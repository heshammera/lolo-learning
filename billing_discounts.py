"""Synthetic discounts. No live payments or provider calls."""
import hashlib
import re
import secrets
import uuid
from family_accounts import FamilyError
from billing import require_staging, parent_for_test, identifier
from billing_owner import owner

def code_digest(code):
    if type(code) is not str or not re.fullmatch(r"SALE-[A-F0-9]{32}",code):raise FamilyError(400,"Invalid discount code.")
    return hashlib.sha256(code.encode("ascii")).digest()

def create_discount(store,admin,token,campaign,plan,period,kind,value,max_uses,valid_days):
    actor=owner(admin,token)
    if type(campaign) is not str or not 1<=len(campaign.strip())<=60 or any(ord(c)<32 for c in campaign):raise FamilyError(400,"Invalid campaign.")
    if plan not in ("plus","family") or period not in ("monthly","yearly") or kind not in ("percent","fixed"):raise FamilyError(400,"Invalid discount policy.")
    for v,limit in ((value,99 if kind=="percent" else 100000000),(max_uses,10000),(valid_days,365)):
        if type(v) is not int or not 1<=v<=limit:raise FamilyError(400,"Invalid limit.")
    code="SALE-"+secrets.token_hex(16).upper();cid=uuid.uuid4()
    with store.connect() as db:
        row=db.execute("SELECT monthly_minor,yearly_minor FROM lolo_billing_plans WHERE id=%s AND enabled=true",(plan,)).fetchone()
        if not row:raise FamilyError(400,"Plan unavailable.")
        amount=row[0] if period=="monthly" else row[1]
        if kind=="fixed" and value>=amount:raise FamilyError(400,"Discount must leave a positive price.")
        db.execute("""INSERT INTO lolo_billing_test_discounts(id,code_hash,campaign,plan_id,period,kind,value,max_uses,expires_at,actor_id)
         VALUES (%s,%s,%s,%s,%s,%s,%s,%s,CURRENT_TIMESTAMP+%s*INTERVAL '1 day',%s)""",(cid,code_digest(code),campaign.strip(),plan,period,kind,value,max_uses,valid_days,actor))
    return {"id":str(cid),"code":code,"testOnly":True}

def calculate(db,parent,plan,period,amount,code,lock=False):
    digest=code_digest(code)
    query="""SELECT id,plan_id,period,kind,value,max_uses FROM lolo_billing_test_discounts
      WHERE code_hash=%s AND enabled=true AND expires_at>clock_timestamp()"""
    if lock:query+=" FOR UPDATE"
    row=db.execute(query,(digest,)).fetchone()
    if not row or row[1]!=plan or row[2]!=period:raise FamilyError(404,"Discount unavailable.")
    cid,_,_,kind,value,maximum=row
    # Count pending holds conservatively until cancellation; paid uses remain counted.
    if db.execute("SELECT 1 FROM lolo_billing_orders WHERE discount_id=%s AND parent_id=%s AND status IN ('pending','test_paid')",(cid,parent)).fetchone():raise FamilyError(409,"Code already reserved or used.")
    if db.execute("SELECT count(*) FROM lolo_billing_orders WHERE discount_id=%s AND status IN ('pending','test_paid')",(cid,)).fetchone()[0]>=maximum:raise FamilyError(409,"Discount exhausted.")
    discount=amount*value//100 if kind=="percent" else value
    if not 0<discount<amount:raise FamilyError(409,"Discount invalid at current price.")
    return cid,discount

def quote(store,token,plan,period,code):
    require_staging()
    if plan not in ("plus","family") or period not in ("monthly","yearly"):raise FamilyError(400,"Invalid plan.")
    with store.connect() as db:
        parent=parent_for_test(store,db,token)
        row=db.execute("SELECT monthly_minor,yearly_minor FROM lolo_billing_plans WHERE id=%s AND enabled=true",(plan,)).fetchone()
        if not row:raise FamilyError(404,"Plan unavailable.")
        amount=row[0] if period=="monthly" else row[1]
        _,discount=calculate(db,parent,plan,period,amount,code)
        return {"originalAmountMinor":amount,"discountMinor":discount,"amountMinor":amount-discount,"currency":"EGP","testOnly":True}

def list_discounts(store,admin,token):
    owner(admin,token)
    with store.connect() as db:
        rows=db.execute("""SELECT c.id,c.campaign,c.plan_id,c.period,c.kind,c.value,c.max_uses,c.expires_at,c.enabled,
         (SELECT count(*) FROM lolo_billing_orders o WHERE o.discount_id=c.id AND o.status IN ('pending','test_paid'))
         FROM lolo_billing_test_discounts c ORDER BY c.created_at DESC,c.id LIMIT 100""").fetchall()
        return {"discounts":[{"id":str(r[0]),"campaign":r[1],"planId":r[2],"period":r[3],"kind":r[4],"value":r[5],"maxUses":r[6],"expiresAt":r[7].isoformat(),"enabled":r[8],"reservedOrUsed":r[9]} for r in rows],"testOnly":True}

def disable_discount(store,admin,token,cid):
    owner(admin,token)
    with store.connect() as db:
        if not db.execute("UPDATE lolo_billing_test_discounts SET enabled=false WHERE id=%s",(identifier(cid),)).rowcount:raise FamilyError(404,"Discount unavailable.")
        return {"ok":True,"testOnly":True}
