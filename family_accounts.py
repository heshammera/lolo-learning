"""Opt-in, operator-provisioned family identity foundation; no child voice data."""
import hashlib
import hmac
import re
import secrets
import unicodedata
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

EMAIL = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+")
TOKEN = re.compile(r"[A-Za-z0-9_-]{43}")
AGE_BANDS = frozenset(("4-6", "7-9", "10-12", "13-17", "unspecified"))
SESSION_HOURS = 12
MAX_CHILDREN = 12
MIGRATIONS = Path(__file__).resolve().parent / "database" / "migrations"
from progress_sync import InvalidProgress, uuid_value, validate_write


class FamilyError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def email_value(value):
    if not isinstance(value, str):
        raise FamilyError(400, "البريد الإلكتروني غير صالح.")
    value = value.strip().lower()
    if len(value) > 254 or not EMAIL.fullmatch(value) or any(unicodedata.category(c).startswith("C") for c in value):
        raise FamilyError(400, "البريد الإلكتروني غير صالح.")
    return value


def password_value(value):
    if not isinstance(value, str) or not 12 <= len(value) <= 128 or len(value.encode("utf-8", errors="replace")) > 512:
        raise FamilyError(400, "كلمة المرور يجب أن تكون بين 12 و128 حرفًا.")
    try:
        return value.encode("utf-8")
    except UnicodeEncodeError:
        raise FamilyError(400, "كلمة المرور غير صالحة.") from None


def derive(password, salt):
    return hashlib.scrypt(password, salt=salt, n=32768, r=8, p=1, maxmem=64*1024*1024, dklen=32)


def password_hash(value):
    salt = secrets.token_bytes(16)
    return "scrypt-v1:" + salt.hex() + ":" + derive(password_value(value), salt).hex()


def verify_password(value, stored):
    try:
        scheme, salt, expected = stored.split(":")
        salt, expected = bytes.fromhex(salt), bytes.fromhex(expected)
        if scheme != "scrypt-v1" or len(salt) != 16 or len(expected) != 32:
            return False
        return hmac.compare_digest(derive(password_value(value), salt), expected)
    except (ValueError, TypeError, FamilyError, AttributeError):
        return False


def digest_token(token):
    if not isinstance(token, str) or not TOKEN.fullmatch(token):
        raise FamilyError(401, "سجّل الدخول أولًا.")
    return hashlib.sha256(token.encode("ascii")).digest()


def child_fields(nickname, age_band):
    if not isinstance(nickname, str):
        raise FamilyError(400, "اختاري اسمًا مستعارًا للطفل.")
    nickname = nickname.strip()
    if not 1 <= len(nickname) <= 40 or any(unicodedata.category(c).startswith("C") for c in nickname):
        raise FamilyError(400, "الاسم المستعار غير صالح.")
    if not isinstance(age_band, str) or age_band not in AGE_BANDS:
        raise FamilyError(400, "الفئة العمرية غير صالحة.")
    return nickname, age_band


