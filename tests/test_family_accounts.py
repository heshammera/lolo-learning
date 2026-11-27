import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from family_accounts import FamilyStore, FamilyError, password_hash, verify_password, digest_token, child_fields
import server


class FamilyUnitTests(unittest.TestCase):
    def test_password_hash_and_token_validation(self):
        value = "example-long-password"
        encoded = password_hash(value)
        self.assertNotEqual(encoded, password_hash(value))
        self.assertTrue(verify_password(value, encoded))
        self.assertFalse(verify_password("incorrect-long-password", encoded))
        self.assertFalse(verify_password(value, "invalid"))
        with self.assertRaises(FamilyError):
            digest_token("not-a-token")

    def test_minimal_child_fields(self):
        self.assertEqual(child_fields(" لولو ", "4-6"), ("لولو","4-6"))
        for nickname,band in [("", "4-6"), ("a\n", []), ("x", "unknown"), ("x"*41,"4-6")]:
            with self.assertRaises(FamilyError):
                child_fields(nickname,band)

    def test_default_disabled(self):
        from io import BytesIO
        handler = object.__new__(server.Handler)
        handler.send_json = lambda status, data: (status,data)
        with patch.object(server,"FAMILY_ENABLED",False), patch.object(server,"FamilyStore") as store:
            self.assertEqual(handler.family_request()[0],503)
            store.assert_not_called()


