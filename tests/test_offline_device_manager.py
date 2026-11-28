import os,uuid,unittest,importlib.util
from pathlib import Path
from unittest.mock import Mock,patch
from family_accounts import FamilyStore,FamilyError
import billing_grants as grants
import billing_entitlements as entitlements
import offline_license as lic

spec=importlib.util.spec_from_file_location("billing_device_preview",Path(__file__).resolve().parents[1]/"staging-billing"/"serve.py")
preview=importlib.util.module_from_spec(spec);spec.loader.exec_module(preview)

@unittest.skipUnless(os.environ.get("LOLO_TEST_DATABASE_URL"),"Dedicated DB required")
class DeviceManagerTests(unittest.TestCase):
    def test_device_visibility_and_revoke_isolation(self):
        from cryptography.hazmat.primitives.asymmetric import ec
        store=FamilyStore(os.environ["LOLO_TEST_DATABASE_URL"]);self.assertNotEqual(store.dsn,os.environ.get("LOLO_DATABASE_URL"));store.migrate()
        emails=[f"{uuid.uuid4()}@example.test" for _ in range(2)]
        for email in emails:store.provision(email,"synthetic-long-password")
        a,b=[store.login(email,"synthetic-long-password")["token"] for email in emails]
        admin=Mock();admin.inspect.return_value={"id":str(uuid.uuid4())}
        key=ec.generate_private_key(ec.SECP256R1());did=str(uuid.uuid4())
        try:
            with patch.dict(os.environ,{"LOLO_BILLING_STAGING":"true"}):
                grants.manual_change(store,admin,"token",emails[0],"grant","plus",7,0)
                child=store.create_child(a,"Synthetic","7-9")["id"];entitlements.assign_slot(store,a,child)
                lic.issue(store,a,did,"test-ci",key)
                self.assertEqual(preview.dispatch(store,{"action":"devices"},b)["devices"],[])
                self.assertEqual(preview.dispatch(store,{"action":"devices"},a)["devices"][0]["deviceId"],did)
                with self.assertRaises(FamilyError):preview.dispatch(store,{"action":"revokeDevice","deviceId":did},b)
                self.assertTrue(preview.dispatch(store,{"action":"revokeDevice","deviceId":did},a)["revoked"])
                self.assertTrue(preview.dispatch(store,{"action":"devices"},a)["devices"][0]["revoked"])
                self.assertEqual(len(store.children(a)),1)
                with self.assertRaises(FamilyError):lic.issue(store,a,did,"test-ci",key)
        finally:
            with store.connect() as db:
                for email in emails:db.execute("DELETE FROM lolo_parents WHERE email=%s",(email,))
