"""Synthetic server-selected evidence only. Never records or receives audio."""
import os
from family_accounts import FamilyError
from billing import require_staging,parent_for_test,identifier
from billing_entitlements import policy,slots,owned_child,month_now,used
from pronunciation_contract import Reference,normalize_evidence
from voice_consent import POLICY,PURPOSE

# Demonstration reference, not educator-certified production content.
REFERENCES={"synthetic-cat":Reference("synthetic-cat","en-US","cat",("k","æ","t"))}
def enabled():
    require_staging()
    if os.environ.get("LOLO_PRONUNCIATION_PREVIEW")!="true":raise FamilyError(503,"Preview disabled.")

def evaluate(store,token,child_id,reference_id,operation_id):
    enabled()
    if type(reference_id) is not str or reference_id not in REFERENCES:raise FamilyError(400,"Unknown test reference.")
    ref=REFERENCES[reference_id];operation=identifier(operation_id)
    with store.connect() as db:
        parent=parent_for_test(store,db,token,lock=True)
        child=owned_child(db,parent,child_id)
        # Serialize with operator receipt replacement and parent revocation.
        db.execute("SELECT id FROM lolo_children WHERE id=%s FOR UPDATE",(child,)).fetchone()
        consent=db.execute("""SELECT 1 FROM lolo_voice_consent WHERE child_id=%s AND purpose=%s AND policy=%s
            AND revoked_at IS NULL AND expires_at>clock_timestamp()""",(child,PURPOSE,POLICY)).fetchone()
        if not consent:raise FamilyError(403,"Reviewed test receipt required.")
        p=policy(db,parent)
        if p["planId"] not in ("plus","family") or child not in slots(db,parent,p["childLimit"]):raise FamilyError(403,"Test entitlement required.")
        prior=db.execute("SELECT 1 FROM lolo_billing_test_usage WHERE parent_id=%s AND operation_id=%s",(parent,operation)).fetchone()
        if prior:raise FamilyError(409,"Operation already used.")
        month=month_now(db);consumed=used(db,parent,month,"pronunciation")
        if consumed>=p["pronunciationLimit"]:raise FamilyError(429,"Test allowance exhausted.")
        evidence=normalize_evidence(ref,{"activityId":ref.activity_id,"locale":ref.locale,"status":"aligned",
            "phonemes":[{"index":i,"phoneme":phoneme,"accuracy":score} for i,(phoneme,score) in enumerate(zip(ref.phonemes,(92,61,88)))]})
        if evidence is None:raise FamilyError(503,"Test evidence unavailable.")
        db.execute("""INSERT INTO lolo_billing_test_usage(parent_id,operation_id,child_id,feature,units,month)
            VALUES (%s,%s,%s,'pronunciation',1,%s)""",(parent,operation,child,month))
        return {"testOnly":True,"source":"synthetic-fixture","referenceText":ref.text,"evidence":evidence,
            "remainingTestAttempts":p["pronunciationLimit"]-consumed-1}
