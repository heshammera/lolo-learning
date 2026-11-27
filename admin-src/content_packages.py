"""Offline signing primitive, no key generation or production export endpoints."""
import base64
import json
import re
from cms_drafts import validate,draft_id
from admin_identity import FamilyError

def b64(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")

def sign_package(key_id,private_key,draft,release,version,sequence,content):
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
    from cryptography.hazmat.primitives import hashes
    if not isinstance(key_id,str) or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}",key_id):
        raise FamilyError(400,"Invalid key identifier.")
    if not isinstance(private_key,ec.EllipticCurvePrivateKey) or not isinstance(private_key.curve,ec.SECP256R1):
        raise FamilyError(400,"P-256 key required.")
    draft_id(draft);draft_id(release)
    if any(type(v) is not int or not 1<=v<=9007199254740991 for v in (version,sequence)):
        raise FamilyError(400,"Invalid package version.")
    if not validate(content)["valid"]:
        raise FamilyError(422,"Content incompatible.")
    raw=json.dumps({"format":1,"draftId":draft,"releaseId":release,"version":version,"sequence":sequence,"content":content},ensure_ascii=False,allow_nan=False,separators=(",",":")).encode("utf-8")
    if len(raw)>262144:raise FamilyError(400,"Package too large.")
    der=private_key.sign(raw,ec.ECDSA(hashes.SHA256()))
    r,s=decode_dss_signature(der)
    return {"keyId":key_id,"payload":b64(raw),"signature":b64(r.to_bytes(32,"big")+s.to_bytes(32,"big"))}

def public_jwk(private_key):
    nums=private_key.public_key().public_numbers()
    return {"kty":"EC","crv":"P-256","x":b64(nums.x.to_bytes(32,"big")),"y":b64(nums.y.to_bytes(32,"big")),"ext":True,"key_ops":["verify"]}

def export_active(store,token,value,expected_release,key_id,private_key):
    """Staging-only export from the active reviewed release; no arbitrary signing input."""
    ident,expected=draft_id(value),draft_id(expected_release)
    with store.connect() as db:
        actor=store.authorize(db,token,"curriculum:publish")
        if not db.execute("SELECT id FROM lolo_cms_drafts WHERE id=%s FOR UPDATE",(ident,)).fetchone():
            raise FamilyError(404,"Curriculum not found.")
        row=db.execute("""SELECT r.id,r.version,r.content FROM lolo_cms_active_release a
            JOIN lolo_cms_releases r ON r.draft_id=a.draft_id AND r.id=a.release_id
            WHERE a.draft_id=%s""",(ident,)).fetchone()
        if not row or row[0]!=expected:
            raise FamilyError(409,"Active release changed.")
        sequence=db.execute("""INSERT INTO lolo_cms_delivery_sequence(draft_id,sequence) VALUES (%s,1)
            ON CONFLICT(draft_id) DO UPDATE SET sequence=lolo_cms_delivery_sequence.sequence+1
            RETURNING sequence""",(ident,)).fetchone()[0]
        envelope=sign_package(key_id,private_key,str(ident),str(row[0]),row[1],sequence,row[2])
        store.authorize(db,token,"curriculum:publish")
        store.audit(db,actor["id"],"cms.export")
        return envelope
