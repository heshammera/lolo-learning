"""Owner-only synthetic billing administration. Edits and audit are atomic."""
from family_accounts import FamilyError
from billing import require_staging, plan_record, identifier

FIELDS={"monthlyMinor","yearlyMinor","childLimit","voiceSecondsMonthly","pronunciationAttemptsMonthly","enabled"}
SELECT="id,monthly_minor,yearly_minor,child_limit,voice_seconds,pronunciation_attempts,enabled,revision"

def owner(admin,token):
    require_staging()
    return identifier(admin.inspect(token,"billing:manage")["id"])

def record(row):
    return {**plan_record(row[:7]),"revision":row[7]}

def list_plans(store,admin,token):
    owner(admin,token)
    with store.connect() as db:
        return {"plans":[record(r) for r in db.execute("SELECT "+SELECT+" FROM lolo_billing_plans ORDER BY CASE id WHEN 'free' THEN 0 WHEN 'plus' THEN 1 ELSE 2 END").fetchall()],"testOnly":True}

def validate(plan,values):
    if plan not in ("free","plus","family") or type(values) is not dict or set(values)!=FIELDS:
        raise FamilyError(400,"Invalid policy.")
    bounds={"monthlyMinor":(0,100000000),"yearlyMinor":(0,100000000),"childLimit":(1,12),"voiceSecondsMonthly":(0,360000),"pronunciationAttemptsMonthly":(0,10000)}
    for key,(low,high) in bounds.items():
        if type(values[key]) is not int or not low<=values[key]<=high:raise FamilyError(400,"Invalid policy limit.")
    if type(values["enabled"]) is not bool:raise FamilyError(400,"Invalid status.")
    if plan=="free":
        if values["monthlyMinor"] or values["yearlyMinor"] or not values["enabled"]:raise FamilyError(400,"Free must remain free and enabled.")
    elif min(values["monthlyMinor"],values["yearlyMinor"])<=0:
        raise FamilyError(400,"Paid price required.")

def change_plan(store,admin,token,plan,revision,values):
    actor=owner(admin,token)
    validate(plan,values)
    if type(revision) is not int or not 1<=revision<2147483647:raise FamilyError(400,"Invalid revision.")
    from psycopg.types.json import Jsonb
    with store.connect() as db:
        prior=db.execute("SELECT "+SELECT+" FROM lolo_billing_plans WHERE id=%s FOR UPDATE",(plan,)).fetchone()
        if not prior or prior[7]!=revision:raise FamilyError(409,"Policy changed.")
        result=db.execute("""UPDATE lolo_billing_plans SET monthly_minor=%s,yearly_minor=%s,child_limit=%s,
          voice_seconds=%s,pronunciation_attempts=%s,enabled=%s,revision=revision+1 WHERE id=%s RETURNING """+SELECT,
          (values["monthlyMinor"],values["yearlyMinor"],values["childLimit"],values["voiceSecondsMonthly"],values["pronunciationAttemptsMonthly"],values["enabled"],plan)).fetchone()
        before,after=record(prior),record(result)
        db.execute("INSERT INTO lolo_billing_plan_audit(actor_id,plan_id,before_policy,after_policy) VALUES (%s,%s,%s,%s)",(actor,plan,Jsonb(before),Jsonb(after)))
        return {"plan":after,"testOnly":True}

def history(store,admin,token):
    owner(admin,token)
    with store.connect() as db:
        rows=db.execute("SELECT actor_id,plan_id,before_policy,after_policy,changed_at FROM lolo_billing_plan_audit ORDER BY id DESC LIMIT 50").fetchall()
        return {"changes":[{"actorId":str(r[0]),"planId":r[1],"before":r[2],"after":r[3],"changedAt":r[4].isoformat()} for r in rows],"testOnly":True}
