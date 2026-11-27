"""Local-only administration web service. Never mount on the student origin."""
import json
import os
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
ROOT = Path(__file__).resolve().parent
COOKIE = "lolo_admin_session"
ASSETS = {"/":("index.html","text/html; charset=utf-8"),
           "/admin.css":("admin.css","text/css; charset=utf-8"),
           "/admin.js":("admin.js","text/javascript; charset=utf-8")}
CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'"


def load_library():
    # Only operator-controlled code is executed, once before accepting requests.
    result=subprocess.run(["node","-e","const l=require('./activity-library.cjs');if(!l.audit().valid)process.exit(1);process.stdout.write(JSON.stringify(l.query()));"],cwd=ROOT,check=True,capture_output=True,text=True,timeout=15)
    return json.loads(result.stdout)


class AdminServer(ThreadingHTTPServer):
    daemon_threads=True
    def __init__(self,port,store,library):
        super().__init__(("127.0.0.1",port),Handler)
        self.store=store
        self.library=library
        self.drafts=Drafts(store)
        self.host="127.0.0.1:"+str(self.server_port)
        self.origin="http://"+self.host
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
        if cookie:self.send_header("Set-Cookie",cookie)
        self.end_headers()
        self.wfile.write(body)

    def valid_host(self):
        return self.headers.get_all("Host")==[self.server.host]

    def valid_origin(self):
        return self.headers.get_all("Origin")==[self.server.origin] and self.headers.get("Sec-Fetch-Site","same-origin")=="same-origin"

    def token(self):
        try:
            cookies=SimpleCookie()
            cookies.load(self.headers.get("Cookie",""))
            return cookies[COOKIE].value if COOKIE in cookies else ""
        except CookieError:return ""

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
            if self.path=="/api/login":
                body=self.json_body()
                if set(body)!={"email","password","code"}:raise FamilyError(400,"Invalid fields.")
                if not self.server.admit_login() or not self.server.login_slots.acquire(blocking=False):
                    raise FamilyError(429,"Too many requests.")
                try:result=self.server.store.login(body["email"],body["password"],body["code"])
                finally:self.server.login_slots.release()
                token=result.pop("token")
                # Loopback only; a real HTTPS deployment must require Secure and __Host- cookies.
                return self.reply(200,result,cookie=f"{COOKIE}={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800")
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
            if self.path=="/api/logout":
                if self.json_body()!={}:raise FamilyError(400,"Invalid fields.")
                try:self.server.store.logout(self.token())
                except FamilyError as exc:
                    if exc.status!=401:raise
                return self.reply(200,{"ok":True},cookie=f"{COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0")
            return self.reply(404,{"error":"Not found."})
        except Exception as exc:self.error_response(exc)


def main():
    if os.environ.get("LOLO_ADMIN_LOCAL_WEB")!="true":
        raise RuntimeError("Local admin web disabled.")
    dsn=os.environ.get("LOLO_ADMIN_DATABASE_URL")
    if not dsn or dsn==os.environ.get("LOLO_DATABASE_URL"):
        raise RuntimeError("Separate admin database required.")
    store=AdminStore(dsn,os.environ.get("LOLO_ADMIN_ENCRYPTION_KEY"))
    with AdminServer(int(os.environ.get("LOLO_ADMIN_PORT","4180")),store,load_library()) as server:
        print("Local-only admin: "+server.origin,flush=True)
        server.serve_forever()


if __name__=="__main__":
    try:main()
    except Exception:
        print("Admin web could not start. Check local configuration privately.",file=sys.stderr)
        sys.exit(1)
