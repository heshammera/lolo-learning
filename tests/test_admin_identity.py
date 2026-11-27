import os
import sys
import unittest
import uuid
from datetime import datetime,timedelta,timezone
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"admin-src"))
from admin_identity import AdminStore,ROLES,FamilyError

class RolesTests(unittest.TestCase):
    def test_permissions_are_separate(self):
        self.assertIn("admin:manage",ROLES["owner"])
        self.assertNotIn("admin:manage",ROLES["admin"])
        self.assertNotIn("curriculum:publish",ROLES["teacher"])
        self.assertNotIn("curriculum:publish",ROLES["content-manager"])
        self.assertNotIn("library:read",ROLES["support"])
        self.assertNotIn("parent",ROLES)

@unittest.skipUnless(os.environ.get("LOLO_TEST_ADMIN_DATABASE_URL"),"Disposable admin database required")
class AdminDBTests(unittest.TestCase):
    def setUp(self):
        import pyotp
        from cryptography.fernet import Fernet
        dsn=os.environ["LOLO_TEST_ADMIN_DATABASE_URL"]
        self.assertNotEqual(dsn,os.environ.get("LOLO_DATABASE_URL"))
        self.assertNotEqual(dsn,os.environ.get("LOLO_ADMIN_DATABASE_URL"))
        self.now=datetime.now(timezone.utc)
        self.store=AdminStore(dsn,Fernet.generate_key(),lambda:self.now)
        self.store.migrate()
        self.email=str(uuid.uuid4())+"@example.test"
        self.password="synthetic-long-password"
        self.secret=pyotp.random_base32()
        self.user=self.store.provision(self.email,self.password,"content-manager",self.secret,self.code())
        self.now+=timedelta(seconds=30)

    def code(self):
        import pyotp
        return pyotp.TOTP(self.secret).at(self.now)

    def tearDown(self):
        with self.store.connect() as db:
            db.execute("DELETE FROM lolo_admin_audit WHERE actor_id=%s",(self.user,))
            db.execute("DELETE FROM lolo_admin_users WHERE id=%s",(self.user,))

    def denied(self,fn,status=401):
        with self.assertRaises(FamilyError) as e:fn()
        self.assertEqual(e.exception.status,status)

    def test_mfa_replay_permissions_and_revocation(self):
        self.denied(lambda:self.store.login(self.email,self.password,"invalid"))
        result=self.store.login(self.email,self.password,self.code())
        token=result["token"]
        self.assertEqual(self.store.inspect(token,"library:read")["role"],"content-manager")
        self.denied(lambda:self.store.inspect(token,"curriculum:publish"),403)
        self.denied(lambda:self.store.inspect("a"*43))
        self.denied(lambda:self.store.login(self.email,self.password,self.code()))
        with self.store.connect() as db:
            row=db.execute("SELECT totp_secret,password_hash FROM lolo_admin_users WHERE id=%s",(self.user,)).fetchone()
            self.assertNotIn(self.secret.encode(),bytes(row[0]))
            self.assertNotIn(self.password,row[1])
        self.store.logout(token)
        self.denied(lambda:self.store.inspect(token))

    def test_lockout_persists_and_session_expires(self):
        for _ in range(5):self.denied(lambda:self.store.login(self.email,"incorrect-long-password",self.code()))
        self.denied(lambda:self.store.login(self.email,self.password,self.code()))
        self.now+=timedelta(minutes=16)
        token=self.store.login(self.email,self.password,self.code())["token"]
        self.now+=timedelta(minutes=31)
        self.denied(lambda:self.store.inspect(token))