class FamilyStore:
    def __init__(self, dsn):
        if not dsn:
            raise FamilyError(503, "خدمة الحسابات غير متاحة.")
        self.dsn = dsn

    def connect(self):
        import psycopg
        return psycopg.connect(self.dsn, connect_timeout=5)

    def migrate(self):
        with self.connect() as db:
            for migration in sorted(MIGRATIONS.glob("[0-9][0-9][0-9]_*.sql")):
                db.execute(migration.read_text(encoding="utf-8"))

    def provision(self, email, password):
        """Operator only. No public registration route; no verified-parent claim."""
        from psycopg.errors import UniqueViolation
        parent_id = uuid.uuid4()
        email, encoded = email_value(email), password_hash(password)
        try:
            with self.connect() as db:
                db.execute("INSERT INTO lolo_parents(id,email,password_hash) VALUES (%s,%s,%s)", (parent_id,email,encoded))
        except UniqueViolation:
            raise FamilyError(409, "الحساب موجود بالفعل.") from None
        return str(parent_id)

    def login(self, email, password):
        try:
            email = email_value(email)
            password_value(password)
        except FamilyError:
            raise FamilyError(401, "بيانات الدخول غير صحيحة.") from None
        with self.connect() as db:
            row = db.execute("SELECT id,password_hash,disabled_at FROM lolo_parents WHERE email=%s", (email,)).fetchone()
            # Equalize the expensive hash work for unknown valid-format email addresses.
            dummy = "scrypt-v1:" + "00"*16 + ":" + "00"*32
            valid = verify_password(password, row[1] if row else dummy)
            if not row or not valid or row[2] is not None:
                raise FamilyError(401, "بيانات الدخول غير صحيحة.")
            token = secrets.token_urlsafe(32)
            expiry = datetime.now(timezone.utc) + timedelta(hours=SESSION_HOURS)
            db.execute("DELETE FROM lolo_parent_sessions WHERE parent_id=%s AND (expires_at<=CURRENT_TIMESTAMP OR revoked_at IS NOT NULL)", (row[0],))
            db.execute("INSERT INTO lolo_parent_sessions(token_hash,parent_id,expires_at) VALUES (%s,%s,%s)", (digest_token(token),row[0],expiry))
            return {"token":token,"expiresAt":expiry.isoformat(),"parentId":str(row[0])}

    def authenticated_parent(self, db, token):
        row = db.execute("""SELECT p.id FROM lolo_parent_sessions s JOIN lolo_parents p ON p.id=s.parent_id
            WHERE s.token_hash=%s AND s.revoked_at IS NULL AND s.expires_at>CURRENT_TIMESTAMP AND p.disabled_at IS NULL""",
            (digest_token(token),)).fetchone()
        if not row:
            raise FamilyError(401, "انتهت الجلسة. سجّل الدخول من جديد.")
        return row[0]

    def children(self, token):
        with self.connect() as db:
            parent_id = self.authenticated_parent(db, token)
            rows = db.execute("SELECT id,nickname,age_band FROM lolo_children WHERE parent_id=%s ORDER BY created_at,id", (parent_id,)).fetchall()
            return [{"id":str(row[0]),"nickname":row[1],"ageBand":row[2]} for row in rows]

    def create_child(self, token, nickname, age_band):
        nickname, age_band = child_fields(nickname, age_band)
        child_id = uuid.uuid4()
        with self.connect() as db:
            parent_id = self.authenticated_parent(db, token)
            # Serialize per-parent creation and enforce the cap in the same transaction.
            db.execute("SELECT id FROM lolo_parents WHERE id=%s FOR UPDATE", (parent_id,))
            count = db.execute("SELECT count(*) FROM lolo_children WHERE parent_id=%s", (parent_id,)).fetchone()[0]
            if count >= MAX_CHILDREN:
                raise FamilyError(409, "وصلت للحد الأقصى للملفات.")
            db.execute("INSERT INTO lolo_children(id,parent_id,nickname,age_band) VALUES (%s,%s,%s,%s)", (child_id,parent_id,nickname,age_band))
        return {"id":str(child_id),"nickname":nickname,"ageBand":age_band}

    def delete_child(self, token, child_id):
        try:
            child_id = uuid.UUID(child_id) if isinstance(child_id, str) else None
        except ValueError:
            child_id = None
        if not child_id:
            raise FamilyError(400, "معرّف الملف غير صالح.")
        with self.connect() as db:
            parent_id = self.authenticated_parent(db, token)
            deleted = db.execute("DELETE FROM lolo_children WHERE id=%s AND parent_id=%s", (child_id,parent_id)).rowcount
            if not deleted:
                raise FamilyError(404, "الملف غير موجود.")

    def owned_progress_child(self, db, token, child_id, lock=False):
        parent_id = self.authenticated_parent(db,token)
        try:
            child_id=uuid_value(child_id)
        except InvalidProgress as exc:
            raise FamilyError(400,str(exc)) from None
        query="SELECT id FROM lolo_children WHERE id=%s AND parent_id=%s"
        if lock:
            query += " FOR UPDATE"
        if not db.execute(query,(child_id,parent_id)).fetchone():
            raise FamilyError(404,"الملف غير موجود.")
        return child_id

    def read_progress(self, token, child_id):
        with self.connect() as db:
            child_id=self.owned_progress_child(db,token,child_id)
            row=db.execute("SELECT revision,snapshot,updated_at FROM lolo_child_progress WHERE child_id=%s",(child_id,)).fetchone()
            if not row:
                return {"revision":0,"snapshot":None,"updatedAt":None}
            return {"revision":row[0],"snapshot":row[1],"updatedAt":row[2].isoformat()}

    def write_progress(self, token, child_id, base_revision, operation_id, snapshot):
        from psycopg.types.json import Jsonb
        try:
            base_revision,operation,snapshot=validate_write(base_revision,operation_id,snapshot)
        except InvalidProgress as exc:
            raise FamilyError(400,str(exc)) from None
        with self.connect() as db:
            # Lock the owned child even for its first snapshot; concurrent writers serialize.
            child_id=self.owned_progress_child(db,token,child_id,lock=True)
            row=db.execute("SELECT revision,snapshot,last_operation,updated_at FROM lolo_child_progress WHERE child_id=%s",(child_id,)).fetchone()
            revision=row[0] if row else 0
            if row and row[2]==operation:
                if row[1]!=snapshot or base_revision!=revision-1:
                    raise FamilyError(409,"معرّف العملية مستخدم من قبل.")
                return {"revision":revision,"snapshot":row[1],"updatedAt":row[3].isoformat()}
            if base_revision!=revision:
                raise FamilyError(409,"في نسخة أحدث من التقدم. راجع الاختلافات قبل الحفظ.")
            updated=db.execute("""INSERT INTO lolo_child_progress(child_id,revision,snapshot,last_operation)
                VALUES (%s,%s,%s,%s) ON CONFLICT(child_id) DO UPDATE SET revision=EXCLUDED.revision,
                snapshot=EXCLUDED.snapshot,last_operation=EXCLUDED.last_operation,updated_at=CURRENT_TIMESTAMP
                RETURNING updated_at""",(child_id,revision+1,Jsonb(snapshot),operation)).fetchone()[0]
            return {"revision":revision+1,"snapshot":snapshot,"updatedAt":updated.isoformat()}

    def logout(self, token):
        with self.connect() as db:
            db.execute("UPDATE lolo_parent_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=%s AND revoked_at IS NULL", (digest_token(token),))
