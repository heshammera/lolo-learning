import unittest
from pronunciation_contract import Reference, normalize_evidence, practice_feedback


class PronunciationTests(unittest.TestCase):
    def setUp(self):
        self.ref=Reference("word-1","en-US","cat",("k","æ","t"))
        self.items=[{"index":i,"phoneme":p,"accuracy":80+i} for i,p in enumerate(self.ref.phonemes)]
        self.result={"activityId":"word-1","locale":"en-US","status":"aligned","phonemes":self.items}

    def test_evidence_is_not_mastery(self):
        value=normalize_evidence(self.ref,self.result)
        self.assertFalse(value["masteryEligible"])
        self.assertEqual(value["phonemes"],self.items)
        self.assertIsNot(value["phonemes"],self.items)
        self.assertNotIn("overallScore",value)

    def test_fail_closed(self):
        for result in [None,{}, {**self.result,"transcript":"cat"}, {**self.result,"status":"no-speech"},
                       {**self.result,"locale":"ar-EG"},{**self.result,"activityId":"different"},
                       {**self.result,"phonemes":self.items[:2]}, {**self.result,"phonemes":self.items[::-1]}]:
            self.assertIsNone(normalize_evidence(self.ref,result))
        for score in [True,-1,101,80.5,float("nan"),"100"]:
            items=[{**self.items[0],"accuracy":score},*self.items[1:]]
            self.assertIsNone(normalize_evidence(self.ref,{**self.result,"phonemes":items}))
        self.assertIsNone(normalize_evidence(self.ref,{**self.result,"phonemes":[{**self.items[0],"phoneme":"x"},*self.items[1:]]}))

    def test_reference_validation(self):
        for locale,text,phonemes in [("xx","cat",("k",)),("en-US","",("k",)),("en-US","cat",()),("en-US","cat",["k"]),("en-US","cat",("\n",))]:
            with self.assertRaises(ValueError):
                Reference("word",locale,text,phonemes)

    def test_guidance_is_bounded_deterministic_and_requires_aligned_evidence(self):
        guidance={"k":"Listen to first sound.","æ":"Listen to the middle sound.","t":"Listen to final sound."}
        items=[{**p,"accuracy":score} for p,score in zip(self.items,(65,49,60))]
        value=practice_feedback(self.ref,{**self.result,"phonemes":items},guidance=guidance)
        self.assertEqual(value["kind"],"guided-repeat")
        self.assertFalse(value["masteryEligible"])
        self.assertEqual([p["phoneme"] for p in value["targets"]],["æ","t"])
        self.assertEqual(practice_feedback(self.ref,self.result,guidance=guidance)["targets"],[])
        self.assertIsNone(practice_feedback(self.ref,{**self.result,"status":"no-speech"},guidance=guidance))
        self.assertIsNone(practice_feedback(self.ref,self.result,guidance={"k":"hint"}))
        repeated=Reference("repeat","en-US","test",("t","s","t"))
        result={"activityId":"repeat","locale":"en-US","status":"aligned","phonemes":[{"index":i,"phoneme":p,"accuracy":score} for i,(p,score) in enumerate(zip(repeated.phonemes,(62,90,40)))]}
        targets=practice_feedback(repeated,result,guidance={"t":"Repeat t.","s":"Repeat s."})["targets"]
        self.assertEqual([(t["index"],t["phoneme"]) for t in targets],[(2,"t")])
