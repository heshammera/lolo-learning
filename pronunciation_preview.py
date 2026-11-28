"""Synthetic server-selected evidence only. Never records or receives audio."""
import os
from family_accounts import FamilyError
from billing import require_staging,parent_for_test,identifier
from billing_entitlements import policy,slots,owned_child,month_now,used
from pronunciation_contract import Reference,normalize_evidence,practice_feedback
from voice_consent import POLICY,PURPOSE

# Demonstration reference, not educator-certified production content.
REFERENCES={
    "synthetic-cat":Reference("synthetic-cat","en-US","cat",("k","æ","t")),
    "synthetic-ship":Reference("synthetic-ship","en-US","ship",("ʃ","ɪ","p")),
    "synthetic-sun":Reference("synthetic-sun","en-US","sun",("s","ʌ","n")),
}
# Authored instructional examples only; independent educator/provider review still required.
FIXTURES={
    "synthetic-cat":((92,61,88),{"k":"استمعي إلى أول صوت في cat ثم كرري الكلمة بهدوء.","æ":"استمعي إلى الصوت الأوسط في cat وكرري الكلمة ببطء.","t":"استمعي إلى آخر صوت في cat ثم كرري."}),
    "synthetic-ship":((60,68,91),{"ʃ":"استمعي إلى صوت sh في ship ثم كرري.","ɪ":"استمعي إلى الصوت القصير في وسط ship.","p":"استمعي إلى آخر صوت في ship."}),
    "synthetic-sun":((91,86,90),{"s":"استمعي إلى أول صوت في sun.","ʌ":"استمعي إلى الصوت الأوسط في sun.","n":"استمعي إلى آخر صوت في sun."}),
}
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
        scores,guidance=FIXTURES[reference_id]
        raw={"activityId":ref.activity_id,"locale":ref.locale,"status":"aligned",
            "phonemes":[{"index":i,"phoneme":phoneme,"accuracy":score} for i,(phoneme,score) in enumerate(zip(ref.phonemes,scores))]}
        evidence=normalize_evidence(ref,raw)
        feedback=practice_feedback(ref,raw,guidance=guidance)
        if evidence is None or feedback is None:raise FamilyError(503,"Test evidence unavailable.")
        db.execute("""INSERT INTO lolo_billing_test_usage(parent_id,operation_id,child_id,feature,units,month)
            VALUES (%s,%s,%s,'pronunciation',1,%s)""",(parent,operation,child,month))
        return {"testOnly":True,"source":"synthetic-fixture","referenceText":ref.text,"evidence":evidence,"feedback":feedback,
            "remainingTestAttempts":p["pronunciationLimit"]-consumed-1}
