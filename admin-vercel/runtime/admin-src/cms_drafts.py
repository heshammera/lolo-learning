"""Draft-only CMS. No publication or learner-facing delivery."""
import json
import subprocess
import threading
import uuid
from pathlib import Path
from admin_identity import FamilyError

ROOT=Path(__file__).resolve().parent
SLOTS=threading.BoundedSemaphore(2)

from hosted_validator import validate

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
            rows=db.execute("SELECT id,revision,content->>'title',updated_at,status FROM lolo_cms_drafts ORDER BY updated_at DESC,id LIMIT 100").fetchall()
            return {"drafts":[{"id":str(r[0]),"revision":r[1],"title":r[2],"updatedAt":r[3].isoformat(),"status":r[4]} for r in rows]}

    def read(self,token,value):
        with self.store.connect() as db:
            self.store.authorize(db,token,"curriculum:read")
            row=db.execute("SELECT id,revision,content,status FROM lolo_cms_drafts WHERE id=%s",(draft_id(value),)).fetchone()
            if not row:raise FamilyError(404,"Draft not found.")
            return {"id":str(row[0]),"revision":row[1],"content":row[2],"status":row[3]}

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
                row=db.execute("UPDATE lolo_cms_drafts SET content=%s,revision=revision+1,updated_by=%s,updated_at=CURRENT_TIMESTAMP WHERE id=%s AND revision=%s AND status='draft' RETURNING revision",(Jsonb(content),actor["id"],ident,revision)).fetchone()
                if not row:raise FamilyError(409,"Draft revision changed.")
            self.store.audit(db,actor["id"],"cms.draft.save")
        return {"saved":True,"id":str(ident),"revision":revision+1,"status":"draft"}

    def transition(self,token,value,revision,action):
        policies={"submit":("curriculum:edit",("draft",),"review"),
                  "approve":("curriculum:review",("review",),"approved"),
                  "return":("curriculum:review",("review","approved"),"draft"),
                  "reopen":("curriculum:edit",("published",),"draft"),
                  "publish":("curriculum:publish",("approved",),"published")}
        if not isinstance(action,str) or action not in policies or type(revision) is not int or not 1<=revision<2147483647:
            raise FamilyError(400,"Invalid transition.")
        permission,prior,next_status=policies[action]
        ident=draft_id(value)
        with self.store.connect() as db:
            actor=self.store.authorize(db,token,permission)
            row=db.execute("SELECT revision,status,content,updated_by,reviewer_id FROM lolo_cms_drafts WHERE id=%s FOR UPDATE",(ident,)).fetchone()
            if not row:raise FamilyError(404,"Draft not found.")
            if row[0]!=revision or row[1] not in prior:raise FamilyError(409,"Draft changed or action not permitted in this state.")
            if action=="approve" and str(row[3])==actor["id"]:
                raise FamilyError(403,"A different reviewer must approve the last editor's work.")
            if action in ("submit","approve","publish") and not validate(row[2])["valid"]:
                raise FamilyError(422,"Current activity validation failed.")
            # Recheck the session/role after potentially slow validation.
            self.store.authorize(db,token,permission)
            reviewer=actor["id"] if action=="approve" else row[4] if action=="publish" else None
            release=None
            if action=="publish":
                if not reviewer:raise FamilyError(409,"Review required.")
                from psycopg.types.json import Jsonb
                version=db.execute("SELECT COALESCE(MAX(version),0)+1 FROM lolo_cms_releases WHERE draft_id=%s",(ident,)).fetchone()[0]
                release=uuid.uuid4()
                db.execute("INSERT INTO lolo_cms_releases(id,draft_id,version,source_revision,content,reviewer_id,publisher_id) VALUES (%s,%s,%s,%s,%s,%s,%s)",(release,ident,version,revision,Jsonb(row[2]),reviewer,actor["id"]))
                db.execute("INSERT INTO lolo_cms_active_release(draft_id,release_id) VALUES (%s,%s) ON CONFLICT(draft_id) DO UPDATE SET release_id=EXCLUDED.release_id",(ident,release))
            db.execute("UPDATE lolo_cms_drafts SET status=%s,reviewer_id=%s,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=%s",(next_status,reviewer,ident))
            self.store.audit(db,actor["id"],"cms."+action)
            return {"id":str(ident),"status":next_status,"revision":revision+1,"releaseId":str(release) if release else None}

    def history(self,token,value):
        ident=draft_id(value)
        with self.store.connect() as db:
            self.store.authorize(db,token,"curriculum:read")
            if not db.execute("SELECT 1 FROM lolo_cms_drafts WHERE id=%s",(ident,)).fetchone():raise FamilyError(404,"Draft not found.")
            rows=db.execute("SELECT r.id,r.version,r.source_revision,r.created_at,(a.release_id IS NOT NULL) FROM lolo_cms_releases r LEFT JOIN lolo_cms_active_release a ON a.draft_id=r.draft_id AND a.release_id=r.id WHERE r.draft_id=%s ORDER BY r.version DESC LIMIT 100",(ident,)).fetchall()
            return {"releases":[{"id":str(r[0]),"version":r[1],"sourceRevision":r[2],"createdAt":r[3].isoformat(),"active":r[4]} for r in rows]}

    def rollback(self,token,value,target,expected_active):
        ident,target,expected_active=map(draft_id,(value,target,expected_active))
        with self.store.connect() as db:
            actor=self.store.authorize(db,token,"curriculum:publish")
            if not db.execute("SELECT id FROM lolo_cms_drafts WHERE id=%s FOR UPDATE",(ident,)).fetchone():raise FamilyError(404,"Draft not found.")
            current=db.execute("SELECT release_id FROM lolo_cms_active_release WHERE draft_id=%s",(ident,)).fetchone()
            if not current or current[0]!=expected_active or target==expected_active:raise FamilyError(409,"Active release changed.")
            row=db.execute("SELECT content FROM lolo_cms_releases WHERE draft_id=%s AND id=%s",(ident,target)).fetchone()
            if not row:raise FamilyError(404,"Release not found.")
            if not validate(row[0])["valid"]:raise FamilyError(422,"Release no longer compatible.")
            self.store.authorize(db,token,"curriculum:publish")
            db.execute("UPDATE lolo_cms_active_release SET release_id=%s WHERE draft_id=%s",(target,ident))
            self.store.audit(db,actor["id"],"cms.rollback")
            return {"activeReleaseId":str(target)}
