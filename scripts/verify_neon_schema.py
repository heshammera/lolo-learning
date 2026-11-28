"""Read-only production database verification; never print credentials or records."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from database_connection import database_dsn

EXPECTED = [
    "lolo_parents",
    "lolo_parent_sessions",
    "lolo_children",
    "lolo_child_progress",
    "lolo_voice_consent",
    "lolo_homework_assignments",
    "lolo_homework_submissions",
    "lolo_homework_review_grants",
    "lolo_homework_reviews",
    "lolo_billing_plans",
    "lolo_billing_orders",
    "lolo_billing_test_entitlements",
    "lolo_billing_test_slots",
    "lolo_billing_test_usage",
    "lolo_billing_plan_audit",
    "lolo_billing_test_grants",
    "lolo_billing_test_coupons",
    "lolo_billing_test_redemptions",
    "lolo_billing_test_grant_audit",
    "lolo_billing_test_discounts",
    "lolo_offline_test_devices",
    "lolo_offline_test_challenges",
    "lolo_remote_test_config",
    "lolo_remote_test_config_audit",
    "lolo_voice_receipt_history",
    "lolo_shared_request_budget"
]
CORE = ("lolo_parents","lolo_parent_sessions","lolo_children","lolo_child_progress")

def verify(dsn):
    if not dsn:
        raise RuntimeError("Connection not configured")
    import psycopg
    with psycopg.connect(dsn, connect_timeout=8) as db:
        db.execute("SET TRANSACTION READ ONLY")
        db.execute("SET LOCAL statement_timeout='8s'")
        db.execute("SET LOCAL search_path=public,pg_catalog")
        existing={row[0] for row in db.execute(
            "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name=ANY(%s)",
            (EXPECTED,)).fetchall()}
        if existing!=set(EXPECTED):
            raise RuntimeError("Schema incomplete")
        for table in CORE:
            for privilege in ("SELECT","INSERT","UPDATE","DELETE"):
                if not db.execute("SELECT has_table_privilege(current_user,%s,%s)",("public."+table,privilege)).fetchone()[0]:
                    raise RuntimeError("Family role lacks required privilege")
        # Validate expected application projections without reading any personal records.
        db.execute("SELECT id,email,password_hash,disabled_at FROM public.lolo_parents LIMIT 0")
        db.execute("SELECT token_hash,parent_id,expires_at,revoked_at FROM public.lolo_parent_sessions LIMIT 0")
        db.execute("SELECT id,parent_id,nickname,age_band FROM public.lolo_children LIMIT 0")
        db.execute("SELECT child_id,revision,snapshot,last_operation FROM public.lolo_child_progress LIMIT 0")
        db.execute("SELECT bucket,window_start,used FROM public.lolo_shared_request_budget LIMIT 0")
        return len(existing)

def main():
    try:
        count=verify(database_dsn("family"))
    except Exception:
        print("LOLO_NEON_VERIFY=FAILED: schema, privileges or connection unavailable.",file=sys.stderr)
        return 1
    print(f"LOLO_NEON_VERIFY=PASS: {count}/{len(EXPECTED)} tables; core access checks passed; read only.")
    return 0

if __name__=="__main__":
    sys.exit(main())
