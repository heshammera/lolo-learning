"""Test-only signed local entitlement contract; never a live access grant."""
import base64
import json
import re
from billing import require_staging, parent_for_test, identifier
from billing_entitlements import policy,slots
from family_accounts import FamilyError

MAX_AGE=30*86400
DEVICE_LIMITS={"plus":2,"family":4}
LOCAL_FEATURES=("advanced-review","advanced-tests","full-curricula","local-progress")

def b64(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")

def sign(payload,key_id,key):
    from cryptography.hazmat.primitives.asymmetric import ec,utils
    from cryptography.hazmat.primitives import hashes
    if type(key_id) is not str or not re.fullmatch(r"test-[A-Za-z0-9_-]{1,55}",key_id) or not isinstance(key,ec.EllipticCurvePrivateKey) or not isinstance(key.curve,ec.SECP256R1):
        raise FamilyError(400,"Test P-256 key required.")
    raw=json.dumps(payload,sort_keys=True,separators=(",",":"),ensure_ascii=True).encode("ascii")
    r,s=utils.decode_dss_signature(key.sign(raw,ec.ECDSA(hashes.SHA256())))
    return {"keyId":key_id,"payload":b64(raw),"signature":b64(r.to_bytes(32,"big")+s.to_bytes(32,"big"))}

def issue(store,token,device_id,key_id,key):
    require_staging()
    device=identifier(device_id)
    with store.connect() as db:
        parent=parent_for_test(store,db,token,lock=True)
        return _issue_locked(db,parent,device,key_id,key)

def _issue_locked(db,parent,device,key_id,key,key_digest=None):
    p=policy(db,parent);plan=p["planId"]
    if plan not in DEVICE_LIMITS:raise FamilyError(403,"Paid test subscription required.")
    children=slots(db,parent,p["childLimit"])
    if not children:raise FamilyError(409,"Assign a child first.")
    time=db.execute("""SELECT floor(extract(epoch FROM clock_timestamp()))::bigint,
        floor(extract(epoch FROM ends_at))::bigint FROM lolo_billing_test_effective WHERE parent_id=%s""",(parent,)).fetchone()
    if not time:raise FamilyError(409,"Subscription unavailable.")
    now,expiry=time;ends=min(now+MAX_AGE,expiry)
    if ends<=now:raise FamilyError(409,"Subscription expired.")
    existing=db.execute("SELECT parent_id,sequence,revoked_at,key_digest FROM lolo_offline_test_devices WHERE device_id=%s",(device,)).fetchone()
    if existing and (existing[0]!=parent or existing[2] is not None or (bytes(existing[3]) if existing[3] is not None else None)!=key_digest):raise FamilyError(409,"Device unavailable.")
    # On downgrade, only earliest registered devices remain eligible for new leases.
    active=db.execute("""SELECT device_id FROM lolo_offline_test_devices WHERE parent_id=%s AND revoked_at IS NULL
        ORDER BY registered_at,device_id LIMIT %s""",(parent,DEVICE_LIMITS[plan])).fetchall()
    if existing and (device,) not in active:raise FamilyError(409,"Device exceeds plan limit.")
    if not existing:
        if len(active)>=DEVICE_LIMITS[plan]:raise FamilyError(409,"Device limit reached.")
        db.execute("INSERT INTO lolo_offline_test_devices(parent_id,device_id,key_digest) VALUES (%s,%s,%s)",(parent,device,key_digest))
    seq=db.execute("UPDATE lolo_offline_test_devices SET sequence=sequence+1 WHERE parent_id=%s AND device_id=%s RETURNING sequence",(parent,device)).fetchone()[0]
    payload={"format":1,"audience":"lolo-offline-test","testOnly":True,"licenseId":str(__import__("uuid").uuid4()),
        "parentId":str(parent),"deviceId":str(device),"planId":plan,"childIds":sorted(str(c) for c in children),
        "features":list(LOCAL_FEATURES),"issuedAt":now,"expiresAt":ends,"subscriptionEndsAt":expiry,"sequence":seq}
    if key_digest is not None:
        payload["format"]=2;payload["deviceKeySha256"]=key_digest.hex()
    return sign(payload,key_id,key)

def revoke(store,token,device_id):
    require_staging()
    with store.connect() as db:
        parent=parent_for_test(store,db,token,lock=True)
        result=db.execute("""UPDATE lolo_offline_test_devices SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP)
            WHERE parent_id=%s AND device_id=%s""",(parent,identifier(device_id)))
        if not result.rowcount:raise FamilyError(404,"Device unavailable.")
        return {"revoked":True,"testOnly":True}

def devices(store,token):
    require_staging()
    with store.connect() as db:
        parent=parent_for_test(store,db,token)
        rows=db.execute("SELECT device_id,registered_at,revoked_at,sequence,key_digest IS NOT NULL FROM lolo_offline_test_devices WHERE parent_id=%s ORDER BY registered_at,device_id LIMIT 100",(parent,)).fetchall()
        return [{"deviceId":str(r[0]),"registeredAt":r[1].isoformat(),"revoked":r[2] is not None,"sequence":r[3],"keyBound":r[4]} for r in rows]
