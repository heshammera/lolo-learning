import os
import unittest
import uuid
from unittest.mock import patch
from family_accounts import FamilyError, FamilyStore
import billing


class BillingTests(unittest.TestCase):
    def test_disabled(self):
        with patch.dict(os.environ,{"LOLO_BILLING_STAGING":"false"}):
            with self.assertRaises(FamilyError) as denied:billing.catalog(None)
            self.assertEqual(denied.exception.status,503)


@unittest.skipUnless(os.environ.get("LOLO_TEST_DATABASE_URL"),"Dedicated PostgreSQL database required")
class BillingDatabaseTests(unittest.TestCase):
    def setUp(self):
        dsn=os.environ["LOLO_TEST_DATABASE_URL"]
        if dsn==os.environ.get("LOLO_DATABASE_URL"):self.fail("Never test on application DB")
        self.store=FamilyStore(dsn)
        self.store.migrate()
        self.emails=[f"{uuid.uuid4()}@example.test" for _ in range(2)]
        for email in self.emails:self.store.provision(email,"synthetic-long-password")
        self.a,self.b=[self.store.login(email,"synthetic-long-password")["token"] for email in self.emails]

    def tearDown(self):
        with self.store.connect() as db:
            for email in self.emails:db.execute("DELETE FROM lolo_parents WHERE email=%s",(email,))

    def test_catalog_order_ownership_amount_and_expiry(self):
        with patch.dict(os.environ,{"LOLO_BILLING_STAGING":"true"}):
            plans=billing.catalog(self.store)
            self.assertEqual([(p["id"],p["monthlyMinor"],p["yearlyMinor"]) for p in plans],[("free",0,0),("plus",14900,149000),("family",29900,299000)])
            self.assertEqual(billing.test_subscription(self.store,self.a)["planId"],"free")
            op=str(uuid.uuid4())
            order=billing.create_order(self.store,self.a,"plus","monthly",op)
            self.assertEqual(order["amountMinor"],14900)
            self.assertEqual(order["status"],"pending")
            self.assertEqual(billing.create_order(self.store,self.a,"plus","monthly",op),order)
            with self.assertRaises(FamilyError):billing.create_order(self.store,self.a,"family","monthly",op)
            with self.assertRaises(FamilyError):billing.read_order(self.store,self.b,order["id"])
            for amount,currency in [(149,"EGP"),(14900,"USD"),(True,"EGP")]:
                with self.assertRaises(FamilyError):billing.test_settle(self.store,order["id"],amount,currency)
            self.assertEqual(billing.test_subscription(self.store,self.a)["planId"],"free")
            billing.test_settle(self.store,order["id"],14900,"EGP")
            before=billing.test_subscription(self.store,self.a)
            self.assertEqual(before["planId"],"plus")
            billing.test_settle(self.store,order["id"],14900,"EGP")
            self.assertEqual(billing.test_subscription(self.store,self.a),before)
            self.assertEqual(billing.test_subscription(self.store,self.b)["planId"],"free")
            with self.store.connect() as db:
                db.execute("UPDATE lolo_billing_test_entitlements SET starts_at=CURRENT_TIMESTAMP-INTERVAL '2 days',ends_at=CURRENT_TIMESTAMP-INTERVAL '1 day' WHERE order_id=%s",(order["id"],))
            self.assertEqual(billing.test_subscription(self.store,self.a)["planId"],"free")
            annual=billing.create_order(self.store,self.a,"family","yearly",str(uuid.uuid4()))
            self.assertEqual(annual["amountMinor"],299000)
            with self.store.connect() as db:
                db.execute("UPDATE lolo_billing_orders SET expires_at=CURRENT_TIMESTAMP-INTERVAL '1 minute' WHERE id=%s",(annual["id"],))
            with self.assertRaises(FamilyError):billing.test_settle(self.store,annual["id"],299000,"EGP")
