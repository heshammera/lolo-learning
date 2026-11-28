"""Test-only authenticated lifecycle. Signed denial survives offline reconnect."""
from billing import require_staging,parent_for_test,identifier
from billing_entitlements import policy,slots
from family_accounts import FamilyError
from offline_license import DEVICE_LIMITS,sign
import re

def status(store,token,device_id,device_digest,key_id,key):
    require_staging()
    device=identifier(device_id)
    if type(device_digest) is not str or not re.fullmatch(r"[a-f0-9]{64}",device_digest):raise FamilyError(400,"Invalid device binding.")
    with store.connect() as db:
        parent=parent_for_test(store,db,token,lock=True)
        row=db.execute("SELECT sequence,revoked_at,key_digest FROM lolo_offline_test_devices WHERE parent_id=%s AND device_id=%s",(parent,device)).fetchone()
        if not row or row[2] is None or bytes(row[2]).hex()!=device_digest:raise FamilyError(404,"Device unavailable.")
        p=policy(db,parent)
        limit=DEVICE_LIMITS.get(p["planId"],0)
        active=db.execute("""SELECT device_id FROM lolo_offline_test_devices WHERE parent_id=%s AND revoked_at IS NULL ORDER BY registered_at,device_id LIMIT %s""",(parent,limit)).fetchall()
        allowed=row[1] is None and (device,) in active and bool(slots(db,parent,p["childLimit"]))
        # An allowed response is not an access grant; a fresh challenge must renew the lease.
        now=db.execute("SELECT floor(extract(epoch FROM clock_timestamp()))::bigint").fetchone()[0]
        payload={"format":1,"audience":"lolo-offline-status-test","testOnly":True,"parentId":str(parent),"deviceId":str(device),"deviceKeySha256":device_digest,"sequence":row[0],"issuedAt":now,"status":"renew" if allowed else "denied"}
        return sign(payload,key_id,key)
