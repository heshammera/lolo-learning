"""Shared admission limits, not billing, provider consumption or authorization."""
from family_accounts import FamilyStore
class BudgetUnavailable(Exception):
    pass

def admit(dsn,kind,minute_limit,day_limit=None):
    if kind not in ("paid","login") or type(minute_limit) is not int or not 1<=minute_limit<=1000000:
        raise ValueError("Invalid budget")
    if kind=="paid" and (type(day_limit) is not int or not 1<=day_limit<=1000000):
        raise ValueError("Invalid daily budget")
    try:
        with FamilyStore(dsn).connect() as db:
            db.execute("SET LOCAL statement_timeout='3s'")
            # Take locks in a consistent order. Use the database clock, not instance time.
            db.execute("SELECT pg_advisory_xact_lock(17694321,%s)",(1 if kind=="paid" else 2,))
            now,minute,day=db.execute("""SELECT t,date_trunc('minute',t),date_trunc('day',t AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
                FROM (SELECT clock_timestamp() AS t) q""").fetchone()
            windows=[(kind+"-minute",minute,minute_limit,60)]
            if kind=="paid":windows.append(("paid-day",day,day_limit,86400))
            counts=[]
            for name,start,limit,seconds in windows:
                row=db.execute("SELECT window_start,used FROM lolo_shared_request_budget WHERE bucket=%s FOR UPDATE",(name,)).fetchone()
                if row and row[0]>start:raise BudgetUnavailable("Database clock moved backwards")
                count=row[1] if row and row[0]==start else 0
                if count>=limit:
                    from math import ceil
                    return False,max(1,ceil(seconds-(now-start).total_seconds()))
                counts.append((name,start,count+1))
            for name,start,count in counts:
                db.execute("""INSERT INTO lolo_shared_request_budget(bucket,window_start,used) VALUES (%s,%s,%s)
                    ON CONFLICT(bucket) DO UPDATE SET window_start=EXCLUDED.window_start,used=EXCLUDED.used""",(name,start,count))
            return True,0
    except Exception as exc:
        raise BudgetUnavailable("Shared request budget unavailable") from None
