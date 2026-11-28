"""Owner-issued and trial-code synthetic subscriptions. No real payment."""
import hashlib
import re
import secrets
import uuid
from family_accounts import FamilyError
from billing import require_staging, parent_for_test, identifier
from billing_owner import owner

GRANT="plan_id,starts_at,ends_at,revoked_at,revision,source"

def state(row):
    if not row:return None
    return {"planId":row[0],"startsAt":row[1].isoformat(),"endsAt":row[2].isoformat(),"revokedAt":row[3].isoformat() if row[3] else None,"revision":row[4],"source":row[5]}

def parent_by_email(db,email):
    if type(email) is not str or not re.fullmatch(r"[A-Za-z0-9._+-]{1,100}@example\.test",email):raise FamilyError(400,"Synthetic email required.")
    row=db.execute("SELECT id FROM lolo_parents WHERE email=%s AND disabled_at IS NULL FOR UPDATE",(email.lower(),)).fetchone()
    if not row:raise FamilyError(404,"Test parent not found.")
    return row[0]

def active(db,parent):
    return db.execute("SELECT 1 FROM lolo_billing_test_effective WHERE parent_id=%s",(parent,)).fetchone() is not None

def plan_ok(db,plan):
    if plan not in ("plus","family") or not db.execute("SELECT 1 FROM lolo_billing_plans WHERE id=%s AND enabled=true",(plan,)).fetchone():raise FamilyError(400,"Paid plan unavailable.")

def audit(db,parent,actor,action,before,after):
    from psycopg.types.json import Jsonb
    db.execute("INSERT INTO lolo_billing_test_grant_audit(parent_id,actor_id,action,before_state,after_state) VALUES (%s,%s,%s,%s,%s)",(parent,actor,action,Jsonb(before) if before else None,Jsonb(after)))

def write_grant(db,parent,plan,days,source,actor,prior):
    row=db.execute("""INSERT INTO lolo_billing_test_grants(parent_id,plan_id,starts_at,ends_at,revision,source)
       VALUES (%s,%s,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP+%s*INTERVAL '1 day',1,%s)
       ON CONFLICT(parent_id) DO UPDATE SET plan_id=EXCLUDED.plan_id,starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,revoked_at=NULL,revision=lolo_billing_test_grants.revision+1,source=EXCLUDED.source
       RETURNING """+GRANT,(parent,plan,days,source)).fetchone()
    result=state(row);audit(db,parent,actor,"trial" if source=="trial" else "grant",state(prior),result);return result

def lookup(store,admin,token,email):
    owner(admin,token)
    with store.connect() as db:
        parent=parent_by_email(db,email)
        row=db.execute("SELECT "+GRANT+" FROM lolo_billing_test_grants WHERE parent_id=%s",(parent,)).fetchone()
        return {"grant":state(row),"active":active(db,parent),"testOnly":True}

def manual_change(store,admin,token,email,action,plan,days,revision):
    actor=owner(admin,token)
    if action not in ("grant","extend","revoke") or type(revision) is not int or revision<0:raise FamilyError(400,"Invalid action.")
    if action=="revoke":
        if plan is not None or days!=0:raise FamilyError(400,"Invalid revocation.")
    elif type(days) is not int or not 1<=days<=366:raise FamilyError(400,"Invalid duration.")
    with store.connect() as db:
        parent=parent_by_email(db,email)
        prior=db.execute("SELECT "+GRANT+" FROM lolo_billing_test_grants WHERE parent_id=%s FOR UPDATE",(parent,)).fetchone()
        if revision!=(prior[4] if prior else 0):raise FamilyError(409,"Grant changed.")
        if action=="grant":
            plan_ok(db,plan)
            if active(db,parent):raise FamilyError(409,"Existing active subscription.")
            return {"grant":write_grant(db,parent,plan,days,"manual",actor,prior),"testOnly":True}
        if not prior or prior[3] is not None:raise FamilyError(409,"No editable grant.")
        if action=="extend":
            if prior[0]!=plan:raise FamilyError(400,"Cannot change active plan.")
            row=db.execute("UPDATE lolo_billing_test_grants SET ends_at=ends_at+%s*INTERVAL '1 day',revision=revision+1 WHERE parent_id=%s AND ends_at>CURRENT_TIMESTAMP AND ends_at+%s*INTERVAL '1 day'<=CURRENT_TIMESTAMP+INTERVAL '366 days' RETURNING "+GRANT,(days,parent,days)).fetchone()
        else:
            row=db.execute("UPDATE lolo_billing_test_grants SET revoked_at=CURRENT_TIMESTAMP,revision=revision+1 WHERE parent_id=%s AND ends_at>CURRENT_TIMESTAMP RETURNING "+GRANT,(parent,)).fetchone()
        if not row:raise FamilyError(409,"Grant expired or exceeds maximum.")
        result=state(row);audit(db,parent,actor,action,state(prior),result)
        return {"grant":result,"testOnly":True}

