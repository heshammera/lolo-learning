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
        for role in ("content-manager","teacher"):
            email=str(uuid.uuid4())+"@example.test";secret=pyotp.random_base32();password="synthetic-long-password"
            self.users.append(self.store.provision(email,password,role,secret,pyotp.TOTP(secret).at(self.now)))
            self.now+=timedelta(seconds=30)
            self.tokens.append(self.store.login(email,password,pyotp.TOTP(secret).at(self.now))["token"])
        self.cms=Drafts(self.store)
    def tearDown(self):
        with self.store.connect() as db:
            for user in self.users:
                db.execute("DELETE FROM lolo_cms_drafts WHERE created_by=%s",(user,))
                db.execute("DELETE FROM lolo_admin_audit WHERE actor_id=%s",(user,))
                db.execute("DELETE FROM lolo_admin_users WHERE id=%s",(user,))
    def test_save_revision_and_permissions(self):
        editor,teacher=self.tokens
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
