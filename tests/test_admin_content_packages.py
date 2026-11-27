import json,subprocess,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"admin-src"))
from content_packages import sign_package,public_jwk
from test_cms_drafts import sample

class SigningTests(unittest.TestCase):
    def test_python_signature_verifies_in_actual_js_client(self):
        try:from cryptography.hazmat.primitives.asymmetric import ec
        except ImportError:self.skipTest("Admin signing dependencies not installed")
        key=ec.generate_private_key(ec.SECP256R1())
        d="11111111-1111-4111-8111-111111111111";r="22222222-2222-4222-8222-222222222222"
        envelope=sign_package("fixture",key,d,r,1,1,sample())
        body=json.dumps({"envelope":envelope,"trusted":{"fixture":public_jwk(key)}})
        script="const x=JSON.parse(require('fs').readFileSync(0,'utf8'));require('./content-package.js').verify(x.envelope,x.trusted,{subtle:require('crypto').webcrypto.subtle}).then(r=>{if(!r.valid){console.error(r.code);process.exit(1)}})"
        subprocess.run(["node","-e",script],input=body,text=True,check=True,timeout=10,cwd=Path(__file__).resolve().parents[1])
