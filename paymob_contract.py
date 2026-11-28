"""Paymob test-only protocol adapter. No network request, no production route.
POST HMAC field order follows the official transaction callback documentation.
Only standalone successful non-refunded payment is eligible for synthetic settlement.
"""
import hashlib
import hmac
import re
from urllib.parse import urlencode
from family_accounts import FamilyError
from billing import require_staging, identifier, parent_for_test

HMAC_KEYS=("amount_cents","created_at","currency","error_occured","has_parent_transaction","id","integration_id","is_3d_secure","is_auth","is_capture","is_refunded","is_standalone_payment","is_voided","order.id","owner","pending","source_data.pan","source_data.sub_type","source_data.type","success")
BOOLEAN_KEYS={"error_occured","has_parent_transaction","is_3d_secure","is_auth","is_capture","is_refunded","is_standalone_payment","is_voided","pending","success"}
INTEGER_KEYS={"amount_cents","id","integration_id","order.id","owner"}
MAX_ID=2**63-1

def positive(v):
    return type(v) is int and 0<v<=MAX_ID

def invalid():
    return FamilyError(400,"Invalid Paymob test evidence.")

def fields(payload):
    if type(payload) is not dict or payload.get("type")!="TRANSACTION" or type(payload.get("obj")) is not dict:raise invalid()
    result={}
    for key in HMAC_KEYS:
        value=payload["obj"]
        for part in key.split("."):
            if type(value) is not dict or part not in value:raise invalid()
            value=value[part]
        if key in BOOLEAN_KEYS:
            if type(value) is not bool:raise invalid()
        elif key in INTEGER_KEYS:
            if not positive(value):raise invalid()
        elif type(value) is not str or not 1<=len(value)<=128 or any(ord(c)<32 or ord(c)>126 for c in value):
            raise invalid()
        result[key]=value
    return result

def canonical(values):
    return "".join(("true" if v else "false") if type(v) is bool else str(v) for v in (values[k] for k in HMAC_KEYS))

def verified_payment(payload,signature,secret):
    require_staging()
    if type(secret) is not str or not 16<=len(secret)<=256 or type(signature) is not str or not re.fullmatch(r"[0-9a-fA-F]{128}",signature):raise invalid()
    v=fields(payload)
    digest=hmac.new(secret.encode("utf-8"),canonical(v).encode("ascii"),hashlib.sha512).hexdigest()
    if not hmac.compare_digest(digest,signature.lower()):raise FamilyError(403,"Invalid callback signature.")
    if v["currency"]!="EGP" or not v["success"] or not v["is_standalone_payment"] or any(v[k] for k in ("pending","error_occured","has_parent_transaction","is_auth","is_capture","is_refunded","is_voided")):
        raise FamilyError(409,"Not an eligible standalone payment.")
    # is_live is not HMAC-covered: never use it as a trust boundary. Test DB and test credential separation required.
    if payload["obj"].get("is_live") is not False:raise FamilyError(403,"Only test evidence permitted.")
    return {k:v[k] for k in ("id","order.id","amount_cents","integration_id","owner","currency")}

def intention_payload(order,integration_id,billing_data,notification_url,redirection_url):
    """Prepare a test request for a trusted operator transport, no HTTP call."""
    require_staging()
    if order.get("testOnly") is not True or order.get("status")!="pending" or order.get("currency")!="EGP" or order.get("planId") not in ("plus","family") or order.get("period") not in ("monthly","yearly") or not positive(order.get("amountMinor")) or not positive(integration_id):raise invalid()
    reference=str(identifier(order["id"]))
    # Only synthetic contact data; never source this from a child profile.
    if type(billing_data) is not dict or set(billing_data)!={"first_name","last_name","email","phone_number"} or not all(type(x) is str and 1<=len(x)<=100 for x in billing_data.values()) or not billing_data["email"].endswith("@example.test"):raise invalid()
    from urllib.parse import urlsplit
    for url in (notification_url,redirection_url):
        parsed=urlsplit(url)
        if parsed.scheme!="https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:raise invalid()
    return {"amount":order["amountMinor"],"currency":"EGP","payment_methods":[integration_id],
      "items":[{"name":"Lolo "+order["planId"]+" "+order["period"],"amount":order["amountMinor"],"quantity":1}],
      "billing_data":dict(billing_data),"special_reference":reference,"expiration":900,
      "notification_url":notification_url,"redirection_url":redirection_url}

