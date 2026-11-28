import os
import unittest
import uuid
from unittest.mock import Mock, patch
from family_accounts import FamilyStore, FamilyError
import billing_owner as owner

class ValidationTests(unittest.TestCase):
    def test_free_and_limits(self):
        valid={"monthlyMinor":0,"yearlyMinor":0,"childLimit":1,"voiceSecondsMonthly":300,"pronunciationAttemptsMonthly":0,"enabled":True}
        owner.validate("free",valid)
        for changes in [{"enabled":False},{"monthlyMinor":1},{"childLimit":True},{"voiceSecondsMonthly":-1}]:
            with self.assertRaises(FamilyError):owner.validate("free",{**valid,**changes})

@unittest.skipUnless(os.environ.get("LOLO_TEST_DATABASE_URL"),"Dedicated DB required")
class OwnerDatabaseTests(unittest.TestCase):
    def test_policy_audit_stale_revision_and_permission(self):
        store=FamilyStore(os.environ["LOLO_TEST_DATABASE_URL"])
        self.assertNotEqual(store.dsn,os.environ.get("LOLO_DATABASE_URL"))
        store.migrate()
        admin=Mock()
        actor=str(uuid.uuid4())
        admin.inspect.return_value={"id":actor}
        with patch.dict(os.environ,{"LOLO_BILLING_STAGING":"true"}):
            plan=next(p for p in owner.list_plans(store,admin,"token")["plans"] if p["id"]=="plus")
            old={k:plan[k] for k in owner.FIELDS}
            try:
                changed=owner.change_plan(store,admin,"token","plus",plan["revision"],{**old,"monthlyMinor":15900})["plan"]
                self.assertEqual(changed["monthlyMinor"],15900)
                admin.inspect.assert_called_with("token","billing:manage")
                with self.assertRaises(FamilyError) as stale:owner.change_plan(store,admin,"token","plus",plan["revision"],old)
                self.assertEqual(stale.exception.status,409)
                audit=owner.history(store,admin,"token")["changes"][0]
                self.assertEqual(audit["actorId"],actor)
                self.assertEqual(audit["before"]["monthlyMinor"],old["monthlyMinor"])
                self.assertEqual(audit["after"]["monthlyMinor"],15900)
                admin.inspect.side_effect=FamilyError(403,"Denied")
                with self.assertRaises(FamilyError):owner.list_plans(store,admin,"token")
                with self.assertRaises(FamilyError):owner.change_plan(store,admin,"token","plus",changed["revision"],old)
            finally:
                with store.connect() as db:
                    db.execute("UPDATE lolo_billing_plans SET monthly_minor=%s,revision=%s WHERE id='plus'",(old["monthlyMinor"],plan["revision"]))
                    db.execute("DELETE FROM lolo_billing_plan_audit WHERE actor_id=%s",(actor,))
