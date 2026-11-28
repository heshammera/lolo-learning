"""Real HTTP + two disposable PostgreSQL services; never use application DSNs."""
import json
import os
import threading
import unittest
import uuid
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch
from family_accounts import FamilyStore
from progress_sync import VERSION
import server

PRIMARY="postgresql://lolo_test:disposable-ci-only@127.0.0.1:5432/lolo_test"
PILOT="postgresql://lolo_pilot:disposable-pilot-only@127.0.0.1:5433/lolo_pilot"

@unittest.skipUnless(os.environ.get("LOLO_TEST_PILOT_DATABASE_URL"),"Dedicated pilot test service not configured")
class HostedFamilyPilotTest(unittest.TestCase):
    def test_two_database_hosted_http_roundtrip(self):
        # Restrict this destructive fixture setup to the exact ephemeral CI endpoints.
        self.assertEqual(os.environ.get("LOLO_TEST_DATABASE_URL"),PRIMARY)
        self.assertEqual(os.environ.get("LOLO_TEST_PILOT_DATABASE_URL"),PILOT)
        self.assertNotIn(os.environ.get("LOLO_DATABASE_URL"),(PRIMARY,PILOT))
        self.assertNotIn(os.environ.get("LOLO_FAMILY_PILOT_DATABASE_URL"),(PRIMARY,PILOT))
        primary,pilot=FamilyStore(PRIMARY),FamilyStore(PILOT,synthetic_only=True)
        primary.migrate()
        pilot.migrate()
        password="disposable-test-password-only"
        accounts=[f"{uuid.uuid4()}@example.test" for _ in range(3)]
        main_email,a_email,b_email=accounts
        primary.provision(main_email,password)
        self.addCleanup(self.delete_fixture,primary,main_email)
        for email in (a_email,b_email):
            pilot.provision(email,password)
            self.addCleanup(self.delete_fixture,pilot,email)
        primary_token=primary.login(main_email,password)["token"]
        sentinel=primary.create_child(primary_token,"Primary sentinel","unspecified")
        httpd=ThreadingHTTPServer(("127.0.0.1",0),server.Handler)
        thread=threading.Thread(target=httpd.serve_forever,daemon=True)
        thread.start()
        def stop():
            httpd.shutdown();httpd.server_close();thread.join(timeout=3)
        self.addCleanup(stop)
        root=f"http://127.0.0.1:{httpd.server_port}"
        def request(body=None,token=None):
            headers={"Content-Type":"application/json"}
            if token:headers["Authorization"]="Bearer "+token
            req=Request(root+("/api/status" if body is None else "/api/family"),headers=headers,data=None if body is None else json.dumps(body).encode())
            try:response=urlopen(req,timeout=12)
            except HTTPError as err:response=err
            with response:
                self.assertEqual(response.headers.get("Cache-Control"),"no-store")
                return response.status,json.load(response)
        def login(email):
            return request({"action":"login","email":email,"password":password})
        env={"VERCEL":"1","VERCEL_ENV":"production","LOLO_DATABASE_URL":PRIMARY,
             "LOLO_FAMILY_PILOT_MODE":"synthetic","LOLO_FAMILY_PILOT_DATABASE_URL":PILOT,
             "LOLO_BUDGET_DATABASE_URL":PILOT,"LOLO_SHARED_REQUEST_BUDGET":"required",
             "LOLO_SHARED_LOGIN_PER_MINUTE":"30"}
        with patch.dict(os.environ,env),patch.object(server,"FAMILY_ENABLED",True),patch.object(server,"PARENT_CLOUD_UI_ENABLED",True),patch.object(server,"PROGRESS_SYNC_ENABLED",True),patch.object(server,"FAMILY_RATE_LIMITER",server.SlidingWindowRateLimiter()),patch.object(server,"FAMILY_GLOBAL_LIMITER",server.SlidingWindowRateLimiter()):
            self.assertTrue(request()[1]["familyUiEnabled"])
            self.assertTrue(request()[1]["progressSyncEnabled"])
            self.assertEqual(login(main_email)[0],401)
            self.assertEqual(request({"action":"children"},primary_token)[0],401)
            status,a=login(a_email);self.assertEqual(status,200);a=a["token"]
            status,b=login(b_email);self.assertEqual(status,200);b=b["token"]
            self.assertEqual(request({"action":"createChild","nickname":"not a fixture","ageBand":"4-6"},a)[0],400)
            status,child=request({"action":"createChild","nickname":"Synthetic 7","ageBand":"4-6"},a)
            self.assertEqual(status,201)
            child_id=child["id"]
            read={"action":"readProgress","childId":child_id}
            write={"action":"writeProgress","childId":child_id,"baseRevision":0,"operationId":str(uuid.uuid4()),"snapshot":{"schemaVersion":1,"curriculumVersion":VERSION,"completedLessonIds":["hello-1"],"path":None}}
            self.assertEqual(request(read,b)[0],404)
            status,first=request(write,a)
            self.assertEqual(status,200);self.assertEqual(first["revision"],1)
            self.assertEqual(request(write,a),(200,first))
            self.assertEqual(request({**write,"operationId":str(uuid.uuid4())},a)[0],409)
            status,second=login(a_email);self.assertEqual(status,200);second=second["token"]
            self.assertNotEqual(a,second)
            self.assertEqual(request(read,second),(200,first))
            self.assertEqual(request({"action":"logout"},a)[0],200)
            self.assertEqual(request(read,a)[0],401)
            self.assertEqual(request(read,second),(200,first))
            with pilot.connect() as db:
                self.assertGreaterEqual(db.execute("SELECT used FROM lolo_shared_request_budget WHERE bucket='login-minute'").fetchone()[0],4)
            with patch.dict(os.environ,{"LOLO_BUDGET_DATABASE_URL":PRIMARY}):
                self.assertFalse(request()[1]["familyUiEnabled"])
                self.assertEqual(request(read,second)[0],503)
            with patch.dict(os.environ,{"LOLO_SHARED_REQUEST_BUDGET":"off"}):
                self.assertFalse(request()[1]["progressSyncEnabled"])
                self.assertEqual(request(read,second)[0],503)
        self.assertEqual(primary.children(primary_token),[sentinel])
        self.assertEqual(primary.read_progress(primary_token,sentinel["id"])["revision"],0)
        with primary.connect() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM lolo_parents WHERE email IN (%s,%s)",(a_email,b_email)).fetchone()[0],0)
        with pilot.connect() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM lolo_parents WHERE email=%s",(main_email,)).fetchone()[0],0)

    @staticmethod
    def delete_fixture(store,email):
        with store.connect() as db:
            db.execute("DELETE FROM lolo_parents WHERE email=%s",(email,))
