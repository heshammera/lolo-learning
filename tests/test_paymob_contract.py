import os
import unittest
import uuid
import hashlib
import hmac
from unittest.mock import patch
from family_accounts import FamilyStore, FamilyError
import billing
import paymob_contract as p

SECRET="synthetic-hmac-secret-0001"
def evidence(amount=14900,order=111,tx=222):
    return {"type":"TRANSACTION","obj":{"amount_cents":amount,"created_at":"2026-11-28T12:00:00.000000","currency":"EGP","error_occured":False,"has_parent_transaction":False,"id":tx,"integration_id":333,"is_3d_secure":True,"is_auth":False,"is_capture":False,"is_refunded":False,"is_standalone_payment":True,"is_voided":False,"order":{"id":order},"owner":444,"pending":False,"source_data":{"pan":"0000","sub_type":"MasterCard","type":"card"},"success":True,"is_live":False}}
def sign(body):
    return hmac.new(SECRET.encode(),p.canonical(p.fields(body)).encode(),hashlib.sha512).hexdigest()

class ProtocolTests(unittest.TestCase):
    def test_signed_fields_and_tampering(self):
        body=evidence()
        self.assertEqual(p.canonical(p.fields(body)),"149002026-11-28T12:00:00.000000EGPfalsefalse222333truefalsefalsefalsetruefalse111444false0000MasterCardcardtrue")
        with patch.dict(os.environ,{"LOLO_BILLING_STAGING":"true"}):
            signature=sign(body)
            self.assertEqual(p.verified_payment(body,signature,SECRET)["id"],222)
            body["obj"]["amount_cents"]+=1
            with self.assertRaises(FamilyError):p.verified_payment(body,signature,SECRET)
            for flag,value in [("pending",True),("is_refunded",True),("is_auth",True),("success",False),("is_live",True)]:
                body=evidence();body["obj"][flag]=value
                with self.assertRaises(FamilyError):p.verified_payment(body,sign(body),SECRET)
            with self.assertRaises(FamilyError):p.checkout_url({"id":"pi_live_x","intention_order_id":1,"client_secret":"synthetic"},"egy_pk_test_x")
    def test_payload(self):
        with patch.dict(os.environ,{"LOLO_BILLING_STAGING":"true"}):
            order={"id":str(uuid.uuid4()),"testOnly":True,"status":"pending","currency":"EGP","planId":"plus","period":"monthly","amountMinor":14900}
            data={"first_name":"Test","last_name":"Parent","email":"test@example.test","phone_number":"+201000000000"}
            result=p.intention_payload(order,333,data,"https://example.test/webhook","https://example.test/return")
            self.assertEqual(result["amount"],14900);self.assertEqual(result["special_reference"],order["id"])
            self.assertEqual(p.checkout_url({"id":"pi_test_x","intention_order_id":1,"client_secret":"test_secret"},"egy_pk_test_x"),"https://accept.paymob.com/unifiedcheckout/?publicKey=egy_pk_test_x&clientSecret=test_secret")

@unittest.skipUnless(os.environ.get("LOLO_TEST_DATABASE_URL"),"Dedicated test DB required")
class ReceiptTests(unittest.TestCase):
    def test_binding_and_atomic_receipt(self):
        store=FamilyStore(os.environ["LOLO_TEST_DATABASE_URL"])
        self.assertNotEqual(store.dsn,os.environ.get("LOLO_DATABASE_URL"));store.migrate()
        email=f"{uuid.uuid4()}@example.test"
        store.provision(email,"synthetic-long-password");token=store.login(email,"synthetic-long-password")["token"]
        try:
            with patch.dict(os.environ,{"LOLO_BILLING_STAGING":"true"}):
                order=billing.create_order(store,token,"plus","monthly",str(uuid.uuid4()))
                pid=uuid.uuid4().int%1000000000000+1;tx=uuid.uuid4().int%1000000000000+1
                p.bind_test_intention(store,token,order["id"],pid,333,444)
                body=evidence(order=pid,tx=tx);wrong=evidence(amount=1,order=pid,tx=tx)
                with self.assertRaises(FamilyError):p.accept_test_callback(store,wrong,sign(wrong),SECRET)
                self.assertEqual(billing.test_subscription(store,token)["planId"],"free")
                self.assertFalse(p.accept_test_callback(store,body,sign(body),SECRET)["duplicate"])
                before=billing.test_subscription(store,token);self.assertEqual(before["planId"],"plus")
                self.assertTrue(p.accept_test_callback(store,body,sign(body),SECRET)["duplicate"])
                self.assertEqual(billing.test_subscription(store,token),before)
        finally:
            with store.connect() as db:db.execute("DELETE FROM lolo_parents WHERE email=%s",(email,))
