import os,uuid,unittest,importlib.util,json,base64
from pathlib import Path
from unittest.mock import Mock,patch
from family_accounts import FamilyStore,FamilyError
import billing_grants as grants
import billing_entitlements as entitlements
import offline_license as lic
spec=importlib.util.spec_from_file_location("billing_lifecycle_preview",Path(__file__).resolve().parents[1]/"staging-billing"/"serve.py")
preview=importlib.util.module_from_spec(spec);spec.loader.exec_module(preview)
@unittest.skipUnless(os.environ.get("LOLO_TEST_DATABASE_URL"),"Dedicated DB required")
class LifecycleTests(unittest.TestCase):
    def test_signed_reconnect_status(self):
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.primitives import hashes,serialization
        import hashlib
        store=FamilyStore(os.environ["LOLO_TEST_DATABASE_URL"]);self.assertNotEqual(store.dsn,os.environ.get("LOLO_DATABASE_URL"));store.migrate()
        email=f"{uuid.uuid4()}@example.test";store.provision(email,"synthetic-long-password")
        token=store.login(email,"synthetic-long-password")["token"];admin=Mock();admin.inspect.return_value={"id":str(uuid.uuid4())}
        device=ec.generate_private_key(ec.SECP256R1());key=ec.generate_private_key(ec.SECP256R1());signing=("test-ci",key)
        raw=device.public_key().public_bytes(serialization.Encoding.DER,serialization.PublicFormat.SubjectPublicKeyInfo)
        did=str(uuid.uuid4())
        def unpack(e):return json.loads(base64.urlsafe_b64decode(e["payload"]+"="*((-len(e["payload"]))%4)))
        try:
            with patch.dict(os.environ,{"LOLO_BILLING_STAGING":"true"}):
                grants.manual_change(store,admin,"token",email,"grant","plus",7,0)
                child=store.create_child(token,"Synthetic","7-9")["id"];entitlements.assign_slot(store,token,child)
                req={"action":"licenseBegin","deviceId":did,"publicSpki":lic.b64(raw)}
                with self.assertRaises(FamilyError):preview.dispatch(store,req,token)
                c=preview.dispatch(store,req,token,signing)
                proof=lic.b64(device.sign(c["message"].encode("ascii"),ec.ECDSA(hashes.SHA256())))
                lease=preview.dispatch(store,{"action":"licenseComplete","challengeId":c["challengeId"],"signature":proof},token,signing)
                status={"action":"licenseStatus","deviceId":did,"deviceKeySha256":hashlib.sha256(raw).hexdigest()}
                self.assertEqual(unpack(preview.dispatch(store,status,token,signing))["status"],"renew")
                preview.dispatch(store,{"action":"revokeDevice","deviceId":did},token)
                denial=unpack(preview.dispatch(store,status,token,signing))
                self.assertEqual(denial["status"],"denied");self.assertEqual(denial["sequence"],unpack(lease)["sequence"])
                with self.assertRaises(FamilyError):preview.dispatch(store,req,token,signing)
        finally:
            with store.connect() as db:db.execute("DELETE FROM lolo_parents WHERE email=%s",(email,))
