import os
import sys
import unittest
from datetime import datetime,timezone
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"admin-src"))
from admin_identity import AdminStore,FamilyError
from preflight import configuration,database_check

class ConfigurationTests(unittest.TestCase):
    def test_requires_separate_database_and_closed_initial_deployment(self):
        from cryptography.fernet import Fernet
        env={"LOLO_ADMIN_HTTPS_STAGING":"true","LOLO_ADMIN_ORIGIN":"https://admin.example.test",
             "LOLO_ADMIN_PROXY_TOKEN":"x"*43,"LOLO_ADMIN_DATABASE_URL":"fixture-admin",
             "LOLO_ADMIN_ENCRYPTION_KEY":Fernet.generate_key().decode()}
        self.assertEqual(configuration(env).dsn,"fixture-admin")
        for changes in ({"LOLO_ADMIN_LOCAL_WEB":"true"},{"LOLO_ADMIN_PORT":"80"},
                        {"LOLO_DATABASE_URL":"fixture-admin"},{"LOLO_ADMIN_STAGING_EXPORT":"true"},
                        {"LOLO_ADMIN_FAMILY_PILOT":"true"},{"LOLO_ADMIN_ORIGIN":"http://admin.example.test"}):
            with self.assertRaises((FamilyError,RuntimeError)):configuration({**env,**changes})

@unittest.skipUnless(os.environ.get("LOLO_TEST_ADMIN_DATABASE_URL"),"Disposable admin DB required")
class DatabaseTests(unittest.TestCase):
    def test_read_only_preflight_and_mixed_schema_denial(self):
        import pyotp
        import uuid
        from cryptography.fernet import Fernet
        dsn=os.environ["LOLO_TEST_ADMIN_DATABASE_URL"]
        self.assertEqual(dsn,"postgresql://admin_test:disposable-ci-only@127.0.0.1:5432/admin_test")
        self.assertNotIn(dsn,(os.environ.get("LOLO_DATABASE_URL"),os.environ.get("LOLO_ADMIN_DATABASE_URL")))
        now=datetime.now(timezone.utc)
        store=AdminStore(dsn,Fernet.generate_key(),lambda:now)
        store.migrate()
        secret=pyotp.random_base32()
        owner=store.provision(f"{uuid.uuid4()}@example.test","fixture-long-password","owner",secret,pyotp.TOTP(secret).at(now))
        try:
            self.assertEqual(database_check(store),8)
            with store.connect() as db:
                db.execute("CREATE SCHEMA preflight_fixture")
                db.execute("CREATE TABLE preflight_fixture.lolo_parents (id uuid)")
            try:
                with self.assertRaises(FamilyError):database_check(store)
            finally:
                with store.connect() as db:db.execute("DROP SCHEMA preflight_fixture CASCADE")
        finally:
            with store.connect() as db:
                db.execute("DELETE FROM lolo_admin_audit WHERE actor_id=%s",(owner,))
                db.execute("DELETE FROM lolo_admin_users WHERE id=%s",(owner,))
