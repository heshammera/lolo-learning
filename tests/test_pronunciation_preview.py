import os,uuid,unittest
from unittest.mock import Mock,patch
from family_accounts import FamilyStore,FamilyError
import billing_grants as grants
import billing_entitlements as entitlements
import voice_consent as consent
import pronunciation_preview as preview

@unittest.skipUnless(os.environ.get("LOLO_TEST_DATABASE_URL"),"Dedicated DB required")
class PronunciationPreviewTest(unittest.TestCase):
    def test_consent_quota_and_replay(self):
        store=FamilyStore(os.environ["LOLO_TEST_DATABASE_URL"]);self.assertNotEqual(store.dsn,os.environ.get("LOLO_DATABASE_URL"));store.migrate()
        email=f"{uuid.uuid4()}@example.test";store.provision(email,"synthetic-long-password")
        token=store.login(email,"synthetic-long-password")["token"]
        admin=Mock();admin.inspect.return_value={"id":str(uuid.uuid4())}
        try:
            with patch.dict(os.environ,{"LOLO_BILLING_STAGING":"true","LOLO_PRONUNCIATION_PREVIEW":"true"}):
                child=store.create_child(token,"Synthetic","7-9")["id"]
                grants.manual_change(store,admin,"token",email,"grant","plus",7,0)
                entitlements.assign_slot(store,token,child)
                op=str(uuid.uuid4())
                with self.assertRaises(FamilyError):preview.evaluate(store,token,child,"synthetic-cat",op)
                consent.grant_reviewed_receipt(store,child,"a"*64,consent.POLICY)
                before=entitlements.usage_status(store,token)["pronunciationUsed"]
                r=preview.evaluate(store,token,child,"synthetic-cat",op)
                self.assertTrue(r["testOnly"]);self.assertFalse(r["evidence"]["masteryEligible"])
                self.assertEqual(r["source"],"synthetic-fixture")
                with self.assertRaises(FamilyError):preview.evaluate(store,token,child,"synthetic-cat",op)
                self.assertEqual(entitlements.usage_status(store,token)["pronunciationUsed"],before+1)
                consent.revoke(store,token,child)
                with self.assertRaises(FamilyError):consent.grant_reviewed_receipt(store,child,"a"*64,consent.POLICY)
                with self.assertRaises(FamilyError):preview.evaluate(store,token,child,"synthetic-cat",str(uuid.uuid4()))
                consent.grant_reviewed_receipt(store,child,"b"*64,consent.POLICY)
                with self.assertRaises(FamilyError):preview.evaluate(store,token,child,"unknown",str(uuid.uuid4()))
        finally:
            with store.connect() as db:db.execute("DELETE FROM lolo_parents WHERE email=%s",(email,))
