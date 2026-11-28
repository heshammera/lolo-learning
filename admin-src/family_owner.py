"""Exact synthetic-account lookup and reversible suspension, no child data returned."""
import uuid
from family_accounts import FamilyError,email_value

def validated(store,email):
    if not store.synthetic_only:raise FamilyError(503,"Synthetic store required.")
    email=email_value(email)
    if not email.endswith("@example.test"):raise FamilyError(400,"Synthetic email required.")
    return email

def result(db,parent):
    pid,disabled=parent
    children=db.execute("SELECT count(*) FROM lolo_children WHERE parent_id=%s",(pid,)).fetchone()[0]
    sessions=db.execute("SELECT count(*) FROM lolo_parent_sessions WHERE parent_id=%s AND revoked_at IS NULL AND expires_at>CURRENT_TIMESTAMP",(pid,)).fetchone()[0]
    return {"disabled":disabled is not None,"childCount":children,"activeSessions":sessions}

def lookup(store,email):
    email=validated(store,email)
    with store.connect() as db:
        db.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        parent=db.execute("SELECT id,disabled_at FROM lolo_parents WHERE email=%s",(email,)).fetchone()
        if not parent:raise FamilyError(404,"Fixture not found.")
        return result(db,parent)

def change(store,actor,email,expected_disabled,disabled):
    email=validated(store,email)
    try:actor=uuid.UUID(str(actor))
    except ValueError:raise FamilyError(400,"Invalid actor.") from None
    if type(expected_disabled) is not bool or type(disabled) is not bool or expected_disabled==disabled:
        raise FamilyError(400,"Invalid state transition.")
    with store.connect() as db:
        parent=db.execute("SELECT id,disabled_at FROM lolo_parents WHERE email=%s FOR UPDATE",(email,)).fetchone()
        if not parent:raise FamilyError(404,"Fixture not found.")
        if (parent[1] is not None)!=expected_disabled:raise FamilyError(409,"State changed.")
        pid=parent[0]
        db.execute("UPDATE lolo_parents SET disabled_at=CASE WHEN %s THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id=%s",(disabled,pid))
        if disabled:db.execute("UPDATE lolo_parent_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE parent_id=%s AND revoked_at IS NULL",(pid,))
        db.execute("INSERT INTO lolo_pilot_family_audit(actor_id,parent_id,disabled) VALUES (%s,%s,%s)",(actor,pid,disabled))
        return result(db,db.execute("SELECT id,disabled_at FROM lolo_parents WHERE id=%s",(pid,)).fetchone())
