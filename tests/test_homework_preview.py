import importlib.util
import json
import os
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock, MagicMock, patch
from urllib.request import Request, urlopen
from urllib.error import HTTPError

from family_accounts import FamilyError

spec=importlib.util.spec_from_file_location("homework_preview",Path(__file__).resolve().parents[1]/"staging-homework"/"serve.py")
preview=importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)


class PreviewTests(unittest.TestCase):
    def test_disabled_default(self):
        with patch.dict(os.environ,{"LOLO_HOMEWORK_STORAGE_STAGING":"false"}):
            with self.assertRaises(FamilyError):
                preview.PreviewServer(0,Mock())

    def test_synthetic_only_and_validation(self):
        store=MagicMock()
        db=store.connect.return_value.__enter__.return_value
        db.execute.return_value.fetchone.return_value=("parent@example.test",)
        with patch.dict(os.environ,{"LOLO_HOMEWORK_STORAGE_STAGING":"true"}):
            with self.assertRaises(FamilyError):
                preview.dispatch(store,{"action":"login","email":"real@example.com","password":"test"},"")
            store.login.assert_not_called()
            for body in [{"action":"submit","childId":"id","assignmentId":"real","image":"YQ==","confirmed":True},
                         {"action":"submit","childId":"id","assignmentId":"synthetic-x","image":"!","confirmed":True},
                         {"action":"submit","childId":"id","assignmentId":"synthetic-x","image":"YQ==","confirmed":False},
                         {"action":"children","extra":True}]:
                with self.assertRaises(FamilyError):preview.dispatch(store,body,"token")
            with patch.object(preview,"submit",return_value={"id":"test"}) as submit:
                self.assertEqual(preview.dispatch(store,{"action":"submit","childId":"id","assignmentId":"synthetic-x","image":"YQ==","confirmed":True},"token"),{"id":"test"})
                submit.assert_called_once_with(store,"token","id","synthetic-x",b"a",True)
            db.execute.return_value.fetchone.return_value=("real@example.com",)
            with self.assertRaises(FamilyError):preview.dispatch(store,{"action":"children"},"token")

    def test_loopback_origin_and_headers(self):
        with patch.dict(os.environ,{"LOLO_HOMEWORK_STORAGE_STAGING":"true"}):
            server=preview.PreviewServer(0,Mock())
            worker=threading.Thread(target=server.serve_forever,daemon=True)
            worker.start()
            try:
                def post(headers):
                    request=Request(server.origin+"/api",data=json.dumps({"action":"children"}).encode(),headers=headers)
                    try:response=urlopen(request,timeout=3)
                    except HTTPError as error:response=error
                    with response:return response.status,response.headers
                headers={"Content-Type":"application/json","Origin":server.origin}
                with patch.object(preview,"dispatch",return_value={"children":[]}) as dispatch:
                    for bad in [{**headers,"Origin":"https://elsewhere.test"},{**headers,"Host":"elsewhere.test"},{**headers,"Sec-Fetch-Site":"cross-site"}]:
                        self.assertEqual(post(bad)[0],403)
                    dispatch.assert_not_called()
                    code,response_headers=post(headers)
                    self.assertEqual(code,200)
                    self.assertEqual(response_headers["Cache-Control"],"no-store")
                    self.assertEqual(response_headers["X-Content-Type-Options"],"nosniff")
                with urlopen(server.origin,timeout=3) as result:
                    self.assertIn("STAGING",result.read().decode())
            finally:
                server.shutdown()
                server.server_close()
                worker.join(timeout=3)
