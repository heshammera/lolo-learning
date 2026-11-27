(function attachAssessmentEngine(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.LoloAssessment = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createAssessmentEngine() {
  const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
  const ARABIC_NUMBER_WORDS = new Map([
    ['صفر', 0], ['zero', 0], ['واحد', 1], ['واحدة', 1], ['واحده', 1], ['one', 1],
    ['اتنين', 2], ['اثنين', 2], ['تنين', 2], ['two', 2], ['تلاتة', 3], ['ثلاثة', 3], ['three', 3],
    ['اربعة', 4], ['أربعة', 4], ['four', 4], ['خمسة', 5], ['خمسه', 5], ['five', 5],
    ['ستة', 6], ['سته', 6], ['six', 6], ['سبعة', 7], ['سبعه', 7], ['seven', 7],
    ['تمانية', 8], ['ثمانية', 8], ['تمانيه', 8], ['eight', 8], ['تسعة', 9], ['تسعه', 9], ['nine', 9],
    ['عشرة', 10], ['عشره', 10], ['ten', 10], ['حداشر', 11], ['أحد عشر', 11], ['eleven', 11],
    ['اتناشر', 12], ['اثنا عشر', 12], ['twelve', 12], ['تلتاشر', 13], ['thirteen', 13],
    ['اربعتاشر', 14], ['أربعة عشر', 14], ['fourteen', 14], ['خمستاشر', 15], ['fifteen', 15],
    ['ستاشر', 16], ['sixteen', 16], ['سبعتاشر', 17], ['seventeen', 17], ['تمنتاشر', 18], ['eighteen', 18],
    ['تسعتاشر', 19], ['nineteen', 19], ['عشرين', 20], ['twenty', 20],
  ].map(([word, number]) => [normalizeAnswer(word), number]));

  function normalizeAnswer(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    return String(value).normalize('NFKC').toLocaleLowerCase('en')
      .replace(/[٠-٩]/g, digit => String(ARABIC_DIGITS.indexOf(digit)))
      .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
      .replace(/[’‘`]/g, "'").replace(/[^\p{L}\p{N}']+/gu, ' ').trim().replace(/\s+/g, ' ');
  }

  function normalizeMathAnswer(value) {
    const normalized = normalizeAnswer(value);
    if (!normalized) return null;
    const values = normalized.split(' ').flatMap(word => {
      if (/^\d{1,2}$/.test(word)) return [Number(word)];
      return ARABIC_NUMBER_WORDS.has(word) ? [ARABIC_NUMBER_WORDS.get(word)] : [];
    });
    const distinct = [...new Set(values)];
    return distinct.length === 1 ? distinct[0] : null;
  }

  function makeId(prefix) {
    const uuid = globalThis.crypto?.randomUUID?.();
    return `${prefix}_${uuid || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`}`;
  }

  function create() {
    const attempts = new Map();

    function grade(input = {}) {
      const attemptId = typeof input.attemptId === 'string' && input.attemptId.trim() ? input.attemptId.trim() : makeId('attempt');
      const prior = attempts.get(attemptId);
      if (prior) return {...prior, duplicate: true};

      const questionId = typeof input.questionId === 'string' ? input.questionId : '';
      const acceptedAnswers = Array.isArray(input.acceptedAnswers) ? input.acceptedAnswers : [input.expected];
      const answers = acceptedAnswers.map(normalizeAnswer).filter(Boolean);
      const answer = normalizeAnswer(input.answer);
      let status = 'unresolved';
      let confidence = 0;
      let isCorrect = null;
      let score = null;

      if (input.kind === 'handwriting') {
        const quality = Number(input.quality);
        if (Number.isFinite(quality)) {
          score = Math.max(0, Math.min(100, Math.round(quality)));
          status = score >= 62 ? 'correct' : score >= 48 ? 'partial' : 'incorrect';
          confidence = 0.65;
          isCorrect = status === 'correct';
        }
      } else if (input.kind === 'math') {
        const expected = normalizeMathAnswer(input.expected);
        const actual = normalizeMathAnswer(input.answer);
        if (expected !== null && actual !== null) {
          isCorrect = expected === actual;
          status = isCorrect ? 'correct' : 'incorrect';
          confidence = 1;
        }
      } else if (answer && answers.length) {
        isCorrect = answers.includes(answer);
        status = isCorrect ? 'correct' : 'incorrect';
        confidence = 1;
      }

      const result = Object.freeze({
        questionId,
        attemptId,
        status,
        isCorrect,
        confidence,
        score,
        normalizedAnswer: answer,
        duplicate: false,
      });
      attempts.set(attemptId, result);
      return result;
    }

    return Object.freeze({grade, attemptCount: () => attempts.size});
  }

  function createAssessmentId() { return makeId('assessment'); }
  return Object.freeze({create, createAssessmentId, normalizeAnswer, normalizeMathAnswer});
});
