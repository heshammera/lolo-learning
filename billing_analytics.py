"""Owner-only aggregate reporting over synthetic billing records. No real revenue or provider costs."""
from billing_owner import owner
from family_accounts import FamilyError

def snapshot(store,admin,token):
    owner(admin,token)
    with store.connect() as db:
        db.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        now,month=db.execute("SELECT CURRENT_TIMESTAMP,date_trunc('month',CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date").fetchone()
        # Always filter to synthetic accounts, even if a staging database was mispopulated.
        accounts=db.execute("""SELECT COALESCE(e.plan_id,'free'),count(*)
          FROM lolo_parents p LEFT JOIN lolo_billing_test_effective e ON e.parent_id=p.id
          WHERE p.disabled_at IS NULL AND right(p.email,13)='@example.test' GROUP BY 1""").fetchall()
        plans={k:0 for k in ("free","plus","family")}
        for k,v in accounts:
            if k not in plans:raise FamilyError(503,"Unknown reporting plan.")
            plans[k]=v
        students=db.execute("""SELECT count(*) FROM lolo_children c JOIN lolo_parents p ON p.id=c.parent_id
          WHERE p.disabled_at IS NULL AND right(p.email,13)='@example.test'""").fetchone()[0]
        sources=db.execute("""SELECT
          count(*) FILTER(WHERE e.order_id IS NOT NULL),
          count(*) FILTER(WHERE e.order_id IS NULL AND g.source='manual'),
          count(*) FILTER(WHERE e.order_id IS NULL AND g.source='trial')
          FROM lolo_billing_test_effective a JOIN lolo_parents p ON p.id=a.parent_id
          LEFT JOIN lolo_billing_test_entitlements e ON e.parent_id=a.parent_id AND e.starts_at<=CURRENT_TIMESTAMP AND e.ends_at>CURRENT_TIMESTAMP
          LEFT JOIN lolo_billing_test_grants g ON g.parent_id=a.parent_id AND g.revoked_at IS NULL AND g.starts_at<=CURRENT_TIMESTAMP AND g.ends_at>CURRENT_TIMESTAMP
          WHERE p.disabled_at IS NULL AND right(p.email,13)='@example.test'""").fetchone()
        orders=db.execute("""SELECT count(*) FILTER(WHERE o.status='pending' AND o.expires_at>CURRENT_TIMESTAMP),
          count(*) FILTER(WHERE o.status='cancelled' OR (o.status='pending' AND o.expires_at<=CURRENT_TIMESTAMP)),
          count(*) FILTER(WHERE o.status='test_paid'),
          COALESCE(sum(o.amount_minor) FILTER(WHERE o.status='test_paid'),0),
          COALESCE(sum(o.discount_minor) FILTER(WHERE o.status='test_paid'),0)
          FROM lolo_billing_orders o JOIN lolo_parents p ON p.id=o.parent_id WHERE right(p.email,13)='@example.test'""").fetchone()
        usage=db.execute("""SELECT u.feature,COALESCE(sum(u.units),0),count(*) FROM lolo_billing_test_usage u
          JOIN lolo_parents p ON p.id=u.parent_id WHERE right(p.email,13)='@example.test' AND u.month=%s GROUP BY u.feature""",(month,)).fetchall()
        uses={"voice":{"reservedUnits":0,"reservations":0},"pronunciation":{"reservedUnits":0,"reservations":0}}
        for name,units,n in usage:
            if name in uses:uses[name]={"reservedUnits":units,"reservations":n}
        trial=db.execute("""SELECT count(*) FROM lolo_billing_test_redemptions r JOIN lolo_parents p ON p.id=r.parent_id WHERE right(p.email,13)='@example.test'""").fetchone()[0]
        discounts=db.execute("""SELECT count(*) FILTER(WHERE o.status='test_paid'), count(*) FILTER(WHERE o.status='pending' AND o.expires_at>CURRENT_TIMESTAMP)
          FROM lolo_billing_orders o JOIN lolo_parents p ON p.id=o.parent_id WHERE o.discount_id IS NOT NULL AND right(p.email,13)='@example.test'""").fetchone()
        devices=db.execute("""SELECT count(*) FILTER(WHERE d.revoked_at IS NULL), count(*) FILTER(WHERE d.revoked_at IS NOT NULL)
          FROM lolo_offline_test_devices d JOIN lolo_parents p ON p.id=d.parent_id WHERE right(p.email,13)='@example.test'""").fetchone()
        return {"testOnly":True,"asOf":now.isoformat(),"usageMonth":month.isoformat(),"currency":"EGP",
          "activeAccounts":sum(plans.values()),"studentProfiles":students,"plans":plans,
          "activeSources":{"testSettlement":sources[0],"manual":sources[1],"trial":sources[2]},
          "orders":{"pending":orders[0],"cancelledOrExpired":orders[1],"testSettled":orders[2],"testAmountMinor":str(orders[3]),"testDiscountMinor":str(orders[4])},
          "usage":uses,"campaigns":{"trialRedemptions":trial,"discountSettled":discounts[0],"discountPending":discounts[1]},
          "devices":{"registeredNotRevoked":devices[0],"revoked":devices[1]},
          "realRevenueMinor":None,"actualProviderCostMinor":None}
