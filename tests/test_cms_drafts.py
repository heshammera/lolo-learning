import os,sys,unittest,uuid
from pathlib import Path
from datetime import datetime,timedelta,timezone
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"admin-src"))
from cms_drafts import Drafts,validate
from admin_identity import AdminStore,FamilyError

def sample():
    return {"schemaVersion":1,"subjectId":"science","gradeId":"grade-1","title":"Synthetic science","units":[{"id":"unit-1","title":"Plants","lessons":[{"id":"lesson-1","title":"Plants","goal":"Identify water","activities":[{"id":"activity-1","type":"true-false","version":1,"prompt":"Plants need water","config":{"answer":True}}]}]}]}

class ValidationTests(unittest.TestCase):
    def test_server_contracts(self):
        d=sample();self.assertTrue(validate(d)["valid"])
        d["units"][0]["lessons"][0]["activities"][0]["type"]="science-simulation"
        self.assertFalse(validate(d)["valid"])

@unittest.skipUnless(os.environ.get("LOLO_TEST_ADMIN_DATABASE_URL"),"Disposable DB required")
class DraftTests(unittest.TestCase):
    def setUp(self):
        import pyotp
        from cryptography.fernet import Fernet
        dsn=os.environ["LOLO_TEST_ADMIN_DATABASE_URL"]
        self.assertNotEqual(dsn,os.environ.get("LOLO_ADMIN_DATABASE_URL"))
        self.assertNotEqual(dsn,os.environ.get("LOLO_DATABASE_URL"))
        self.now=datetime.now(timezone.utc)
        self.store=AdminStore(dsn,Fernet.generate_key(),lambda:self.now)
        self.store.migrate()
        self.users=[];self.tokens=[]
        for role in ("content-manager","teacher","owner"):
            email=str(uuid.uuid4())+"@example.test";secret=pyotp.random_base32();password="synthetic-long-password"
            self.users.append(self.store.provision(email,password,role,secret,pyotp.TOTP(secret).at(self.now)))
            self.now+=timedelta(seconds=30)
            self.tokens.append(self.store.login(email,password,pyotp.TOTP(secret).at(self.now))["token"])
        self.cms=Drafts(self.store)
    def tearDown(self):
        with self.store.connect() as db:
            for user in self.users:
                db.execute("DELETE FROM lolo_cms_active_release WHERE draft_id IN (SELECT id FROM lolo_cms_drafts WHERE created_by=%s)",(user,))
                db.execute("DELETE FROM lolo_cms_releases WHERE draft_id IN (SELECT id FROM lolo_cms_drafts WHERE created_by=%s)",(user,))
                db.execute("DELETE FROM lolo_cms_drafts WHERE created_by=%s",(user,))
            for user in self.users:
                db.execute("DELETE FROM lolo_admin_audit WHERE actor_id=%s",(user,))
                db.execute("DELETE FROM lolo_admin_users WHERE id=%s",(user,))
    def test_save_revision_and_permissions(self):
        editor,teacher,_=self.tokens
        content=sample()
        result=self.cms.save(editor,None,0,content)
        self.assertTrue(result["saved"]);ident=result["id"]
        self.assertEqual(self.cms.read(teacher,ident)["content"],content)
        self.assertIn(ident,[d["id"] for d in self.cms.list(editor)["drafts"]])
        with self.assertRaises(FamilyError) as e:self.cms.save(teacher,ident,1,content)
        self.assertEqual(e.exception.status,403)
        content["title"]="Updated"
        self.assertEqual(self.cms.save(editor,ident,1,content)["revision"],2)
        with self.assertRaises(FamilyError) as e:self.cms.save(editor,ident,1,content)
        self.assertEqual(e.exception.status,409)
        content["units"][0]["lessons"][0]["activities"][0]["version"]=999
        self.assertFalse(self.cms.save(editor,ident,2,content)["saved"])
        self.assertEqual(self.cms.read(editor,ident)["revision"],2)

    def test_review_release_rollback_and_conflicts(self):
        editor,teacher,owner=self.tokens
        d=sample();ident=self.cms.save(owner,None,0,d)["id"]
        def denied(fn,status):
            with self.assertRaises(FamilyError) as e:fn()
            self.assertEqual(e.exception.status,status)
        denied(lambda:self.cms.transition(owner,ident,1,"publish"),409)
        self.assertEqual(self.cms.transition(owner,ident,1,"submit")["status"],"review")
        denied(lambda:self.cms.save(owner,ident,2,d),409)
        denied(lambda:self.cms.transition(owner,ident,2,"approve"),403)
        denied(lambda:self.cms.transition(editor,ident,2,"approve"),403)
        self.assertEqual(self.cms.transition(teacher,ident,2,"approve")["status"],"approved")
        denied(lambda:self.cms.transition(teacher,ident,3,"publish"),403)
        first=self.cms.transition(owner,ident,3,"publish")["releaseId"]
        denied(lambda:self.cms.transition(owner,ident,3,"publish"),409)
        self.cms.transition(editor,ident,4,"reopen")
        d["title"]="Second version"
        self.assertEqual(self.cms.save(editor,ident,5,d)["revision"],6)
        self.cms.transition(editor,ident,6,"submit")
        self.cms.transition(teacher,ident,7,"approve")
        second=self.cms.transition(owner,ident,8,"publish")["releaseId"]
        history=self.cms.history(teacher,ident)["releases"]
        self.assertEqual([r["version"] for r in history],[2,1])
        self.assertEqual(history[0]["id"],second)
        self.assertTrue(history[0]["active"])
        denied(lambda:self.cms.rollback(editor,ident,first,second),403)
        denied(lambda:self.cms.rollback(owner,ident,first,first),409)
        self.assertEqual(self.cms.rollback(owner,ident,first,second)["activeReleaseId"],first)
        history=self.cms.history(teacher,ident)["releases"]
        self.assertTrue(history[1]["active"])
        self.assertEqual(self.cms.read(editor,ident)["content"]["title"],"Second version")
        with self.store.connect() as db:
            original=db.execute("SELECT content->>'title' FROM lolo_cms_releases WHERE id=%s",(first,)).fetchone()[0]
        self.assertEqual(original,"Synthetic science")
