const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {validateCurriculum} = require('../curriculum-engine.js');

const curriculum = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../curriculum.json'), 'utf8'));
const baseline = validateCurriculum(curriculum);
assert.equal(baseline.valid, true, JSON.stringify(baseline.errors, null, 2));
assert.deepEqual(baseline.counts, {programs: 3, units: 35, lessons: 140, skills: 140});
assert.ok(baseline.warnings.some(item => item.code === 'QUESTION_BANK_MISSING'));

const duplicate = structuredClone(curriculum);
duplicate.skills.push(structuredClone(duplicate.skills[0]));
assert.ok(validateCurriculum(duplicate).errors.some(item => item.code === 'DUPLICATE_SKILL_ID'));

const badSkillReference = structuredClone(curriculum);
badSkillReference.units[0].lessons[0].skillIds = ['missing:skill'];
assert.ok(validateCurriculum(badSkillReference).errors.some(item => item.code === 'LESSON_SKILL_REFERENCE'));

const brokenPrerequisite = structuredClone(curriculum);
brokenPrerequisite.skills[0].prerequisiteSkillIds = ['unknown:skill'];
assert.ok(validateCurriculum(brokenPrerequisite).errors.some(item => item.code === 'PREREQUISITE_REFERENCE'));

const skillLessonMismatch = structuredClone(curriculum);
skillLessonMismatch.skills[0].lessonIds = [skillLessonMismatch.units[0].lessons[1].id];
assert.ok(validateCurriculum(skillLessonMismatch).errors.some(item => item.code === 'SKILL_LESSON_MISMATCH'));

const cyclic = structuredClone(curriculum);
cyclic.skills[0].prerequisiteSkillIds = [cyclic.skills[1].id];
cyclic.skills[1].prerequisiteSkillIds = [cyclic.skills[0].id];
assert.ok(validateCurriculum(cyclic).errors.some(item => item.code === 'SKILL_CYCLE'));

const invalidQuestion = structuredClone(curriculum);
invalidQuestion.units[0].lessons[0].questionBank = [{id: 'q1', prompt: 'Say hello', acceptedAnswers: []}];
assert.ok(validateCurriculum(invalidQuestion).errors.some(item => item.code === 'QUESTION_ANSWERS_INVALID'));

const validMathQuestion = structuredClone(curriculum);
validMathQuestion.programs[1].units[0].lessons[0].questionBank = [{id: 'math-q1', type: 'math', prompt: 'What is 2 + 3?', expression: '2 + 3', expectedAnswer: 5, acceptedAnswers: ['5']}];
assert.equal(validateCurriculum(validMathQuestion).valid, true);
validMathQuestion.programs[1].units[0].lessons[0].questionBank[0].expectedAnswer = 4;
assert.ok(validateCurriculum(validMathQuestion).errors.some(item => item.code === 'MATH_ANSWER_MISMATCH'));
validMathQuestion.programs[1].units[0].lessons[0].questionBank = [{id: 'math-q2', type: 'math', prompt: 'What is 3 x 2?', expression: '3 X 2', expectedAnswer: 6, acceptedAnswers: ['6']}];
assert.equal(validateCurriculum(validMathQuestion).valid, true);

const unsupportedActivity = structuredClone(curriculum);
unsupportedActivity.activityTypes = ['spoken_repeat'];
unsupportedActivity.units[0].lessons[0].activities = [{type: 'unregistered'}];
assert.ok(validateCurriculum(unsupportedActivity).errors.some(item => item.code === 'UNSUPPORTED_ACTIVITY_TYPE'));

const unregisteredStrand = structuredClone(curriculum);
unregisteredStrand.units[0].lessons[0].strand = 'science';
assert.ok(validateCurriculum(unregisteredStrand).errors.some(item => item.code === 'UNSUPPORTED_STRAND'));

const invalidVersion = structuredClone(curriculum);
invalidVersion.programs[0].units[0].lessons[0].version = 'latest';
assert.ok(validateCurriculum(invalidVersion).errors.some(item => item.code === 'LESSON_VERSION'));

const invalidHistory = structuredClone(curriculum);
invalidHistory.versionHistory[0].note = '';
assert.ok(validateCurriculum(invalidHistory).errors.some(item => item.code === 'VERSION_HISTORY_INVALID'));

console.log('Curriculum schema and reference checks passed.');
