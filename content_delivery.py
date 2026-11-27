"""Opt-in public distribution of explicitly curated signed packages.
No admin database, private keys, dynamic filesystem paths or student information.
Client signature verification is mandatory; catalog metadata is only discovery.
"""
import base64
import json
import re
from pathlib import Path

MAX_FILE=4_500_000
MAX_ENTRIES=12
UUID=re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")
KEY=re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}")
B64=re.compile(r"[A-Za-z0-9_-]+")

def decode(value,maximum):
    if not isinstance(value,str) or not value or len(value)>(maximum*4+2)//3 or not B64.fullmatch(value):
        raise ValueError("Invalid encoded field")
    raw=base64.urlsafe_b64decode(value+"="*(-len(value)%4))
    if len(raw)>maximum or base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")!=value:
        raise ValueError("Invalid encoded field")
    return raw

def reject_constant(value):
    raise ValueError("Invalid constant")

def load_catalog(filename):
    if not filename:raise ValueError("Catalog unavailable")
    with Path(filename).open("rb") as source:
        raw=source.read(MAX_FILE+1)
    if len(raw)>MAX_FILE:raise ValueError("Catalog too large")
    catalog=json.loads(raw,parse_constant=reject_constant)
    if not isinstance(catalog,dict) or set(catalog)!={"format","packages"} or type(catalog["format"]) is not int or catalog["format"]!=1 or not isinstance(catalog["packages"],list) or len(catalog["packages"])>MAX_ENTRIES:
        raise ValueError("Invalid catalog")
    entries={}
    for envelope in catalog["packages"]:
        if not isinstance(envelope,dict) or set(envelope)!={"keyId","payload","signature"} or not isinstance(envelope["keyId"],str) or not KEY.fullmatch(envelope["keyId"]):
            raise ValueError("Invalid envelope")
        if len(decode(envelope["signature"],64))!=64:raise ValueError("Invalid signature encoding")
        p=json.loads(decode(envelope["payload"],262144),parse_constant=reject_constant)
        if not isinstance(p,dict) or set(p)!={"format","draftId","releaseId","version","sequence","content"} or type(p["format"]) is not int or p["format"]!=1:
            raise ValueError("Invalid package")
        if any(not isinstance(p[k],str) or not UUID.fullmatch(p[k]) for k in ("draftId","releaseId")):
            raise ValueError("Invalid ID")
        if any(type(p[k]) is not int or not 1<=p[k]<=9007199254740991 for k in ("version","sequence")):
            raise ValueError("Invalid version")
        content=p["content"]
        if not isinstance(content,dict) or not isinstance(content.get("title"),str) or not 1<=len(content["title"].strip())<=200 or p["draftId"] in entries:
            raise ValueError("Invalid title or duplicate curriculum")
        # This reader intentionally does not sign or claim to verify approval.
        meta={k:p[k] for k in ("draftId","releaseId","version","sequence")}
        meta.update(title=content["title"],keyId=envelope["keyId"])
        entries[p["draftId"]]=(meta,envelope)
    return entries