@unittest.skipUnless(os.environ.get("LOLO_TEST_DATABASE_URL"), "Dedicated PostgreSQL test database not configured")
class FamilyDatabaseTests(unittest.TestCase):
    def setUp(self):
        dsn = os.environ["LOLO_TEST_DATABASE_URL"]
        if dsn == os.environ.get("LOLO_DATABASE_URL"):
            self.fail("Never test against the configured application database")
        self.store = FamilyStore(dsn)
        self.store.migrate()
        # Only the disposable CI database is permitted here.
        import uuid
        self.emails = [f"{uuid.uuid4()}@example.test" for _ in range(2)]
        self.password = "test-long-password-only"
        self.ids = [self.store.provision(email,self.password) for email in self.emails]

    def tearDown(self):
        with self.store.connect() as db:
            for email in self.emails:
                db.execute("DELETE FROM lolo_parents WHERE email=%s",(email,))

    def test_login_child_isolation_and_logout(self):
        with self.assertRaises(FamilyError):
            self.store.login(self.emails[0],"incorrect-long-password")
        a,b = [self.store.login(email,self.password)["token"] for email in self.emails]
        child = self.store.create_child(a,"Learner","7-9")
        self.assertEqual(self.store.children(a),[child])
        self.assertEqual(self.store.children(b),[])
        with self.assertRaises(FamilyError) as denied:
            self.store.delete_child(b,child["id"])
        self.assertEqual(denied.exception.status,404)
        self.store.delete_child(a,child["id"])
        self.assertEqual(self.store.children(a),[])
        self.store.logout(a)
        with self.assertRaises(FamilyError):
            self.store.children(a)

    def test_expired_session_and_hash_only_storage(self):
        token = self.store.login(self.emails[0],self.password)["token"]
        with self.store.connect() as db:
            row = db.execute("SELECT token_hash FROM lolo_parent_sessions WHERE parent_id=%s",(self.ids[0],)).fetchone()
            self.assertEqual(bytes(row[0]),digest_token(token))
            db.execute("UPDATE lolo_parent_sessions SET expires_at=%s WHERE token_hash=%s",(datetime.now(timezone.utc)-timedelta(seconds=1),digest_token(token)))
        with self.assertRaises(FamilyError):
            self.store.children(token)

    def test_http_routes_and_account_isolation(self):
        import json
        import threading
        from http.server import ThreadingHTTPServer
        from urllib.request import Request, urlopen
        from urllib.error import HTTPError
        httpd=ThreadingHTTPServer(("127.0.0.1",0),server.Handler)
        thread=threading.Thread(target=httpd.serve_forever,daemon=True)
        thread.start()
        def request(body,token=None):
            headers={"Content-Type":"application/json"}
            if token:
                headers["Authorization"]="Bearer "+token
            req=Request(f"http://127.0.0.1:{httpd.server_port}/api/family",data=json.dumps(body).encode(),headers=headers)
            try:
                response=urlopen(req,timeout=10)
            except HTTPError as error:
                response=error
            with response:
                self.assertEqual(response.headers.get("Cache-Control"),"no-store")
                return response.status,json.load(response)
        try:
            with patch.object(server,"FAMILY_ENABLED",True), patch.dict(os.environ,{"LOLO_DATABASE_URL":self.store.dsn}), patch.object(server,"FAMILY_RATE_LIMITER",server.SlidingWindowRateLimiter()), patch.object(server,"FAMILY_GLOBAL_LIMITER",server.SlidingWindowRateLimiter()):
                self.assertEqual(request({"action":"children"})[0],401)
                self.assertEqual(request({"action":"register"})[0],400)
                a,b=[request({"action":"login","email":email,"password":self.password})[1]["token"] for email in self.emails]
                status,child=request({"action":"createChild","nickname":"Learner","ageBand":"4-6"},a)
                self.assertEqual(status,201)
                self.assertEqual(request({"action":"children"},a),(200,{"children":[child]}))
                self.assertEqual(request({"action":"children"},b),(200,{"children":[]}))
                self.assertEqual(request({"action":"deleteChild","childId":child["id"]},b)[0],404)
                import uuid
                from progress_sync import VERSION
                read={"action":"readProgress","childId":child["id"]}
                write={"action":"writeProgress","childId":child["id"],"baseRevision":0,"operationId":str(uuid.uuid4()),"snapshot":{"schemaVersion":1,"curriculumVersion":VERSION,"completedLessonIds":["hello-1"],"path":None}}
                with patch.object(server,"PROGRESS_SYNC_ENABLED",False):
                    self.assertEqual(request(read,a)[0],503)
                    self.assertEqual(request(write,a)[0],503)
                with patch.object(server,"PROGRESS_SYNC_ENABLED",True):
                    self.assertEqual(request(read)[0],401)
                    self.assertEqual(request(read,b)[0],404)
                    self.assertEqual(request(read,a)[1]["revision"],0)
                    status,initial=request(write,a)
                    self.assertEqual(status,200)
                    self.assertEqual(initial["revision"],1)
                    self.assertEqual(request(write,a),(200,initial))
                    self.assertEqual(request({**write,"operationId":str(uuid.uuid4())},a)[0],409)
                    self.assertEqual(request(read,a),(200,initial))
                    self.assertEqual(request({**write,"baseRevision":1},b)[0],404)
                self.assertEqual(request({"action":"logout"},a)[0],200)
                self.assertEqual(request({"action":"children"},a)[0],401)
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=3)

    def test_disabled_parent_cannot_login_or_use_existing_session(self):
        token=self.store.login(self.emails[0],self.password)["token"]
        with self.store.connect() as db:
            db.execute("UPDATE lolo_parents SET disabled_at=CURRENT_TIMESTAMP WHERE id=%s",(self.ids[0],))
        with self.assertRaises(FamilyError):
            self.store.login(self.emails[0],self.password)
        with self.assertRaises(FamilyError):
            self.store.children(token)

    def test_progress_revision_retry_and_ownership(self):
        import uuid
        from progress_sync import VERSION
        a,b=[self.store.login(email,self.password)["token"] for email in self.emails]
        child=self.store.create_child(a,"Learner","4-6")["id"]
        empty={"schemaVersion":1,"curriculumVersion":VERSION,"completedLessonIds":[],"path":None}
        progressed={**empty,"completedLessonIds":["hello-1"]}
        self.assertEqual(self.store.read_progress(a,child)["revision"],0)
        op=str(uuid.uuid4())
        first=self.store.write_progress(a,child,0,op,progressed)
        self.assertEqual(first["revision"],1)
        self.assertEqual(self.store.write_progress(a,child,0,op,progressed),first)
        for token,revision,operation,snapshot,status in [
            (a,0,str(uuid.uuid4()),empty,409),
            (a,0,op,empty,409),
            (b,1,str(uuid.uuid4()),empty,404),
            (a,1,str(uuid.uuid4()),{**empty,"transcript":"not allowed"},400),
        ]:
            with self.assertRaises(FamilyError) as error:
                self.store.write_progress(token,child,revision,operation,snapshot)
            self.assertEqual(error.exception.status,status)
        with self.assertRaises(FamilyError):
            self.store.read_progress(b,child)
        self.assertEqual(self.store.read_progress(a,child),first)
        second=self.store.write_progress(a,child,1,str(uuid.uuid4()),empty)
        self.assertEqual(second["revision"],2)
        self.store.delete_child(a,child)
        with self.store.connect() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM lolo_child_progress WHERE child_id=%s",(child,)).fetchone()[0],0)

    def test_concurrent_progress_writes_do_not_overwrite(self):
        from concurrent.futures import ThreadPoolExecutor
        import uuid
        from progress_sync import VERSION
        token=self.store.login(self.emails[0],self.password)["token"]
        child=self.store.create_child(token,"Learner","4-6")["id"]
        def write(lesson):
            snapshot={"schemaVersion":1,"curriculumVersion":VERSION,"completedLessonIds":[lesson],"path":None}
            try:
                return self.store.write_progress(token,child,0,str(uuid.uuid4()),snapshot)["revision"]
            except FamilyError as exc:
                return exc.status
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(write,["hello-1","hello-2"])),[1,409])
        self.assertEqual(self.store.read_progress(token,child)["revision"],1)
