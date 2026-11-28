"""Isolated administration service: loopback or explicitly gated HTTPS proxy staging."""
import json
import os
import re
from hmac import compare_digest
import subprocess
import sys
import threading
import time
from collections import deque
from http.cookies import SimpleCookie, CookieError
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from admin_identity import AdminStore, FamilyError
from cms_drafts import Drafts
from content_packages import export_active
from family_accounts import FamilyStore
import billing_owner
ROOT = Path(__file__).resolve().parent
COOKIE = "lolo_admin_session"
SECURE_COOKIE = "__Host-lolo_admin_session"


def proxy_config(origin,secret):
    # Dedicated DNS origin, no path, credentials, wildcard, IP or nonstandard port.
    label=r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
    if not isinstance(origin,str) or len(origin)>261 or not re.fullmatch(r"https://(?:"+label+r"\.)+[a-z]{2,63}",origin):
        raise RuntimeError("Dedicated HTTPS admin origin required.")
    if not isinstance(secret,str) or not re.fullmatch(r"[A-Za-z0-9_-]{43,128}",secret):
        raise RuntimeError("Private proxy token required.")
    return origin,secret
ASSETS = {"/":("index.html","text/html; charset=utf-8"),
           "/admin.css":("admin.css","text/css; charset=utf-8"),
           "/admin.js":("admin.js","text/javascript; charset=utf-8"),
           "/cms-editor.js":("cms-editor.js","text/javascript; charset=utf-8")}
CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'"


def load_library():
    # Only operator-controlled code is executed, once before accepting requests.
    result=subprocess.run(["node","-e","const l=require('./activity-library.cjs');if(!l.audit().valid)process.exit(1);process.stdout.write(JSON.stringify(l.query()));"],cwd=ROOT,check=True,capture_output=True,text=True,timeout=15)
    return json.loads(result.stdout)


class AdminServer(ThreadingHTTPServer):
    daemon_threads=True
    def __init__(self,port,store,library,signing=None,proxy=None,billing_store=None):
        if proxy is not None:proxy=proxy_config(*proxy)
        super().__init__(("127.0.0.1",port),Handler)
        self.store=store
        self.library=library
        self.drafts=Drafts(store)
        self.signing=signing
        self.billing_store=billing_store if proxy is None else None
        self.host="127.0.0.1:"+str(self.server_port)
        self.origin="http://"+self.host
        self.proxy_secret=None
        self.cookie_name=COOKIE
        if proxy is not None:
            self.origin,self.proxy_secret=proxy
            self.host=self.origin.removeprefix("https://")
            self.cookie_name=SECURE_COOKIE
        self.attempts=deque()
        self.limit_lock=threading.Lock()
        self.login_slots=threading.BoundedSemaphore(2)

    def admit_login(self):
        with self.limit_lock:
            now=time.monotonic()
            while self.attempts and self.attempts[0]<=now-60:self.attempts.popleft()
            if len(self.attempts)>=15:return False
            self.attempts.append(now)
            return True


