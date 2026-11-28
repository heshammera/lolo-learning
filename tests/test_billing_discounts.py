import os,uuid,unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock,patch
from family_accounts import FamilyStore,FamilyError
import billing,billing_discounts as d
@unittest.skipUnless(os.environ.get("LOLO_TEST_DATABASE_URL"),"Dedicated DB required")
class Discounts(unittest.TestCase):
    def test_quote_and_atomic_reservation(self):
        store=FamilyStore(os.environ["LOLO_TEST_DATABASE_URL"]);self.assertNotEqual(store.dsn,os.environ.get("LOLO_DATABASE_URL"));store.migrate()
        emails=[f"{uuid.uuid4()}@example.test" for _ in range(2)]
        admin=Mock();admin.inspect.return_value={"id":str(uuid.uuid4())}
        for email in emails:store.provision(email,"synthetic-long-password")
        a,b=[store.login(x,"synthetic-long-password")["token"] for x in emails]
        ids=[]
        try:
            with patch.dict(os.environ,{"LOLO_BILLING_STAGING":"true"}):
                c=d.create_discount(store,admin,"token","Synthetic sale","plus","monthly","percent",20,1,30);ids.append(c["id"])
                code=c["code"]
                self.assertEqual(d.quote(store,a,"plus","monthly",code)["amountMinor"],11920)
                with self.assertRaises(FamilyError):billing.create_order(store,a,"plus","monthly",str(uuid.uuid4()),14900,code)
                def reserve(token):
                    op=str(uuid.uuid4())
                    try:return token,op,billing.create_order(store,token,"plus","monthly",op,11920,code)
                    except FamilyError as exc:self.assertEqual(exc.status,409);return None
                with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(reserve,[a,b]))
                winners=[r for r in results if r];self.assertEqual(len(winners),1)
                token,op,order=winners[0];self.assertEqual(billing.create_order(store,token,"plus","monthly",op,11920,code),order)
                other=b if token==a else a
                billing.cancel_order(store,token,order["id"])
                new=billing.create_order(store,other,"plus","monthly",str(uuid.uuid4()),11920,code)
                billing.test_settle(store,new["id"],11920,"EGP")
                with self.assertRaises(FamilyError):d.quote(store,token,"plus","monthly",code)
                fixed=d.create_discount(store,admin,"token","Fixed","family","yearly","fixed",5000,2,30);ids.append(fixed["id"])
                self.assertEqual(d.quote(store,token,"family","yearly",fixed["code"])["amountMinor"],294000)
                d.disable_discount(store,admin,"token",fixed["id"])
                with self.assertRaises(FamilyError):d.quote(store,token,"family","yearly",fixed["code"])
        finally:
            with store.connect() as db:
                for email in emails:db.execute("DELETE FROM lolo_parents WHERE email=%s",(email,))
                for cid in ids:db.execute("DELETE FROM lolo_billing_test_discounts WHERE id=%s",(cid,))
