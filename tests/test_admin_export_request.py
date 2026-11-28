import sys,tempfile,unittest,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"admin-src"))
from export_request import parse_request,write_new,read_request,sign_request
from admin_identity import FamilyError
D="11111111-1111-4111-8111-111111111111"
R="22222222-2222-4222-8222-222222222222"
class ExportRequestTests(unittest.TestCase):
    def test_exact_unsigned_reference_and_exclusive_output(self):
        request={"format":1,"draftId":D,"releaseId":R}
        self.assertEqual(parse_request(request),(D,R))
        for value in ({**request,"content":{}},{**request,"format":True},{**request,"draftId":"../../key"}):
            with self.assertRaises(FamilyError):parse_request(value)
        with tempfile.TemporaryDirectory() as directory:
            source=Path(directory)/"request.json";source.write_text(json.dumps(request))
            self.assertEqual(read_request(source),request)
            out=Path(directory)/"package.json";fixture={"keyId":"fixture","payload":"abc","signature":"xyz"}
            write_new(out,fixture)
            with self.assertRaises(FileExistsError):write_new(out,{"other":True})
            self.assertEqual(json.loads(out.read_text()),fixture)
            source.write_text(" "*4097)
            with self.assertRaises(FamilyError):read_request(source)
    def test_wrong_trust_denied_before_store(self):
        try:from cryptography.hazmat.primitives.asymmetric import ec
        except ImportError:self.skipTest('Admin signing dependencies not installed in student-only test environment')
        key=ec.generate_private_key(ec.SECP256R1())
        with self.assertRaises(FamilyError):sign_request(None,"unused",{"format":1,"draftId":D,"releaseId":R},"fixture",key,{})
