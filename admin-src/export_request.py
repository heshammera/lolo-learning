"""Private operator signing of an active reviewed release. Never a public endpoint."""
import argparse
import getpass
import json
import os
import stat
import subprocess
import sys
from pathlib import Path
from admin_identity import AdminStore,FamilyError
from cms_drafts import draft_id
from content_packages import export_active,public_jwk
ROOT=Path(__file__).resolve().parents[1]

def parse_request(request):
    if not isinstance(request,dict) or set(request)!={"format","draftId","releaseId"} or type(request["format"]) is not int or request["format"]!=1:
        raise FamilyError(400,"Invalid export request.")
    draft_id(request["draftId"]);draft_id(request["releaseId"])
    return request["draftId"],request["releaseId"]

def sign_request(store,token,request,key_id,key,trusted):
    draft,release=parse_request(request)
    from cryptography.hazmat.primitives.asymmetric import ec
    if not isinstance(key,ec.EllipticCurvePrivateKey) or not isinstance(key.curve,ec.SECP256R1):
        raise FamilyError(400,"P-256 key required.")
    if not isinstance(key_id,str) or trusted.get(key_id)!=public_jwk(key):
        raise FamilyError(400,"Signing key must match the build-pinned public key.")
    return export_active(store,token,draft,release,key_id,key)

def separate_store(env):
    dsn=env.get("LOLO_ADMIN_DATABASE_URL")
    others=("LOLO_DATABASE_URL","DATABASE_URL","POSTGRES_URL","LOLO_CONTENT_CATALOG_DATABASE_URL",
            "LOLO_CONTENT_CATALOG_WRITER_DATABASE_URL","LOLO_FAMILY_PILOT_DATABASE_URL","LOLO_BUDGET_DATABASE_URL",
            "LOLO_BILLING_STAGING_DATABASE_URL","LOLO_HOMEWORK_STAGING_DATABASE_URL")
    if not dsn or dsn in [env.get(x) for x in others]:raise FamilyError(400,"Dedicated admin database required.")
    store=AdminStore(dsn,env.get("LOLO_ADMIN_ENCRYPTION_KEY"))
    with store.connect() as db:
        db.execute("SET TRANSACTION READ ONLY")
        db.execute("SET LOCAL statement_timeout='5s'")
        if db.info.get_parameters().get("sslmode")!="verify-full" or not db.pgconn.ssl_in_use:raise FamilyError(400,"Verified TLS required.")
        if db.execute("""SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND c.relname IN
          ('lolo_parents','lolo_children','lolo_public_content_catalog','lolo_billing_orders'))""").fetchone()[0]:
            raise FamilyError(400,"Mixed database rejected.")
    return store

def read_request(filename):
    with Path(filename).open("rb") as file:raw=file.read(4097)
    if len(raw)>4096:raise FamilyError(400,"Request too large.")
    request=json.loads(raw)
    parse_request(request)
    return request

def read_key(filename):
    from cryptography.hazmat.primitives.serialization import load_pem_private_key
    path=Path(filename).resolve(strict=True)
    if path.is_relative_to(ROOT) or not path.is_file():raise FamilyError(400,"Private key must be outside repository.")
    if os.name=="posix" and stat.S_IMODE(path.stat().st_mode)&0o077:raise FamilyError(400,"Private key permissions must be private.")
    with path.open("rb") as file:raw=file.read(16385)
    if len(raw)>16384:raise FamilyError(400,"Invalid key file.")
    phrase=getpass.getpass("Private key passphrase (empty only for separately secured unencrypted key): ")
    return load_pem_private_key(raw,password=phrase.encode() if phrase else None)

def write_new(filename,envelope):
    path=Path(filename)
    data=(json.dumps(envelope,ensure_ascii=False,separators=(",",":"))+"\n").encode()
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,"wb") as file:file.write(data)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("request")
    parser.add_argument("--key-file",required=True)
    parser.add_argument("--key-id",required=True)
    parser.add_argument("--output",required=True)
    args=parser.parse_args()
    if not sys.stdin.isatty() or not sys.stdout.isatty():raise FamilyError(400,"Private interactive terminal required.")
    request=read_request(args.request)
    keys=json.loads(subprocess.check_output(["node","-e","process.stdout.write(JSON.stringify(require('./content-trust.js')))"],cwd=ROOT,timeout=5))
    if not keys:raise FamilyError(400,"Enroll the public signing key first.")
    key=read_key(args.key_file)
    if keys.get(args.key_id)!=public_jwk(key):raise FamilyError(400,"Key does not match pinned trust.")
    if Path(args.output).exists():raise FamilyError(400,"Output already exists.")
    store=separate_store(os.environ)
    print("This signs an active reviewed release only. New login revokes earlier admin sessions.")
    if input("Confirm operator signing (type SIGN): ")!="SIGN":raise FamilyError(400,"Cancelled.")
    email=input("Admin email: ")
    password=getpass.getpass("Admin password: ")
    code=getpass.getpass("Authenticator code: ")
    if not store.admit_proxy_login():raise FamilyError(429,"Login limit reached.")
    token=store.login(email,password,code)["token"]
    try:
        envelope=sign_request(store,token,request,args.key_id,key,keys)
        write_new(args.output,envelope)
        print("Signed package created. Publication is a separate explicit operation.")
    finally:
        try:store.logout(token)
        except Exception:pass
if __name__=="__main__":
    try:main()
    except Exception:
        print("Export refused. Check active release, admin permission, dedicated DB, trust and private key privately.",file=sys.stderr)
        sys.exit(1)
