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
    // Only accept a single unambiguous non-negative integer or a reviewed number phrase.
    // Do not extract a number from a sentence containing negation, a calculation, or guesses.
    if(typeof value==='number')return Number.isSafeInteger(value)&&value>=0&&value<=99?value:null;
    if(typeof value!=='string')return null;
    const raw=value.normalize('NFKC').trim();
    if(/[+\-−–×÷*/=<>.,٫٬]/u.test(raw.replace(/[.!؟?،]+$/u,'')))return null;
    const normalized=normalizeAnswer(raw);
    const parse=word=>/^\d{1,2}$/.test(word)?Number(word):ARABIC_NUMBER_WORDS.has(word)?ARABIC_NUMBER_WORDS.get(word):null;
    const exact=parse(normalized);
    if(exact!==null)return exact;
    // Optional simple counting nouns, not arbitrary trailing words.
    const nouns=new Set(['apple','apples','cookie','cookies','star','stars','fish','ball','balls','object','objects','item','items','تفاحه','تفاحات','نجمه','نجوم','سمكه','سمكات','كرات','كره','حاجات','اشياء','اقلام','قلم'].map(normalizeAnswer));
    const words=normalized.split(' ');
    if(words.length>=2&&nouns.has(words.at(-1)))return parse(words.slice(0,-1).join(' '));
    return null;
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
        const quality = input.quality;
        if (typeof quality==='number' && Number.isFinite(quality) && quality>=0 && quality<=100) {
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

    function createSpokenAssessment(lesson, limit = 5) {
      const rawTokens = Array.isArray(lesson?.board?.tokens) ? lesson.board.tokens : [];
      const tokens = [];
      const seen = new Set();
      for (const token of rawTokens) {
        const target = typeof token?.text === 'string' ? token.text.trim() : '';
        const normalized = normalizeAnswer(target);
        if (!normalized || normalized.length > 60 || seen.has(normalized)) continue;
        seen.add(normalized);
        tokens.push({target, acceptedAnswers: Array.isArray(token.acceptedAnswers) ? token.acceptedAnswers.filter(item => typeof item === 'string') : []});
      }
      if (!tokens.length) return {supported: false, reason: 'الدرس لا يحتوي على كلمات أو أرقام قابلة للاختبار.'};

      for (let index = tokens.length - 1; index > 0; index--) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [tokens[index], tokens[swapIndex]] = [tokens[swapIndex], tokens[index]];
      }
      const assessmentId = makeId('spoken');
      const questions = tokens.slice(0, Math.max(1, Math.min(5, Math.trunc(Number(limit) || 5)))).map((token, index) => ({
        questionId: `${assessmentId}:q${index + 1}`,
        target: token.target,
        acceptedAnswers: token.acceptedAnswers,
        kind: /^\d{1,2}$/.test(normalizeAnswer(token.target)) ? 'math' : 'spoken_repeat',
        prompt: `اسمعي وكرري بعد لولو: ${token.target}`,
        attempts: 0,
      }));
      return {supported: true, assessmentId, lessonId: String(lesson.id || ''), questions, currentIndex: 0, attempts: 0, results: [], responsesByQuestion: Object.create(null), responsesByAttempt: Object.create(null)};
    }

    function gradeSpokenResponse(assessment, questionId, answer, requestedAttemptId = '') {
      if (!assessment?.supported || !Array.isArray(assessment.questions)) return {recorded: false, reason: 'اختبار الصوت غير مهيأ.'};
      const suppliedAttemptId = typeof requestedAttemptId === 'string' ? requestedAttemptId.trim() : '';
      const priorAttempt = suppliedAttemptId && assessment.responsesByAttempt?.[suppliedAttemptId];
      if (priorAttempt) return {...priorAttempt, duplicate: true};
      const previous = assessment.responsesByQuestion?.[questionId];
      if (previous) return {...previous, duplicate: true};
      const question = assessment.questions[assessment.currentIndex];
      if (!question || question.questionId !== questionId) return {recorded: false, reason: 'السؤال لا يطابق السؤال الحالي.'};
      if (typeof answer !== 'string' || !answer.trim()) return {recorded: false, unresolved: true, reason: 'لم يصل كلام واضح من الطفلة.'};

      const attemptId = suppliedAttemptId || `${question.questionId}:attempt-${question.attempts + 1}`;
      question.attempts += 1;
      assessment.attempts += 1;
      const evaluation = grade({
        questionId: question.questionId,
        attemptId,
        kind: question.kind === 'math' ? 'math' : 'text',
        answer,
        expected: question.target,
        acceptedAnswers: question.acceptedAnswers.length ? question.acceptedAnswers : [question.target],
      });
      if (evaluation.status === 'unresolved') {
        const unresolved = {recorded: false, duplicate: false, unresolved: true, questionId: question.questionId, attemptId, reason: 'الإجابة غير واضحة، اطلب إعادة المحاولة.'};
        assessment.responsesByAttempt[attemptId] = unresolved;
        return unresolved;
      }

      const result = {
        recorded: true,
        duplicate: false,
        questionId: question.questionId,
        attemptId,
        question: question.prompt,
        answer: answer.trim(),
        correctAnswer: question.target,
        isCorrect: evaluation.isCorrect === true,
        status: evaluation.status,
        confidence: evaluation.confidence,
        questionNumber: assessment.currentIndex + 1,
      };
      assessment.responsesByQuestion[question.questionId] = result;
      assessment.responsesByAttempt[attemptId] = result;
      assessment.results.push(result);
      assessment.currentIndex += 1;
      result.totalQuestions = assessment.questions.length;
      result.complete = assessment.currentIndex >= assessment.questions.length;
      result.nextQuestion = assessment.questions[assessment.currentIndex] || null;
      return result;
    }

    return Object.freeze({grade, createSpokenAssessment, gradeSpokenResponse, attemptCount: () => attempts.size});
  }

  // Guidance is derived from the current lesson's recorded responses only.
  // No transcript, inferred ability, or cross-child history is returned.
  function lessonGuidance(events, hintLevel='gentle', mode='lesson') {
    if(mode!=='lesson'||!Array.isArray(events)||!events.length)return null;
    const recent=events.slice(-3);
    if(!recent.every(e=>e&&typeof e.is_correct==='boolean'))return null;
    let streak=0;
    for(let i=recent.length-1;i>=0&&recent[i].is_correct===false;i--)streak++;
    if(streak===0)return {kind:'continue',prompt:'شجعي المحاولة في جملة قصيرة ثم اسألي سؤالًا واحدًا من نفس الدرس، ما لم يكن الدرس قد انتهى.'};
    if(streak===1)return {kind:'hint',prompt:hintLevel==='guided'?'قسّمي نفس المطلوب إلى خطوة صغيرة واحدة وقدمي تلميحًا واضحًا دون إعطاء الإجابة؛ ثم انتظري.':'قدمي تلميحًا بسيطًا من الكلمات أو الصور الموجودة، ثم انتظري محاولة واحدة. لا تضيفي سؤالًا جديدًا.'};
    if(streak===2)return {kind:'example',prompt:'اشرحي الفكرة بمثال واحد أبسط من محتوى الدرس الحالي، وفي الماث اعتمدي فقط على المشهد المعروض فعليًا. لا تحسبي المثال كإجابة، ثم انتظري.'};
    return {kind:'offer-break',prompt:'اطمئنيها بلطف أن التعلم يحتاج وقتًا، واعرضي عليها راحة اختيارية أو محاولة أسهل. لا تضغطي عليها، وإذا طلبت التوقف استدعي request_learning_break فورًا.'};
  }
  function createAssessmentId() { return makeId('assessment'); }
  return Object.freeze({create, createAssessmentId, normalizeAnswer, normalizeMathAnswer, lessonGuidance});
});
