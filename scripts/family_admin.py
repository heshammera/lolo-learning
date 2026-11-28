"""Explicit operator setup. Never use the production database for tests."""
import argparse
import getpass
import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from family_accounts import FamilyStore, FamilyError
from database_connection import database_dsn


def pilot_store(env=None):
    env=os.environ if env is None else env
    pilot=env.get("LOLO_FAMILY_PILOT_DATABASE_URL")
    primary=database_dsn("family",env)
    budget=env.get("LOLO_BUDGET_DATABASE_URL")
    if env.get("LOLO_FAMILY_PILOT_MODE")!="synthetic" or not primary or not pilot or not budget or pilot==primary or budget==primary:
        raise FamilyError(400,"Pilot requires explicit independent database configuration.")
    # Different strings do not prove physical database isolation; operator must confirm.
    return FamilyStore(pilot,synthetic_only=True)


def check_pilot(store):
    """Read-only fixture validation; returns counts only, never identities or data."""
    with store.connect() as db:
        db.execute("SET TRANSACTION READ ONLY")
        db.execute("SET LOCAL statement_timeout='3s'")
        parents,nonfixture=db.execute("""SELECT count(*),count(*) FILTER
            (WHERE email NOT LIKE '%@example.test') FROM lolo_parents""").fetchone()
        profiles,invalid=db.execute("""SELECT count(*),count(*) FILTER
            (WHERE c.nickname !~ '^Synthetic [0-9]{1,6}$' OR p.email NOT LIKE '%@example.test')
            FROM lolo_children c JOIN lolo_parents p ON p.id=c.parent_id""").fetchone()
        if nonfixture or invalid:
            raise FamilyError(409,"Pilot contains nonfixture records; activation blocked.")
        return {"fixture_accounts":parents,"fixture_profiles":profiles}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("migrate","provision","check-pilot","provision-pilot"))
    args = parser.parse_args()
    if args.action in ("check-pilot","provision-pilot"):
        store=pilot_store()
        counts=check_pilot(store)
        if args.action=="check-pilot":
            print("Pilot read-only check passed:",counts["fixture_accounts"],"fixture accounts;",counts["fixture_profiles"],"fixture profiles.")
            return
        if input("Confirm independent, reviewed synthetic pilot database (type PILOT): ")!="PILOT":
            raise FamilyError(400,"Pilot provisioning cancelled.")
    else:
        store = FamilyStore(os.environ.get("LOLO_DATABASE_URL"))
    if args.action == "migrate":
        store.migrate()
        print("Family schema applied.")
    else:
        email = input("Parent email: ")
        password = getpass.getpass("Password: ")
        if password != getpass.getpass("Confirm password: "):
            raise FamilyError(400, "Passwords do not match.")
        store.provision(email, password)
        print("Account provisioned; identity/parental consent has not been verified.")


if __name__ == "__main__":
    try:
        main()
    except FamilyError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print("Database operation failed. Check configuration privately.", file=sys.stderr)
        sys.exit(1)
