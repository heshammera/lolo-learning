"""Operator publishes an already reviewed, signed envelope; no signing or public write API."""
import argparse
import json
import os
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from content_catalog_db import configured_dsn,publish

def read_json(path,maximum):
    with Path(path).open("rb") as f:
        raw=f.read(maximum+1)
    if len(raw)>maximum:raise ValueError("File too large.")
    return json.loads(raw)

def main():
    p=argparse.ArgumentParser()
    p.add_argument("envelope")
    p.add_argument("--expected-sequence",type=int,required=True)
    args=p.parse_args()
    if not sys.stdin.isatty() or not sys.stdout.isatty():raise ValueError("Private interactive operator terminal required.")
    # Trust is from the identical build-pinned public keys, not from an envelope.
    import subprocess
    root=Path(__file__).resolve().parents[1]
    keys=json.loads(subprocess.check_output(["node","-e","process.stdout.write(JSON.stringify(require('./content-trust.js')))"],cwd=root,timeout=5))
    if not keys:raise ValueError("No enrolled public content trust keys.")
    envelope=read_json(args.envelope,400000)
    dsn=configured_dsn(os.environ,writer=True)
    if input("Publish reviewed signed curriculum to dedicated catalog (type PUBLISH): ")!="PUBLISH":raise ValueError("Cancelled.")
    result=publish(dsn,envelope,keys,args.expected_sequence)
    print("Catalog operation:",result["status"],"sequence",result["sequence"])

if __name__=="__main__":
    try:main()
    except Exception:
        print("Content publication refused. Check trust keys, approved envelope, sequence and dedicated database privately.",file=sys.stderr)
        sys.exit(1)
