import os,uuid,unittest
from unittest.mock import Mock,patch
from family_accounts import FamilyStore,FamilyError
import billing_grants as grants
import billing_entitlements as entitlements
import offline_license as lic
import offline_device_proof as proof

@unittest.skipUnless(os.environ.get("LOLO_TEST_DATABASE_URL"),"Dedicated DB required")
class DeviceProofTests(unittest.TestCase):
    def test_binding_replay_and_wrong_key(self):
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.primitives import hashes,serialization
        store=FamilyStore(os.environ["LOLO_TEST_DATABASE_URL"])
        self.assertNotEqual(store.dsn,os.environ.get("LOLO_DATABASE_URL"));store.migrate()
        email=f"{uuid.uuid4()}@example.test";store.provision(email,"synthetic-long-password")
        token=store.login(email,"synthetic-long-password")["token"];other_session=store.login(email,"synthetic-long-password")["token"]
        admin=Mock();admin.inspect.return_value={"id":str(uuid.uuid4())}
        device=ec.generate_private_key(ec.SECP256R1());wrong=ec.generate_private_key(ec.SECP256R1());signer=ec.generate_private_key(ec.SECP256R1())
        def pub(k):return lic.b64(k.public_key().public_bytes(serialization.Encoding.DER,serialization.PublicFormat.SubjectPublicKeyInfo))
        def sign(k,c):return lic.b64(k.sign(c["message"].encode("ascii"),ec.ECDSA(hashes.SHA256())))
        did=str(uuid.uuid4())
        try:
            with patch.dict(os.environ,{"LOLO_BILLING_STAGING":"true"}):
                grants.manual_change(store,admin,"token",email,"grant","plus",7,0)
                child=store.create_child(token,"Synthetic","7-9")["id"];entitlements.assign_slot(store,token,child)
                c=proof.begin(store,token,did,pub(device))
                with self.assertRaises(FamilyError):proof.complete(store,token,c["challengeId"],sign(wrong,c),"test-ci",signer)
                with self.assertRaises(FamilyError):proof.complete(store,other_session,c["challengeId"],sign(device,c),"test-ci",signer)
                envelope=proof.complete(store,token,c["challengeId"],sign(device,c),"test-ci",signer)
                import json,base64
                payload=json.loads(base64.urlsafe_b64decode(envelope["payload"]+"="*((-len(envelope["payload"]))%4)))
                self.assertEqual(payload["format"],2)
                self.assertEqual(len(payload["deviceKeySha256"]),64)
                with self.assertRaises(FamilyError):proof.complete(store,token,c["challengeId"],sign(device,c),"test-ci",signer)
                with self.assertRaises(FamilyError):proof.begin(store,token,did,pub(wrong))
                with self.assertRaises(FamilyError):lic.issue(store,token,did,"test-ci",signer)
                c=proof.begin(store,token,did,pub(device));lic.revoke(store,token,did)
                with self.assertRaises(FamilyError):proof.complete(store,token,c["challengeId"],sign(device,c),"test-ci",signer)
        finally:
            with store.connect() as db:db.execute("DELETE FROM lolo_parents WHERE email=%s",(email,))
