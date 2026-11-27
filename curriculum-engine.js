(function attachCurriculumEngine(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.LoloCurriculum = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCurriculumEngine() {
  const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
  function validateCurriculum(data) {
    const errors = [];
    const warnings = [];
    const issue = (list, code, path, message) => list.push({code, path, message});
    const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const strings = value => Array.isArray(value) && value.every(item => typeof item === 'string' && item.trim());

    if (!isObject(data)) return {valid: false, errors: [{code: 'ROOT_TYPE', path: '$', message: 'Curriculum root must be an object.'}], warnings};
    if (data.schemaVersion !== 2) issue(errors, 'SCHEMA_VERSION', '$.schemaVersion', 'Expected curriculum schema version 2.');
    if (typeof data.curriculumVersion !== 'string' || !VERSION.test(data.curriculumVersion)) issue(errors, 'CURRICULUM_VERSION', '$.curriculumVersion', 'Expected a semantic curriculum version such as 2.0.0.');
    if (typeof data.title !== 'string' || !data.title.trim()) issue(errors, 'TITLE_REQUIRED', '$.title', 'Curriculum title is required.');
    if (!Array.isArray(data.versionHistory) || !data.versionHistory.some(item => item?.version === data.curriculumVersion)) issue(errors, 'VERSION_HISTORY_MISSING', '$.versionHistory', 'Version history must include the current curriculum version.');
    if (Array.isArray(data.versionHistory)) {
      const versionIds = new Set();
      for (const [index, item] of data.versionHistory.entries()) {
        const path = `$.versionHistory[${index}]`;
        if (!isObject(item) || typeof item.version !== 'string' || !VERSION.test(item.version) || typeof item.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.date) || typeof item.note !== 'string' || !item.note.trim()) issue(errors, 'VERSION_HISTORY_INVALID', path, 'Version history entries need version, ISO date, and a note.');
        else if (versionIds.has(item.version)) issue(errors, 'DUPLICATE_CURRICULUM_VERSION', `${path}.version`, `Duplicate curriculum version: ${item.version}.`);
        if (item?.version) versionIds.add(item.version);
      }
    }
    if (!Array.isArray(data.units) || !Array.isArray(data.programs)) issue(errors, 'TRACKS_REQUIRED', '$', 'Foundation units and program tracks must be arrays.');
    if (!Array.isArray(data.subjects)) issue(errors, 'SUBJECTS_REQUIRED', '$.subjects', 'A subject registry is required.');
    if (!Array.isArray(data.strands) || data.strands.some(strand => typeof strand !== 'string' || !strand.trim())) issue(errors, 'STRANDS_REQUIRED', '$.strands', 'A strand registry is required for typed lesson strands.');
    if (!Array.isArray(data.skills)) issue(errors, 'SKILLS_REQUIRED', '$.skills', 'A skill registry is required.');

    const subjects = new Set();
    for (const [index, subject] of (Array.isArray(data.subjects) ? data.subjects : []).entries()) {
      const path = `$.subjects[${index}]`;
      if (!isObject(subject) || typeof subject.id !== 'string' || !subject.id.trim() || typeof subject.title !== 'string' || !subject.title.trim()) {
        issue(errors, 'SUBJECT_INVALID', path, 'Each subject needs a stable id and display title.');
        continue;
      }
      if (subjects.has(subject.id)) issue(errors, 'DUPLICATE_SUBJECT_ID', `${path}.id`, `Duplicate subject id: ${subject.id}.`);
      subjects.add(subject.id);
    }

    const programs = [
      {id: 'foundation', title: 'Foundation', units: Array.isArray(data.units) ? data.units : []},
      ...(Array.isArray(data.programs) ? data.programs : []),
    ];
    const programIds = new Set();
    const unitIds = new Set();
    const lessons = new Map();
    const lessonLocations = new Map();
    const questionIds = new Set();
    for (const [programIndex, program] of programs.entries()) {
      const programPath = programIndex === 0 ? '$.units' : `$.programs[${programIndex - 1}]`;
      if (!isObject(program) || typeof program.id !== 'string' || !program.id.trim() || typeof program.title !== 'string' || !program.title.trim()) {
        issue(errors, 'PROGRAM_INVALID', programPath, 'Each program needs a stable id and title.');
        continue;
      }
      if (programIds.has(program.id)) issue(errors, 'DUPLICATE_PROGRAM_ID', `${programPath}.id`, `Duplicate program id: ${program.id}.`);
      programIds.add(program.id);
      if (programIndex > 0 && program.subjectId && !subjects.has(program.subjectId)) issue(errors, 'SUBJECT_REFERENCE', `${programPath}.subjectId`, `Unknown subject id: ${program.subjectId}.`);
      if (!Array.isArray(program.units)) {
        issue(errors, 'UNITS_REQUIRED', `${programPath}.units`, 'Program units must be an array.');
        continue;
      }
      for (const [unitIndex, unit] of program.units.entries()) {
        const unitPath = `${programPath}.units[${unitIndex}]`;
        if (!isObject(unit) || typeof unit.id !== 'string' || !unit.id.trim() || typeof unit.title !== 'string' || !unit.title.trim() || !Array.isArray(unit.lessons)) {
          issue(errors, 'UNIT_INVALID', unitPath, 'Each unit needs an id, title, and lesson array.');
          continue;
        }
        if (unitIds.has(unit.id)) issue(errors, 'DUPLICATE_UNIT_ID', `${unitPath}.id`, `Duplicate unit id: ${unit.id}.`);
        unitIds.add(unit.id);
        for (const [lessonIndex, lesson] of unit.lessons.entries()) {
          const lessonPath = `${unitPath}.lessons[${lessonIndex}]`;
          if (!isObject(lesson) || typeof lesson.id !== 'string' || !lesson.id.trim()) {
            issue(errors, 'LESSON_ID_REQUIRED', `${lessonPath}.id`, 'Each lesson needs a stable id.');
            continue;
          }
          if (lessons.has(lesson.id)) issue(errors, 'DUPLICATE_LESSON_ID', `${lessonPath}.id`, `Duplicate lesson id: ${lesson.id}.`);
          lessons.set(lesson.id, lesson);
          lessonLocations.set(lesson.id, lessonPath);
          for (const field of ['focus', 'goal']) {
            if (typeof lesson[field] !== 'string' || !lesson[field].trim()) issue(errors, 'LESSON_FIELD_REQUIRED', `${lessonPath}.${field}`, `${field} is required.`);
          }
          if (typeof lesson.version !== 'string' || !VERSION.test(lesson.version)) issue(errors, 'LESSON_VERSION', `${lessonPath}.version`, 'Each lesson needs a semantic version.');
          if (typeof lesson.subjectId !== 'string' || !lesson.subjectId.trim()) issue(errors, 'LESSON_SUBJECT_REQUIRED', `${lessonPath}.subjectId`, 'Each lesson needs a subject id.');
          else if (Array.isArray(data.subjects) && !data.subjects.some(subject => subject?.id === lesson.subjectId)) issue(errors, 'LESSON_SUBJECT_REFERENCE', `${lessonPath}.subjectId`, `Unknown subject id: ${lesson.subjectId}.`);
          if (!Array.isArray(lesson.cards) || lesson.cards.some(card => !Array.isArray(card) || card.length < 2 || card.slice(0, 2).some(value => typeof value !== 'string' || !value.trim()))) {
            issue(errors, 'CARDS_INVALID', `${lessonPath}.cards`, 'Cards must contain an icon and a label.');
          }
          if (!isObject(lesson.board) || !Array.isArray(lesson.board.tokens) || lesson.board.tokens.some(token => !isObject(token) || typeof token.text !== 'string' || !token.text.trim())) {
            issue(errors, 'BOARD_TOKENS_INVALID', `${lessonPath}.board.tokens`, 'A lesson board needs tokens with non-empty text.');
          }
          if (!strings(lesson.skillIds) || !lesson.skillIds.length) issue(errors, 'LESSON_SKILLS_REQUIRED', `${lessonPath}.skillIds`, 'Each lesson must reference at least one skill id.');
          if (lesson.strand && (!Array.isArray(data.strands) || !data.strands.includes(lesson.strand))) issue(errors, 'UNSUPPORTED_STRAND', `${lessonPath}.strand`, `Unregistered strand: ${lesson.strand}.`);
          if (!Array.isArray(lesson.questionBank) || !lesson.questionBank.length) issue(warnings, 'QUESTION_BANK_MISSING', `${lessonPath}.questionBank`, 'No authored question bank; any current oral repeat activity is not an authored comprehension assessment.');
          else for (const [questionIndex, question] of lesson.questionBank.entries()) {
            const questionPath = `${lessonPath}.questionBank[${questionIndex}]`;
            if (!isObject(question) || typeof question.id !== 'string' || !question.id.trim() || typeof question.prompt !== 'string' || !question.prompt.trim()) {
              issue(errors, 'QUESTION_INVALID', questionPath, 'Each question needs an id and prompt.');
              continue;
            }
            if (questionIds.has(question.id)) issue(errors, 'DUPLICATE_QUESTION_ID', `${questionPath}.id`, `Duplicate question id: ${question.id}.`);
            questionIds.add(question.id);
            if (!Array.isArray(question.acceptedAnswers) || !question.acceptedAnswers.length || question.acceptedAnswers.some(answer => typeof answer !== 'string' || !answer.trim())) {
              issue(errors, 'QUESTION_ANSWERS_INVALID', `${questionPath}.acceptedAnswers`, 'Questions need one or more non-empty accepted answers.');
            }
            if (question.type === 'math') {
              const expression = typeof question.expression === 'string' ? question.expression.match(/^\s*(-?\d+(?:\.\d+)?)\s*([+\-×x÷/])\s*(-?\d+(?:\.\d+)?)\s*$/i) : null;
              if (!expression || !Number.isFinite(Number(question.expectedAnswer))) issue(errors, 'MATH_QUESTION_INVALID', questionPath, 'Math questions need a supported arithmetic expression and numeric expectedAnswer.');
              else {
                const left = Number(expression[1]); const right = Number(expression[3]);
                const operator = expression[2].toLowerCase();
                const expected = ({'+': left + right, '-': left - right, '×': left * right, x: left * right, '÷': left / right, '/': left / right})[operator];
                if (!Number.isFinite(expected) || expected !== Number(question.expectedAnswer)) issue(errors, 'MATH_ANSWER_MISMATCH', `${questionPath}.expectedAnswer`, 'The expected answer does not match the arithmetic expression.');
                if (!question.acceptedAnswers?.some(answer => Number(answer) === expected)) issue(errors, 'MATH_ACCEPTED_ANSWER_MISSING', `${questionPath}.acceptedAnswers`, 'Accepted answers must include the computed numeric answer.');
              }
            }
          }
          if (lesson.activities !== undefined) {
            if (!Array.isArray(lesson.activities)) issue(errors, 'ACTIVITIES_INVALID', `${lessonPath}.activities`, 'Activities must be an array.');
            else for (const [activityIndex, activity] of lesson.activities.entries()) {
              const activityPath = `${lessonPath}.activities[${activityIndex}]`;
              if (!isObject(activity) || typeof activity.type !== 'string' || !activity.type.trim()) issue(errors, 'ACTIVITY_INVALID', activityPath, 'Each activity needs a registered type.');
              else if (!Array.isArray(data.activityTypes) || !data.activityTypes.includes(activity.type)) issue(errors, 'UNSUPPORTED_ACTIVITY_TYPE', `${activityPath}.type`, `Activity type is not registered: ${activity.type}.`);
            }
          }
          if (!isObject(lesson.accessibility)) issue(warnings, 'ACCESSIBILITY_METADATA_MISSING', `${lessonPath}.accessibility`, 'Accessibility guidance has not been authored for this lesson yet.');
          if (!isObject(lesson.translations)) issue(warnings, 'TRANSLATIONS_MISSING', `${lessonPath}.translations`, 'Localized lesson text has not been authored yet.');
          if (!Number.isInteger(lesson.difficulty) || lesson.difficulty < 1 || lesson.difficulty > 5) issue(warnings, 'DIFFICULTY_UNSET', `${lessonPath}.difficulty`, 'A reviewed 1–5 difficulty rating has not been assigned.');
        }
      }
    }

    const skills = new Map();
    for (const [index, skill] of (Array.isArray(data.skills) ? data.skills : []).entries()) {
      const path = `$.skills[${index}]`;
      if (!isObject(skill) || typeof skill.id !== 'string' || !skill.id.trim() || typeof skill.title !== 'string' || !skill.title.trim() || typeof skill.subjectId !== 'string' || !skill.subjectId.trim() || !strings(skill.lessonIds) || !strings(skill.prerequisiteSkillIds)) {
        issue(errors, 'SKILL_INVALID', path, 'Each skill needs id, title, subjectId, lessonIds, and prerequisiteSkillIds.');
        continue;
      }
      if (skills.has(skill.id)) issue(errors, 'DUPLICATE_SKILL_ID', `${path}.id`, `Duplicate skill id: ${skill.id}.`);
      if (new Set(skill.lessonIds).size !== skill.lessonIds.length) issue(errors, 'DUPLICATE_SKILL_LESSON', `${path}.lessonIds`, 'A lesson may only be listed once per skill.');
      if (new Set(skill.prerequisiteSkillIds).size !== skill.prerequisiteSkillIds.length) issue(errors, 'DUPLICATE_PREREQUISITE', `${path}.prerequisiteSkillIds`, 'A prerequisite may only be listed once.');
      if (!subjects.has(skill.subjectId)) issue(errors, 'SKILL_SUBJECT_REFERENCE', `${path}.subjectId`, `Unknown subject id: ${skill.subjectId}.`);
      skills.set(skill.id, skill);
      for (const lessonId of skill.lessonIds) {
        if (!lessons.has(lessonId)) issue(errors, 'SKILL_LESSON_REFERENCE', `${path}.lessonIds`, `Unknown lesson id: ${lessonId}.`);
        else if (!Array.isArray(lessons.get(lessonId).skillIds) || !lessons.get(lessonId).skillIds.includes(skill.id)) issue(errors, 'SKILL_LESSON_MISMATCH', `${path}.lessonIds`, `Lesson ${lessonId} does not reference skill ${skill.id}.`);
      }
    }

    for (const [lessonId, lesson] of lessons) {
      const path = lessonLocations.get(lessonId);
      for (const skillId of Array.isArray(lesson.skillIds) ? lesson.skillIds : []) {
        const skill = skills.get(skillId);
        if (!skill) issue(errors, 'LESSON_SKILL_REFERENCE', `${path}.skillIds`, `Unknown skill id: ${skillId}.`);
        else if (!skill.lessonIds.includes(lessonId)) issue(errors, 'SKILL_LESSON_MISMATCH', `${path}.skillIds`, `Skill ${skillId} does not reference lesson ${lessonId}.`);
      }
    }

    const visiting = new Set();
    const visited = new Set();
    function visit(skillId, stack = []) {
      if (visiting.has(skillId)) {
        issue(errors, 'SKILL_CYCLE', `$.skills.${skillId}.prerequisiteSkillIds`, `Circular skill dependency: ${[...stack, skillId].join(' -> ')}.`);
        return;
      }
      if (visited.has(skillId)) return;
      const skill = skills.get(skillId);
      if (!skill) return;
      visiting.add(skillId);
      for (const prerequisiteId of skill.prerequisiteSkillIds) {
        if (!skills.has(prerequisiteId)) issue(errors, 'PREREQUISITE_REFERENCE', `$.skills.${skillId}.prerequisiteSkillIds`, `Unknown prerequisite skill id: ${prerequisiteId}.`);
        else visit(prerequisiteId, [...stack, skillId]);
      }
      visiting.delete(skillId);
      visited.add(skillId);
    }
    for (const skillId of skills.keys()) visit(skillId);

    return {valid: errors.length === 0, errors, warnings, counts: {programs: programIds.size, units: unitIds.size, lessons: lessons.size, skills: skills.size}};
  }

  return Object.freeze({validateCurriculum});
});
