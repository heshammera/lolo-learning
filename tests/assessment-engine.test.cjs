const assert = require('node:assert/strict');
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
console.log('Deterministic assessment checks passed.');
