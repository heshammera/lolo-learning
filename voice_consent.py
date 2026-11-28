"""Operator-controlled staging consent receipt; no public grant or audio processing."""
import re
from family_accounts import FamilyError
from progress_sync import uuid_value, InvalidProgress

POLICY = "pronunciation-staging-v1"
RECEIPT = re.compile(r"[a-f0-9]{64}")
PURPOSE = "phoneme-assessment"


def valid_child(child_id):
    try:
        return uuid_value(child_id)
    except InvalidProgress:
        raise FamilyError(400,"Invalid profile.") from None


def grant_reviewed_receipt(store, child_id, receipt_digest, policy):
    """Trusted operator only, after independent consent review.
    Digest references an externally retained receipt; no identity document or audio in DB.
    This function does not itself verify legal consent or authorize a live provider.
    """
    child_id=valid_child(child_id)
    if policy!=POLICY or not isinstance(receipt_digest,str) or not RECEIPT.fullmatch(receipt_digest):
        raise FamilyError(400,"Invalid reviewed receipt.")
    with store.connect() as db:
        if not db.execute("SELECT id FROM lolo_children WHERE id=%s FOR UPDATE",(child_id,)).fetchone():
            raise FamilyError(404,"Profile not found.")
        db.execute("""INSERT INTO lolo_voice_consent(child_id,purpose,policy,receipt_digest,granted_at,expires_at,revoked_at)
            VALUES (%s,%s,%s,%s,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP + INTERVAL '30 days',NULL)
            ON CONFLICT(child_id,purpose) DO UPDATE SET policy=EXCLUDED.policy,receipt_digest=EXCLUDED.receipt_digest,
            granted_at=EXCLUDED.granted_at,expires_at=EXCLUDED.expires_at,revoked_at=NULL""",
            (child_id,PURPOSE,POLICY,receipt_digest))


def eligible_staging(store, token, child_id):
    """Ownership, live session and receipt required; not sufficient for live audio."""
    with store.connect() as db:
        owned=store.owned_progress_child(db,token,child_id)
        row=db.execute("""SELECT 1 FROM lolo_voice_consent
            WHERE child_id=%s AND purpose=%s AND policy=%s
            AND revoked_at IS NULL AND expires_at>CURRENT_TIMESTAMP""",(owned,PURPOSE,POLICY)).fetchone()
        return bool(row)


def revoke(store, token, child_id):
    """Authenticated parent can revoke their own child's receipt; no public route yet."""
    with store.connect() as db:
        owned=store.owned_progress_child(db,token,child_id,lock=True)
        db.execute("""UPDATE lolo_voice_consent SET revoked_at=CURRENT_TIMESTAMP
            WHERE child_id=%s AND purpose=%s AND revoked_at IS NULL""",(owned,PURPOSE))
