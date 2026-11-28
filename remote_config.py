"""Owner-only synthetic control plane. Never overrides server authorization or local learning."""
from family_accounts import FamilyError
from billing import require_staging,identifier,parent_for_test
import os
FLAGS=("onlineMaintenance","voice","pronunciation","cloudSync","homework")
FIELDS=set(FLAGS)|{"minimumAndroidVersionCode","recommendedAndroidVersionCode","message"}

def enabled():
    require_staging()
    if os.environ.get("LOLO_REMOTE_CONFIG_STAGING")!="true":raise FamilyError(503,"Test configuration disabled.")

def validate(values):
    if type(values) is not dict or set(values)!=FIELDS:raise FamilyError(400,"Invalid configuration fields.")
    for name in FLAGS:
        if type(values[name]) is not bool:raise FamilyError(400,"Invalid feature flag.")
    for name in ("minimumAndroidVersionCode","recommendedAndroidVersionCode"):
        if type(values[name]) is not int or not 1<=values[name]<=2100000000:raise FamilyError(400,"Invalid version.")
    if values["minimumAndroidVersionCode"]>values["recommendedAndroidVersionCode"]:raise FamilyError(400,"Invalid version order.")
    msg=values["message"]
    if type(msg) is not str or len(msg)>300 or any(ord(c)<32 or 127<=ord(c)<=159 or c in "\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069" for c in msg):raise FamilyError(400,"Invalid plain-text message.")

def admin_actor(admin,token):
    enabled()
    return identifier(admin.inspect(token,"settings:manage")["id"])

def record(row):
    if not row:raise FamilyError(503,"Configuration unavailable.")
    validate(row[1])
    return {"testOnly":True,"revision":row[0],"policy":row[1],"updatedAt":row[2].isoformat()}

def read(store,admin,token):
    admin_actor(admin,token)
    with store.connect() as db:
        return record(db.execute("SELECT revision,policy,updated_at FROM lolo_remote_test_config WHERE id=1").fetchone())

def change(store,admin,token,revision,values):
    actor=admin_actor(admin,token);validate(values)
    if type(revision) is not int or not 1<=revision<2147483647:raise FamilyError(400,"Invalid revision.")
    from psycopg.types.json import Jsonb
    with store.connect() as db:
        prior=db.execute("SELECT revision,policy,updated_at FROM lolo_remote_test_config WHERE id=1 FOR UPDATE").fetchone()
        if not prior or prior[0]!=revision:raise FamilyError(409,"Configuration changed.")
        result=db.execute("UPDATE lolo_remote_test_config SET revision=revision+1,policy=%s,updated_at=clock_timestamp() WHERE id=1 RETURNING revision,policy,updated_at",(Jsonb(values),)).fetchone()
        db.execute("INSERT INTO lolo_remote_test_config_audit(actor_id,before_policy,after_policy,revision) VALUES (%s,%s,%s,%s)",(actor,Jsonb(prior[1]),Jsonb(values),result[0]))
        return record(result)

def history(store,admin,token):
    admin_actor(admin,token)
    with store.connect() as db:
        rows=db.execute("SELECT revision,actor_id,before_policy,after_policy,changed_at FROM lolo_remote_test_config_audit ORDER BY revision DESC LIMIT 30").fetchall()
        return {"testOnly":True,"changes":[{"revision":r[0],"actorId":str(r[1]),"before":r[2],"after":r[3],"changedAt":r[4].isoformat()} for r in rows]}

def preview(store,token):
    enabled()
    with store.connect() as db:
        parent_for_test(store,db,token)
        return record(db.execute("SELECT revision,policy,updated_at FROM lolo_remote_test_config WHERE id=1").fetchone())
