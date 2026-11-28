"""Local synthetic parent billing preview. No payment collection or settlement endpoint."""
import json
import os
import sys
import re
from collections import deque
from pathlib import Path
from http.server import BaseHTTPRequestHandler, HTTPServer
from time import monotonic
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT.parent))
from family_accounts import FamilyStore, FamilyError
import billing
import billing_grants
import billing_discounts
import billing_entitlements as entitlements

SHAPES={
 "login":{"action","email","password"},
 "dashboard":{"action"},
 "create":{"action","planId","period","operationId","expectedAmountMinor"},
 "cancel":{"action","orderId"},
 "discountQuote":{"action","planId","period","code"},
 "discountCreate":{"action","planId","period","operationId","expectedAmountMinor","code"},
 "redeem":{"action","code"},
 "assign":{"action","childId"},
 "remove":{"action","childId"},
 "logout":{"action"},
}

def dispatch(store,body,token):
    billing.require_staging()
    action=body.get("action") if type(body) is dict else None
    if not isinstance(action,str) or action not in SHAPES or set(body)!=SHAPES[action]:
        raise FamilyError(400,"Invalid request.")
    if action=="login":
        email=body["email"]
        if not isinstance(email,str) or not re.fullmatch(r"[A-Za-z0-9._+-]{1,100}@example\.test",email):
            raise FamilyError(403,"Synthetic account required.")
        return store.login(email,body["password"])
    with store.connect() as db:billing.parent_for_test(store,db,token)
    if action=="dashboard":
        return {"plans":billing.catalog(store),"subscription":billing.test_subscription(store,token),
          "usage":entitlements.usage_status(store,token),"orders":billing.list_orders(store,token),
          "children":store.children(token),"testOnly":True}
    if action=="discountQuote":return billing_discounts.quote(store,token,body["planId"],body["period"],body["code"])
    if action in ("create","discountCreate"):
        if type(body["expectedAmountMinor"]) is not int or body["expectedAmountMinor"]<=0:
            raise FamilyError(400,"Quote required.")
        return billing.create_order(store,token,body["planId"],body["period"],body["operationId"],body["expectedAmountMinor"],body.get("code"))
    if action=="redeem":return billing_grants.redeem_trial(store,token,body["code"])
    if action=="cancel":return billing.cancel_order(store,token,body["orderId"])
    if action=="assign":return {"ok":entitlements.assign_slot(store,token,body["childId"])}
    if action=="remove":return {"ok":entitlements.remove_slot(store,token,body["childId"])}
    store.logout(token)
    return {"ok":True}

class Server(HTTPServer):
    def __init__(self,port,store):
        billing.require_staging()
        super().__init__(("127.0.0.1",port),Handler)
        self.store=store
        self.host="127.0.0.1:"+str(self.server_port)
        self.origin="http://"+self.host
        self.requests=deque()
        self.logins=deque()
    def admit(self,bucket,limit):
        now=monotonic()
        while bucket and bucket[0]<=now-60:bucket.popleft()
        if len(bucket)>=limit:return False
        bucket.append(now)
        return True

class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(8)
    def log_message(self,*args):pass
    def reply(self,status,body,mime="application/json; charset=utf-8"):
        if isinstance(body,dict):body=json.dumps(body,ensure_ascii=False).encode()
        self.send_response(status)
        for key,value in {"Content-Type":mime,"Content-Length":str(len(body)),"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Referrer-Policy":"no-referrer","Content-Security-Policy":"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'","Permissions-Policy":"camera=(), microphone=(), geolocation=()"}.items():self.send_header(key,value)
        self.end_headers()
        self.wfile.write(body)
    def host_ok(self):return self.headers.get_all("Host")==[self.server.host]
    def do_GET(self):
        if not self.host_ok():return self.reply(403,{"error":"Forbidden."})
        files={"/":("index.html","text/html; charset=utf-8"),"/billing.js":("billing.js","text/javascript; charset=utf-8"),"/billing.css":("billing.css","text/css; charset=utf-8")}
        if self.path not in files:return self.reply(404,{"error":"Not found."})
        name,mime=files[self.path]
        return self.reply(200,(ROOT/name).read_bytes(),mime)
    def do_POST(self):
        try:
            if not self.host_ok() or self.headers.get_all("Origin")!=[self.server.origin] or self.headers.get("Sec-Fetch-Site","same-origin")!="same-origin":
                raise FamilyError(403,"Forbidden.")
            if self.path!="/api":raise FamilyError(404,"Not found.")
            if not self.server.admit(self.server.requests,40):raise FamilyError(429,"Rate limited.")
            lengths=self.headers.get_all("Content-Length") or []
            if self.headers.get_all("Content-Type")!=["application/json"] or self.headers.get("Transfer-Encoding"):raise FamilyError(415,"JSON required.")
            if len(lengths)!=1 or not lengths[0].isdigit():raise FamilyError(400,"Invalid length.")
            length=int(lengths[0])
            if not 1<=length<=8192:raise FamilyError(413,"Invalid size.")
            raw=self.rfile.read(length)
            if len(raw)!=length:raise FamilyError(400,"Incomplete.")
            body=json.loads(raw)
            if isinstance(body,dict) and body.get("action")=="login" and not self.server.admit(self.server.logins,5):raise FamilyError(429,"Rate limited.")
            auth=self.headers.get_all("Authorization") or []
            token=auth[0][7:] if len(auth)==1 and auth[0].startswith("Bearer ") else ""
            return self.reply(200,dispatch(self.server.store,body,token))
        except FamilyError as exc:return self.reply(exc.status,{"error":"Request rejected."})
        except (ValueError,RecursionError,TimeoutError):return self.reply(400,{"error":"Invalid request."})
        except Exception:return self.reply(503,{"error":"Staging unavailable."})

if __name__=="__main__":
    dsn=os.environ.get("LOLO_BILLING_STAGING_DATABASE_URL")
    if not dsn or dsn in (os.environ.get("LOLO_DATABASE_URL"),os.environ.get("LOLO_ADMIN_DATABASE_URL"),os.environ.get("LOLO_HOMEWORK_STAGING_DATABASE_URL")):
        raise SystemExit("Dedicated disposable billing database required.")
    with Server(4186,FamilyStore(dsn)) as server:
        print("Synthetic billing: "+server.origin,flush=True)
        server.serve_forever()
