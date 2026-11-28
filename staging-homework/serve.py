"""Loopback-only synthetic homework parent preview; never imported by production."""
import base64
import binascii
import json
import os
import re
import sys
from collections import deque
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from time import monotonic
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT.parent))
from family_accounts import FamilyStore, FamilyError
from homework_storage import submit, list_owned, delete_owned, MAX_INPUT, require_staging
from homework_review import parent_feedback, teacher_id, read_for_review, review, identifier

MAX_BODY=4*((MAX_INPUT+2)//3)+4096
SYNTHETIC_EMAIL=re.compile(r"[a-zA-Z0-9._+-]{1,100}@example\.test")
SYNTHETIC_ASSIGNMENT=re.compile(r"synthetic-[a-zA-Z0-9_-]{1,54}")
SHAPES={
    "login":{"action","email","password"},
    "children":{"action"},
    "submit":{"action","childId","assignmentId","image","confirmed"},
    "list":{"action","childId"},
    "feedback":{"action","childId","submissionId"},
    "delete":{"action","childId","submissionId"},
    "logout":{"action"},
}


def dispatch(store,body,token):
    require_staging()
    action=body.get("action") if type(body) is dict else None
    if not isinstance(action,str) or action not in SHAPES or set(body)!=SHAPES[action]:
        raise FamilyError(400,"Invalid request.")
    if action=="login":
        if not isinstance(body["email"],str) or not SYNTHETIC_EMAIL.fullmatch(body["email"]):
            raise FamilyError(403,"Synthetic test account required.")
        return store.login(body["email"],body["password"])
    # Require synthetic parent even for a token minted through a different route.
    with store.connect() as db:
        parent=store.authenticated_parent(db,token)
        row=db.execute("SELECT email FROM lolo_parents WHERE id=%s",(parent,)).fetchone()
        if not row or not SYNTHETIC_EMAIL.fullmatch(row[0]):
            raise FamilyError(403,"Synthetic test account required.")
    if action=="children":
        return {"children":store.children(token)}
    if action=="logout":
        store.logout(token)
        return {"ok":True}
    child=body["childId"]
    if action=="submit":
        if not isinstance(body["assignmentId"],str) or not SYNTHETIC_ASSIGNMENT.fullmatch(body["assignmentId"]) or body["confirmed"] is not True:
            raise FamilyError(400,"Synthetic assignment and confirmation required.")
        encoded=body["image"]
        if not isinstance(encoded,str) or len(encoded)>4*((MAX_INPUT+2)//3):
            raise FamilyError(400,"Image too large.")
        try:
            raw=base64.b64decode(encoded,validate=True)
        except (ValueError,binascii.Error):
            raise FamilyError(400,"Invalid image.") from None
        return submit(store,token,child,body["assignmentId"],raw,True)
    if action=="list":
        return {"submissions":list_owned(store,token,child)}
    if action=="feedback":
        return parent_feedback(store,token,child,body["submissionId"])
    delete_owned(store,token,child,body["submissionId"])
    return {"ok":True}


TEACHER_SHAPES={
    "login":{"action","email","password","code"},
    "list":{"action"},
    "image":{"action","submissionId"},
    "review":{"action","submissionId","outcome","score","feedback"},
    "logout":{"action"},
}


def teacher_dispatch(store,admin,body,token):
    require_staging()
    if admin is None:raise FamilyError(503,"Teacher preview unavailable.")
    action=body.get("action") if type(body) is dict else None
    if not isinstance(action,str) or action not in TEACHER_SHAPES or set(body)!=TEACHER_SHAPES[action]:
        raise FamilyError(400,"Invalid teacher request.")
    if action=="login":
        if not isinstance(body["email"],str) or not SYNTHETIC_EMAIL.fullmatch(body["email"]):
            raise FamilyError(403,"Synthetic teacher required.")
        result=admin.login(body["email"],body["password"],body["code"])
        if result["role"]!="teacher":
            admin.logout(result["token"])
            raise FamilyError(403,"Teacher required.")
        return result
    reviewer=teacher_id(admin,token)
    # Verify synthetic identity even when the token was minted elsewhere.
    with admin.connect() as db:
        row=db.execute("SELECT email FROM lolo_admin_users WHERE id=%s",(reviewer,)).fetchone()
        if not row or not SYNTHETIC_EMAIL.fullmatch(row[0]):
            raise FamilyError(403,"Synthetic teacher required.")
    if action=="logout":
        admin.logout(token)
        return {"ok":True}
    with store.connect() as db:
        rows=db.execute("""SELECT s.id,s.assignment_id,s.created_at,r.outcome FROM lolo_homework_submissions s
            JOIN lolo_homework_review_grants g ON g.child_id=s.child_id AND g.assignment_id=s.assignment_id
            JOIN lolo_homework_assignments a ON a.id=s.assignment_id
            JOIN lolo_children c ON c.id=s.child_id JOIN lolo_parents p ON p.id=c.parent_id
            LEFT JOIN lolo_homework_reviews r ON r.submission_id=s.id
            WHERE g.reviewer_id=%s AND a.active=true AND s.expires_at>CURRENT_TIMESTAMP
            AND p.email LIKE '%%@example.test' AND s.assignment_id LIKE 'synthetic-%%'
            ORDER BY s.created_at DESC,s.id LIMIT 100""",(reviewer,)).fetchall()
    if action=="list":
        return {"submissions":[{"id":str(r[0]),"assignmentId":r[1],"createdAt":r[2].isoformat(),"status":r[3] or "submitted"} for r in rows]}
    if not any(r[0]==identifier(body["submissionId"]) for r in rows):
        raise FamilyError(404,"Submission not found.")
    if action=="image":
        return {"image":base64.b64encode(read_for_review(store,admin,token,body["submissionId"])).decode("ascii")}
    return review(store,admin,token,body["submissionId"],body["outcome"],body["score"],body["feedback"])


class PreviewServer(HTTPServer):
    def __init__(self,port,store,admin=None):
        require_staging()
        super().__init__(("127.0.0.1",port),Handler)
        self.store=store
        self.admin=admin
        self.host="127.0.0.1:"+str(self.server_port)
        self.origin="http://"+self.host
        self.attempts=deque()
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

    def log_message(self,*args):
        pass

    def reply(self,status,body,mime="application/json"):
        if type(body) is dict:body=json.dumps(body,ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type",mime)
        self.send_header("Content-Length",str(len(body)))
        self.send_header("Cache-Control","no-store")
        self.send_header("X-Content-Type-Options","nosniff")
        self.send_header("X-Frame-Options","DENY")
        self.send_header("Referrer-Policy","no-referrer")
        self.send_header("Content-Security-Policy","default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src blob:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'")
        self.send_header("Permissions-Policy","camera=(), microphone=(), geolocation=()")
        self.end_headers()
        self.wfile.write(body)

    def valid_host(self):
        return self.headers.get_all("Host")==[self.server.host]

    def do_GET(self):
        if not self.valid_host():return self.reply(403,{"error":"Forbidden."})
        files={"/":("index.html","text/html; charset=utf-8"),"/preview.js":("preview.js","text/javascript; charset=utf-8"),"/preview.css":("preview.css","text/css; charset=utf-8")}
        if self.server.admin is not None:
            files.update({"/teacher":("teacher.html","text/html; charset=utf-8"),"/teacher.js":("teacher.js","text/javascript; charset=utf-8")})
        if self.path not in files:return self.reply(404,{"error":"Not found."})
        name,mime=files[self.path]
        self.reply(200,(ROOT/name).read_bytes(),mime)

    def do_POST(self):
        try:
            if not self.valid_host() or self.headers.get_all("Origin")!=[self.server.origin] or self.headers.get("Sec-Fetch-Site","same-origin")!="same-origin":
                raise FamilyError(403,"Forbidden.")
            if self.path not in ("/api","/teacher-api"):raise FamilyError(404,"Not found.")
            if not self.server.admit(self.server.attempts,40):raise FamilyError(429,"Too many requests.")
            if self.headers.get_all("Content-Type")!=["application/json"] or self.headers.get("Transfer-Encoding"):
                raise FamilyError(415,"JSON required.")
            lengths=self.headers.get_all("Content-Length") or []
            if len(lengths)!=1 or not lengths[0].isdigit():raise FamilyError(400,"Invalid length.")
            length=int(lengths[0])
            if not 1<=length<=MAX_BODY:raise FamilyError(413,"Request too large.")
            raw=self.rfile.read(length)
            if len(raw)!=length:raise FamilyError(400,"Incomplete request.")
            body=json.loads(raw)
            if isinstance(body,dict) and body.get("action")=="login" and not self.server.admit(self.server.logins,5):
                raise FamilyError(429,"Too many login attempts.")
            auth=self.headers.get("Authorization","")
            token=auth[7:] if auth.startswith("Bearer ") else ""
            result=teacher_dispatch(self.server.store,self.server.admin,body,token) if self.path=="/teacher-api" else dispatch(self.server.store,body,token)
            self.reply(200,result)
        except FamilyError as exc:self.reply(exc.status,{"error":"Request rejected."})
        except (ValueError,RecursionError,TimeoutError):self.reply(400,{"error":"Invalid request."})
        except Exception:self.reply(503,{"error":"Staging unavailable."})


if __name__=="__main__":
    dsn=os.environ.get("LOLO_HOMEWORK_STAGING_DATABASE_URL")
    if not dsn or dsn==os.environ.get("LOLO_DATABASE_URL") or dsn==os.environ.get("LOLO_ADMIN_DATABASE_URL"):
        raise SystemExit("Dedicated disposable homework staging database required.")
    require_staging()
    store=FamilyStore(dsn)
    admin=None
    admin_dsn=os.environ.get("LOLO_HOMEWORK_STAGING_ADMIN_DATABASE_URL")
    if admin_dsn:
        if admin_dsn in (dsn,os.environ.get("LOLO_DATABASE_URL"),os.environ.get("LOLO_ADMIN_DATABASE_URL")):
            raise SystemExit("Dedicated disposable teacher database required.")
        sys.path.insert(0,str(ROOT.parent/"admin-src"))
        from admin_identity import AdminStore
        admin=AdminStore(admin_dsn,os.environ.get("LOLO_HOMEWORK_STAGING_ADMIN_KEY"))
    server=PreviewServer(4185,store,admin)
    print("Synthetic homework preview: "+server.origin)
    server.serve_forever()
