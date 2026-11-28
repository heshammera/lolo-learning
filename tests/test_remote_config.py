import os,unittest,uuid
from unittest.mock import Mock,patch
from family_accounts import FamilyStore,FamilyError
import remote_config as cfg
@unittest.skipUnless(os.environ.get("LOLO_TEST_DATABASE_URL"),"Dedicated DB required")
class RemoteConfigTests(unittest.TestCase):
    def test_revision_audit_and_authorization(self):
        store=FamilyStore(os.environ["LOLO_TEST_DATABASE_URL"]);self.assertNotEqual(store.dsn,os.environ.get("LOLO_DATABASE_URL"));store.migrate()
        admin=Mock();admin.inspect.return_value={"id":str(uuid.uuid4())}
        with patch.dict(os.environ,{"LOLO_BILLING_STAGING":"true","LOLO_REMOTE_CONFIG_STAGING":"true"}):
            prior=cfg.read(store,admin,"test")
            policy={**prior["policy"],"onlineMaintenance":not prior["policy"]["onlineMaintenance"],"message":"Synthetic maintenance"}
            changed=cfg.change(store,admin,"test",prior["revision"],policy)
            self.assertEqual(changed["revision"],prior["revision"]+1)
            self.assertEqual(changed["policy"],policy)
            self.assertEqual(cfg.history(store,admin,"test")["changes"][0]["after"],policy)
            with self.assertRaises(FamilyError):cfg.change(store,admin,"test",prior["revision"],policy)
            with self.assertRaises(FamilyError):cfg.change(store,admin,"test",changed["revision"],{**policy,"minimumAndroidVersionCode":3,"recommendedAndroidVersionCode":2})
            cfg.change(store,admin,"test",changed["revision"],prior["policy"])
            admin.inspect.assert_called_with("test","settings:manage")
            admin.inspect.side_effect=FamilyError(403,"Denied")
            with self.assertRaises(FamilyError):cfg.read(store,admin,"test")
        with patch.dict(os.environ,{"LOLO_BILLING_STAGING":"true","LOLO_REMOTE_CONFIG_STAGING":"false"}):
            with self.assertRaises(FamilyError):cfg.read(store,admin,"test")
