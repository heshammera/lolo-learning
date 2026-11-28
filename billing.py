"""Synthetic subscription foundation. No real payment, no production entitlement."""
import os
import uuid
from types import MappingProxyType
from family_accounts import FamilyError
from progress_sync import uuid_value, InvalidProgress

FEATURES=MappingProxyType({
    "free":("selected-curricula","basic-tests","local-progress","basic-review","voice-trial"),
    "plus":("full-curricula","advanced-tests","local-progress","advanced-review","voice","pronunciation","homework","detailed-reports","cloud-sync"),
    "family":("full-curricula","advanced-tests","local-progress","advanced-review","voice","pronunciation","homework","detailed-reports","cloud-sync"),
})
# These are commercial policy identifiers, not claims that implementations are live.
def require_staging():
    if os.environ.get("LOLO_BILLING_STAGING")!="true":
        raise FamilyError(503,"Billing staging disabled.")

def identifier(value):
    try:return uuid_value(value)
    except InvalidProgress:raise FamilyError(400,"Invalid identifier.") from None

def plan_record(row):
    return {"id":row[0],"currency":"EGP","monthlyMinor":row[1],"yearlyMinor":row[2],
            "childLimit":row[3],"voiceSecondsMonthly":row[4],"pronunciationAttemptsMonthly":row[5],
            "features":list(FEATURES[row[0]]),"enabled":row[6]}

def catalog(store):
    require_staging()
    with store.connect() as db:
        rows=db.execute("""SELECT id,monthly_minor,yearly_minor,child_limit,voice_seconds,pronunciation_attempts,enabled
            FROM lolo_billing_plans ORDER BY CASE id WHEN 'free' THEN 0 WHEN 'plus' THEN 1 ELSE 2 END""").fetchall()
        return [plan_record(row) for row in rows if row[6]]

def parent_for_test(store,db,token,lock=False):
    parent=store.authenticated_parent(db,token)
    query="SELECT email FROM lolo_parents WHERE id=%s AND disabled_at IS NULL"
    if lock:query+=" FOR UPDATE"
    row=db.execute(query,(parent,)).fetchone()
    if not row or not row[0].endswith("@example.test"):
        raise FamilyError(403,"Synthetic account required.")
    return parent

def order_record(row):
    return {"id":str(row[0]),"planId":row[1],"period":row[2],"amountMinor":row[3],"currency":row[4],
            "status":row[5],"expiresAt":row[6].isoformat(),"testOnly":True}

def create_order(store,token,plan,period,operation_id,expected_amount=None,discount_code=None):
    require_staging()
    if plan not in ("plus","family") or period not in ("monthly","yearly"):
        raise FamilyError(400,"Invalid paid plan or period.")
    if expected_amount is not None and (type(expected_amount) is not int or expected_amount<=0):
        raise FamilyError(400,"Invalid quote.")
    operation=identifier(operation_id)
    if discount_code is not None:
        from billing_discounts import code_digest,calculate
        digest=code_digest(discount_code)
        if expected_amount is None:raise FamilyError(400,"Discount quote required.")
    with store.connect() as db:
        parent=parent_for_test(store,db,token,lock=True)
        previous=db.execute("""SELECT id,plan_id,period,amount_minor,currency,status,expires_at
            FROM lolo_billing_orders WHERE parent_id=%s AND operation_id=%s""",(parent,operation)).fetchone()
        if previous:
            if previous[1]!=plan or previous[2]!=period or (expected_amount is not None and previous[3]!=expected_amount):
                raise FamilyError(409,"Operation already used.")
            existing=db.execute("SELECT d.code_hash FROM lolo_billing_orders o LEFT JOIN lolo_billing_test_discounts d ON d.id=o.discount_id WHERE o.id=%s",(previous[0],)).fetchone()[0]
            if (discount_code is None and existing is not None) or (discount_code is not None and (existing is None or bytes(existing)!=digest)):raise FamilyError(409,"Operation already used.")
            return order_record(previous)
        row=db.execute("SELECT monthly_minor,yearly_minor FROM lolo_billing_plans WHERE id=%s AND enabled=true FOR SHARE",(plan,)).fetchone()
        if not row:raise FamilyError(404,"Plan unavailable.")
        amount=row[0] if period=="monthly" else row[1]
        # Avoid unlimited pending orders; expired intents are not usable.
        db.execute("UPDATE lolo_billing_orders SET status='cancelled' WHERE parent_id=%s AND status='pending' AND expires_at<=CURRENT_TIMESTAMP",(parent,))
        if db.execute("SELECT count(*) FROM lolo_billing_orders WHERE parent_id=%s AND status='pending'",(parent,)).fetchone()[0]>=3:
            raise FamilyError(409,"Too many pending orders.")
        original=amount
        cid,discount=(calculate(db,parent,plan,period,amount,discount_code,lock=True) if discount_code is not None else (None,0))
        amount-=discount
        if expected_amount is not None and amount!=expected_amount:raise FamilyError(409,"Quote changed; review current price.")
        result=db.execute("""INSERT INTO lolo_billing_orders(id,parent_id,operation_id,plan_id,period,amount_minor,currency,discount_id,original_amount_minor,discount_minor)
            VALUES (%s,%s,%s,%s,%s,%s,'EGP',%s,%s,%s) RETURNING id,plan_id,period,amount_minor,currency,status,expires_at""",
            (uuid.uuid4(),parent,operation,plan,period,amount,cid,original,discount)).fetchone()
        return order_record(result)

