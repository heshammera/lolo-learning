"""Test-only proof of possession of a P-256 device key, not hardware attestation."""
import base64
import hashlib
import re
import secrets
import uuid
from billing import require_staging, parent_for_test, identifier
from billing_entitlements import policy
from family_accounts import FamilyError,digest_token
from offline_license import _issue_locked, b64, DEVICE_LIMITS

def decode(value,limit):
    if type(value) is not str or not re.fullmatch(r"[A-Za-z0-9_-]+",value) or len(value)>((limit*4+2)//3):raise FamilyError(400,"Invalid proof encoding.")
    try:raw=base64.urlsafe_b64decode(value+"="*((-len(value))%4))
    except ValueError:raise FamilyError(400,"Invalid proof encoding.") from None
    if len(raw)>limit or b64(raw)!=value:raise FamilyError(400,"Invalid proof encoding.")
    return raw

def public_key(raw):
    from cryptography.hazmat.primitives.serialization import load_der_public_key,Encoding,PublicFormat
    from cryptography.hazmat.primitives.asymmetric import ec
    try:
        key=load_der_public_key(raw)
        if not isinstance(key,ec.EllipticCurvePublicKey) or not isinstance(key.curve,ec.SECP256R1) or key.public_bytes(Encoding.DER,PublicFormat.SubjectPublicKeyInfo)!=raw:raise ValueError()
        return key
    except (ValueError,TypeError):raise FamilyError(400,"Invalid device public key.") from None

def message(parent,device,cid,nonce,digest):
    return "\n".join(("LOLO-OFFLINE-TEST-V1",str(parent),str(device),str(cid),b64(nonce),digest.hex()))

def begin(store,token,device_id,public_spki):
    require_staging()
    device=identifier(device_id);raw=decode(public_spki,128);public_key(raw)
    digest=hashlib.sha256(raw).digest()
    with store.connect() as db:
        parent=parent_for_test(store,db,token,lock=True)
        if policy(db,parent)["planId"] not in DEVICE_LIMITS:raise FamilyError(403,"Paid test subscription required.")
        existing=db.execute("SELECT parent_id,revoked_at,key_digest FROM lolo_offline_test_devices WHERE device_id=%s",(device,)).fetchone()
        if existing and (existing[0]!=parent or existing[1] is not None or existing[2] is None or bytes(existing[2])!=digest):raise FamilyError(409,"Device binding unavailable.")
        db.execute("DELETE FROM lolo_offline_test_challenges WHERE parent_id=%s AND expires_at<=clock_timestamp()",(parent,))
        if db.execute("SELECT count(*) FROM lolo_offline_test_challenges WHERE parent_id=%s",(parent,)).fetchone()[0]>=5:raise FamilyError(429,"Too many pending challenges.")
        cid=uuid.uuid4();nonce=secrets.token_bytes(32)
        db.execute("INSERT INTO lolo_offline_test_challenges(id,parent_id,device_id,session_digest,public_key,nonce) VALUES (%s,%s,%s,%s,%s,%s)",(cid,parent,device,digest_token(token),raw,nonce))
        return {"challengeId":str(cid),"message":message(parent,device,cid,nonce,digest),"testOnly":True}

def complete(store,token,challenge_id,signature,key_id,signing_key):
    require_staging()
    cid=identifier(challenge_id);sig=decode(signature,80)
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives import hashes
    from cryptography.exceptions import InvalidSignature
    with store.connect() as db:
        parent=parent_for_test(store,db,token,lock=True)
        row=db.execute("""SELECT device_id,public_key,nonce FROM lolo_offline_test_challenges
          WHERE id=%s AND parent_id=%s AND session_digest=%s AND expires_at>clock_timestamp() FOR UPDATE""",(cid,parent,digest_token(token))).fetchone()
        if not row:raise FamilyError(409,"Challenge unavailable.")
        device,raw,nonce=row;raw=bytes(raw);digest=hashlib.sha256(raw).digest()
        try:public_key(raw).verify(sig,message(parent,device,cid,bytes(nonce),digest).encode("ascii"),ec.ECDSA(hashes.SHA256()))
        except (InvalidSignature,ValueError):raise FamilyError(403,"Invalid device signature.") from None
        envelope=_issue_locked(db,parent,device,key_id,signing_key,digest)
        db.execute("DELETE FROM lolo_offline_test_challenges WHERE id=%s",(cid,))
        return envelope