class Handler(BaseHTTPRequestHandler):
    server_version="LOLO-Admin"
    sys_version=""
    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def log_message(self,*args):
        # Do not log paths, request bodies, credentials, or cookies.
        pass

    def reply(self,status,body,content_type="application/json; charset=utf-8",cookie=None):
        if isinstance(body,dict):body=json.dumps(body,ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type",content_type)
        self.send_header("Content-Length",str(len(body)))
        self.send_header("Cache-Control","no-store")
        self.send_header("X-Content-Type-Options","nosniff")
        self.send_header("X-Frame-Options","DENY")
        self.send_header("Referrer-Policy","no-referrer")
        self.send_header("Content-Security-Policy",CSP)
        self.send_header("Permissions-Policy","camera=(), microphone=(), geolocation=()")
        if self.server.proxy_secret is not None:self.send_header("Strict-Transport-Security","max-age=31536000")
        if cookie:self.send_header("Set-Cookie",cookie)
        self.end_headers()
        self.wfile.write(body)

    def valid_host(self):
        if self.headers.get_all("Host")!=[self.server.host]:return False
        if self.server.proxy_secret is None:return True
        values=self.headers.get_all("X-Lolo-Admin-Proxy") or []
        return (self.headers.get_all("X-Forwarded-Proto")==["https"] and len(values)==1
                and values[0].isascii() and compare_digest(values[0],self.server.proxy_secret))

    def valid_origin(self):
        return self.headers.get_all("Origin")==[self.server.origin] and self.headers.get("Sec-Fetch-Site","same-origin")=="same-origin"

    def token(self):
        try:
            cookies=SimpleCookie()
            cookies.load(self.headers.get("Cookie",""))
            name=self.server.cookie_name
            return cookies[name].value if name in cookies else ""
        except CookieError:return ""

    def session_cookie(self,token,age):
        secure="; Secure" if self.server.proxy_secret is not None else ""
        return f"{self.server.cookie_name}={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={age}{secure}"

    def json_body(self,maximum=4096):
        if self.headers.get("Content-Type","").split(";",1)[0].strip().lower()!="application/json":
            raise FamilyError(415,"JSON required.")
        try:
            values=self.headers.get_all("Content-Length") or []
            if len(values)!=1 or self.headers.get("Transfer-Encoding"):raise ValueError()
            length=int(values[0])
            if not 1<=length<=maximum:raise ValueError()
            raw=self.rfile.read(length)
            if len(raw)!=length:raise ValueError()
            value=json.loads(raw)
            if not isinstance(value,dict):raise ValueError()
            return value
        except (ValueError,RecursionError,TimeoutError):
            raise FamilyError(400,"Invalid request.") from None

    def error_response(self,exc):
        if isinstance(exc,FamilyError):
            self.reply(exc.status,{"error":{401:"بيانات الدخول غير صحيحة أو الجلسة انتهت.",403:"غير مصرح بالوصول.",429:"محاولات كثيرة؛ جرب لاحقًا."}.get(exc.status,"تعذر تنفيذ الطلب.")})
        else:self.reply(503,{"error":"خدمة الإدارة غير متاحة."})

    def do_GET(self):
        if not self.valid_host():return self.reply(403,{"error":"Invalid host."})
        try:
            if self.path in ASSETS:
                file,mime=ASSETS[self.path]
                return self.reply(200,(ROOT/"web"/file).read_bytes(),mime)
            if self.path=="/activity-engine.js":
                self.server.store.inspect(self.token(),"library:read")
                return self.reply(200,(ROOT.parent/"activity-engine.js").read_bytes(),"text/javascript; charset=utf-8")
            if self.path in ("/api/billing/plans","/api/billing/history"):
                self.server.store.inspect(self.token(),"billing:manage")
                if self.server.billing_store is None:raise FamilyError(503,"Billing disabled.")
                fn=billing_owner.list_plans if self.path.endswith("/plans") else billing_owner.history
                return self.reply(200,fn(self.server.billing_store,self.server.store,self.token()))
            if self.path=="/api/session":
                return self.reply(200,self.server.store.inspect(self.token()))
            if self.path=="/api/drafts":
                return self.reply(200,self.server.drafts.list(self.token()))
            if self.path=="/api/library":
                self.server.store.inspect(self.token(),"library:read")
                return self.reply(200,{"activities":self.server.library})
            return self.reply(404,{"error":"Not found."})
        except Exception as exc:self.error_response(exc)

    def do_POST(self):
        if not self.valid_host() or not self.valid_origin():
            return self.reply(403,{"error":"Invalid origin."})
        try:
            if self.path=="/api/billing/plan":
                self.server.store.inspect(self.token(),"billing:manage")
                if self.server.billing_store is None:raise FamilyError(503,"Billing disabled.")
                body=self.json_body()
                if set(body)!={"planId","revision","values"}:raise FamilyError(400,"Invalid fields.")
                return self.reply(200,billing_owner.change_plan(self.server.billing_store,self.server.store,self.token(),body["planId"],body["revision"],body["values"]))
            if self.path=="/api/login":
                body=self.json_body()
                if set(body)!={"email","password","code"}:raise FamilyError(400,"Invalid fields.")
                if not self.server.admit_login() or not self.server.login_slots.acquire(blocking=False):
                    raise FamilyError(429,"Too many requests.")
                try:
                    if self.server.proxy_secret is not None and not self.server.store.admit_proxy_login():
                        raise FamilyError(429,"Too many requests.")
                    result=self.server.store.login(body["email"],body["password"],body["code"])
                finally:self.server.login_slots.release()
                token=result.pop("token")
                return self.reply(200,result,cookie=self.session_cookie(token,1800))
            if self.path in ("/api/draft/transition","/api/draft/history","/api/draft/rollback"):
                body=self.json_body()
                if self.path=="/api/draft/transition" and set(body)=={"id","revision","action"}:
                    return self.reply(200,self.server.drafts.transition(self.token(),body["id"],body["revision"],body["action"]))
                if self.path=="/api/draft/history" and set(body)=={"id"}:
                    return self.reply(200,self.server.drafts.history(self.token(),body["id"]))
                if self.path=="/api/draft/rollback" and set(body)=={"id","target","expectedActive"}:
                    return self.reply(200,self.server.drafts.rollback(self.token(),body["id"],body["target"],body["expectedActive"]))
                raise FamilyError(400,"Invalid fields.")
            if self.path in ("/api/draft/read","/api/draft/check","/api/draft/save"):
                body=self.json_body(262144)
                if self.path=="/api/draft/read" and set(body)=={"id"}:
                    return self.reply(200,self.server.drafts.read(self.token(),body["id"]))
                if self.path=="/api/draft/check" and set(body)=={"content"}:
                    return self.reply(200,self.server.drafts.check(self.token(),body["content"]))
                if self.path=="/api/draft/save" and set(body)=={"id","revision","content"}:
                    result=self.server.drafts.save(self.token(),body["id"],body["revision"],body["content"])
                    return self.reply(200 if result["saved"] else 422,result)
                raise FamilyError(400,"Invalid fields.")
            if self.path=="/api/draft/export":
                self.server.store.inspect(self.token(),"curriculum:publish")
                if not self.server.signing:raise FamilyError(503,"Signing disabled.")
                body=self.json_body()
                if set(body)!={"id","expectedRelease"}:raise FamilyError(400,"Invalid fields.")
                key_id,key=self.server.signing
                return self.reply(200,export_active(self.server.store,self.token(),body["id"],body["expectedRelease"],key_id,key))
            if self.path=="/api/logout":
                if self.json_body()!={}:raise FamilyError(400,"Invalid fields.")
                try:self.server.store.logout(self.token())
                except FamilyError as exc:
                    if exc.status!=401:raise
                return self.reply(200,{"ok":True},cookie=self.session_cookie("",0))
            return self.reply(404,{"error":"Not found."})
        except Exception as exc:self.error_response(exc)


def main():
    local=os.environ.get("LOLO_ADMIN_LOCAL_WEB")=="true"
    https=os.environ.get("LOLO_ADMIN_HTTPS_STAGING")=="true"
    if local==https:raise RuntimeError("Select exactly one admin mode.")
    proxy=proxy_config(os.environ.get("LOLO_ADMIN_ORIGIN"),os.environ.get("LOLO_ADMIN_PROXY_TOKEN")) if https else None
    dsn=os.environ.get("LOLO_ADMIN_DATABASE_URL")
    if not dsn or dsn==os.environ.get("LOLO_DATABASE_URL"):
        raise RuntimeError("Separate admin database required.")
    store=AdminStore(dsn,os.environ.get("LOLO_ADMIN_ENCRYPTION_KEY"))
    signing=None
    if os.environ.get("LOLO_ADMIN_STAGING_EXPORT")=="true":
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ec
        key_file=Path(os.environ["LOLO_ADMIN_SIGNING_KEY_FILE"])
        # Private key file must be supplied by the operator, outside the repository.
        if key_file.resolve().is_relative_to(ROOT.parent):raise RuntimeError("Key must be outside repository.")
        key=serialization.load_pem_private_key(key_file.read_bytes(),password=None)
        if not isinstance(key,ec.EllipticCurvePrivateKey) or not isinstance(key.curve,ec.SECP256R1):raise RuntimeError("P-256 key required.")
        signing=(os.environ["LOLO_ADMIN_SIGNING_KEY_ID"],key)
    billing_store=None
    if local and os.environ.get("LOLO_BILLING_STAGING")=="true":
        billing_dsn=os.environ.get("LOLO_BILLING_STAGING_DATABASE_URL")
        if not billing_dsn or billing_dsn in (dsn,os.environ.get("LOLO_DATABASE_URL"),os.environ.get("LOLO_HOMEWORK_STAGING_DATABASE_URL")):
            raise RuntimeError("Dedicated disposable billing DB required.")
        billing_store=FamilyStore(billing_dsn)
    with AdminServer(int(os.environ.get("LOLO_ADMIN_PORT","4180")),store,load_library(),signing,proxy=proxy,billing_store=billing_store) as server:
        print("HTTPS proxy staging: "+server.origin if https else "Local-only admin: "+server.origin,flush=True)
        server.serve_forever()


if __name__=="__main__":
    try:main()
    except Exception:
        print("Admin web could not start. Check local configuration privately.",file=sys.stderr)
        sys.exit(1)
