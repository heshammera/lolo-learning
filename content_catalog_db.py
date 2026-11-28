"""Independent signed-curriculum catalog. No user data or signing secrets.
Production API only reads; mutation is an explicit operator action on separate credentials.
"""
import json
from content_delivery import parse_catalog,MAX_ENTRIES,MAX_FILE

OTHER_DSNS=("LOLO_DATABASE_URL","DATABASE_URL","POSTGRES_URL","LOLO_ADMIN_DATABASE_URL",
            "LOLO_FAMILY_PILOT_DATABASE_URL","LOLO_BUDGET_DATABASE_URL",
            "LOLO_BILLING_STAGING_DATABASE_URL","LOLO_HOMEWORK_STAGING_DATABASE_URL")
LOCK=182670441
def configured_dsn(env,writer=False):
    key="LOLO_CONTENT_CATALOG_WRITER_DATABASE_URL" if writer else "LOLO_CONTENT_CATALOG_DATABASE_URL"
    dsn=env.get(key)
    if not dsn or dsn in [env.get(k) for k in OTHER_DSNS]:
        raise ValueError("Independent catalog database required.")
    if not writer and env.get("LOLO_CONTENT_CATALOG_WRITER_DATABASE_URL"):
        raise ValueError("Never configure writer credentials on student service.")
    if writer and dsn==env.get("LOLO_CONTENT_CATALOG_DATABASE_URL"):
        raise ValueError("Separate read and write roles required.")
    return dsn

def connect(dsn):
    import psycopg
    return psycopg.connect(dsn,connect_timeout=5)

def boundary(db,require_tls):
    db.execute("SET LOCAL statement_timeout='5s'")
    if require_tls and (db.info.get_parameters().get("sslmode")!="verify-full" or not db.pgconn.ssl_in_use):
        raise ValueError("Verified TLS required.")
    mixed=db.execute("""SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND c.relname IN
        ('lolo_parents','lolo_children','lolo_admin_users','lolo_cms_drafts','lolo_billing_orders','lolo_shared_request_budget'))""").fetchone()[0]
    if mixed:raise ValueError("Mixed database rejected.")

def rows(db):
    packages=[r[0] for r in db.execute("SELECT envelope FROM lolo_public_content_catalog ORDER BY draft_id LIMIT 13").fetchall()]
    if len(json.dumps(packages,ensure_ascii=False).encode())>MAX_FILE:raise ValueError("Catalog too large.")
    return parse_catalog({"format":1,"packages":packages})

def read_catalog(dsn,require_tls=True):
    try:
        with connect(dsn) as db:
            db.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            boundary(db,require_tls)
            return rows(db)
    except Exception:raise RuntimeError("Content catalog unavailable.") from None

def verified_envelope(envelope,keys):
    """Use the actual app verifier; input is JSON data, not interpolated code."""
    import subprocess
    from pathlib import Path
    parsed=parse_catalog({"format":1,"packages":[envelope]})
    body=json.dumps({"envelope":envelope,"keys":keys},ensure_ascii=True,allow_nan=False)
    if len(body)>MAX_FILE:raise ValueError("Verification input too large.")
    script="""const fs=require('node:fs');const x=JSON.parse(fs.readFileSync(0,'utf8'));
    require('./content-package.js').verify(x.envelope,x.keys,{subtle:require('node:crypto').webcrypto.subtle})
      .then(r=>{process.exitCode=r.valid?0:1;}).catch(()=>{process.exitCode=1;});"""
    try:
        result=subprocess.run(["node","-e",script],input=body,text=True,capture_output=True,timeout=10,cwd=Path(__file__).resolve().parent)
        if result.returncode:raise ValueError("Signature or curriculum compatibility rejected.")
    except (OSError,subprocess.TimeoutExpired):raise ValueError("Verifier unavailable.") from None
    return next(iter(parsed.values()))[0]

def publish(dsn,envelope,keys,expected_sequence,require_tls=True):
    if type(expected_sequence) is not int or not 0<=expected_sequence<=9007199254740991:
        raise ValueError("Invalid expected sequence.")
    # Copy to immutable JSON representation before verification.
    envelope=json.loads(json.dumps(envelope,allow_nan=False))
    meta=verified_envelope(envelope,keys)
    from psycopg.types.json import Jsonb
    with connect(dsn) as db:
        boundary(db,require_tls)
        db.execute("SELECT pg_advisory_xact_lock(%s)",(LOCK,))
        entries=rows(db)
        old=entries.get(meta["draftId"])
        previous=old[0]["sequence"] if old else 0
        if old and previous==meta["sequence"] and old[1]["payload"]==envelope["payload"] and old[1]["keyId"]==envelope["keyId"]:
            return {"status":"already-published","sequence":previous}
        if previous!=expected_sequence or meta["sequence"]<=previous:
            raise ValueError("Catalog changed or stale/conflicting package.")
        if not old and len(entries)>=MAX_ENTRIES:raise ValueError("Catalog capacity reached.")
        candidate=[v[1] for k,v in entries.items() if k!=meta["draftId"]]+[envelope]
        if len(json.dumps(candidate,ensure_ascii=False).encode())>MAX_FILE:raise ValueError("Catalog too large.")
        db.execute("""INSERT INTO lolo_public_content_catalog(draft_id,sequence,envelope) VALUES (%s,%s,%s)
          ON CONFLICT(draft_id) DO UPDATE SET sequence=EXCLUDED.sequence,envelope=EXCLUDED.envelope,updated_at=CURRENT_TIMESTAMP""",
          (meta["draftId"],meta["sequence"],Jsonb(envelope)))
        return {"status":"published","sequence":meta["sequence"]}
