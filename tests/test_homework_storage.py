import io
import os
import unittest
import uuid
from unittest.mock import patch
from PIL import Image, PngImagePlugin
from family_accounts import FamilyStore, FamilyError
from homework_storage import sanitize_image, submit, list_owned, read_owned, delete_owned, purge_expired, MAX_INPUT


def image_bytes():
    out=io.BytesIO()
    metadata=PngImagePlugin.PngInfo()
    metadata.add_text("private","synthetic metadata")
    Image.new("RGB",(32,32),"white").save(out,format="PNG",pnginfo=metadata)
    return out.getvalue()


class HomeworkImageTests(unittest.TestCase):
    def test_reencode_and_reject(self):
        result=sanitize_image(image_bytes())
        with Image.open(io.BytesIO(result)) as im:
            self.assertEqual(im.format,"JPEG")
            self.assertEqual(im.size,(32,32))
            self.assertNotIn("private",im.info)
            self.assertFalse(im.getexif())
        for raw in [b"",b"<svg/>",b"%PDF-1.7",b"x"*(MAX_INPUT+1),image_bytes()[:20]]:
            with self.assertRaises(FamilyError):
                sanitize_image(raw)
        out=io.BytesIO()
        Image.new("RGB",(3001,1)).save(out,format="PNG")
        with self.assertRaises(FamilyError):
            sanitize_image(out.getvalue())

    def test_disabled_default(self):
        with patch.dict(os.environ,{"LOLO_HOMEWORK_STORAGE_STAGING":"false"}):
            with self.assertRaises(FamilyError) as error:
                submit(None,None,None,None,b"",True)
            self.assertEqual(error.exception.status,503)


@unittest.skipUnless(os.environ.get("LOLO_TEST_DATABASE_URL"),"Dedicated PostgreSQL test database not configured")
class HomeworkDatabaseTests(unittest.TestCase):
    def setUp(self):
        dsn=os.environ["LOLO_TEST_DATABASE_URL"]
        if dsn==os.environ.get("LOLO_DATABASE_URL"):
            self.fail("Never test against configured application database")
        self.store=FamilyStore(dsn)
        self.store.migrate()
        self.emails=[f"{uuid.uuid4()}@example.test" for _ in range(2)]
        self.assignment="synthetic-"+uuid.uuid4().hex
        for email in self.emails:
            self.store.provision(email,"synthetic-long-password")
        self.a,self.b=[self.store.login(e,"synthetic-long-password")["token"] for e in self.emails]
        self.child=self.store.create_child(self.a,"Synthetic learner","7-9")["id"]
        with self.store.connect() as db:
            db.execute("INSERT INTO lolo_homework_assignments(id,active) VALUES (%s,true)",(self.assignment,))

    def tearDown(self):
        with self.store.connect() as db:
            for email in self.emails:
                db.execute("DELETE FROM lolo_parents WHERE email=%s",(email,))
            db.execute("DELETE FROM lolo_homework_assignments WHERE id=%s",(self.assignment,))

    def test_owner_confirmation_quota_expiry_and_delete(self):
        with patch.dict(os.environ,{"LOLO_HOMEWORK_STORAGE_STAGING":"true"}):
            with self.assertRaises(FamilyError):
                submit(self.store,self.a,self.child,self.assignment,image_bytes(),False)
            with self.assertRaises(FamilyError):
                submit(self.store,self.a,self.child,"missing",image_bytes(),True)
            first=submit(self.store,self.a,self.child,self.assignment,image_bytes(),True)
            self.assertEqual(first["status"],"submitted")
            self.assertEqual(list_owned(self.store,self.a,self.child)[0]["id"],first["id"])
            self.assertTrue(read_owned(self.store,self.a,self.child,first["id"]).startswith(b"\xff\xd8"))
            for fn,args in [(list_owned,()),(read_owned,(first["id"],)),(delete_owned,(first["id"],)),(submit,(self.assignment,image_bytes(),True))]:
                with self.assertRaises(FamilyError) as denied:
                    fn(self.store,self.b,self.child,*args)
                self.assertEqual(denied.exception.status,404)
            for _ in range(9):
                submit(self.store,self.a,self.child,self.assignment,image_bytes(),True)
            with self.assertRaises(FamilyError) as full:
                submit(self.store,self.a,self.child,self.assignment,image_bytes(),True)
            self.assertEqual(full.exception.status,409)
            delete_owned(self.store,self.a,self.child,first["id"])
            with self.assertRaises(FamilyError):
                read_owned(self.store,self.a,self.child,first["id"])
            with self.store.connect() as db:
                db.execute("UPDATE lolo_homework_submissions SET created_at=CURRENT_TIMESTAMP-INTERVAL '8 days',expires_at=CURRENT_TIMESTAMP-INTERVAL '1 day' WHERE child_id=%s",(self.child,))
            self.assertEqual(list_owned(self.store,self.a,self.child),[])
            self.assertEqual(purge_expired(self.store),9)
