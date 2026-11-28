import os
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from family_accounts import FamilyStore,FamilyError,digest_token
from family_credentials import migrate_pilot_credentials,issue_code,redeem_code

DSN="postgresql://lolo_test:disposable-ci-only@127.0.0.1:5432/lolo_test"

class GuardTest(unittest.TestCase):
    def test_real_store_denied_before_connect(self):
        store=FamilyStore("not-a-connection")
        for action in (lambda:migrate_pilot_credentials(store),lambda:issue_code(store,"register","x@example.test"),lambda:redeem_code(store,"register","x@example.test","x","password-long-enough")):
            with self.assertRaises(FamilyError):action()

@unittest.skipUnless(os.environ.get("LOLO_TEST_DATABASE_URL"),"Disposable PostgreSQL required")
class CredentialsTest(unittest.TestCase):
    def setUp(self):
        self.assertEqual(os.environ.get("LOLO_TEST_DATABASE_URL"),DSN)
        self.assertNotEqual(os.environ.get("LOLO_DATABASE_URL"),DSN)
        self.store=FamilyStore(DSN,synthetic_only=True)
        self.store.migrate()
        migrate_pilot_credentials(self.store)
        self.email=f"{uuid.uuid4()}@example.test"
        self.other=f"{uuid.uuid4()}@example.test"
        self.password="old-fixture-password"
        self.new="new-fixture-password"
        self.addCleanup(self.cleanup)
    def cleanup(self):
        with self.store.connect() as db:
            for email in (self.email,self.other):
                db.execute("DELETE FROM lolo_pilot_credential_codes WHERE email=%s",(email,))
                db.execute("DELETE FROM lolo_parents WHERE email=%s",(email,))
    def test_registration_binding_expiry_replacement_and_concurrent_use(self):
        stale=issue_code(self.store,"register",self.email)
        code=issue_code(self.store,"register",self.email)
        with self.store.connect() as db:
            self.assertEqual(bytes(db.execute("SELECT code_hash FROM lolo_pilot_credential_codes WHERE email=%s",(self.email,)).fetchone()[0]),digest_token(code))
        for email,purpose,value in ((self.email,"register",stale),(self.other,"register",code),(self.email,"reset",code),("real@example.invalid","register",code)):
            with self.assertRaises(FamilyError):redeem_code(self.store,purpose,email,value,self.password)
        def attempt():
            try:
                redeem_code(self.store,"register",self.email,code,self.password)
                return 201
            except FamilyError as e:return e.status
        with ThreadPoolExecutor(max_workers=2) as pool:self.assertEqual(sorted(pool.map(lambda _:attempt(),range(2))),[201,400])
        self.assertTrue(self.store.login(self.email,self.password)["token"])
        exp=issue_code(self.store,"register",self.other)
        with self.store.connect() as db:db.execute("UPDATE lolo_pilot_credential_codes SET expires_at=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE email=%s",(self.other,))
        with self.assertRaises(FamilyError):redeem_code(self.store,"register",self.other,exp,self.password)
    def test_reset_revokes_sessions_preserves_child_and_denies_replay(self):
        self.store.provision(self.email,self.password)
        token=self.store.login(self.email,self.password)["token"]
        second=self.store.login(self.email,self.password)["token"]
        child=self.store.create_child(token,"Synthetic 8","4-6")
        code=issue_code(self.store,"reset",self.email)
        redeem_code(self.store,"reset",self.email,code,self.new)
        for op in (lambda:self.store.children(token),lambda:self.store.children(second),lambda:self.store.login(self.email,self.password),lambda:redeem_code(self.store,"reset",self.email,code,self.password)):
            with self.assertRaises(FamilyError):op()
        self.assertEqual(self.store.children(self.store.login(self.email,self.new)["token"]),[child])
