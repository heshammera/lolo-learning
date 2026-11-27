"""Run on a trusted operator machine only. Never expose enrollment secrets to logs."""
import argparse
import getpass
import os
import sys
from admin_identity import AdminStore,ROLES,FamilyError

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("action",choices=["migrate","provision"])
    parser.add_argument("--role",choices=sorted(ROLES),default="owner")
    args=parser.parse_args()
    dsn=os.environ.get("LOLO_ADMIN_DATABASE_URL")
    if not dsn or dsn==os.environ.get("LOLO_DATABASE_URL"):
        raise FamilyError(400,"Configure a separate admin database.")
    store=AdminStore(dsn,os.environ.get("LOLO_ADMIN_ENCRYPTION_KEY"))
    if args.action=="migrate":
        store.migrate()
        print("Admin schema applied.")
        return
    import pyotp
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        raise FamilyError(400,"Interactive private terminal required.")
    email=input("Admin email: ")
    password=getpass.getpass("Password: ")
    if password!=getpass.getpass("Confirm password: "):
        raise FamilyError(400,"Passwords do not match.")
    secret=pyotp.random_base32()
    print("Add this secret manually in your authenticator, then clear your terminal: "+secret)
    code=getpass.getpass("Authenticator code: ")
    store.provision(email,password,args.role,secret,code)
    print("Admin account provisioned. Wait for the next authenticator code before login.")
if __name__=="__main__":
    try:main()
    except FamilyError as exc:
        print(str(exc),file=sys.stderr);sys.exit(1)
    except Exception:
        print("Admin operation failed. Check configuration privately.",file=sys.stderr);sys.exit(1)
