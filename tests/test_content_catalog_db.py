import json,os,sys,unittest
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"admin-src"))
from content_packages import sign_package,public_jwk
from content_catalog_db import configured_dsn,connect,read_catalog,publish,verified_envelope
D="11111111-1111-4111-8111-111111111111"
R="22222222-2222-4222-8222-222222222222"
S="33333333-3333-4333-8333-333333333333"
DSN="postgresql://catalog_test:disposable-catalog-only@127.0.0.1:5432/catalog_test"
def content(title):
    return {"schemaVersion":1,"subjectId":"science","gradeId":"grade-1","title":title,
        "units":[{"id":"u","title":"Unit","lessons":[{"id":"l","title":"Lesson","goal":"Goal",
        "activities":[{"id":"a","type":"true-false","version":1,"prompt":"Plants need water","config":{"answer":True}}]}]}]}
class GuardTest(unittest.TestCase):
    def test_isolation(self):
        for env in ({},{"LOLO_CONTENT_CATALOG_DATABASE_URL":"same","LOLO_DATABASE_URL":"same"},{"LOLO_CONTENT_CATALOG_DATABASE_URL":"reader","LOLO_CONTENT_CATALOG_WRITER_DATABASE_URL":"writer"}):
            with self.assertRaises(ValueError):configured_dsn(env)
@unittest.skipUnless(os.environ.get("LOLO_TEST_CATALOG_DATABASE_URL"),"Dedicated disposable database required")
class CatalogTest(unittest.TestCase):
    def test_signature_concurrency_rollback_and_read_only_boundary(self):
        from cryptography.hazmat.primitives.asymmetric import ec
        self.assertEqual(os.environ["LOLO_TEST_CATALOG_DATABASE_URL"],DSN)
        self.assertNotIn(DSN,(os.environ.get("LOLO_DATABASE_URL"),os.environ.get("LOLO_CONTENT_CATALOG_DATABASE_URL")))
        key=ec.generate_private_key(ec.SECP256R1());keys={"fixture":public_jwk(key)}
        with connect(DSN) as db:
            db.execute((ROOT/"database/content-catalog/001_catalog.sql").read_text())
            db.execute("DELETE FROM lolo_public_content_catalog")
        def signed(seq,version,release,title):return sign_package("fixture",key,D,release,version,seq,content(title))
        first=signed(1,1,R,"First")
        self.assertEqual(publish(DSN,first,keys,0,False)["status"],"published")
        self.assertEqual(publish(DSN,first,keys,0,False)["status"],"already-published")
        self.assertEqual(read_catalog(DSN,False)[D][0]["sequence"],1)
        with self.assertRaises(ValueError):publish(DSN,{**first,"signature":"eA"*42+"eA"},keys,1,False)
        with self.assertRaises(ValueError):publish(DSN,signed(1,1,R,"Conflicting"),keys,1,False)
        second=signed(2,2,S,"Second")
        competing=signed(3,2,S,"Concurrent")
        def attempt(envelope):
            try:return publish(DSN,envelope,keys,1,False)["status"]
            except ValueError:return "conflict"
        with ThreadPoolExecutor(max_workers=2) as pool:self.assertEqual(sorted(pool.map(attempt,[second,competing])),["conflict","published"])
        current=read_catalog(DSN,False)[D][0]["sequence"]
        rollback=signed(current+1,1,R,"First")
        self.assertEqual(publish(DSN,rollback,keys,current,False)["sequence"],current+1)
        self.assertEqual(read_catalog(DSN,False)[D][0]["version"],1)
        with self.assertRaises(ValueError):publish(DSN,first,keys,current+1,False)
        with self.assertRaises(RuntimeError):read_catalog(DSN,True)
        with connect(DSN) as db:db.execute("CREATE TABLE lolo_parents(id uuid)")
        try:
            with self.assertRaises(RuntimeError):read_catalog(DSN,False)
            with self.assertRaises(ValueError):publish(DSN,signed(current+2,1,R,"First"),keys,current+1,False)
        finally:
            with connect(DSN) as db:db.execute("DROP TABLE lolo_parents")
