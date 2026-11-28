"""Private homework storage staging. Internal only, synthetic data only."""
import io
import os
import uuid
import warnings
from family_accounts import FamilyError
from progress_sync import uuid_value, InvalidProgress
from pronunciation_contract import ID

MAX_INPUT = 2 * 1024 * 1024
MAX_OUTPUT = MAX_INPUT
MAX_PIXELS = 4_000_000
MAX_PER_CHILD = 10


def require_staging():
    if os.environ.get("LOLO_HOMEWORK_STORAGE_STAGING") != "true":
        raise FamilyError(503, "Homework storage staging disabled.")


def identifier(value):
    try:
        return uuid_value(value)
    except InvalidProgress:
        raise FamilyError(400, "Invalid submission identifier.") from None


def sanitize_image(raw):
    """Decode and re-encode pixels only; never preserve filename, EXIF or original file."""
    from PIL import Image, UnidentifiedImageError
    if type(raw) is not bytes or not 1 <= len(raw) <= MAX_INPUT:
        raise FamilyError(400, "Image size not allowed.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw), formats=["PNG", "JPEG"]) as source:
                if source.format not in ("PNG", "JPEG") or getattr(source, "n_frames", 1) != 1:
                    raise ValueError("Unsupported image")
                width,height=source.size
                if not 1 <= width <= 3000 or not 1 <= height <= 3000 or width*height>MAX_PIXELS:
                    raise ValueError("Image dimensions exceed limit")
                source.load()
                pixels=source.convert("RGB")
                # A fresh image has no source metadata or embedded profiles.
                clean=Image.new("RGB",pixels.size)
                clean.paste(pixels)
                out=io.BytesIO()
                clean.save(out,format="JPEG",quality=82)
                data=out.getvalue()
                if len(data)>MAX_OUTPUT:
                    raise ValueError("Encoded image exceeds limit")
                return data
    except (OSError, ValueError, SyntaxError, Image.DecompressionBombError, Image.DecompressionBombWarning, UnidentifiedImageError):
        raise FamilyError(400,"Invalid or unsupported image.") from None


def submit(store, token, child_id, assignment_id, raw, confirmed):
    """Parent-owned staged photo, with explicit confirmation; not verified legal consent."""
    require_staging()
    if confirmed is not True or not isinstance(assignment_id,str) or not ID.fullmatch(assignment_id):
        raise FamilyError(400,"Explicit confirmation and valid assignment required.")
    with store.connect() as db:
        child=store.owned_progress_child(db,token,child_id,lock=True)
        # Assignment is operator-created, not a client-generated filename or URL.
        if not db.execute("SELECT id FROM lolo_homework_assignments WHERE id=%s AND active=true",(assignment_id,)).fetchone():
            raise FamilyError(404,"Assignment not found.")
        db.execute("DELETE FROM lolo_homework_submissions WHERE child_id=%s AND expires_at<=CURRENT_TIMESTAMP",(child,))
        count=db.execute("SELECT count(*) FROM lolo_homework_submissions WHERE child_id=%s",(child,)).fetchone()[0]
        if count>=MAX_PER_CHILD:
            raise FamilyError(409,"Submission limit reached.")
        data=sanitize_image(raw)
        submission=uuid.uuid4()
        db.execute("""INSERT INTO lolo_homework_submissions(id,child_id,assignment_id,image,expires_at)
            VALUES (%s,%s,%s,%s,CURRENT_TIMESTAMP+INTERVAL '7 days')""",(submission,child,assignment_id,data))
        return {"id":str(submission),"assignmentId":assignment_id,"status":"submitted"}


def list_owned(store, token, child_id):
    require_staging()
    with store.connect() as db:
        child=store.owned_progress_child(db,token,child_id)
        rows=db.execute("""SELECT id,assignment_id,created_at FROM lolo_homework_submissions
            WHERE child_id=%s AND expires_at>CURRENT_TIMESTAMP ORDER BY created_at,id""",(child,)).fetchall()
        return [{"id":str(row[0]),"assignmentId":row[1],"createdAt":row[2].isoformat(),"status":"submitted"} for row in rows]


def read_owned(store, token, child_id, submission_id):
    require_staging()
    with store.connect() as db:
        child=store.owned_progress_child(db,token,child_id)
        row=db.execute("""SELECT image FROM lolo_homework_submissions
            WHERE child_id=%s AND id=%s AND expires_at>CURRENT_TIMESTAMP""",(child,identifier(submission_id))).fetchone()
        if not row:
            raise FamilyError(404,"Submission not found.")
        return bytes(row[0])


def delete_owned(store, token, child_id, submission_id):
    require_staging()
    with store.connect() as db:
        child=store.owned_progress_child(db,token,child_id,lock=True)
        if not db.execute("DELETE FROM lolo_homework_submissions WHERE child_id=%s AND id=%s",(child,identifier(submission_id))).rowcount:
            raise FamilyError(404,"Submission not found.")


def purge_expired(store):
    """Trusted scheduled operator task; must be configured before any live use."""
    require_staging()
    with store.connect() as db:
        return db.execute("DELETE FROM lolo_homework_submissions WHERE expires_at<=CURRENT_TIMESTAMP").rowcount
