"""Internal synthetic staging; admin session plus explicit assignment/child grant."""
import unicodedata
from family_accounts import FamilyError
from homework_storage import require_staging, identifier
from pronunciation_contract import ID


def teacher_id(admin_store, admin_token):
    # The admin store must be server-configured, never caller-selected over HTTP.
    identity=admin_store.inspect(admin_token)
    if identity["role"]!="teacher":
        raise FamilyError(403,"Teacher role required.")
    return identifier(identity["id"])


def grant_for_staging(store, child_id, assignment_id, reviewer_id):
    """Trusted operator only. No public grant route; use synthetic IDs/data only."""
    require_staging()
    child=identifier(child_id)
    reviewer=identifier(reviewer_id)
    if not isinstance(assignment_id,str) or not ID.fullmatch(assignment_id):
        raise FamilyError(400,"Invalid assignment.")
    with store.connect() as db:
        if not db.execute("SELECT id FROM lolo_children WHERE id=%s FOR UPDATE",(child,)).fetchone():
            raise FamilyError(404,"Profile not found.")
        if not db.execute("SELECT id FROM lolo_homework_assignments WHERE id=%s AND active=true",(assignment_id,)).fetchone():
            raise FamilyError(404,"Assignment not found.")
        db.execute("""INSERT INTO lolo_homework_review_grants(child_id,assignment_id,reviewer_id)
            VALUES (%s,%s,%s) ON CONFLICT DO NOTHING""",(child,assignment_id,reviewer))


def revoke_for_staging(store, child_id, assignment_id, reviewer_id):
    require_staging()
    with store.connect() as db:
        db.execute("""DELETE FROM lolo_homework_review_grants WHERE child_id=%s AND assignment_id=%s AND reviewer_id=%s""",
                   (identifier(child_id),assignment_id,identifier(reviewer_id)))


def authorized_submission(db, reviewer, submission_id, lock=False):
    query="""SELECT s.id,s.image FROM lolo_homework_submissions s
        JOIN lolo_homework_review_grants g ON g.child_id=s.child_id AND g.assignment_id=s.assignment_id
        JOIN lolo_homework_assignments a ON a.id=s.assignment_id
        WHERE s.id=%s AND g.reviewer_id=%s AND a.active=true AND s.expires_at>CURRENT_TIMESTAMP"""
    if lock:
        query+=" FOR UPDATE OF s,g,a"
    row=db.execute(query,(identifier(submission_id),reviewer)).fetchone()
    if not row:
        raise FamilyError(404,"Submission not found.")
    return row


def read_for_review(store, admin_store, admin_token, submission_id):
    require_staging()
    reviewer=teacher_id(admin_store,admin_token)
    with store.connect() as db:
        return bytes(authorized_submission(db,reviewer,submission_id)[1])


def review(store, admin_store, admin_token, submission_id, outcome, score, feedback):
    require_staging()
    reviewer=teacher_id(admin_store,admin_token)
    if outcome not in ("reviewed","revise") or (outcome=="reviewed" and (type(score) is not int or not 0<=score<=100)) or (outcome=="revise" and score is not None):
        raise FamilyError(400,"Invalid outcome or score.")
    if not isinstance(feedback,str) or not 1<=len(feedback.strip())<=500 or any(unicodedata.category(c).startswith("C") for c in feedback):
        raise FamilyError(400,"Invalid feedback.")
    with store.connect() as db:
        submission=authorized_submission(db,reviewer,submission_id,lock=True)[0]
        result=db.execute("""INSERT INTO lolo_homework_reviews(submission_id,reviewer_id,outcome,score,feedback)
            VALUES (%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING RETURNING submission_id""",
            (submission,reviewer,outcome,score,feedback.strip())).fetchone()
        if not result:
            raise FamilyError(409,"Already reviewed; submit a new attempt.")
        return {"id":str(submission),"status":outcome,"score":score}


def parent_feedback(store,token,child_id,submission_id):
    require_staging()
    with store.connect() as db:
        child=store.owned_progress_child(db,token,child_id)
        row=db.execute("""SELECT r.outcome,r.score,r.feedback FROM lolo_homework_submissions s
            LEFT JOIN lolo_homework_reviews r ON r.submission_id=s.id
            WHERE s.child_id=%s AND s.id=%s AND s.expires_at>CURRENT_TIMESTAMP""",
            (child,identifier(submission_id))).fetchone()
        if not row:
            raise FamilyError(404,"Submission not found.")
        return {"status":row[0] or "submitted","score":row[1],"feedback":row[2]}
