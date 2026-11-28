(function attachLearningEngine(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.LoloLearning = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createLearningEngine() {
  const STORE_VERSION = 1;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const STATUS = Object.freeze({
    NOT_STARTED: 'NOT_STARTED',
    INTRODUCED: 'INTRODUCED',
    PRACTICING: 'PRACTICING',
    DEVELOPING: 'DEVELOPING',
    PROFICIENT: 'PROFICIENT',
    MASTERED: 'MASTERED',
    REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  });
  const LABELS = Object.freeze({
    NOT_STARTED: 'لم تبدأ',
    INTRODUCED: 'تعرّفت عليها',
    PRACTICING: 'بتتدرّب على الترديد',
    DEVELOPING: 'محتاجة تدريب على الترديد',
    PROFICIENT: 'متقدمة في الترديد',
    MASTERED: 'متقنة ترديد محتوى اللوحة',
    REVIEW_REQUIRED: 'موعد مراجعة الترديد',
  });

  function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function validTime(value) {
    const time = typeof value === 'number' ? value : Date.parse(value);
    return Number.isFinite(time) ? time : null;
  }

  function createStore(raw) {
    if (isObject(raw) && raw.schemaVersion === STORE_VERSION && isObject(raw.skills)) return clone(raw);
    return {schemaVersion: STORE_VERSION, skills: {}};
  }

  function defaultSkill(skillId, metadata = {}) {
    return {
      skillId,
      status: STATUS.NOT_STARTED,
      attempts: 0,
      correct: 0,
      incorrect: 0,
      assessmentCount: 0,
      consecutiveStrongAssessments: 0,
      reviewIntervalDays: 0,
      introducedAt: null,
      lastPracticedAt: null,
      lastAssessmentAt: null,
      nextReviewAt: null,
      lastAssessmentId: null,
      curriculumVersion: metadata.curriculumVersion || null,
      lessonVersion: metadata.lessonVersion || null,
      attemptIds: [],
      assessments: [],
    };
  }

  function normalizeRecord(skillId, raw, metadata = {}) {
    const base = defaultSkill(skillId, metadata);
    if (!isObject(raw)) return base;
    const record = {...base, ...raw, skillId};
    record.attemptIds = Array.isArray(raw.attemptIds) ? raw.attemptIds.filter(id => typeof id === 'string').slice(-200) : [];
    record.assessments = Array.isArray(raw.assessments) ? raw.assessments.filter(item => isObject(item) && typeof item.assessmentId === 'string' && Number.isInteger(item.score) && typeof item.day === 'string').slice(-30) : [];
    for (const key of ['attempts', 'correct', 'incorrect', 'assessmentCount', 'consecutiveStrongAssessments', 'reviewIntervalDays']) {
      record[key] = Number.isFinite(raw[key]) && raw[key] >= 0 ? Math.floor(raw[key]) : 0;
    }
    if (!Object.values(STATUS).includes(record.status)) record.status = STATUS.NOT_STARTED;
    return record;
  }

  // Never carry prior evidence or review streaks across explicitly changed versions.
  function versionedRecord(skillId, raw, metadata = {}) {
    const record = normalizeRecord(skillId, raw, metadata);
    const cv = metadata.curriculumVersion || record.curriculumVersion;
    const lv = metadata.lessonVersion || record.lessonVersion;
    if (raw && ((metadata.curriculumVersion && record.curriculumVersion !== cv) ||
                (metadata.lessonVersion && record.lessonVersion !== lv))) {
      return defaultSkill(skillId, {curriculumVersion: cv, lessonVersion: lv});
    }
    return record;
  }

  function getRecord(store, skillId) {
    const safeStore = createStore(store);
    const record = safeStore.skills[skillId];
    return normalizeRecord(skillId, record);
  }

  function markIntroduced(store, skillIds, metadata = {}, at = Date.now()) {
    const next = createStore(store);
    if (!Array.isArray(skillIds) || !Number.isFinite(validTime(at))) return {progress: next, recorded: false};
    const timestamp = new Date(validTime(at)).toISOString();
    let recorded = false;
    for (const skillId of new Set(skillIds.filter(id => typeof id === 'string' && id.trim()))) {
      const prior = versionedRecord(skillId, next.skills[skillId], metadata);
      if (prior.status === STATUS.NOT_STARTED) prior.status = STATUS.INTRODUCED;
      prior.introducedAt ||= timestamp;
      prior.curriculumVersion = metadata.curriculumVersion || prior.curriculumVersion;
      prior.lessonVersion = metadata.lessonVersion || prior.lessonVersion;
      next.skills[skillId] = prior;
      recorded = true;
    }
    return {progress: next, recorded};
  }

  function recordResponse(store, skillId, evidence = {}) {
    const next = createStore(store);
    if (typeof skillId !== 'string' || !skillId.trim() || typeof evidence.attemptId !== 'string' || !evidence.attemptId.trim() || typeof evidence.questionId !== 'string' || !evidence.questionId.trim() || typeof evidence.isCorrect !== 'boolean') {
      return {progress: next, recorded: false, reason: 'Evidence needs skill, question, attempt, and a boolean result.'};
    }
    if (typeof skillId !== 'string' || !skillId.trim()) return {progress: next, recorded: false, reason: 'Skill id is required.'};
    const record = versionedRecord(skillId, next.skills[skillId], evidence);
    if (record.attemptIds.includes(evidence.attemptId)) return {progress: next, recorded: false, duplicate: true};
    const at = validTime(evidence.at) ?? Date.now();
    record.status = STATUS.PRACTICING;
    record.attempts = (Number(record.attempts) || 0) + 1;
    record[evidence.isCorrect ? 'correct' : 'incorrect'] = (Number(record[evidence.isCorrect ? 'correct' : 'incorrect']) || 0) + 1;
    record.lastPracticedAt = new Date(at).toISOString();
    record.curriculumVersion = evidence.curriculumVersion || record.curriculumVersion;
    record.lessonVersion = evidence.lessonVersion || record.lessonVersion;
    record.attemptIds = [...(Array.isArray(record.attemptIds) ? record.attemptIds : []), evidence.attemptId].slice(-200);
    next.skills[skillId] = record;
    return {progress: next, recorded: true, status: record.status};
  }

  function recordAssessment(store, skillId, evidence = {}) {
    const next = createStore(store);
    const total = evidence.total;
    const correct = evidence.correct;
    const completedAt = validTime(evidence.completedAt);
    if (typeof skillId !== 'string' || !skillId.trim() || typeof evidence.assessmentId !== 'string' || !evidence.assessmentId.trim() || !Number.isInteger(total) || total < 1 || !Number.isInteger(correct) || correct < 0 || correct > total || completedAt === null) {
      return {progress: next, recorded: false, reason: 'Assessment evidence is incomplete or invalid.'};
    }
    const record = versionedRecord(skillId, next.skills[skillId], evidence);
    if (record.assessments.some(item => item.assessmentId === evidence.assessmentId)) return {progress: next, recorded: false, duplicate: true, status: record.status};

    if (record.lastAssessmentAt && completedAt < validTime(record.lastAssessmentAt)) return {progress: next, recorded: false, reason: 'Out-of-order assessment.'};
    const score = Math.round(correct / total * 100);
    const day = new Date(completedAt).toISOString().slice(0, 10);
    const earlierStrongSession = record.consecutiveStrongAssessments > 0 && record.assessments.some(item =>
      item.score >= 85 && item.day < day &&
      (!record.curriculumVersion || item.curriculumVersion === record.curriculumVersion) &&
      (!record.lessonVersion || item.lessonVersion === record.lessonVersion));
    const priorInterval = Number(record.reviewIntervalDays) || 0;
    let status;
    let intervalDays = 1;
    let strongCount = score >= 85 ? (Number(record.consecutiveStrongAssessments) || 0) + 1 : 0;

    if (score >= 85 && earlierStrongSession) {
      status = STATUS.MASTERED;
      intervalDays = record.status === STATUS.MASTERED ? Math.min(Math.max(3, priorInterval * 2), 30) : 3;
    } else if (score >= 75) {
      status = STATUS.PROFICIENT;
      intervalDays = 1;
    } else if (score >= 40) {
      status = STATUS.DEVELOPING;
      intervalDays = 1;
    } else {
      status = STATUS.PRACTICING;
      intervalDays = 1;
    }
    if (score < 85) strongCount = 0;

    const assessment = {
      assessmentId: evidence.assessmentId,
      curriculumVersion: evidence.curriculumVersion || record.curriculumVersion || null,
      lessonVersion: evidence.lessonVersion || record.lessonVersion || null,
      correct,
      total,
      score,
      day,
      completedAt: new Date(completedAt).toISOString(),
    };
    record.status = status;
    record.assessmentCount = (Number(record.assessmentCount) || 0) + 1;
    record.consecutiveStrongAssessments = strongCount;
    record.reviewIntervalDays = intervalDays;
    record.lastAssessmentAt = assessment.completedAt;
    record.lastPracticedAt = assessment.completedAt;
    record.nextReviewAt = new Date(completedAt + intervalDays * DAY_MS).toISOString();
    record.lastAssessmentId = evidence.assessmentId;
    record.curriculumVersion = evidence.curriculumVersion || record.curriculumVersion;
    record.lessonVersion = evidence.lessonVersion || record.lessonVersion;
    record.assessments = [...(Array.isArray(record.assessments) ? record.assessments : []), assessment].slice(-30);
    next.skills[skillId] = record;
    return {progress: next, recorded: true, score, status, intervalDays, nextReviewAt: record.nextReviewAt, separatedStrongSessions: earlierStrongSession};
  }

  function getStatus(store, skillId, now = Date.now()) {
    const record = getRecord(store, skillId);
    const nowMs = validTime(now) ?? Date.now();
    if (record.nextReviewAt && validTime(record.nextReviewAt) !== null && validTime(record.nextReviewAt) <= nowMs && record.status !== STATUS.NOT_STARTED && record.status !== STATUS.INTRODUCED) return STATUS.REVIEW_REQUIRED;
    return Object.values(STATUS).includes(record.status) ? record.status : STATUS.NOT_STARTED;
  }

  function getStatusLabel(status) { return LABELS[status] || LABELS.NOT_STARTED; }

  function getDueSkillIds(store, now = Date.now()) {
    const safeStore = createStore(store);
    return Object.keys(safeStore.skills).filter(skillId => getStatus(safeStore, skillId, now) === STATUS.REVIEW_REQUIRED)
      .sort((a, b) => Date.parse(safeStore.skills[a].nextReviewAt) - Date.parse(safeStore.skills[b].nextReviewAt));
  }

  function summarize(store, now = Date.now()) {
    const safeStore = createStore(store);
    const counts = Object.fromEntries(Object.values(STATUS).map(status => [status, 0]));
    for (const skillId of Object.keys(safeStore.skills)) counts[getStatus(safeStore, skillId, now)] += 1;
    return counts;
  }

  return Object.freeze({
    STATUS,
    STORE_VERSION,
    createStore,
    defaultSkill,
    getRecord,
    markIntroduced,
    recordResponse,
    recordAssessment,
    getStatus,
    getStatusLabel,
    getDueSkillIds,
    summarize,
  });
});
