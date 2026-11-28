import os,uuid,unittest
from unittest.mock import Mock,patch
from family_accounts import FamilyStore,FamilyError
import billing,billing_grants as grants,billing_analytics as analytics,billing_entitlements as entitlements
@unittest.skipUnless(os.environ.get("LOLO_TEST_DATABASE_URL"),"Dedicated DB required")
class AnalyticsTest(unittest.TestCase):
    def test_aggregate_source_and_usage_separation(self):
        store=FamilyStore(os.environ["LOLO_TEST_DATABASE_URL"]);self.assertNotEqual(store.dsn,os.environ.get("LOLO_DATABASE_URL"));store.migrate()
        admin=Mock();admin.inspect.return_value={"id":str(uuid.uuid4())}
        emails=[f"{uuid.uuid4()}@example.test" for _ in range(3)]
        try:
            with patch.dict(os.environ,{"LOLO_BILLING_STAGING":"true"}):
                before=analytics.snapshot(store,admin,"token")
                for email in emails:store.provision(email,"synthetic-long-password")
                a,b,c=[store.login(email,"synthetic-long-password")["token"] for email in emails]
                grants.manual_change(store,admin,"token",emails[0],"grant","plus",7,0)
                order=billing.create_order(store,b,"family","monthly",str(uuid.uuid4()))
                billing.test_settle(store,order["id"],order["amountMinor"],"EGP")
                child=store.create_child(a,"Synthetic","7-9")["id"];entitlements.assign_slot(store,a,child)
                entitlements.reserve(store,a,child,"voice",60,str(uuid.uuid4()))
                r=analytics.snapshot(store,admin,"token")
                self.assertEqual(r["activeAccounts"]-before["activeAccounts"],3)
                self.assertEqual(r["plans"]["plus"]-before["plans"]["plus"],1)
                self.assertEqual(r["plans"]["family"]-before["plans"]["family"],1)
                self.assertEqual(r["plans"]["free"]-before["plans"]["free"],1)
                self.assertEqual(r["activeSources"]["manual"]-before["activeSources"]["manual"],1)
                self.assertEqual(r["activeSources"]["testSettlement"]-before["activeSources"]["testSettlement"],1)
                self.assertEqual(int(r["orders"]["testAmountMinor"])-int(before["orders"]["testAmountMinor"]),order["amountMinor"])
                self.assertEqual(r["usage"]["voice"]["reservedUnits"]-before["usage"]["voice"]["reservedUnits"],60)
                self.assertIsNone(r["realRevenueMinor"]);self.assertIsNone(r["actualProviderCostMinor"])
                admin.inspect.side_effect=FamilyError(403,"Denied")
                with self.assertRaises(FamilyError):analytics.snapshot(store,admin,"token")
        finally:
            with store.connect() as db:
                for email in emails:db.execute("DELETE FROM lolo_parents WHERE email=%s",(email,))
