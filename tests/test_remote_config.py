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

    def test_signed_preview_is_scoped(self):
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
        import base64,json
        store=FamilyStore(os.environ["LOLO_TEST_DATABASE_URL"]);store.migrate()
        email=f"{uuid.uuid4()}@example.test";store.provision(email,"synthetic-long-password")
        token=store.login(email,"synthetic-long-password")["token"]
        key=ec.generate_private_key(ec.SECP256R1())
        try:
            with patch.dict(os.environ,{"LOLO_BILLING_STAGING":"true","LOLO_REMOTE_CONFIG_STAGING":"true"}):
                envelope=cfg.signed_preview(store,token,"a"*64,"test-ci",key)
                def decode(v):return base64.urlsafe_b64decode(v+"="*((-len(v))%4))
                raw=decode(envelope["payload"]);sig=decode(envelope["signature"])
                key.public_key().verify(encode_dss_signature(int.from_bytes(sig[:32],"big"),int.from_bytes(sig[32:],"big")),raw,ec.ECDSA(hashes.SHA256()))
                payload=json.loads(raw);self.assertEqual(payload["nonce"],"a"*64);self.assertEqual(payload["expiresAt"]-payload["issuedAt"],300)
                with self.assertRaises(FamilyError):cfg.signed_preview(store,"invalid","a"*64,"test-ci",key)
                with self.assertRaises(FamilyError):cfg.signed_preview(store,token,"invalid","test-ci",key)
        finally:
            with store.connect() as db:db.execute("DELETE FROM lolo_parents WHERE email=%s",(email,))
