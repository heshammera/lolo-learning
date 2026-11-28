const assert = require('node:assert/strict');
const curriculum = require('../curriculum.json');
const Assessment = require('../assessment-engine.js');

const engine = Assessment.create();

assert.equal(Assessment.normalizeAnswer('  HELLO!!  '), 'hello');
assert.equal(Assessment.normalizeAnswer('I am   happy.'), 'i am happy');
assert.equal(Assessment.normalizeMathAnswer('٤'), 4);
assert.equal(Assessment.normalizeMathAnswer('اربعة'), 4);
assert.equal(Assessment.normalizeMathAnswer('Four cookies'), 4);
assert.equal(Assessment.normalizeMathAnswer('four or five'), null);
assert.equal(Assessment.normalizeMathAnswer('not sure'), null);

const accepted = engine.grade({questionId:'q-word', attemptId:'a-word', answer:'  HELLO! ', acceptedAnswers:['hello', 'hi']});
assert.equal(accepted.status, 'correct');
assert.equal(accepted.confidence, 1);
assert.equal(accepted.isCorrect, true);

const rejected = engine.grade({questionId:'q-word', attemptId:'a-wrong', answer:'bye', acceptedAnswers:['hello', 'hi']});
assert.equal(rejected.status, 'incorrect');
assert.equal(rejected.isCorrect, false);

const repeatedLetters = engine.grade({questionId:'q-order', attemptId:'a-order', answer:'hello', expected:'hello'});
assert.equal(repeatedLetters.isCorrect, true);
const missingRepeatedLetter = engine.grade({questionId:'q-order', attemptId:'a-order-missing', answer:'helo', expected:'hello'});
assert.equal(missingRepeatedLetter.isCorrect, false);

const math = engine.grade({questionId:'q-math', attemptId:'a-math', kind:'math', answer:'تلاتة', expected:'3'});
assert.equal(math.isCorrect, true);
const mathWrong = engine.grade({questionId:'q-math', attemptId:'a-math-wrong', kind:'math', answer:'اثنين', expected:'3'});
assert.equal(mathWrong.isCorrect, false);

const partial = engine.grade({questionId:'q-trace', attemptId:'a-trace', kind:'handwriting', answer:'A', quality:54});
assert.equal(partial.status, 'partial');
assert.equal(partial.isCorrect, false);
assert.equal(partial.confidence, 0.65);

const unresolved = engine.grade({questionId:'q-unknown', attemptId:'a-unknown', answer:'maybe'});
assert.equal(unresolved.status, 'unresolved');
assert.equal(unresolved.isCorrect, null);

const duplicate = engine.grade({questionId:'q-word', attemptId:'a-word', answer:'wrong', acceptedAnswers:['wrong']});
assert.equal(duplicate.duplicate, true);
assert.equal(duplicate.isCorrect, true);
assert.equal(engine.attemptCount(), 8);

const spokenQuiz = engine.createSpokenAssessment({
  id:'spoken-lesson',
  board:{tokens:[{text:'Hello'}, {text:'Bye'}, {text:'4'}]},
});
assert.equal(spokenQuiz.supported, true);
assert.equal(spokenQuiz.questions.length, 3);
assert.equal(new Set(spokenQuiz.questions.map(question => question.questionId)).size, 3);
const firstQuestion = spokenQuiz.questions[0];
const firstResponse = engine.gradeSpokenResponse(spokenQuiz, firstQuestion.questionId, firstQuestion.target, 'child-turn-1');
assert.equal(firstResponse.recorded, true);
assert.equal(firstResponse.isCorrect, true);
assert.equal(firstResponse.questionNumber, 1);
assert.equal(firstResponse.totalQuestions, 3);
assert.equal(spokenQuiz.currentIndex, 1);
const duplicateResponse = engine.gradeSpokenResponse(spokenQuiz, firstQuestion.questionId, 'wrong answer', 'child-turn-1');
assert.equal(duplicateResponse.duplicate, true);
assert.equal(duplicateResponse.isCorrect, true);
assert.equal(spokenQuiz.currentIndex, 1);

