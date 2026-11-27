(() => {
  const VERSION = 1;
  const SCOPES = ['lesson', 'unit', 'curriculum'];
  function select(lessons, spec) {
    if (!SCOPES.includes(spec?.scope) || typeof spec.programId !== 'string') return [];
    return lessons.filter(l => l.programId === spec.programId &&
      (spec.scope === 'curriculum' || l.unitId === spec.unitId) &&
      (spec.scope !== 'lesson' || l.id === spec.lessonId));
  }
  function build(lessons, spec, mastered = new Set(), version = '') {
    const selected = select(lessons, spec);
    if (!selected.length || new Set(selected.map(l => l.id)).size !== selected.length ||
        (spec.scope === 'lesson' && selected.length !== 1)) return null;
    const skipped = spec.scope !== 'lesson' && spec.skipPreviouslyCompleted === true
      ? selected.filter(l => mastered.has(l.id)).map(l => l.id) : [];
    const ids = selected.map(l => l.id).filter(id => !skipped.includes(id));
    return {schemaVersion: VERSION, scope: spec.scope, programId: spec.programId,
      unitId: spec.scope === 'curriculum' ? null : spec.unitId,
      lessonId: spec.scope === 'lesson' ? spec.lessonId : null,
      curriculumVersion: version, lessonIds: ids, skippedLessonIds: skipped,
      currentIndex: 0, status: ids.length ? 'ready' : 'completed'};
  }
  function validate(path, lessons, version) {
    if (!path || path.schemaVersion !== VERSION || path.curriculumVersion !== version ||
        !Array.isArray(path.lessonIds) || !Array.isArray(path.skippedLessonIds) ||
        !Number.isInteger(path.currentIndex) || path.currentIndex < 0 ||
        path.currentIndex > path.lessonIds.length) return false;
    const selected = select(lessons, path).map(l => l.id);
    const skipped = new Set(path.skippedLessonIds);
    if (!selected.length || skipped.size !== path.skippedLessonIds.length ||
        path.skippedLessonIds.some(id => !selected.includes(id)) ||
        (path.scope === 'lesson' && (selected.length !== 1 || skipped.size))) return false;
    const expected = selected.filter(id => !skipped.has(id));
    return expected.length === path.lessonIds.length &&
      expected.every((id, i) => id === path.lessonIds[i]) &&
      path.status === (path.currentIndex === expected.length ? 'completed' : 'ready');
  }
  function current(path) { return path?.lessonIds?.[path.currentIndex] || null; }
  function advance(path, lessonId) {
    if (!path || path.status !== 'ready' || !lessonId || current(path) !== lessonId) return null;
    const currentIndex = path.currentIndex + 1;
    return {...path, currentIndex, status: currentIndex === path.lessonIds.length ? 'completed' : 'ready'};
  }
  // Pure transition decision, shared by the runtime and deterministic tests.
  function transition(state) {
    if (!state.active || !state.sameCompletion) return 'ignore';
    if (state.hidden || state.now >= state.deadline) return 'pause';
    if (state.rewardActive) return 'wait';
    const quiet = !state.modelSpeaking && !state.audioPlaying && !state.queuedAudio &&
      state.now - state.lastOutputAt >= 800;
    if (state.now - state.armedAt >= 1600 && quiet) return state.nextLessonId ? 'advance' : 'complete';
    return state.now - state.armedAt >= 12000 ? 'pause' : 'wait';
  }
  function mayRecordTurn(turnId, gradedTurnId) {
    return Number.isInteger(turnId) && turnId > 0 && turnId !== gradedTurnId;
  }
  const api = Object.freeze({build, validate, current, advance, transition, mayRecordTurn});
  if (typeof window !== 'undefined') window.LoloLearningPath = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
