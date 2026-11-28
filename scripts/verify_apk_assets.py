"""Compare actual packaged Capacitor assets to the tested web bundle."""
import sys
from pathlib import Path
from zipfile import ZipFile

bundle=Path(sys.argv[1])
apk=Path(sys.argv[2])
expected={p.relative_to(bundle).as_posix():p.read_bytes() for p in bundle.rglob("*") if p.is_file()}
assert "index.html" in expected and "activity-engine.js" in expected and "activity-pilot.js" in expected
assert b'id="homeActivityHub"' in expected["index.html"]
assert b"LoloBuildCommit" in expected["index.html"]
with ZipFile(apk) as z:
    prefix="assets/public/"
    names=[n for n in z.namelist() if n.startswith(prefix) and not n.endswith("/")]
    assert len(names)==len(set(names)), "Duplicate APK asset"
    assert set(expected).issubset({n[len(prefix):] for n in names}), "Missing tested web assets"
    for name, data in expected.items():
        assert z.read(prefix+name)==data, "APK asset differs from tested bundle: "+name
    assert not any(n.startswith((prefix+"admin-src/",prefix+"database/",prefix+"api/")) for n in names)
    assert not any(n.endswith(("/.env","/server.py")) for n in names)
print("LOLO_APK_ASSETS=PASS:",len(expected),"verified bundled assets")