def checkout_url(response,public_key):
    require_staging()
    if type(response) is not dict or not positive(response.get("intention_order_id")) or not isinstance(response.get("id"),str) or not response["id"].startswith("pi_test_") or not isinstance(response.get("client_secret"),str) or not 8<=len(response["client_secret"])<=1024 or not isinstance(public_key,str) or not public_key.startswith("egy_pk_test_"):
        raise invalid()
    return "https://accept.paymob.com/unifiedcheckout/?"+urlencode({"publicKey":public_key,"clientSecret":response["client_secret"]})

def bind_test_intention(store,token,order_id,provider_order_id,integration_id,provider_owner):
    """Trusted internal operator only, after inspecting authenticated provider response.
    Never accept provider IDs from a client/browser redirect.
    """
    require_staging()
    if not all(positive(v) for v in (provider_order_id,integration_id,provider_owner)):raise invalid()
    oid=identifier(order_id)
    with store.connect() as db:
        parent=parent_for_test(store,db,token,lock=True)
        row=db.execute("SELECT status,expires_at>CURRENT_TIMESTAMP FROM lolo_billing_orders WHERE id=%s AND parent_id=%s FOR UPDATE",(oid,parent)).fetchone()
        if not row or row!=("pending",True):raise FamilyError(409,"Order unavailable.")
        previous=db.execute("SELECT provider_order_id,integration_id,provider_owner FROM lolo_paymob_test_intentions WHERE order_id=%s",(oid,)).fetchone()
        expected=(provider_order_id,integration_id,provider_owner)
        if previous:
            if previous!=expected:raise FamilyError(409,"Intent already bound.")
            return
        if db.execute("SELECT 1 FROM lolo_paymob_test_intentions WHERE provider_order_id=%s",(provider_order_id,)).fetchone():raise FamilyError(409,"Provider order already used.")
        db.execute("INSERT INTO lolo_paymob_test_intentions(order_id,provider_order_id,integration_id,provider_owner) VALUES (%s,%s,%s,%s)",(oid,*expected))

def accept_test_callback(store,payload,signature,secret):
    """Atomic receipt + test entitlement. No public route, no real charge.
    Refunds, voids, late paid orders and additional purchases need reconciliation.
    """
    v=verified_payment(payload,signature,secret)
    with store.connect() as db:
        row=db.execute("""SELECT o.id,o.parent_id,o.plan_id,o.period,o.amount_minor,o.status,o.expires_at>CURRENT_TIMESTAMP,
          i.integration_id,i.provider_owner,p.email,p.disabled_at
          FROM lolo_paymob_test_intentions i JOIN lolo_billing_orders o ON o.id=i.order_id
          JOIN lolo_parents p ON p.id=o.parent_id WHERE i.provider_order_id=%s FOR UPDATE OF p,o,i""",(v["order.id"],)).fetchone()
        if not row or not row[9].endswith("@example.test") or row[10] is not None:raise FamilyError(404,"Test order not found.")
        oid,parent,plan,period,amount,status,active,integration,owner,_,_=row
        if (amount,integration,owner)!=(v["amount_cents"],v["integration_id"],v["owner"]):raise FamilyError(409,"Payment evidence mismatch.")
        receipt=db.execute("SELECT transaction_id,amount_minor FROM lolo_paymob_test_receipts WHERE order_id=%s",(oid,)).fetchone()
        if receipt:
            if receipt!=(v["id"],amount):raise FamilyError(409,"Additional payment needs review.")
            return {"status":"test_paid","duplicate":True,"testOnly":True}
        if status!="pending" or not active:raise FamilyError(409,"Payment requires reconciliation.")
        if db.execute("SELECT 1 FROM lolo_billing_test_entitlements WHERE parent_id=%s AND ends_at>CURRENT_TIMESTAMP",(parent,)).fetchone():raise FamilyError(409,"Existing subscription requires review.")
        if db.execute("SELECT 1 FROM lolo_paymob_test_receipts WHERE transaction_id=%s",(v["id"],)).fetchone():raise FamilyError(409,"Transaction already used.")
        interval="1 month" if period=="monthly" else "1 year"
        db.execute("INSERT INTO lolo_paymob_test_receipts(transaction_id,order_id,amount_minor) VALUES (%s,%s,%s)",(v["id"],oid,amount))
        db.execute("""INSERT INTO lolo_billing_test_entitlements(parent_id,order_id,plan_id,starts_at,ends_at)
          VALUES (%s,%s,%s,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP+%s::interval)
          ON CONFLICT(parent_id) DO UPDATE SET order_id=EXCLUDED.order_id,plan_id=EXCLUDED.plan_id,starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at""",(parent,oid,plan,interval))
        db.execute("UPDATE lolo_billing_orders SET status='test_paid' WHERE id=%s",(oid,))
        return {"status":"test_paid","duplicate":False,"testOnly":True}
