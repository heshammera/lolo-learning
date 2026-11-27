"""Explicit operator setup. Never use the production database for tests."""
import argparse
import getpass
import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from family_accounts import FamilyStore, FamilyError


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("migrate", "provision"))
    args = parser.parse_args()
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
