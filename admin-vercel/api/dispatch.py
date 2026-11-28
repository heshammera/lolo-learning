"""Dedicated Vercel admin API. Disabled until independently configured and approved."""
import json
import os
import re
import sys
from pathlib import Path
from http.cookies import SimpleCookie,CookieError
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlsplit,parse_qs
ROOT=Path(__file__).resolve().parents[1]/"runtime"
sys.path.insert(0,str(ROOT))
sys.path.insert(0,str(ROOT/"admin-src"))
from admin_identity import AdminStore, FamilyError
from cms_drafts import Drafts
from hosted_validator import library

COOKIE="__Host-lolo_admin_session"
CSP="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'"
POST_FIELDS={
 "/api/login":{"email","password","code"}, "/api/logout":set(),
 "/api/draft/read":{"id"}, "/api/draft/check":{"content"},
 "/api/draft/save":{"id","revision","content"},
 "/api/draft/transition":{"id","revision","action"},
 "/api/draft/history":{"id"}, "/api/draft/rollback":{"id","target","expectedActive"}
}
GET_PATHS={"/api/session","/api/library","/api/drafts","/activity-engine.js"}
DISABLED_PREFIX=("/api/family-pilot/","/api/billing/","/api/settings/")
OTHER_DSNS=("LOLO_DATABASE_URL","LOLO_FAMILY_PILOT_DATABASE_URL","LOLO_BUDGET_DATABASE_URL","LOLO_BILLING_STAGING_DATABASE_URL","LOLO_HOMEWORK_STAGING_DATABASE_URL","DATABASE_URL","POSTGRES_URL")

def config(env):
    if env.get("VERCEL_ENV")!="production" or env.get("LOLO_ADMIN_SERVERLESS_ENABLED")!="true":
        raise FamilyError(503,"Admin activation pending.")
    origin=env.get("LOLO_ADMIN_ORIGIN","")
    if not re.fullmatch(r"https://(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}",origin):
        raise FamilyError(503,"Origin configuration required.")
    dsn=env.get("LOLO_ADMIN_DATABASE_URL")
    if not dsn or dsn in [env.get(k) for k in OTHER_DSNS] or not env.get("LOLO_ADMIN_ENCRYPTION_KEY"):
        raise FamilyError(503,"Independent administration database required.")
    return origin,AdminStore(dsn,env["LOLO_ADMIN_ENCRYPTION_KEY"])

def checked_store(store):
    # No migration, credential issuance or app DB fallback in a public request.
    with store.connect() as db:
        db.execute("SET TRANSACTION READ ONLY")
        db.execute("SET LOCAL statement_timeout='3s'")
        if db.info.get_parameters().get("sslmode")!="verify-full" or not db.pgconn.ssl_in_use:
            raise FamilyError(503,"Verified database TLS required.")
        mixed=db.execute("""SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND c.relname IN
          ('lolo_parents','lolo_children','lolo_child_progress','lolo_billing_orders','lolo_shared_request_budget'))""").fetchone()[0]
        if mixed:raise FamilyError(503,"Mixed database rejected.")
        if not db.execute("SELECT EXISTS(SELECT 1 FROM lolo_admin_users WHERE role='owner' AND disabled_at IS NULL)").fetchone()[0]:
            raise FamilyError(503,"Owner enrollment pending.")
    return store

def route_value(path):
    parts=urlsplit(path)
    if parts.path=="/api/dispatch":
        q=parse_qs(parts.query,keep_blank_values=True)
        if set(q)!={"route"} or len(q["route"])!=1:return ""
        value=q["route"][0]
        return "/activity-engine.js" if value=="activity-engine.js" else "/api/"+value
    return parts.path if not parts.query else ""

def cookie(token,age):
    return f"{COOKIE}={token}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age={age}"

class handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def reply(self,status,value,content_type="application/json; charset=utf-8",session=None):
        data=json.dumps(value,ensure_ascii=False).encode() if isinstance(value,dict) else value
        self.send_response(status)
        for key,val in (("Content-Type",content_type),("Content-Length",str(len(data))),("Cache-Control","no-store"),("X-Content-Type-Options","nosniff"),("X-Frame-Options","DENY"),("Referrer-Policy","no-referrer"),("Strict-Transport-Security","max-age=31536000"),("Content-Security-Policy",CSP),("Permissions-Policy","camera=(), microphone=(), geolocation=()")):self.send_header(key,val)
        if session:self.send_header("Set-Cookie",session)
        self.end_headers();self.wfile.write(data)
    def token(self):
        try:
            jar=SimpleCookie();jar.load(self.headers.get("Cookie",""))
            return jar[COOKIE].value if COOKIE in jar else ""
        except CookieError:return ""
    def body(self,maximum):
        if self.headers.get("Content-Type","").split(";",1)[0].strip().lower()!="application/json":raise FamilyError(415,"JSON required.")
        lengths=self.headers.get_all("Content-Length") or []
        if len(lengths)!=1 or self.headers.get("Transfer-Encoding") or not re.fullmatch(r"[0-9]{1,6}",lengths[0]):raise FamilyError(400,"Invalid length.")
        length=int(lengths[0])
        if not 1<=length<=maximum:raise FamilyError(400,"Invalid length.")
        try:
            raw=self.rfile.read(length)
            if len(raw)!=length:raise ValueError()
            result=json.loads(raw)
            if not isinstance(result,dict):raise ValueError()
            return result
        except (ValueError,RecursionError,TimeoutError):raise FamilyError(400,"Invalid JSON.") from None
    def do_GET(self):self.dispatch(False)
    def do_POST(self):self.dispatch(True)
    def dispatch(self,post):
        try:
            path=route_value(self.path)
            if path.startswith(DISABLED_PREFIX) or path=="/api/draft/export":
                raise FamilyError(503,"Pilot-only feature is not connected to hosted admin.")
            if path not in (POST_FIELDS if post else GET_PATHS):raise FamilyError(404,"Unknown endpoint.")
            origin,store=config(os.environ)
            if self.headers.get_all("Host")!=[origin.removeprefix("https://")]:raise FamilyError(403,"Invalid host.")
            if post and (self.headers.get_all("Origin")!=[origin] or self.headers.get("Sec-Fetch-Site","same-origin")!="same-origin"):raise FamilyError(403,"Invalid origin.")
            if post:
                body=self.body(262144 if path.startswith("/api/draft/") else 4096)
                if set(body)!=POST_FIELDS[path]:raise FamilyError(400,"Invalid fields.")
            store=checked_store(store)
            token=self.token();drafts=Drafts(store)
            if path=="/api/login":
                if not store.admit_proxy_login():raise FamilyError(429,"Too many requests.")
                result=store.login(body["email"],body["password"],body["code"])
                session=cookie(result.pop("token"),1800)
                return self.reply(200,result,session=session)
            if path=="/api/logout":
                try:store.logout(token)
                except FamilyError as exc:
                    if exc.status!=401:raise
                return self.reply(200,{"ok":True},session=cookie("",0))
            if path=="/api/session":return self.reply(200,store.inspect(token))
            if path=="/api/library":
                store.inspect(token,"library:read");return self.reply(200,{"activities":library()})
            if path=="/activity-engine.js":
                store.inspect(token,"library:read")
                return self.reply(200,(ROOT/"activity-engine.js").read_bytes(),"text/javascript; charset=utf-8")
            if path=="/api/drafts":return self.reply(200,drafts.list(token))
            if path=="/api/draft/read":return self.reply(200,drafts.read(token,body["id"]))
            if path=="/api/draft/check":return self.reply(200,drafts.check(token,body["content"]))
            if path=="/api/draft/save":
                result=drafts.save(token,body["id"],body["revision"],body["content"])
                return self.reply(200 if result["saved"] else 422,result)
            if path=="/api/draft/transition":return self.reply(200,drafts.transition(token,body["id"],body["revision"],body["action"]))
            if path=="/api/draft/history":return self.reply(200,drafts.history(token,body["id"]))
            if path=="/api/draft/rollback":return self.reply(200,drafts.rollback(token,body["id"],body["target"],body["expectedActive"]))
            raise FamilyError(404,"Unknown endpoint.")
        except FamilyError as exc:self.reply(exc.status,{"error":"خدمة الإدارة غير متاحة أو الطلب غير مسموح."})
        except Exception:self.reply(503,{"error":"خدمة الإدارة غير متاحة حاليًا."})
