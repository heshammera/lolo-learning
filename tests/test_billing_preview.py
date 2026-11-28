import importlib.util
import os
import unittest
import uuid
from pathlib import Path
from unittest.mock import Mock, patch
from family_accounts import FamilyStore, FamilyError
import billing

spec=importlib.util.spec_from_file_location("billing_preview",Path(__file__).resolve().parents[1]/"staging-billing"/"serve.py")
preview=importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)

class PreviewBoundaryTests(unittest.TestCase):
    def test_disabled_and_no_settlement_action(self):
        with patch.dict(os.environ,{"LOLO_BILLING_STAGING":"false"}):
            with self.assertRaises(FamilyError):preview.Server(0,Mock())
        with patch.dict(os.environ,{"LOLO_BILLING_STAGING":"true"}):
            for body in [{"action":"settle"},{"action":"create","planId":"plus","period":"monthly","operationId":"x","expectedAmountMinor":1,"paid":True},{"action":"login","email":"real@example.com","password":"password"}]:
                with self.assertRaises(FamilyError):preview.dispatch(Mock(),body,"")

@unittest.skipUnless(os.environ.get("LOLO_TEST_DATABASE_URL"),"Dedicated test database required")
class PreviewDatabaseTests(unittest.TestCase):
    def setUp(self):
        dsn=os.environ["LOLO_TEST_DATABASE_URL"]
        self.assertNotEqual(dsn,os.environ.get("LOLO_DATABASE_URL"))
        self.store=FamilyStore(dsn)
        self.store.migrate()
        self.emails=[f"{uuid.uuid4()}@example.test" for _ in range(2)]
        for email in self.emails:self.store.provision(email,"synthetic-long-password")
        self.a,self.b=[self.store.login(email,"synthetic-long-password")["token"] for email in self.emails]
    def tearDown(self):
        with self.store.connect() as db:
            for email in self.emails:db.execute("DELETE FROM lolo_parents WHERE email=%s",(email,))
    def test_quote_and_order_isolation(self):
        with patch.dict(os.environ,{"LOLO_BILLING_STAGING":"true"}):
            initial=preview.dispatch(self.store,{"action":"dashboard"},self.a)
            self.assertEqual(initial["subscription"]["planId"],"free")
            self.assertEqual(initial["usage"]["voiceLimit"],300)
            amount=next(p["monthlyMinor"] for p in initial["plans"] if p["id"]=="plus")
            request={"action":"create","planId":"plus","period":"monthly","operationId":str(uuid.uuid4()),"expectedAmountMinor":amount}
            with self.assertRaises(FamilyError) as stale:preview.dispatch(self.store,{**request,"expectedAmountMinor":amount+1},self.a)
            self.assertEqual(stale.exception.status,409)
            self.assertEqual(billing.list_orders(self.store,self.a),[])
            order=preview.dispatch(self.store,request,self.a)
            self.assertEqual(order["amountMinor"],amount)
            self.assertEqual(preview.dispatch(self.store,request,self.a),order)
            self.assertEqual(preview.dispatch(self.store,{"action":"dashboard"},self.b)["orders"],[])
            with self.assertRaises(FamilyError):preview.dispatch(self.store,{"action":"cancel","orderId":order["id"]},self.b)
            self.assertEqual(preview.dispatch(self.store,{"action":"cancel","orderId":order["id"]},self.a)["status"],"cancelled")
            self.assertEqual(billing.test_subscription(self.store,self.a)["planId"],"free")
            self.assertEqual(billing.list_orders(self.store,self.a)[0]["status"],"cancelled")
