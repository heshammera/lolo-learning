import base64,json,tempfile,threading,unittest
from pathlib import Path
from http.server import ThreadingHTTPServer
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from unittest.mock import patch
import server
from content_delivery import load_catalog

def b64(b):return base64.urlsafe_b64encode(b).rstrip(b"=").decode()
D="11111111-1111-4111-8111-111111111111"
R="22222222-2222-4222-8222-222222222222"
def fixture():
    # Discovery reader does not verify signatures; browser tests do.
    p={"format":1,"draftId":D,"releaseId":R,"version":1,"sequence":2,"content":{"title":"Synthetic science"}}
    return {"keyId":"fixture","payload":b64(json.dumps(p).encode()),"signature":b64(b"x"*64)}

class DeliveryTests(unittest.TestCase):
    def test_catalog_and_api(self):
        with tempfile.TemporaryDirectory() as tmp:
            file=Path(tmp)/"catalog.json"
            e=fixture();file.write_text(json.dumps({"format":1,"packages":[e]}))
            self.assertEqual(load_catalog(file)[D][0]["sequence"],2)
            httpd=ThreadingHTTPServer(("127.0.0.1",0),server.Handler)
            th=threading.Thread(target=httpd.serve_forever,daemon=True);th.start()
            def request(body):
                req=Request(f"http://127.0.0.1:{httpd.server_port}/api/content",data=json.dumps(body).encode(),headers={"Content-Type":"application/json"})
                try:r=urlopen(req,timeout=5)
                except HTTPError as exc:r=exc
                with r:
                    self.assertEqual(r.headers.get("Cache-Control"),"no-store")
                    return r.status,json.load(r)
            try:
                with patch.object(server,"CONTENT_DELIVERY_ENABLED",False):
                    self.assertEqual(request({"action":"list"})[0],503)
                with patch.object(server,"CONTENT_DELIVERY_ENABLED",True),patch.dict(server.os.environ,{"LOLO_CONTENT_CATALOG_FILE":str(file)}),patch.object(server,"CONTENT_DELIVERY_LIMITER",server.SlidingWindowRateLimiter()):
                    self.assertEqual(request({"action":"list"})[1]["packages"][0]["draftId"],D)
                    self.assertEqual(request({"action":"download","draftId":D,"sequence":2}),(200,{"envelope":e}))
                    self.assertEqual(request({"action":"download","draftId":D,"sequence":1})[0],409)
                    self.assertEqual(request({"action":"download","draftId":"../../.env","sequence":2})[0],400)
                    file.write_text(json.dumps({"format":1,"packages":[e,e]}))
                    self.assertEqual(request({"action":"list"})[0],503)
            finally:httpd.shutdown();httpd.server_close();th.join(timeout=2)