def create_trial(store,admin,token,campaign,plan,days,max_uses,valid_days):
    actor=owner(admin,token)
    if type(campaign) is not str or not 1<=len(campaign.strip())<=60 or any(ord(c)<32 for c in campaign):raise FamilyError(400,"Invalid campaign.")
    for value,limit in ((days,90),(max_uses,10000),(valid_days,365)):
        if type(value) is not int or not 1<=value<=limit:raise FamilyError(400,"Invalid limit.")
    code="LOLO-"+secrets.token_hex(16).upper()
    cid=uuid.uuid4()
    with store.connect() as db:
        plan_ok(db,plan)
        db.execute("""INSERT INTO lolo_billing_test_coupons(id,code_hash,campaign,plan_id,days,max_uses,expires_at,actor_id)
         VALUES (%s,%s,%s,%s,%s,%s,CURRENT_TIMESTAMP+%s*INTERVAL '1 day',%s)""",(cid,hashlib.sha256(code.encode()).digest(),campaign.strip(),plan,days,max_uses,valid_days,actor))
    return {"id":str(cid),"code":code,"testOnly":True}

def redeem_trial(store,token,code):
    require_staging()
    if type(code) is not str or not re.fullmatch(r"LOLO-[A-F0-9]{32}",code):raise FamilyError(400,"Invalid code.")
    with store.connect() as db:
        parent=parent_for_test(store,db,token,lock=True)
        row=db.execute("""SELECT id,plan_id,days,max_uses FROM lolo_billing_test_coupons
          WHERE code_hash=%s AND enabled=true AND expires_at>CURRENT_TIMESTAMP FOR UPDATE""",(hashlib.sha256(code.encode()).digest(),)).fetchone()
        if not row:raise FamilyError(404,"Code unavailable.")
        cid,plan,days,max_uses=row
        if db.execute("SELECT 1 FROM lolo_billing_test_redemptions WHERE coupon_id=%s AND parent_id=%s",(cid,parent)).fetchone():raise FamilyError(409,"Code already used.")
        if active(db,parent):raise FamilyError(409,"Existing active subscription.")
        if db.execute("SELECT count(*) FROM lolo_billing_test_redemptions WHERE coupon_id=%s",(cid,)).fetchone()[0]>=max_uses:raise FamilyError(409,"Code exhausted.")
        plan_ok(db,plan)
        prior=db.execute("SELECT "+GRANT+" FROM lolo_billing_test_grants WHERE parent_id=%s FOR UPDATE",(parent,)).fetchone()
        db.execute("INSERT INTO lolo_billing_test_redemptions(coupon_id,parent_id) VALUES (%s,%s)",(cid,parent))
        return {"grant":write_grant(db,parent,plan,days,"trial",None,prior),"testOnly":True}

def list_trials(store,admin,token):
    owner(admin,token)
    with store.connect() as db:
        rows=db.execute("""SELECT c.id,c.campaign,c.plan_id,c.days,c.max_uses,c.expires_at,c.enabled,
          (SELECT count(*) FROM lolo_billing_test_redemptions r WHERE r.coupon_id=c.id)
          FROM lolo_billing_test_coupons c ORDER BY c.created_at DESC,c.id LIMIT 100""").fetchall()
        return {"coupons":[{"id":str(r[0]),"campaign":r[1],"planId":r[2],"days":r[3],"maxUses":r[4],"expiresAt":r[5].isoformat(),"enabled":r[6],"used":r[7]} for r in rows],"testOnly":True}

def disable_trial(store,admin,token,coupon_id):
    owner(admin,token)
    with store.connect() as db:
        if not db.execute("UPDATE lolo_billing_test_coupons SET enabled=false WHERE id=%s",(identifier(coupon_id),)).rowcount:raise FamilyError(404,"Code unavailable.")
        return {"ok":True,"testOnly":True}
