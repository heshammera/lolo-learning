"""Separate admin identity foundation. No public registration, no student routes."""
import sys
import secrets
import uuid
from pathlib import Path
from datetime import datetime, timedelta, timezone
from types import MappingProxyType
from hmac import compare_digest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from family_accounts import FamilyError, email_value, password_value, password_hash, verify_password, digest_token

ROLES = MappingProxyType({
    "owner": frozenset({"library:read","curriculum:read","curriculum:edit","curriculum:review","curriculum:publish","admin:manage","audit:read","support:read","billing:manage","settings:manage","family:manage"}),
    "admin": frozenset({"library:read","curriculum:read","curriculum:edit","curriculum:review","curriculum:publish","audit:read","support:read"}),
    "content-manager": frozenset({"library:read","curriculum:read","curriculum:edit"}),
    "teacher": frozenset({"library:read","curriculum:read","curriculum:review"}),
    "support": frozenset({"support:read"}),
})
SCHEMA = Path(__file__).resolve().parent / "migrations" / "001_admin.sql"
DUMMY = "scrypt-v1:"+"00"*16+":"+"00"*32


class AdminStore:
    def __init__(self,dsn,encryption_key,clock=lambda:datetime.now(timezone.utc)):
        if not dsn or not encryption_key:
            raise FamilyError(503,"Admin service unavailable.")
        from cryptography.fernet import Fernet
        self.dsn=dsn
        self.cipher=Fernet(encryption_key)
        self.clock=clock

    def connect(self):
        import psycopg
        return psycopg.connect(self.dsn,connect_timeout=5)

    def migrate(self):
        with self.connect() as db:
            for migration in sorted(SCHEMA.parent.glob("[0-9][0-9][0-9]_*.sql")):
                db.execute(migration.read_text(encoding="utf-8"))

    def admit_proxy_login(self):
        """Shared, fail-closed rolling quota; serializes admission across processes."""
        with self.connect() as db:
            db.execute("SELECT pg_advisory_xact_lock(721804381)")
            db.execute("DELETE FROM lolo_admin_proxy_login WHERE attempted_at <= clock_timestamp() - interval '60 seconds'")
            count=db.execute("SELECT count(*) FROM lolo_admin_proxy_login").fetchone()[0]
            if count>=15:return False
            db.execute("INSERT INTO lolo_admin_proxy_login(attempted_at) VALUES (clock_timestamp())")
            return True

    def provision(self,email,password,role,secret,code):
        """Trusted operator only; require proof of authenticator enrollment."""
        import pyotp
        from psycopg.errors import UniqueViolation
        if not isinstance(role,str) or role not in ROLES:
            raise FamilyError(400,"Unknown role.")
        email=email_value(email)
        encoded=password_hash(password)
        now=self.clock()
        step=self.valid_step(secret,code,now)
        if step is None:
            raise FamilyError(400,"Authenticator confirmation invalid.")
        user=uuid.uuid4()
        try:
            with self.connect() as db:
                db.execute("INSERT INTO lolo_admin_users(id,email,password_hash,role,totp_secret,last_totp_step) VALUES (%s,%s,%s,%s,%s,%s)",(user,email,encoded,role,self.cipher.encrypt(secret.encode("ascii")),step))
                self.audit(db,user,"admin.provision")
        except UniqueViolation:
            raise FamilyError(409,"Account already exists.") from None
        return str(user)

    @staticmethod
    def valid_step(secret,code,now):
        import pyotp
        if not isinstance(code,str) or len(code)!=6 or not code.isascii() or not code.isdigit():
            return None
        try:
            otp=pyotp.TOTP(secret)
            current=int(now.timestamp())//30
            for step in (current,current-1,current+1):
                if compare_digest(otp.at(step*30),code):
                    return step
        except (ValueError,TypeError):
            pass
        return None

    @staticmethod
    def audit(db,user,action):
        db.execute("INSERT INTO lolo_admin_audit(actor_id,action) VALUES (%s,%s)",(user,action))

    def login(self,email,password,code):
        try:
            email=email_value(email)
            password_value(password)
        except FamilyError:
            raise FamilyError(401,"Invalid credentials.") from None
        result=None
        now=self.clock()
        with self.connect() as db:
            row=db.execute("SELECT id,password_hash,role,totp_secret,last_totp_step,failures,locked_until,disabled_at FROM lolo_admin_users WHERE email=%s FOR UPDATE",(email,)).fetchone()
            valid=verify_password(password,row[1] if row else DUMMY)
            if row and row[7] is None and (row[6] is None or row[6]<=now):
                step=self.valid_step(self.cipher.decrypt(bytes(row[3])).decode("ascii"),code,now) if valid else None
                if step is not None and step>row[4]:
                    token=secrets.token_urlsafe(32)
                    expiry=now+timedelta(minutes=30)
                    db.execute("UPDATE lolo_admin_users SET last_totp_step=%s,failures=0,locked_until=NULL WHERE id=%s",(step,row[0]))
                    db.execute("UPDATE lolo_admin_sessions SET revoked_at=%s WHERE user_id=%s AND revoked_at IS NULL",(now,row[0]))
                    db.execute("INSERT INTO lolo_admin_sessions(token_hash,user_id,expires_at) VALUES (%s,%s,%s)",(digest_token(token),row[0],expiry))
                    self.audit(db,row[0],"admin.login")
                    result={"token":token,"expiresAt":expiry.isoformat(),"role":row[2],"permissions":sorted(ROLES[row[2]])}
                else:
                    failures=(0 if row[6] is not None else row[5])+1
                    until=now+timedelta(minutes=15) if failures>=5 else None
                    db.execute("UPDATE lolo_admin_users SET failures=%s,locked_until=%s WHERE id=%s",(failures,until,row[0]))
                    self.audit(db,row[0],"admin.login_failed")
        if result is None:
            raise FamilyError(401,"Invalid credentials or account unavailable.")
        return result

    def authorize(self,db,token,permission=None):
        row=db.execute("""SELECT u.id,u.role FROM lolo_admin_sessions s JOIN lolo_admin_users u ON u.id=s.user_id
          WHERE s.token_hash=%s AND s.revoked_at IS NULL AND s.expires_at>%s AND u.disabled_at IS NULL""",(digest_token(token),self.clock())).fetchone()
        if not row or row[1] not in ROLES:
            raise FamilyError(401,"Admin session required.")
        if permission is not None and permission not in ROLES[row[1]]:
            raise FamilyError(403,"Permission denied.")
        return {"id":str(row[0]),"role":row[1],"permissions":sorted(ROLES[row[1]])}

    def inspect(self,token,permission=None):
        with self.connect() as db:
            return self.authorize(db,token,permission)

    def logout(self,token):
        with self.connect() as db:
            identity=self.authorize(db,token)
            db.execute("UPDATE lolo_admin_sessions SET revoked_at=%s WHERE token_hash=%s",(self.clock(),digest_token(token)))
            self.audit(db,identity["id"],"admin.logout")