assert.equal(engine.createSpokenAssessment({id:'empty-lesson', board:{tokens:[]}}).supported, false);

const unclearQuiz = engine.createSpokenAssessment({id:'number-quiz', board:{tokens:[{text:'5'}]}});
const unclearQuestion = unclearQuiz.questions[0];
const unclearAttempt = engine.gradeSpokenResponse(unclearQuiz, unclearQuestion.questionId, 'five or six', 'turn-unresolved');
assert.equal(unclearAttempt.unresolved, true);
assert.equal(unclearQuiz.currentIndex, 0);
const unclearDuplicate = engine.gradeSpokenResponse(unclearQuiz, unclearQuestion.questionId, 'five', 'turn-unresolved');
assert.equal(unclearDuplicate.duplicate, true);
assert.equal(unclearDuplicate.unresolved, true);
const retrySuccess = engine.gradeSpokenResponse(unclearQuiz, unclearQuestion.questionId, 'five', 'turn-clear');
assert.equal(retrySuccess.recorded, true);
assert.equal(retrySuccess.isCorrect, true);

const curriculumLessons = [
  ...curriculum.units.flatMap(unit => unit.lessons),
  ...curriculum.programs.flatMap(program => program.units.flatMap(unit => unit.lessons)),
];
assert.equal(curriculumLessons.length, 140);
for (const lesson of curriculumLessons) {
  const assessment = engine.createSpokenAssessment(lesson);
  assert.equal(assessment.supported, true, `spoken assessment missing for ${lesson.id}`);
  assert.ok(assessment.questions.length >= 2 && assessment.questions.length <= 5, `question count invalid for ${lesson.id}`);
  const curriculumTargets = new Set(lesson.board.tokens.map(token => Assessment.normalizeAnswer(token.text)));
  assert.ok(assessment.questions.every(question => curriculumTargets.has(Assessment.normalizeAnswer(question.target))));
  assert.equal(new Set(assessment.questions.map(question => question.questionId)).size, assessment.questions.length);
}
for(const value of ['not five','مش خمسه','5 + 1','-5','5.5','five six','five five','five maybe','zero? five','5/2'])assert.equal(Assessment.normalizeMathAnswer(value),null,value);
assert.equal(Assessment.normalizeMathAnswer('أحد عشر'),11);
assert.equal(Assessment.normalizeMathAnswer('خمسة تفاحات'),5);
assert.equal(Assessment.normalizeMathAnswer('5.'),5);
const strict=Assessment.create();
assert.equal(strict.grade({kind:'math',answer:'not five',expected:'5'}).status,'unresolved');
for(const quality of [null,'90',-1,101,NaN])assert.equal(strict.grade({kind:'handwriting',quality}).status,'unresolved');
console.log('Deterministic assessment checks passed.');

const guidance=Assessment.lessonGuidance;
const wrong={is_correct:false},right={is_correct:true};
assert.equal(guidance([], 'guided'),null);
assert.equal(guidance([wrong],'guided','test'),null);
assert.equal(guidance([{is_correct:'false'}]),null);
assert.equal(guidance([wrong]).kind,'hint');
assert.notEqual(guidance([wrong],'guided').prompt,guidance([wrong],'gentle').prompt);
assert.equal(guidance([wrong,wrong]).kind,'example');
assert.equal(guidance([wrong,wrong,wrong]).kind,'offer-break');
assert.equal(guidance([wrong,wrong,right]).kind,'continue');
assert.equal(guidance([wrong,right,wrong]).kind,'hint');
assert.equal(JSON.stringify(guidance([{...wrong,answer:'PRIVATE TRANSCRIPT'}])).includes('PRIVATE TRANSCRIPT'),false);
