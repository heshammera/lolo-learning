"""Server-internal pronunciation evidence boundary. No provider or HTTP endpoint."""
from dataclasses import dataclass
import re
import unicodedata

ID = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}")
LOCALES = frozenset(("en-US", "en-GB", "ar-EG", "ar-SA"))


def safe_text(value, limit):
    return (isinstance(value, str) and 1 <= len(value) <= limit
            and bool(value.strip()) and not any(unicodedata.category(c).startswith("C") for c in value))


@dataclass(frozen=True)
class Reference:
    """Only server-selected, educator-reviewed reference; not a client request."""
    activity_id: str
    locale: str
    text: str
    phonemes: tuple

    def __post_init__(self):
        if (not isinstance(self.activity_id,str) or not ID.fullmatch(self.activity_id)
                or not isinstance(self.locale,str) or self.locale not in LOCALES
                or not safe_text(self.text, 200) or not isinstance(self.phonemes,tuple)
                or not 1 <= len(self.phonemes) <= 80
                or not all(safe_text(p,16) for p in self.phonemes)):
            raise ValueError("Invalid pronunciation reference")


def normalize_evidence(reference, result):
    """Accept a normalized result only from a future trusted server adapter.
    Scores are descriptive provider evidence, never mastery or clinical measures.
    No result if alignment/coverage is incomplete; never infer a phoneme score from ASR text.
    """
    if not isinstance(reference,Reference) or type(result) is not dict:
        return None
    if set(result)!={"activityId","locale","status","phonemes"}:
        return None
    if (result["activityId"]!=reference.activity_id or result["locale"]!=reference.locale
            or result["status"]!="aligned"):
        return None
    items=result["phonemes"]
    if type(items) is not list or len(items)!=len(reference.phonemes):
        return None
    output=[]
    for index,(expected,item) in enumerate(zip(reference.phonemes,items)):
        if type(item) is not dict or set(item)!={"index","phoneme","accuracy"}:
            return None
        if type(item["index"]) is not int or item["index"]!=index or item["phoneme"]!=expected:
            return None
        score=item["accuracy"]
        if type(score) is not int or not 0<=score<=100:
            return None
        output.append({"index":index,"phoneme":expected,"accuracy":score})
    return {"activityId":reference.activity_id,"locale":reference.locale,
            "status":"aligned","phonemes":output,"masteryEligible":False}

def practice_feedback(reference, result, *, guidance):
    """Rank up to two practice targets, not a pronunciation diagnosis or mastery score.
    Guidance is a reviewed server-owned map of phoneme to instructional hint.
    No inference from transcripts, no threshold claimed to be clinically calibrated.
    """
    evidence=normalize_evidence(reference,result)
    if evidence is None or type(guidance) is not dict:
        return None
    if set(guidance)!=set(reference.phonemes) or not all(safe_text(hint,200) for hint in guidance.values()):
        return None
    candidates=sorted((p for p in evidence["phonemes"] if p["accuracy"]<75),key=lambda p:(p["accuracy"],p["index"]))
    targets=[]
    seen=set()
    for item in candidates:
        if item["phoneme"] in seen:
            continue
        seen.add(item["phoneme"])
        targets.append({"index":item["index"],"phoneme":item["phoneme"],"hint":guidance[item["phoneme"]]})
        if len(targets)==2:
            break
    return {"kind":"guided-repeat" if targets else "listen-and-repeat","targets":targets,"masteryEligible":False}