def read_order(store,token,order_id):
    require_staging()
    with store.connect() as db:
        parent=parent_for_test(store,db,token)
        row=db.execute("""SELECT id,plan_id,period,amount_minor,currency,
            CASE WHEN status='pending' AND expires_at<=CURRENT_TIMESTAMP THEN 'cancelled' ELSE status END,expires_at
            FROM lolo_billing_orders WHERE id=%s AND parent_id=%s""",(identifier(order_id),parent)).fetchone()
        if not row:raise FamilyError(404,"Order not found.")
        return order_record(row)

def test_settle(store,order_id,amount_minor,currency):
    """Trusted synthetic test harness only. Never expose as an HTTP endpoint.
    This creates a TEST entitlement, not a real payment or access grant.
    """
    require_staging()
    if type(amount_minor) is not int or currency!="EGP":
        raise FamilyError(400,"Invalid payment evidence.")
    with store.connect() as db:
        order=identifier(order_id)
        row=db.execute("""SELECT o.parent_id,o.plan_id,o.period,o.amount_minor,o.status,o.expires_at> CURRENT_TIMESTAMP,p.email
            FROM lolo_billing_orders o JOIN lolo_parents p ON p.id=o.parent_id
            WHERE o.id=%s AND p.disabled_at IS NULL FOR UPDATE OF o,p""",(order,)).fetchone()
        if not row or not row[6].endswith("@example.test"):
            raise FamilyError(404,"Synthetic order not found.")
        parent,plan,period,expected,status,valid,_=row
        if amount_minor!=expected:raise FamilyError(400,"Amount mismatch.")
        if status=="test_paid":return {"status":"test_paid","testOnly":True}
        if status!="pending" or not valid:raise FamilyError(409,"Order inactive.")
        if db.execute("SELECT 1 FROM lolo_billing_test_effective WHERE parent_id=%s",(parent,)).fetchone():
            raise FamilyError(409,"Existing active test subscription; renewal not yet supported.")
        interval="1 month" if period=="monthly" else "1 year"
        db.execute("""INSERT INTO lolo_billing_test_entitlements(parent_id,order_id,plan_id,starts_at,ends_at)
            VALUES (%s,%s,%s,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP+%s::interval)
            ON CONFLICT(parent_id) DO UPDATE SET order_id=EXCLUDED.order_id,plan_id=EXCLUDED.plan_id,starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at""",
            (parent,order,plan,interval))
        db.execute("UPDATE lolo_billing_orders SET status='test_paid' WHERE id=%s",(order,))
        return {"status":"test_paid","testOnly":True}

def test_subscription(store,token):
    require_staging()
    with store.connect() as db:
        parent=parent_for_test(store,db,token)
        row=db.execute("""SELECT plan_id,ends_at FROM lolo_billing_test_effective WHERE parent_id=%s""",(parent,)).fetchone()
        return {"planId":row[0] if row else "free","endsAt":row[1].isoformat() if row else None,"testOnly":True}

def list_orders(store,token):
    require_staging()
    with store.connect() as db:
        parent=parent_for_test(store,db,token)
        rows=db.execute("""SELECT id,plan_id,period,amount_minor,currency,
            CASE WHEN status='pending' AND expires_at<=CURRENT_TIMESTAMP THEN 'cancelled' ELSE status END,expires_at
            FROM lolo_billing_orders WHERE parent_id=%s ORDER BY created_at DESC,id LIMIT 30""",(parent,)).fetchall()
        return [order_record(row) for row in rows]

def cancel_order(store,token,order_id):
    require_staging()
    with store.connect() as db:
        parent=parent_for_test(store,db,token,lock=True)
        row=db.execute("SELECT status FROM lolo_billing_orders WHERE id=%s AND parent_id=%s FOR UPDATE",(identifier(order_id),parent)).fetchone()
        if not row:raise FamilyError(404,"Order not found.")
        if row[0]=="test_paid":raise FamilyError(409,"Paid test order cannot be cancelled.")
        db.execute("UPDATE lolo_billing_orders SET status='cancelled' WHERE id=%s AND parent_id=%s",(identifier(order_id),parent))
        return {"status":"cancelled","testOnly":True}
