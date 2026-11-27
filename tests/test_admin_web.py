import os
import sys
import unittest
import uuid
import json
import threading
from datetime import datetime,timedelta,timezone
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"admin-src"))
from admin_web import AdminServer,load_library,proxy_config
from admin_identity import AdminStore

@unittest.skipUnless(os.environ.get("LOLO_TEST_ADMIN_DATABASE_URL"),"Disposable admin database required")
class AdminWebTests(unittest.TestCase):
    def setUp(self):
        from cryptography.fernet import Fernet
        import pyotp
        dsn=os.environ["LOLO_TEST_ADMIN_DATABASE_URL"]
        self.assertNotEqual(dsn,os.environ.get("LOLO_ADMIN_DATABASE_URL"))
        self.assertNotEqual(dsn,os.environ.get("LOLO_DATABASE_URL"))
        self.now=datetime.now(timezone.utc)
        self.store=AdminStore(dsn,Fernet.generate_key(),lambda:self.now)
        self.store.migrate()
        self.secret=pyotp.random_base32()
        self.email=str(uuid.uuid4())+"@example.test"
        self.password="synthetic-long-password"
        self.user=self.store.provision(self.email,self.password,"content-manager",self.secret,pyotp.TOTP(self.secret).at(self.now))
        self.now+=timedelta(seconds=30)
        self.server=AdminServer(0,self.store,load_library())
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()

    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join(timeout=3)
        with self.store.connect() as db:
            db.execute("DELETE FROM lolo_admin_audit WHERE actor_id=%s",(self.user,))
            db.execute("DELETE FROM lolo_admin_users WHERE id=%s",(self.user,))

    def request(self,path,body=None,cookie=None,origin=None,host=None):
        headers={}
        if body is not None:headers={"Content-Type":"application/json","Origin":origin or self.server.origin}
        if cookie:headers["Cookie"]=cookie
        if host:headers["Host"]=host
        req=Request(self.server.origin+path,data=json.dumps(body).encode() if body is not None else None,headers=headers)
        try:r=urlopen(req,timeout=10)
        except HTTPError as e:r=e
        with r:
            self.assertEqual(r.headers.get("Cache-Control"),"no-store")
            return r.status,r.headers,r.read()

    def test_login_library_permissions_origin_logout(self):
        import pyotp
        self.assertEqual(self.request("/api/library")[0],401)
        self.assertEqual(self.request("/activity-engine.js")[0],401)
        self.assertEqual(self.request("/api/library",cookie="lolo_admin_session="+"a"*43)[0],401)
        self.assertEqual(self.request("/",host="example.test")[0],403)
        login={"email":self.email,"password":self.password,"code":pyotp.TOTP(self.secret).at(self.now)}
        self.assertEqual(self.request("/api/login",login,origin="https://evil.example")[0],403)
        status,headers,body=self.request("/api/login",login)
        self.assertEqual(status,200)
        self.assertNotIn("token",json.loads(body))
        cookie=headers["Set-Cookie"]
        self.assertIn("HttpOnly",cookie);self.assertIn("SameSite=Strict",cookie)
        cookie=cookie.split(";",1)[0]
        self.assertEqual(self.request("/api/session",cookie=cookie)[0],200)
        status,_,body=self.request("/api/library",cookie=cookie)
        self.assertEqual(status,200)
        self.assertEqual(len(json.loads(body)["activities"]),29)
        self.assertEqual(self.request("/activity-engine.js",cookie=cookie)[0],200)
        self.assertEqual(self.request("/api/logout",{},cookie=cookie,origin="https://evil.example")[0],403)
        with self.store.connect() as db:
            db.execute("UPDATE lolo_admin_users SET role='support' WHERE id=%s",(self.user,))
        self.assertEqual(self.request("/api/library",cookie=cookie)[0],403)
        self.assertEqual(self.request("/activity-engine.js",cookie=cookie)[0],403)
        self.assertEqual(self.request("/api/logout",{},cookie=cookie)[0],200)
        self.assertEqual(self.request("/api/session",cookie=cookie)[0],401)

    def test_local_shell_headers_and_login_limit(self):
        status,headers,body=self.request("/")
        self.assertEqual(status,200)
        self.assertIn("frame-ancestors 'none'",headers["Content-Security-Policy"])
        self.assertIn(b"Activity Library",body)
        invalid={"email":"none@example.test","password":"invalid-password","code":"000000"}
        for _ in range(15):self.assertEqual(self.request("/api/login",invalid)[0],401)
        self.assertEqual(self.request("/api/login",invalid)[0],429)

    def test_https_proxy_staging_boundary_and_cookie(self):
        import pyotp
        token="x"*43
        origin="https://admin.example.test"
        proxy=AdminServer(0,self.store,load_library(),proxy=(origin,token))
        thread=threading.Thread(target=proxy.serve_forever,daemon=True);thread.start()
        def call(path,body=None,headers=None):
            h={"Host":"admin.example.test","X-Forwarded-Proto":"https","X-Lolo-Admin-Proxy":token}
            if body is not None:h.update({"Content-Type":"application/json","Origin":origin})
            h.update(headers or {})
            req=Request(f"http://127.0.0.1:{proxy.server_port}"+path,data=json.dumps(body).encode() if body is not None else None,headers=h)
            try:r=urlopen(req,timeout=10)
            except HTTPError as e:r=e
            with r:return r.status,r.headers,r.read()
        try:
            with self.store.connect() as db:db.execute("DELETE FROM lolo_admin_proxy_login")
            self.assertEqual(call("/",headers={"X-Lolo-Admin-Proxy":"wrong"})[0],403)
            self.assertEqual(call("/",headers={"X-Forwarded-Proto":"http"})[0],403)
            self.assertEqual(call("/",headers={"Host":"student.example.test"})[0],403)
            status,headers,_=call("/")
            self.assertEqual(status,200)
            self.assertIn("max-age=",headers["Strict-Transport-Security"])
            login={"email":self.email,"password":self.password,"code":pyotp.TOTP(self.secret).at(self.now)}
            self.assertEqual(call("/api/login",login,{"Origin":"https://student.example.test"})[0],403)
            status,headers,_=call("/api/login",login)
            self.assertEqual(status,200)
            cookie=headers["Set-Cookie"]
            for flag in ("__Host-lolo_admin_session=","Secure","HttpOnly","SameSite=Strict","Path=/"):
                self.assertIn(flag,cookie)
            self.assertNotIn("Domain=",cookie)
            session=cookie.split(";",1)[0]
            self.assertEqual(call("/api/session",headers={"Cookie":session})[0],200)
            status,headers,_=call("/api/logout",{},{"Cookie":session})
            self.assertEqual(status,200)
            self.assertIn("Max-Age=0",headers["Set-Cookie"])
            self.assertIn("Secure",headers["Set-Cookie"])
            for _ in range(14):self.assertTrue(self.store.admit_proxy_login())
            from cryptography.fernet import Fernet
            other=AdminStore(self.store.dsn,Fernet.generate_key())
            self.assertFalse(other.admit_proxy_login())
        finally:
            proxy.shutdown();proxy.server_close();thread.join(timeout=3)
            with self.store.connect() as db:db.execute("DELETE FROM lolo_admin_proxy_login")

class ProxyConfigTests(unittest.TestCase):
    def test_requires_dedicated_https_dns_origin_and_token(self):
        self.assertEqual(proxy_config("https://admin.example.test","x"*43),("https://admin.example.test","x"*43))
        for origin in ("http://admin.example.test","https://admin.example.test/","https://127.0.0.1","https://user@admin.example.test","https://admin.example.test:443"):
            with self.assertRaises(RuntimeError):proxy_config(origin,"x"*43)
        with self.assertRaises(RuntimeError):proxy_config("https://admin.example.test","short")
