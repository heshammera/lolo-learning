import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from family_accounts import FamilyStore, FamilyError, password_hash, verify_password, digest_token, child_fields
import server


class FamilyUnitTests(unittest.TestCase):
    def test_password_hash_and_token_validation(self):
        value = "example-long-password"
        encoded = password_hash(value)
        self.assertNotEqual(encoded, password_hash(value))
        self.assertTrue(verify_password(value, encoded))
        self.assertFalse(verify_password("incorrect-long-password", encoded))
        self.assertFalse(verify_password(value, "invalid"))
        with self.assertRaises(FamilyError):
            digest_token("not-a-token")

    def test_minimal_child_fields(self):
        self.assertEqual(child_fields(" لولو ", "4-6"), ("لولو","4-6"))
        for nickname,band in [("", "4-6"), ("a\n", []), ("x", "unknown"), ("x"*41,"4-6")]:
            with self.assertRaises(FamilyError):
                child_fields(nickname,band)

    def test_default_disabled(self):
        from io import BytesIO
        handler = object.__new__(server.Handler)
        handler.send_json = lambda status, data: (status,data)
        with patch.object(server,"FAMILY_ENABLED",False), patch.object(server,"FamilyStore") as store:
            self.assertEqual(handler.family_request()[0],503)
            store.assert_not_called()


@unittest.skipUnless(os.environ.get("LOLO_TEST_DATABASE_URL"), "Dedicated PostgreSQL test database not configured")
class FamilyDatabaseTests(unittest.TestCase):
    def setUp(self):
        dsn = os.environ["LOLO_TEST_DATABASE_URL"]
        if dsn == os.environ.get("LOLO_DATABASE_URL"):
            self.fail("Never test against the configured application database")
        self.store = FamilyStore(dsn)
        self.store.migrate()
        # Only the disposable CI database is permitted here.
        import uuid
        self.emails = [f"{uuid.uuid4()}@example.test" for _ in range(2)]
        self.password = "test-long-password-only"
        self.ids = [self.store.provision(email,self.password) for email in self.emails]

    def tearDown(self):
        with self.store.connect() as db:
            for email in self.emails:
                db.execute("DELETE FROM lolo_parents WHERE email=%s",(email,))

    def test_login_child_isolation_and_logout(self):
        with self.assertRaises(FamilyError):
            self.store.login(self.emails[0],"incorrect-long-password")
        a,b = [self.store.login(email,self.password)["token"] for email in self.emails]
        child = self.store.create_child(a,"Learner","7-9")
        self.assertEqual(self.store.children(a),[child])
        self.assertEqual(self.store.children(b),[])
        with self.assertRaises(FamilyError) as denied:
            self.store.delete_child(b,child["id"])
        self.assertEqual(denied.exception.status,404)
        self.store.delete_child(a,child["id"])
        self.assertEqual(self.store.children(a),[])
        self.store.logout(a)
        with self.assertRaises(FamilyError):
            self.store.children(a)

    def test_expired_session_and_hash_only_storage(self):
        token = self.store.login(self.emails[0],self.password)["token"]
        with self.store.connect() as db:
            row = db.execute("SELECT token_hash FROM lolo_parent_sessions WHERE parent_id=%s",(self.ids[0],)).fetchone()
            self.assertEqual(bytes(row[0]),digest_token(token))
            db.execute("UPDATE lolo_parent_sessions SET expires_at=%s WHERE token_hash=%s",(datetime.now(timezone.utc)-timedelta(seconds=1),digest_token(token)))
        with self.assertRaises(FamilyError):
            self.store.children(token)
