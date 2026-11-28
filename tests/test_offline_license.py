import json,os,subprocess,unittest,uuid
from pathlib import Path
from unittest.mock import patch
from family_accounts import FamilyStore,FamilyError
import billing_grants as grants
import billing_entitlements as entitlements
import offline_license as lic
from unittest.mock import Mock

@unittest.skipUnless(os.environ.get("LOLO_TEST_DATABASE_URL"),"Dedicated DB required")
class LicenseTests(unittest.TestCase):
    def test_issue_scope_expiry_and_device_limit(self):
        from cryptography.hazmat.primitives.asymmetric import ec
        store=FamilyStore(os.environ["LOLO_TEST_DATABASE_URL"]);self.assertNotEqual(store.dsn,os.environ.get("LOLO_DATABASE_URL"));store.migrate()
        email=f"{uuid.uuid4()}@example.test";store.provision(email,"synthetic-long-password")
        token=store.login(email,"synthetic-long-password")["token"]
        admin=Mock();admin.inspect.return_value={"id":str(uuid.uuid4())}
        key=ec.generate_private_key(ec.SECP256R1())
        try:
            with patch.dict(os.environ,{"LOLO_BILLING_STAGING":"true"}):
                first=str(uuid.uuid4())
                with self.assertRaises(FamilyError):lic.issue(store,token,first,"test-ci",key)
                grant=grants.manual_change(store,admin,"token",email,"grant","plus",7,0)["grant"]
                child=store.create_child(token,"Synthetic","7-9")["id"]
                entitlements.assign_slot(store,token,child)
                envelope=lic.issue(store,token,first,"test-ci",key)
                import base64
                payload=json.loads(base64.urlsafe_b64decode(envelope["payload"]+"="*((-len(envelope["payload"]))%4)))
                self.assertLessEqual(payload["expiresAt"]-payload["issuedAt"],7*86400)
                self.assertEqual(payload["childIds"],[child])
                second=lic.issue(store,token,first,"test-ci",key)
                self.assertNotEqual(envelope,second)
                lic.issue(store,token,str(uuid.uuid4()),"test-ci",key)
                with self.assertRaises(FamilyError):lic.issue(store,token,str(uuid.uuid4()),"test-ci",key)
                lic.revoke(store,token,first)
                with self.assertRaises(FamilyError):lic.issue(store,token,first,"test-ci",key)
                lic.issue(store,token,str(uuid.uuid4()),"test-ci",key)
                self.assertEqual(len(lic.devices(store,token)),3)
                public=key.public_key().public_numbers()
                jwk={"kty":"EC","crv":"P-256","x":lic.b64(public.x.to_bytes(32,"big")),"y":lic.b64(public.y.to_bytes(32,"big"))}
                context={"parentId":payload["parentId"],"deviceId":first,"childId":child,"minSequence":0,"lastSeenAt":0}
                # Cross-language verification of an actual Python-signed envelope.
                script=Path(__file__).resolve().parent/"offline-license-cross.cjs"
                result=subprocess.run(["node",str(script)],input=json.dumps({"envelope":envelope,"key":jwk,"context":context,"now":payload["issuedAt"]}),text=True,capture_output=True)
                self.assertEqual(result.returncode,0,result.stdout+result.stderr)
                grants.manual_change(store,admin,"token",email,"revoke",None,0,grant["revision"])
                with self.assertRaises(FamilyError):lic.issue(store,token,str(uuid.uuid4()),"test-ci",key)
        finally:
            with store.connect() as db:db.execute("DELETE FROM lolo_parents WHERE email=%s",(email,))
