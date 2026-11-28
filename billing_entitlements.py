"""Synthetic server-side feature decisions and atomic quota reservations.
Not connected to live voice, homework, content or provider calls.
"""
from family_accounts import FamilyError
from billing import require_staging, parent_for_test, identifier, FEATURES


def policy(db,parent):
    row=db.execute("""SELECT p.id,p.child_limit,p.voice_seconds,p.pronunciation_attempts
        FROM lolo_billing_plans p WHERE p.id=COALESCE(
        (SELECT e.plan_id FROM lolo_billing_test_entitlements e WHERE e.parent_id=%s
          AND e.starts_at<=CURRENT_TIMESTAMP AND e.ends_at>CURRENT_TIMESTAMP),'free')""",(parent,)).fetchone()
    if not row:raise FamilyError(503,"Plan policy unavailable.")
    return {"planId":row[0],"childLimit":row[1],"voiceLimit":row[2],"pronunciationLimit":row[3]}


def slots(db,parent,limit):
    # Deterministic downgrade: earliest assigned slots remain eligible, no profile deletion.
    rows=db.execute("""SELECT s.child_id FROM lolo_billing_test_slots s JOIN lolo_children c ON c.id=s.child_id
        WHERE s.parent_id=%s AND c.parent_id=%s ORDER BY s.assigned_at,s.child_id LIMIT %s""",(parent,parent,limit)).fetchall()
    return [r[0] for r in rows]


def owned_child(db,parent,child_id):
    child=identifier(child_id)
    if not db.execute("SELECT id FROM lolo_children WHERE id=%s AND parent_id=%s",(child,parent)).fetchone():
        raise FamilyError(404,"Profile not found.")
    return child


def assign_slot(store,token,child_id):
    require_staging()
    with store.connect() as db:
        parent=parent_for_test(store,db,token,lock=True)
        child=owned_child(db,parent,child_id)
        p=policy(db,parent)
        active=slots(db,parent,p["childLimit"])
        if child in active:return True
        if len(active)>=p["childLimit"]:raise FamilyError(409,"No available child slot.")
        db.execute("""INSERT INTO lolo_billing_test_slots(child_id,parent_id)
            VALUES (%s,%s) ON CONFLICT(child_id) DO NOTHING""",(child,parent))
        return child in slots(db,parent,p["childLimit"])


def remove_slot(store,token,child_id):
    require_staging()
    with store.connect() as db:
        parent=parent_for_test(store,db,token,lock=True)
        child=owned_child(db,parent,child_id)
        return bool(db.execute("DELETE FROM lolo_billing_test_slots WHERE child_id=%s AND parent_id=%s",(child,parent)).rowcount)


def feature_allowed(store,token,child_id,feature):
    require_staging()
    with store.connect() as db:
        parent=parent_for_test(store,db,token)
        child=owned_child(db,parent,child_id)
        p=policy(db,parent)
        return child in slots(db,parent,p["childLimit"]) and isinstance(feature,str) and feature in FEATURES[p["planId"]]


def month_now(db):
    return db.execute("SELECT date_trunc('month',CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date").fetchone()[0]


def used(db,parent,month,feature):
    return db.execute("""SELECT COALESCE(sum(units),0) FROM lolo_billing_test_usage
        WHERE parent_id=%s AND month=%s AND feature=%s""",(parent,month,feature)).fetchone()[0]


def usage_status(store,token):
    require_staging()
    with store.connect() as db:
        parent=parent_for_test(store,db,token,lock=True)
        p=policy(db,parent)
        month=month_now(db)
        return {**p,"month":month.isoformat(),"voiceUsed":used(db,parent,month,"voice"),
                "pronunciationUsed":used(db,parent,month,"pronunciation"),
                "activeChildIds":[str(c) for c in slots(db,parent,p["childLimit"])],"testOnly":True}


def reserve(store,token,child_id,feature,units,operation_id):
    """Charge a bounded reservation before a future provider call.
    Duplicate is a record lookup, NOT permission to start a provider call again.
    No refund/release until provider reconciliation is implemented.
    """
    require_staging()
    if feature not in ("voice","pronunciation") or type(units) is not int or not 1<=units<=(300 if feature=="voice" else 1):
        raise FamilyError(400,"Invalid reservation.")
    operation=identifier(operation_id)
    with store.connect() as db:
        parent=parent_for_test(store,db,token,lock=True)
        child=owned_child(db,parent,child_id)
        prior=db.execute("""SELECT child_id,feature,units FROM lolo_billing_test_usage
            WHERE parent_id=%s AND operation_id=%s""",(parent,operation)).fetchone()
        if prior:
            if prior!=(child,feature,units):raise FamilyError(409,"Operation already used.")
            return {"reserved":False,"duplicate":True,"testOnly":True}
        p=policy(db,parent)
        if child not in slots(db,parent,p["childLimit"]):raise FamilyError(403,"Child not assigned.")
        month=month_now(db)
        limit=p["voiceLimit"] if feature=="voice" else p["pronunciationLimit"]
        consumed=used(db,parent,month,feature)
        if consumed+units>limit:raise FamilyError(429,"Monthly allowance exhausted.")
        db.execute("""INSERT INTO lolo_billing_test_usage(parent_id,operation_id,child_id,feature,units,month)
            VALUES (%s,%s,%s,%s,%s,%s)""",(parent,operation,child,feature,units,month))
        return {"reserved":True,"duplicate":False,"remaining":limit-consumed-units,"testOnly":True}
