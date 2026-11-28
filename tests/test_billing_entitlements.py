import os
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from family_accounts import FamilyStore, FamilyError
import billing
import billing_entitlements as e


@unittest.skipUnless(os.environ.get("LOLO_TEST_DATABASE_URL"),"Dedicated PostgreSQL database required")
class EntitlementTests(unittest.TestCase):
    def setUp(self):
        dsn=os.environ["LOLO_TEST_DATABASE_URL"]
        if dsn==os.environ.get("LOLO_DATABASE_URL"):self.fail("Never test application database")
        self.store=FamilyStore(dsn)
        self.store.migrate()
        self.emails=[f"{uuid.uuid4()}@example.test" for _ in range(2)]
        for email in self.emails:self.store.provision(email,"synthetic-long-password")
        self.a,self.b=[self.store.login(email,"synthetic-long-password")["token"] for email in self.emails]
        self.children=[self.store.create_child(self.a,"Synthetic child","7-9")["id"] for _ in range(5)]

    def tearDown(self):
        with self.store.connect() as db:
            for email in self.emails:db.execute("DELETE FROM lolo_parents WHERE email=%s",(email,))

    def test_free_slots_and_atomic_shared_quota(self):
        with patch.dict(os.environ,{"LOLO_BILLING_STAGING":"true"}):
            child=self.children[0]
            self.assertFalse(e.feature_allowed(self.store,self.a,child,"local-progress"))
            self.assertTrue(e.assign_slot(self.store,self.a,child))
            self.assertTrue(e.feature_allowed(self.store,self.a,child,"local-progress"))
            self.assertFalse(e.feature_allowed(self.store,self.a,child,"homework"))
            with self.assertRaises(FamilyError):e.assign_slot(self.store,self.a,self.children[1])
            with self.assertRaises(FamilyError):e.assign_slot(self.store,self.b,child)
            with self.assertRaises(FamilyError):e.reserve(self.store,self.a,child,"pronunciation",1,str(uuid.uuid4()))
            op=str(uuid.uuid4())
            self.assertTrue(e.reserve(self.store,self.a,child,"voice",100,op)["reserved"])
            self.assertFalse(e.reserve(self.store,self.a,child,"voice",100,op)["reserved"])
            with self.assertRaises(FamilyError):e.reserve(self.store,self.a,child,"voice",99,op)
            def charge(_):
                try:return e.reserve(self.store,self.a,child,"voice",150,str(uuid.uuid4()))["reserved"]
                except FamilyError as exc:
                    self.assertEqual(exc.status,429)
                    return False
            with ThreadPoolExecutor(max_workers=2) as pool:
                self.assertEqual(sorted(pool.map(charge,range(2))),[False,True])
            self.assertEqual(e.usage_status(self.store,self.a)["voiceUsed"],250)
            self.assertTrue(e.remove_slot(self.store,self.a,child))
            self.assertTrue(e.assign_slot(self.store,self.a,self.children[1]))
            self.assertEqual(e.usage_status(self.store,self.a)["voiceUsed"],250)
            with self.assertRaises(FamilyError):e.reserve(self.store,self.a,self.children[1],"voice",51,str(uuid.uuid4()))

    def test_family_downgrade_preserves_data(self):
        with patch.dict(os.environ,{"LOLO_BILLING_STAGING":"true"}):
            order=billing.create_order(self.store,self.a,"family","monthly",str(uuid.uuid4()))
            billing.test_settle(self.store,order["id"],29900,"EGP")
            for child in self.children[:4]:self.assertTrue(e.assign_slot(self.store,self.a,child))
            with self.assertRaises(FamilyError):e.assign_slot(self.store,self.a,self.children[4])
            self.assertTrue(e.feature_allowed(self.store,self.a,self.children[1],"homework"))
            for child in self.children[:4]:e.reserve(self.store,self.a,child,"voice",10,str(uuid.uuid4()))
            self.assertEqual(e.usage_status(self.store,self.a)["voiceUsed"],40)
            with self.store.connect() as db:
                db.execute("UPDATE lolo_billing_test_entitlements SET starts_at=CURRENT_TIMESTAMP-INTERVAL '2 days',ends_at=CURRENT_TIMESTAMP-INTERVAL '1 day' WHERE order_id=%s",(order["id"],))
            result=e.usage_status(self.store,self.a)
            self.assertEqual(result["planId"],"free")
            self.assertEqual(len(result["activeChildIds"]),1)
            self.assertEqual(result["voiceUsed"],40)
            self.assertEqual(len(self.store.children(self.a)),5)
