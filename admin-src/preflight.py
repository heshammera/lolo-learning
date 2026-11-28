"""Read-only operator preflight. Never prints credentials or account identifiers."""
import os
import sys
from pathlib import Path
from admin_identity import AdminStore, FamilyError
from admin_web import proxy_config, load_library

TABLES=("lolo_admin_users","lolo_admin_sessions","lolo_admin_audit","lolo_admin_proxy_login",
        "lolo_cms_drafts","lolo_cms_releases","lolo_cms_active_release","lolo_cms_delivery_sequence")
OTHER_DSNS=("LOLO_DATABASE_URL","LOLO_FAMILY_PILOT_DATABASE_URL","LOLO_BUDGET_DATABASE_URL",
            "LOLO_BILLING_STAGING_DATABASE_URL","LOLO_HOMEWORK_STAGING_DATABASE_URL","DATABASE_URL","POSTGRES_URL")


def configuration(env):
    if env.get("LOLO_ADMIN_HTTPS_STAGING")!="true" or env.get("LOLO_ADMIN_LOCAL_WEB")=="true":
        raise FamilyError(400,"Select dedicated HTTPS staging mode.")
    proxy_config(env.get("LOLO_ADMIN_ORIGIN"),env.get("LOLO_ADMIN_PROXY_TOKEN"))
    if env.get("LOLO_ADMIN_PORT","4180")!="4180":
        raise FamilyError(400,"Port must match the private proxy configuration.")
    if any(env.get(k)=="true" for k in ("LOLO_BILLING_STAGING","LOLO_ADMIN_FAMILY_PILOT","LOLO_ADMIN_STAGING_EXPORT")):
        raise FamilyError(400,"Disable pilot management, billing and export for initial HTTPS deployment.")
    dsn=env.get("LOLO_ADMIN_DATABASE_URL")
    if not dsn or dsn in [env.get(k) for k in OTHER_DSNS]:
        raise FamilyError(400,"Dedicated administration database required.")
    return AdminStore(dsn,env.get("LOLO_ADMIN_ENCRYPTION_KEY"))


def database_check(store):
    with store.connect() as db:
        db.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        db.execute("SET LOCAL statement_timeout='5s'")
        host=db.info.host or ""
        if host not in ("127.0.0.1","::1","localhost") and not host.startswith("/"):
            if db.info.get_parameters().get("sslmode")!="verify-full" or not db.pgconn.ssl_in_use:
                raise FamilyError(400,"Remote administration database requires verified TLS.")
        # Reject a mixed schema even when credentials differ as strings.
        mixed=db.execute("""SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname NOT IN ('pg_catalog','information_schema')
            AND c.relname IN ('lolo_parents','lolo_children','lolo_child_progress','lolo_billing_orders','lolo_shared_request_budget'))""").fetchone()[0]
        if mixed:raise FamilyError(400,"Administration database contains family or application tables.")
        for table in TABLES:
            oid=db.execute("SELECT to_regclass(%s)",(table,)).fetchone()[0]
            if oid is None:raise FamilyError(503,"Administration schema incomplete.")
            if not db.execute("SELECT has_table_privilege(current_user,%s,'SELECT')",(table,)).fetchone()[0]:
                raise FamilyError(503,"Administration role lacks required read access.")
        count=db.execute("SELECT count(*) FROM lolo_admin_users WHERE role='owner' AND disabled_at IS NULL").fetchone()[0]
        if count<1:raise FamilyError(503,"Provision an enabled owner before HTTPS startup.")
    return len(TABLES)


def main():
    try:
        store=configuration(os.environ)
        count=database_check(store)
        library=load_library()
        if not library:raise FamilyError(503,"Activity Library is unavailable.")
        print(f"LOLO_ADMIN_PREFLIGHT=PASS: {count} admin tables, owner present, library available; read-only.")
    except Exception:
        # Do not print DSN, key, provider exceptions, account IDs or secret-bearing diagnostics.
        print("LOLO_ADMIN_PREFLIGHT=FAIL: review mode, separate DB, verified TLS, migrations, owner and Activity Library privately.",file=sys.stderr)
        sys.exit(1)

if __name__=="__main__":
    main()
