import os,uuid,unittest
from unittest.mock import Mock,patch
from family_accounts import FamilyStore,FamilyError
import billing,billing_grants as g,billing_entitlements as e
@unittest.skipUnless(os.environ.get("LOLO_TEST_DATABASE_URL"),"Dedicated DB required")
class GrantTests(unittest.TestCase):
    def test_manual_and_trial(self):
        store=FamilyStore(os.environ["LOLO_TEST_DATABASE_URL"]);self.assertNotEqual(store.dsn,os.environ.get("LOLO_DATABASE_URL"));store.migrate()
        emails=[f"{uuid.uuid4()}@example.test" for _ in range(2)]
        admin=Mock();admin.inspect.return_value={"id":str(uuid.uuid4())}
        for email in emails:store.provision(email,"synthetic-long-password")
        a,b=[store.login(x,"synthetic-long-password")["token"] for x in emails]
        cid=None
        try:
            with patch.dict(os.environ,{"LOLO_BILLING_STAGING":"true"}):
                first=g.manual_change(store,admin,"token",emails[0],"grant","plus",30,0)["grant"]
                self.assertEqual(billing.test_subscription(store,a)["planId"],"plus")
                self.assertEqual(e.usage_status(store,a)["voiceLimit"],3600)
                with self.assertRaises(FamilyError):g.manual_change(store,admin,"token",emails[0],"extend","plus",7,0)
                next=g.manual_change(store,admin,"token",emails[0],"extend","plus",7,first["revision"])["grant"]
                g.manual_change(store,admin,"token",emails[0],"revoke",None,0,next["revision"])
                self.assertEqual(billing.test_subscription(store,a)["planId"],"free")
                coupon=g.create_trial(store,admin,"token","Synthetic launch","family",7,1,30);cid=coupon["id"]
                self.assertEqual(g.redeem_trial(store,a,coupon["code"])["grant"]["source"],"trial")
                self.assertEqual(e.usage_status(store,a)["childLimit"],4)
                with self.assertRaises(FamilyError):g.redeem_trial(store,a,coupon["code"])
                with self.assertRaises(FamilyError):g.redeem_trial(store,b,coupon["code"])
                self.assertEqual(g.list_trials(store,admin,"token")["coupons"][0]["used"],1)
                g.disable_trial(store,admin,"token",cid)
                admin.inspect.side_effect=FamilyError(403,"Denied")
                with self.assertRaises(FamilyError):g.create_trial(store,admin,"token","Denied","plus",7,1,30)
        finally:
            with store.connect() as db:
                for email in emails:db.execute("DELETE FROM lolo_parents WHERE email=%s",(email,))
                if cid:db.execute("DELETE FROM lolo_billing_test_coupons WHERE id=%s",(cid,))
