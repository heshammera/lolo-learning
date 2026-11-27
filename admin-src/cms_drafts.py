"""Draft-only CMS. No publication or learner-facing delivery."""
import json
import subprocess
import threading
import uuid
from pathlib import Path
from admin_identity import FamilyError

ROOT=Path(__file__).resolve().parent
SLOTS=threading.BoundedSemaphore(2)

def validate(content):
    try:
        raw=json.dumps(content,ensure_ascii=False,allow_nan=False).encode("utf-8")
    except (ValueError,TypeError,UnicodeError,RecursionError):
        raise FamilyError(400,"Invalid content.") from None
    if len(raw)>262144:
        raise FamilyError(400,"Draft too large.")
    if not SLOTS.acquire(blocking=False):
        raise FamilyError(429,"Validation busy.")
    try:
        r=subprocess.run(["node",str(ROOT/"cms-validate.cjs")],input=raw,capture_output=True,timeout=5,check=True)
        return json.loads(r.stdout)
    finally:SLOTS.release()

def draft_id(value):
    try:
        parsed=uuid.UUID(value)
        if str(parsed)!=value:raise ValueError()
        return parsed
    except (ValueError,TypeError,AttributeError):
        raise FamilyError(400,"Invalid draft ID.") from None

class Drafts:
    def __init__(self,store):self.store=store

    def list(self,token):
        with self.store.connect() as db:
            self.store.authorize(db,token,"curriculum:read")
            rows=db.execute("SELECT id,revision,content->>'title',updated_at FROM lolo_cms_drafts ORDER BY updated_at DESC,id LIMIT 100").fetchall()
            return {"drafts":[{"id":str(r[0]),"revision":r[1],"title":r[2],"updatedAt":r[3].isoformat()} for r in rows]}

    def read(self,token,value):
        with self.store.connect() as db:
            self.store.authorize(db,token,"curriculum:read")
            row=db.execute("SELECT id,revision,content FROM lolo_cms_drafts WHERE id=%s",(draft_id(value),)).fetchone()
            if not row:raise FamilyError(404,"Draft not found.")
            return {"id":str(row[0]),"revision":row[1],"content":row[2]}

    def check(self,token,content):
        self.store.inspect(token,"curriculum:edit")
        return validate(content)

    def save(self,token,value,revision,content):
        self.store.inspect(token,"curriculum:edit")
        if type(revision) is not int or not 0<=revision<2147483647:
            raise FamilyError(400,"Invalid revision.")
        if (value is None)!=(revision==0):
            raise FamilyError(400,"Invalid creation request.")
        result=validate(content)
        if not result["valid"]:
            return {"saved":False,"validation":result}
        from psycopg.types.json import Jsonb
        with self.store.connect() as db:
            actor=self.store.authorize(db,token,"curriculum:edit")
            if value is None:
                ident=uuid.uuid4()
                db.execute("INSERT INTO lolo_cms_drafts(id,revision,content,created_by,updated_by) VALUES (%s,1,%s,%s,%s)",(ident,Jsonb(content),actor["id"],actor["id"]))
            else:
                ident=draft_id(value)
                row=db.execute("UPDATE lolo_cms_drafts SET content=%s,revision=revision+1,updated_by=%s,updated_at=CURRENT_TIMESTAMP WHERE id=%s AND revision=%s RETURNING revision",(Jsonb(content),actor["id"],ident,revision)).fetchone()
                if not row:raise FamilyError(409,"Draft revision changed.")
            self.store.audit(db,actor["id"],"cms.draft.save")
        return {"saved":True,"id":str(ident),"revision":revision+1}
