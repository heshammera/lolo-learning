const assert = require('node:assert/strict');
const learning = require('../learning-engine.js');

const day = 24 * 60 * 60 * 1000;
const start = Date.UTC(2026, 0, 1, 10);
let store = learning.createStore({});
assert.equal(learning.getStatus(store, 'english:hello'), learning.STATUS.NOT_STARTED);

store = learning.markIntroduced(store, ['english:hello'], {curriculumVersion: '2.1.0', lessonVersion: '1.0.0'}, start).progress;
assert.equal(learning.getStatus(store, 'english:hello'), learning.STATUS.INTRODUCED);

const response = {attemptId: 'attempt-1', questionId: 'question-1', isCorrect: true, transcript: 'secret transcript'};
let result = learning.recordResponse(store, 'english:hello', response);
assert.equal(result.recorded, true);
store = result.progress;
assert.equal(learning.recordResponse(store, 'english:hello', response).duplicate, true);
assert.equal(JSON.stringify(store).includes('secret transcript'), false);

result = learning.recordAssessment(store, 'english:hello', {assessmentId: 'assessment-1', total: 4, correct: 4, completedAt: start, curriculumVersion: '2.1.0', lessonVersion: '1.0.0'});
assert.equal(result.status, learning.STATUS.PROFICIENT);
store = result.progress;
assert.equal(learning.recordAssessment(store, 'english:hello', {assessmentId: 'assessment-1', total: 4, correct: 3, completedAt: start}).duplicate, true);

result = learning.recordAssessment(store, 'english:hello', {assessmentId: 'assessment-2', total: 4, correct: 4, completedAt: start + day});
assert.equal(result.status, learning.STATUS.MASTERED);
store = result.progress;
assert.equal(learning.getStatus(store, 'english:hello', start + 4 * day), learning.STATUS.REVIEW_REQUIRED);
assert.deepEqual(learning.getDueSkillIds(store, start + 4 * day), ['english:hello']);
assert.equal(learning.summarize(store, start + 4 * day)[learning.STATUS.REVIEW_REQUIRED], 1);

const sameDay = learning.createStore({});
let sameDayResult = learning.recordAssessment(sameDay, 'skill', {assessmentId: 'a', total: 4, correct: 4, completedAt: start});
sameDayResult = learning.recordAssessment(sameDayResult.progress, 'skill', {assessmentId: 'b', total: 4, correct: 4, completedAt: start + 60 * 60 * 1000});
assert.equal(sameDayResult.status, learning.STATUS.PROFICIENT);

const weak = learning.recordAssessment({}, 'skill', {assessmentId: 'weak', total: 5, correct: 1, completedAt: start});
assert.equal(weak.status, learning.STATUS.PRACTICING);
const partial = learning.recordAssessment({}, 'skill', {assessmentId: 'partial', total: 5, correct: 2, completedAt: start});
assert.equal(partial.status, learning.STATUS.DEVELOPING);
assert.equal(learning.recordAssessment({}, 'skill', {assessmentId: 'bad', total: '5', correct: 4, completedAt: start}).recorded, false);
assert.equal(learning.recordAssessment({}, 'one-item', {assessmentId: 'single', total: 1, correct: 1, completedAt: start}).recorded, true);
let resetStreak = learning.recordAssessment({}, 'streak', {assessmentId: 'strong-1', total: 2, correct: 2, completedAt: start});
resetStreak = learning.recordAssessment(resetStreak.progress, 'streak', {assessmentId: 'weak-between', total: 2, correct: 0, completedAt: start + day});
resetStreak = learning.recordAssessment(resetStreak.progress, 'streak', {assessmentId: 'strong-2', total: 2, correct: 2, completedAt: start + 2 * day});
assert.equal(resetStreak.status, learning.STATUS.PROFICIENT);

const corrupt = {schemaVersion: 1, skills: {skill: {status: 'UNKNOWN', assessments: 'broken', attemptIds: 'broken'}}};
assert.equal(learning.recordAssessment(corrupt, 'skill', {assessmentId: 'safe', total: 2, correct: 2, completedAt: start}).recorded, true);

console.log('Learning engine progress and review checks passed.');

// A different curriculum or lesson version cannot inherit a prior strong streak.
const v1={curriculumVersion:'c1',lessonVersion:'l1'},v2={curriculumVersion:'c1',lessonVersion:'l2'};
let versioned=learning.recordAssessment({},'versioned',{...v1,assessmentId:'v1-a',total:10,correct:10,completedAt:start}).progress;
versioned=learning.recordAssessment(versioned,'versioned',{...v1,assessmentId:'v1-b',total:10,correct:10,completedAt:start+day}).progress;
assert.equal(learning.getRecord(versioned,'versioned').status,learning.STATUS.MASTERED);
const reset=learning.recordAssessment(versioned,'versioned',{...v2,assessmentId:'v2-a',total:10,correct:10,completedAt:start+2*day});
assert.equal(reset.status,learning.STATUS.PROFICIENT);
assert.equal(learning.getRecord(reset.progress,'versioned').assessmentCount,1);
assert.equal(learning.recordAssessment(reset.progress,'versioned',{...v2,assessmentId:'older',total:10,correct:0,completedAt:start}).recorded,false);
const newCurriculum=learning.markIntroduced(reset.progress,['versioned'],{curriculumVersion:'c2',lessonVersion:'l2'},start+3*day);
assert.equal(learning.getRecord(newCurriculum.progress,'versioned').assessmentCount,0);
assert.equal(learning.getRecord(newCurriculum.progress,'versioned').nextReviewAt,null);
assert.equal(learning.getRecord(newCurriculum.progress,'versioned').status,learning.STATUS.INTRODUCED);
