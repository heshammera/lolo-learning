"""Synthetic invitation and recovery only; not proof of mailbox ownership or guardianship."""
import secrets
import uuid
from pathlib import Path
from family_accounts import FamilyError,email_value,password_value,password_hash,digest_token

SCHEMA=Path(__file__).resolve().parent/"database"/"pilot"/"001_credentials.sql"
PURPOSES=("register","reset")
INVALID="الرمز غير صالح أو انتهت صلاحيته."


def guard(store,purpose=None,email=None):
    if not store.synthetic_only:
        raise FamilyError(503,"Synthetic credential pilot required.")
    if purpose is not None and purpose not in PURPOSES:
        raise FamilyError(400,INVALID)
    if email is not None:
        email=email_value(email)
        if not email.endswith("@example.test"):raise FamilyError(400,INVALID)
    return email


def migrate_pilot_credentials(store):
    guard(store)
    with store.connect() as db:
        db.execute(SCHEMA.read_text(encoding="utf-8"))


def lock_email(db,email):
    db.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s,724251))",(email,))


def issue_code(store,purpose,email):
    """Private operator only. Never expose this function through HTTP."""
    guard(store)
    if not isinstance(email,str):raise FamilyError(400,INVALID)
    email=guard(store,purpose,email)
    code=secrets.token_urlsafe(32)
    with store.connect() as db:
        lock_email(db,email)
        parent=db.execute("SELECT id,disabled_at FROM lolo_parents WHERE email=%s",(email,)).fetchone()
        if (purpose=="register" and parent is not None) or (purpose=="reset" and (not parent or parent[1] is not None)):
            raise FamilyError(400,INVALID)
        db.execute("DELETE FROM lolo_pilot_credential_codes WHERE expires_at<=CURRENT_TIMESTAMP")
        db.execute("""INSERT INTO lolo_pilot_credential_codes(email,purpose,code_hash,parent_id,expires_at)
            VALUES (%s,%s,%s,%s,CURRENT_TIMESTAMP+INTERVAL '15 minutes')
            ON CONFLICT(email,purpose) DO UPDATE SET code_hash=EXCLUDED.code_hash,parent_id=EXCLUDED.parent_id,expires_at=EXCLUDED.expires_at""",
            (email,purpose,digest_token(code),parent[0] if parent else None))
    return code


def redeem_code(store,purpose,email,code,password):
    guard(store)
    if not isinstance(email,str):raise FamilyError(400,INVALID)
    email=guard(store,purpose,email)
    try:hashed=digest_token(code)
    except FamilyError:raise FamilyError(400,INVALID) from None
    password_value(password)
    from psycopg.errors import UniqueViolation
    try:
        with store.connect() as db:
            lock_email(db,email)
            row=db.execute("""SELECT parent_id FROM lolo_pilot_credential_codes
                WHERE email=%s AND purpose=%s AND code_hash=%s AND expires_at>CURRENT_TIMESTAMP FOR UPDATE""",(email,purpose,hashed)).fetchone()
            if row is None:raise FamilyError(400,INVALID)
            parent=db.execute("SELECT id,disabled_at FROM lolo_parents WHERE email=%s FOR UPDATE",(email,)).fetchone()
            if purpose=="register":
                if parent is not None:raise FamilyError(400,INVALID)
                db.execute("INSERT INTO lolo_parents(id,email,password_hash) VALUES (%s,%s,%s)",(uuid.uuid4(),email,password_hash(password)))
            else:
                if not parent or parent[1] is not None or row[0]!=parent[0]:raise FamilyError(400,INVALID)
                db.execute("UPDATE lolo_parents SET password_hash=%s WHERE id=%s",(password_hash(password),parent[0]))
                db.execute("UPDATE lolo_parent_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE parent_id=%s AND revoked_at IS NULL",(parent[0],))
            db.execute("DELETE FROM lolo_pilot_credential_codes WHERE email=%s AND purpose=%s",(email,purpose))
    except UniqueViolation:
        raise FamilyError(400,INVALID) from None
