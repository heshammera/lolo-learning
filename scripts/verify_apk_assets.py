"""Compare actual packaged Capacitor assets to the tested web bundle."""
import sys
import os
import re
import subprocess
from pathlib import Path
from zipfile import ZipFile

bundle=Path(sys.argv[1])
apk=Path(sys.argv[2])
expected={p.relative_to(bundle).as_posix():p.read_bytes() for p in bundle.rglob("*") if p.is_file()}
assert "index.html" in expected and "activity-engine.js" in expected and "activity-pilot.js" in expected
assert b'id="homeActivityHub"' in expected["index.html"]
assert b"LoloBuildCommit" in expected["index.html"]
assert b'id="loloBootArt"' in expected["index.html"] and b'id="bootProgress"' in expected["index.html"]
assert "assets/branding/lolo-splash.webp" in expected
from hashlib import sha256
assert sha256(expected["assets/branding/lolo-splash.webp"]).hexdigest()=="91b6d046bec9bcb6fb277ba9d59784213e4982123ede1e8e3855e824df69de3e", "Approved splash art differs"
# Android Gradle can shorten resource filenames in release builds. Inspect the
# compiled resource table rather than requiring the source filename in the ZIP.
sdk=os.environ.get("ANDROID_SDK_ROOT") or os.environ.get("ANDROID_HOME")
assert sdk, "Android SDK missing for compiled splash verification"
def version_key(p):
    return tuple(int(n) for n in re.findall(r"\d+",p.parent.name))
tools=sorted(Path(sdk).glob("build-tools/*/aapt2"),key=version_key)
assert tools, "aapt2 missing"
aapt2=str(tools[-1])
resources=subprocess.check_output([aapt2,"dump","resources",str(apk)],text=True,timeout=60)
icon=re.search(r"(?m)^\s*resource\s+(0x[0-9a-fA-F]+)\s+(?:[\w.]+:)?drawable/lolo_startup_transparent\b[^\n]*\n([\s\S]*?)(?=^\s*resource\s+0x|\Z)",resources)
assert icon, "Compiled transparent startup drawable missing"
files=re.findall(r"(?:res|r)/[^\s()]+\.xml",icon.group(2))
assert files, "Compiled startup drawable does not resolve to XML"
with ZipFile(apk) as z:
    for resource in set(files):
        assert resource in z.namelist(), "Compiled startup drawable file missing"
        xml=subprocess.check_output([aapt2,"dump","xmltree","--file",resource,str(apk)],text=True,timeout=30)
        assert "vector" in xml and re.search(r"fillColor[^\n]*(?:#00000000|0x0\b|0x00000000\b)",xml,re.I), "Startup vector is not transparent"
    print("LOLO_NATIVE_SPLASH=PASS: compiled transparent vector verified")
    prefix="assets/public/"
    names=[n for n in z.namelist() if n.startswith(prefix) and not n.endswith("/")]
    assert len(names)==len(set(names)), "Duplicate APK asset"
    assert set(expected).issubset({n[len(prefix):] for n in names}), "Missing tested web assets"
    for name, data in expected.items():
        assert z.read(prefix+name)==data, "APK asset differs from tested bundle: "+name
    assert not any(n.startswith((prefix+"admin-src/",prefix+"database/",prefix+"api/")) for n in names)
    assert not any(n.endswith(("/.env","/server.py")) for n in names)
print("LOLO_APK_ASSETS=PASS:",len(expected),"verified bundled assets")
