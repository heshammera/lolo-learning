import os,unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from family_accounts import FamilyStore
from request_budget import admit,BudgetUnavailable
import server

@unittest.skipUnless(os.environ.get("LOLO_TEST_DATABASE_URL"),"Dedicated DB required")
class SharedBudgetTests(unittest.TestCase):
    def test_concurrent_and_daily_admission(self):
        dsn=os.environ["LOLO_TEST_DATABASE_URL"];self.assertNotEqual(dsn,os.environ.get("LOLO_DATABASE_URL"));store=FamilyStore(dsn);store.migrate()
        try:
            with store.connect() as db:db.execute("DELETE FROM lolo_shared_request_budget")
            with ThreadPoolExecutor(max_workers=8) as pool:
                results=list(pool.map(lambda _:admit(dsn,"paid",100,3),range(12)))
            self.assertEqual(sum(ok for ok,_ in results),3)
            self.assertFalse(admit(dsn,"paid",100,3)[0])
            self.assertTrue(admit(dsn,"login",2)[0])
            with store.connect() as db:
                db.execute("UPDATE lolo_shared_request_budget SET window_start=window_start-interval '1 day' WHERE bucket LIKE 'paid-%%'")
            self.assertTrue(admit(dsn,"paid",1,3)[0])
            self.assertFalse(admit(dsn,"paid",1,3)[0])
        finally:
            with store.connect() as db:db.execute("DELETE FROM lolo_shared_request_budget")
    def test_required_without_db_fails(self):
        with self.assertRaises(BudgetUnavailable):admit(None,"paid",10,100)

class AdmissionBoundary(unittest.TestCase):
    def test_required_fails_closed_and_off_preserves_existing_mode(self):
        from unittest.mock import Mock
        h=Mock()
        with patch.dict(os.environ,{"LOLO_SHARED_REQUEST_BUDGET":"required","LOLO_BUDGET_DATABASE_URL":""}):
            self.assertFalse(server.Handler.shared_admission(h,"paid"))
            self.assertEqual(h.send_json.call_args.args[0],503)
        with patch.dict(os.environ,{"LOLO_SHARED_REQUEST_BUDGET":"off"}):
            self.assertTrue(server.Handler.shared_admission(h,"paid"))
