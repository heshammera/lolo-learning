const $ = selector => document.querySelector(selector);
if (localStorage.getItem('lolo-welcome-tour-v1-complete') === 'true' && localStorage.getItem('lolo-selected-program')) $('#app')?.classList.add('ready');

let course = null;
let currentLesson = null;
let mastered = new Set(JSON.parse(localStorage.getItem('lolo-mastered') || '[]'));
let lessonExcellence = JSON.parse(localStorage.getItem('lolo-lesson-excellence') || '{}');
let testResults = JSON.parse(localStorage.getItem('lolo-test-results') || '{}');
let traceResults = JSON.parse(localStorage.getItem('lolo-trace-results') || '{}');
let writingPathResults = JSON.parse(localStorage.getItem('lolo-writing-path-results') || '{}');
let writingPathOverrides = JSON.parse(localStorage.getItem('lolo-writing-path-overrides') || '{}');
let traceSpeechRequestId = 0;
let traceSpeechAudio = null;
let lessonStats = JSON.parse(localStorage.getItem('lolo-lesson-stats') || '{}');
const DEFAULT_PARENT_SETTINGS = {sessionMinutes: 10, speechPace: 'slow', hintLevel: 'gentle', repeatWords: true, rewardEnabled: true, rewardSeconds: 9, learningPath: 'selected'};
let parentSettings = (() => { try { return {...DEFAULT_PARENT_SETTINGS, ...JSON.parse(localStorage.getItem('lolo-parent-settings') || '{}')}; } catch { return {...DEFAULT_PARENT_SETTINGS}; } })();
let sessionMode = 'lesson';
let activeAnswerEvents = [];
let answerPending = false;
let pendingChildAnswer = '';
let pendingTutorFeedback = '';
let answerTurnId = 0;
let gradedAnswerTurnId = 0;
let activeRewardGame = null;
let rewardFollowUp = null;
let lessonWasMasteredAtStart = false;
let replayHonoredThisSession = false;
let mathInteractionTimer = null;
let completionFollowUpTimer = null;
let completionFollowUpPending = false;
let sessionLimitTimer = null;
let lastTutorOutputAt = 0;
let socket = null;
let realtimePeer = null;
let realtimeChannel = null;
let remoteAudio = null;
let activeProvider = null;
let mathScene = null;
let micStream = null;
let audioContext = null;
let micSource = null;
let audioWorklet = null;
let isStarting = false;
let isActive = false;
let setupHandshake = null;
let modelSpeaking = false;
let nextAudioTime = 0;
const playingSources = new Set();
let welcomeStep = 0;
const welcomeAudioCache = new Map();

function allLessons() {
  if (!course) return [];
  const programs = [
    {id: 'foundation', title: 'تأسيس من الصفر', units: course.units},
    ...(course.programs || []),
  ];
  return programs.flatMap(program => program.units.flatMap(unit => unit.lessons.map(lesson => ({
    ...lesson,
    programId: program.id,
    programTitle: program.title,
    unitTitle: unit.title,
    unitId: unit.id,
  }))));
}

function nextLesson() {
  const selectedProgram = localStorage.getItem('lolo-path-program') || localStorage.getItem('lolo-selected-program');
  const all = allLessons();
  if (parentSettings.learningPath === 'foundation-first') {
    const foundationLesson = all.find(lesson => lesson.programId === 'foundation' && !mastered.has(lesson.id));
    if (foundationLesson) return foundationLesson;
  }
  const scopedLessons = selectedProgram ? all.filter(lesson => lesson.programId === selectedProgram) : all;
  const lessons = scopedLessons.length ? scopedLessons : all;
  const firstUnmastered = lessons.find(lesson => !mastered.has(lesson.id));
  if (firstUnmastered) return firstUnmastered;
  return null;
}

function lessonAfterCurrent() {
  const lessons = allLessons().filter(lesson => lesson.programId === currentLesson?.programId);
  const currentIndex = lessons.findIndex(lesson => lesson.id === currentLesson?.id);
  if (currentIndex < 0) return lessons.find(lesson => !mastered.has(lesson.id)) || null;
  const next = lessons.slice(currentIndex + 1).find(lesson => !mastered.has(lesson.id));
  if (next) return next;
  if (parentSettings.learningPath === 'foundation-first' && currentLesson?.programId === 'foundation') {
    const selectedProgram = localStorage.getItem('lolo-path-program') || localStorage.getItem('lolo-selected-program');
    return allLessons().find(lesson => lesson.programId === selectedProgram && !mastered.has(lesson.id)) || null;
  }
  return null;
}

function programList() {
  return [
    {id: 'foundation', title: 'تأسيس من الصفر', curriculumLabel: 'تأسيس من الصفر', gradeId: 'foundation', gradeLabel: 'مرحلة التأسيس', units: course?.units || []},
    ...(course?.programs || []),
  ];
}

function gradeList() {
  const grades = new Map();
  for (const program of programList()) {
    const id = program.gradeId || 'grade-1';
    const label = program.gradeLabel || (program.title.match(/الصف\s+([^·]+)/)?.[1]?.trim() ? `الصف ${program.title.match(/الصف\s+([^·]+)/)[1].trim()}` : 'صف دراسي آخر');
    grades.set(id, {id, label});
  }
  return [...grades.values()];
}

function fillSelect(select, options, valueFor, labelFor) {
  select.replaceChildren();
  for (const item of options) {
    const option = document.createElement('option');
    option.value = valueFor(item);
    option.textContent = labelFor(item);
    select.appendChild(option);
  }
}

function fillGradeSelect(select, selectedId, placeholder = false) {
  fillSelect(select, gradeList(), item => item.id, item => item.label);
  if (placeholder) {
    const option = document.createElement('option'); option.value = ''; option.textContent = 'اختاري الصف';
    select.prepend(option);
  }
  select.value = selectedId || '';
}

function syncWelcomePrograms(gradeId, selectedProgramId = '') {
  const select = $('#welcomeProgramSelect');
  const choices = programList().filter(program => (program.gradeId || 'grade-1') === gradeId);
  select.replaceChildren();
  const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = gradeId ? 'اختاري المنهج' : 'اختاري الصف الأول'; select.appendChild(placeholder);
  for (const program of choices) {
    const option = document.createElement('option'); option.value = program.id; option.textContent = program.curriculumLabel || program.title; select.appendChild(option);
  }
  select.disabled = !gradeId || !choices.length;
  select.value = choices.some(item => item.id === selectedProgramId) ? selectedProgramId : '';
  $('#welcomeStart').disabled = !select.value;
}

function showWelcomeStep(step) {
  welcomeStep = Math.max(0, Math.min(2, step));
  const labels = ['أهلاً وسهلاً', 'طريقة اللعب', 'اختيار الرحلة'];
  for (let index = 0; index < 3; index++) {
    const slide = $(`#welcomeSlide${index}`);
    slide.hidden = index !== welcomeStep;
    slide.classList.toggle('active', index === welcomeStep);
  }
  $('#welcomeStepLabel').textContent = labels[welcomeStep];
  $('#welcomeProgressFill').style.width = `${(welcomeStep + 1) / 3 * 100}%`;
  $('#welcomeCurriculum').hidden = welcomeStep !== 2;
  $('#welcomeNext').hidden = welcomeStep === 2;
  $('#welcomeStart').hidden = welcomeStep !== 2;
  $('#welcomeSkip').hidden = welcomeStep === 2;
  $('#welcomeError').textContent = '';
  $('#welcomeAudioStatus').textContent = '';
  $('#welcomeAudioStatus').classList.remove('error');
  const audio = $('#welcomeAudio');
  audio.pause();
  audio.controls = false;
  audio.hidden = true;
  for (const button of document.querySelectorAll('.welcome-audio')) {
    button.textContent = button.dataset.audioStep === 'welcome' ? '🔊 اسمعي ترحيب لولو' : button.dataset.audioStep === 'howto' ? '🔊 اسمعي طريقة اللعب' : '🔊 اسمعي شرح الاختيار';
  }
}

async function playWelcomeNarration(step, button) {
  const audio = $('#welcomeAudio');
  if (!audio.paused) {
    audio.pause();
    button.textContent = '▶️ كمّلي سماع لولو';
    return;
  }
  button.disabled = true;
  let mediaUrl = welcomeAudioCache.get(step);
  $('#welcomeAudioStatus').classList.remove('error');
  $('#welcomeAudioStatus').textContent = 'لولو بتحضّر صوتها...';
  try {
    if (!mediaUrl) {
      const response = await fetch('/api/onboarding-audio', {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({step}),
      });
      const data = await response.json();
      if (!response.ok || !data.audio) throw new Error(data.error || 'الصوت مش جاهز دلوقتي.');
      const bytes = Uint8Array.from(atob(data.audio), character => character.charCodeAt(0));
      mediaUrl = URL.createObjectURL(new Blob([bytes], {type: data.mimeType || 'audio/wav'}));
      welcomeAudioCache.set(step, mediaUrl);
    }
    if (step !== ['welcome', 'howto', 'course'][welcomeStep]) return;
    audio.controls = false;
    audio.hidden = true;
    audio.src = mediaUrl;
    await audio.play();
    button.textContent = '⏸️ وقّفي لولو';
    $('#welcomeAudioStatus').textContent = 'لولو بتكلمك دلوقتي 💛';
  } catch (error) {
    if (mediaUrl) {
      audio.src = mediaUrl;
      audio.controls = true;
      audio.hidden = false;
      $('#welcomeAudioStatus').textContent = 'الصوت جاهز؛ اضغطي ▶️ في المشغّل لو ما بدأش تلقائيًا.';
    } else {
      $('#welcomeAudioStatus').textContent = error.message || 'الصوت مش جاهز دلوقتي، جربي تاني.';
    }
    $('#welcomeAudioStatus').classList.add('error');
  } finally {
    button.disabled = false;
  }
}

function refreshLessonPicker(programId, unitId, requestedGradeId = '') {
  const programs = programList();
  const savedProgram = programs.find(item => item.id === programId) || programs.find(item => item.id === localStorage.getItem('lolo-selected-program'));
  const gradeId = requestedGradeId || savedProgram?.gradeId || localStorage.getItem('lolo-grade-id') || programs[0]?.gradeId;
  fillGradeSelect($('#gradeSelect'), gradeId);
  localStorage.setItem('lolo-grade-id', gradeId || '');
  const gradePrograms = programs.filter(item => (item.gradeId || 'grade-1') === gradeId);
  fillSelect($('#trackSelect'), gradePrograms, item => item.id, item => item.curriculumLabel || item.title);
  const program = gradePrograms.find(item => item.id === programId) || gradePrograms.find(item => item.id === localStorage.getItem('lolo-selected-program')) || gradePrograms[0];
  if (!program) return;
  $('#trackSelect').value = program.id;
  localStorage.setItem('lolo-selected-program', program.id);
  syncWelcomePrograms(gradeId, program.id);
  fillSelect($('#unitSelect'), program.units, unit => unit.id, unit => unitProgressLabel(unit));
  const unit = program.units.find(item => item.id === unitId) || program.units[0];
  if (!unit) return;
  $('#unitSelect').value = unit.id;
  renderUnitSummary(unit);
  renderLessonChoices(unit);
  renderProgramTests(program);
}

function renderLessonChoices(unit) {
  const list = $('#lessonChoices');
  list.replaceChildren();
  const icons = {math: '🔢', phonics: '🔊', grammar: '🧩', speaking: '🗣️', review: '⭐'};
  for (const lesson of unit.lessons) {
    const row = document.createElement('div');
    row.className = 'lesson-choice';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lesson-choice-main';
    button.setAttribute('aria-pressed', String(lesson.id === currentLesson?.id));
    const icon = document.createElement('span');
    icon.className = 'lesson-choice-icon';
    icon.textContent = icons[lesson.strand] || '🌱';
    const title = document.createElement('span');
    title.className = 'lesson-choice-title';
    title.textContent = lesson.title || lesson.focus;
    const meta = document.createElement('span');
    meta.className = 'lesson-choice-meta';
    meta.textContent = lesson.strand === 'math' ? 'ماث وأعداد بالصور' : lesson.strand === 'phonics' ? 'أصوات وفونكس' : lesson.strand === 'grammar' ? 'جرامر بالمواقف' : lesson.strand === 'review' ? 'مراجعة' : 'كلام وصور';
    const mark = document.createElement('span');
    mark.className = 'lesson-choice-mark';
    const stats = lessonStats[lesson.id] || {correct: 0, wrong: 0};
    const total = stats.correct + stats.wrong;
    const percent = total ? Math.round(stats.correct / total * 100) : null;
    const honors = Number(lessonExcellence[lesson.id]) || 0;
    mark.textContent = mastered.has(lesson.id) ? `✅ تم${honors ? ` · 🏅 ${honors}` : ''}` : total ? `${encouragementMark(percent)} ${percent}%` : '🌱 لسه';
    meta.textContent += total ? ` · ${stats.correct} صح · ${stats.wrong} غلط · ${percent}%` : '';
    button.append(icon, title, meta, mark);
    button.onclick = () => chooseLesson(lesson.id, 'lesson');
    row.append(button);
    const history = Array.isArray(stats.history) ? stats.history : [];
    if (history.length || total) {
      row.classList.add('has-history');
      const details = document.createElement('details');
      details.className = 'lesson-answer-history';
      const summary = document.createElement('summary');
      summary.textContent = `تفاصيل الإجابات · ${total}`;
      const list = document.createElement('ul');
      const untrackedCorrect = Math.max(0, (Number(stats.correct) || 0) - history.filter(item => item.is_correct).length);
      const untrackedWrong = Math.max(0, (Number(stats.wrong) || 0) - history.filter(item => !item.is_correct).length);
      if (untrackedCorrect || untrackedWrong) {
        const earlier = document.createElement('li');
        earlier.className = untrackedWrong ? 'is-wrong' : 'is-correct';
        earlier.textContent = `محاولات سابقة: ${untrackedCorrect} صح · ${untrackedWrong} غلط (تفاصيل الإجابات القديمة غير متاحة)`;
        list.appendChild(earlier);
      }
      for (const attempt of history.slice(-30).reverse()) {
        const item = document.createElement('li');
        item.className = attempt.is_correct ? 'is-correct' : 'is-wrong';
        const mark = document.createElement('b');
        mark.textContent = attempt.is_correct ? '✓ صح' : '× محتاجة محاولة تانية';
        const answer = document.createElement('span');
        answer.textContent = `الإجابة: ${attempt.answer || 'غير مسجلة'}`;
        const mode = document.createElement('small');
        mode.textContent = attempt.mode === 'test' ? 'اختبار' : 'درس';
        item.append(mark, answer, mode);
        list.appendChild(item);
      }
      details.append(summary, list);
      row.appendChild(details);
    }
    list.appendChild(row);
  }
}

function encouragementMark(percent) {
  if (percent >= 90) return '🏆';
  if (percent > 75) return '🌟';
  if (percent >= 50) return '🙂';
  if (percent >= 25) return '🌱';
  if (percent > 0) return '🐣';
  return '💪';
}

function unitTotals(unit) {
  const totals = {correct: 0, wrong: 0, mastered: 0, honors: 0, lessons: unit.lessons.length};
  for (const lesson of unit.lessons) {
    const stats = lessonStats[lesson.id] || {};
    totals.correct += Number(stats.correct) || 0;
    totals.wrong += Number(stats.wrong) || 0;
    if (mastered.has(lesson.id)) totals.mastered++;
    totals.honors += Number(lessonExcellence[lesson.id]) || 0;
  }
  return totals;
}

function unitProgressLabel(unit) {
  const totals = unitTotals(unit);
  const total = totals.correct + totals.wrong;
  const percent = total ? `${Math.round(totals.correct / total * 100)}% صح` : 'لسه';
  return `${unit.title} · ${totals.mastered}/${totals.lessons} تم · ${percent}${totals.honors ? ` · 🏅 ${totals.honors} تفوق` : ''}`;
}

function renderUnitSummary(unit) {
  const totals = unitTotals(unit);
  const total = totals.correct + totals.wrong;
  const percent = total ? Math.round(totals.correct / total * 100) : null;
  $('#unitSummary').textContent = total
    ? `القسم ده: ${totals.mastered} من ${totals.lessons} دروس تمّت · ${percent}% إجابات صح · ${totals.wrong} غلط${totals.honors ? ` · 🏅 ${totals.honors} تفوق` : ''}`
    : `القسم ده: ${totals.mastered} من ${totals.lessons} دروس تمّت · لسه مفيش إجابات مسجلة`;
  $('#unitSummary').classList.toggle('unit-summary-has-score', total > 0);
}

function renderProgramTests(program) {
  renderWritingPath(program);
  const root = $('#programTests');
  root.replaceChildren();
  for (const unit of program.units) {
    const group = document.createElement('section');
    group.className = 'test-unit';
    const heading = document.createElement('h3');
    heading.textContent = unitProgressLabel(unit);
    group.appendChild(heading);
    for (const lesson of unit.lessons) {
      const row = document.createElement('div');
      row.className = 'test-choice';
      const label = document.createElement('span');
      label.className = 'test-choice-title';
      label.textContent = lesson.title || lesson.focus;
      const result = testResults[lesson.id];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'lesson-test-button';
      button.textContent = result ? `${result.passed ? '🏆' : '💪'} ${Math.round(result.correct / result.total * 100)}% · ${result.correct}/${result.total}` : 'ابدئي الاختبار';
      button.setAttribute('aria-label', `اختبار ${lesson.title || lesson.focus}`);
      button.onclick = () => chooseLesson(lesson.id, 'test');
      const traceResult = traceResults[lesson.id];
      const targets = traceTargets(lesson);
      if (targets.length) {
        const traceButton = document.createElement('button');
        traceButton.type = 'button';
        traceButton.className = 'trace-test-button';
        traceButton.textContent = traceResult ? `✍️ ${traceResult.percent}%` : '✍️ كتابة';
        traceButton.setAttribute('aria-label', `اختبار كتابة باللمس ${lesson.title || lesson.focus}`);
        traceButton.onclick = () => startTraceTest(lesson.id);
        row.append(label, button, traceButton);
      } else row.append(label, button);
      group.appendChild(row);
      if (traceResult) {
        const traceDetails = document.createElement('details');
        traceDetails.className = 'test-details trace-details';
        const traceSummary = document.createElement('summary');
        traceSummary.textContent = `تفاصيل الكتابة · ${traceResult.percent}% · ${traceResult.attempts} محاولة`;
        traceDetails.appendChild(traceSummary);
        const traceScores = document.createElement('p');
        traceScores.textContent = (traceResult.scores || []).map((item, index) => `${index + 1}. ${item.value}: ${item.score}%`).join(' · ');
        traceDetails.appendChild(traceScores);
        group.appendChild(traceDetails);
      }
      if (result) {
        const details = document.createElement('details');
        details.className = 'test-details';
        const summary = document.createElement('summary');
        summary.textContent = 'عرض إجابات الاختبار';
        details.appendChild(summary);
        const attempts = result.history?.length ? result.history : [result];
        if (attempts.some(attempt => Array.isArray(attempt.questionResults) && attempt.questionResults.length)) {
          for (const [attemptIndex, attempt] of attempts.entries()) {
            const attemptDetails = document.createElement('details');
            attemptDetails.className = 'test-attempt';
            const attemptSummary = document.createElement('summary');
            const attemptPercent = Math.round(attempt.correct / attempt.total * 100);
            const firstAttemptNumber = Math.max(1, (result.attempts || attempts.length) - attempts.length + 1);
            attemptSummary.textContent = `المحاولة ${firstAttemptNumber + attemptIndex} · ${attemptPercent}% (${attempt.correct}/${attempt.total})`;
            attemptDetails.appendChild(attemptSummary);
            for (const [index, item] of (attempt.questionResults || []).entries()) {
              const answer = document.createElement('div');
              answer.className = `test-answer ${item.is_correct ? 'is-correct' : 'is-wrong'}`;
              const question = document.createElement('b');
              question.textContent = `${index + 1}. ${item.question || 'السؤال'}`;
              const childAnswer = document.createElement('span');
              childAnswer.textContent = `إجابة الطفلة: ${item.answer || 'لم تُسجل'}`;
              const correctAnswer = document.createElement('span');
            correctAnswer.textContent = item.is_correct ? `✅ صح · الإجابة المقبولة: ${item.correct_answer || item.answer}` : `❌ غلط · الإجابة الصحيحة: ${item.correct_answer || 'راجعي هذا السؤال معها'}`;
              answer.append(question, childAnswer, correctAnswer);
              attemptDetails.appendChild(answer);
            }
            details.appendChild(attemptDetails);
          }
        } else {
          const noDetails = document.createElement('p');
          noDetails.textContent = 'تفاصيل الإجابات غير متاحة لهذا الاختبار السابق.';
          details.appendChild(noDetails);
        }
        group.appendChild(details);
      }
    }
    root.appendChild(group);
  }
}

const ENGLISH_WRITING_STAGES = [
  {title: 'انسخي الحرف من غير نقط', hint: 'شوفي نموذج الحرف واكتبيه بإيدك.'},
  {title: 'اسمعي واكتبي', hint: 'اسمعي صوت الحرف، واكتبيه من غير نقط.'},
  {title: 'كمّلي الكلمة', hint: 'اكتبي الحرف الناقص في الكلمة.'},
  {title: 'رتّبي حروف الكلمة', hint: 'اسمعي الكلمة ورتّبي حروفها.'},
  {title: 'كمّلي الجملة', hint: 'اسمعي الجملة واختاري الكلمة اللي تكملها.'},
];
const MATH_WRITING_STAGES = [
  {title: 'اكتبي العدد الناقص حتى ١٠', hint: 'كمّلي تسلسل الأعداد الأولى واكتبي العدد الناقص.'},
  {title: 'كمّلي التسلسل حتى ٢٠', hint: 'اكتبي العدد اللي بييجي بين عددين.'},
  {title: 'العشرات والآحاد', hint: 'فكّري: العدد فيه كام عشرة وكام واحد؟'},
  {title: 'قارني الأعداد', hint: 'اختاري العدد الأكبر أو قولي إنهم قد بعض.'},
  {title: 'الجمع والطرح', hint: 'عدّي الصور واختاري ناتج العملية.'},
  {title: 'المسائل المصوّرة', hint: 'اسمعي الحكاية، وعدّي الصور، واختاري الإجابة.'},
];

function writingStages(program) { return program.subject === 'math' ? MATH_WRITING_STAGES : ENGLISH_WRITING_STAGES; }
function writingStageUnlocked(program, index) {
  if (writingPathOverrides[program.id]) return true;
  if (index === 0) {
    const prerequisitePrograms = program.subject === 'math' ? [program.id] : [program.id, 'foundation'];
    return allLessons().some(lesson => prerequisitePrograms.includes(lesson.programId) && (traceResults[lesson.id]?.percent || 0) >= 70);
  }
  const previous = writingPathResults[program.id]?.[index - 1];
  return (previous?.bestPercent || previous?.percent || 0) >= 75;
}
function renderWritingPath(program) {
  const root = $('#writingPath');
  if (!root) return;
  root.replaceChildren();
  const stages = writingStages(program);
  const section = document.createElement('section'); section.className = 'writing-path';
  const heading = document.createElement('h3'); heading.textContent = program.subject === 'math' ? '🔢 مسار تحديات الماث' : '✍️ مسار الكتابة المتقدمة';
  const intro = document.createElement('p'); intro.textContent = program.subject === 'math'
    ? 'بعد إتقان تتبّع الأعداد تفتح التحديات بالتدريج: الأعداد حتى ١٠ و٢٠، العشرات والآحاد، المقارنة، العمليات، ثم المسائل المصوّرة.'
    : 'بعد إتقان تتبّع الحروف تفتح التحديات بالتدريج: نسخ الحرف، كتابته من الصوت، إكمال الكلمة، ترتيب الحروف، ثم إكمال الجملة.';
  section.append(heading, intro);
  const override = document.createElement('button'); override.type = 'button'; override.className = 'writing-parent-unlock';
  override.textContent = writingPathOverrides[program.id] ? '🔓 كل المراحل مفتوحة لوليّ الأمر' : '🔐 فتح كل المراحل لوليّ الأمر';
  override.setAttribute('aria-pressed', String(!!writingPathOverrides[program.id]));
  override.onclick = () => {
    writingPathOverrides[program.id] = !writingPathOverrides[program.id];
    localStorage.setItem('lolo-writing-path-overrides', JSON.stringify(writingPathOverrides));
    refreshLessonPicker(program.id, $('#unitSelect')?.value);
  };
  section.appendChild(override);
  const list = document.createElement('div'); list.className = 'writing-stage-list';
  stages.forEach((stage, index) => {
    const saved = writingPathResults[program.id]?.[index];
    const open = writingStageUnlocked(program, index);
    const button = document.createElement('button'); button.type = 'button';
    button.className = `writing-stage${open ? ' unlocked' : ' locked'}${saved ? ' completed' : ''}`;
    button.disabled = !open;
    const mark = saved ? `${saved.bestPercent || saved.percent}%` : open ? 'ابدئي' : '🔒';
    button.innerHTML = `<span class="writing-stage-number">${index + 1}</span><span class="writing-stage-copy"><b></b><small></small></span><span class="writing-stage-mark"></span>`;
    button.querySelector('.writing-stage-copy b').textContent = stage.title;
    button.querySelector('.writing-stage-copy small').textContent = stage.hint;
    button.querySelector('.writing-stage-mark').textContent = mark;
    button.onclick = () => startWritingPath(program, index);
    list.appendChild(button);
  });
  section.appendChild(list);
  const details = Object.entries(writingPathResults[program.id] || {}).filter(([, result]) => result);
  if (details.length) {
    const report = document.createElement('details'); report.className = 'writing-parent-report';
    const summary = document.createElement('summary'); summary.textContent = 'تفاصيل نتائج تحديات الكتابة والماث'; report.appendChild(summary);
    for (const [stageIndex, result] of details) {
      const line = document.createElement('p');
      line.textContent = `${stages[Number(stageIndex)]?.title || 'تحدي'} · ${result.percent}% · ${result.history?.length || 1} محاولة`;
      report.appendChild(line);
      for (const item of result.items || []) {
        const answer = document.createElement('p'); answer.className = `writing-result-item ${item.correct ? 'correct' : 'wrong'}`;
        answer.textContent = `${item.prompt} · ${item.correct ? '✅ صح' : `❌ الإجابة: ${item.expected}`}`;
        report.appendChild(answer);
      }
    }
    section.appendChild(report);
  }
  root.appendChild(section);
}

function writingWordBank(program) {
  let lessons = program.units.flatMap(unit => unit.lessons);
  let practiced = lessons.filter(lesson => mastered.has(lesson.id) || (traceResults[lesson.id]?.percent || 0) >= 70);
  if (!practiced.length && program.id !== 'foundation') {
    practiced = allLessons().filter(lesson => lesson.programId === 'foundation' && (mastered.has(lesson.id) || (traceResults[lesson.id]?.percent || 0) >= 70));
  }
  if (!practiced.length) practiced = program.units[0]?.lessons || lessons.slice(0, 5);
  const source = practiced.flatMap(lesson => [
    lesson.focus, lesson.title, ...(lesson.board?.tokens || []).map(token => token.text),
  ]).filter(Boolean).join(' ');
  const common = new Set(['this','that','what','where','when','your','from','with','have','here','there','please','thank','three','four','five','eight','seven','mother','father','sister','brother']);
  const words = (source.match(/[A-Za-z]+/g) || []).map(word => word.toLowerCase()).filter(word => word.length >= 3 && word.length <= 7 && !common.has(word));
  const unique = [...new Set(words)];
  return unique.length ? unique : ['cat','sun','map','red','dog'];
}

function writingLetters(words) {
  const letters = [...new Set(words.join('').toUpperCase())];
  return letters.slice(0, 12).length ? letters.slice(0, 12) : ['A','B','C','D','E'];
}

function makeWritingOptions(answer, pool) {
  const other = [...new Set(pool.filter(item => item !== answer))].slice(0, 2);
  const choices = [answer, ...other];
  return choices.length > 1 ? choices : [answer, answer === '1' ? '2' : '1'];
}

function buildEnglishWritingTasks(program, stageIndex) {
  const words = writingWordBank(program);
  const letters = writingLetters(words);
  if (stageIndex <= 1) return Array.from({length: 5}, (_, index) => {
    const letter = letters[index % letters.length];
    return {type: 'draw', target: stageIndex === 0 ? letter : letter.toLowerCase(),
      mode: stageIndex === 0 ? 'copy' : 'memory',
      prompt: stageIndex === 0 ? `انسخي الحرف ${letter}` : 'اسمعي صوت الحرف واكتبيه',
      say: letter,
      lang: 'en-US', expected: letter};
  });
  if (stageIndex === 2) return Array.from({length: 5}, (_, index) => {
    const word = words[index % words.length];
    const hole = Math.max(1, Math.min(word.length - 2, Math.floor(word.length / 2)));
    const answer = word[hole].toLowerCase();
    const pattern = `${word.slice(0, hole)} _ ${word.slice(hole + 1)}`;
    return {type: 'draw', mode: 'memory', target: answer,
      prompt: `اكتبي الحرف الناقص: ${pattern}`, visual: pattern,
      say: `اسمعي الكلمة واكتبي الحرف الناقص: ${word}.`, lang: 'en-US', expected: answer};
  });
  if (stageIndex === 3) return Array.from({length: 5}, (_, index) => {
    const word = words[index % words.length];
    let scrambled = [...word];
    if (scrambled.length > 1 && scrambled.join('') === word) scrambled = [scrambled.at(-1), ...scrambled.slice(0, -1)];
    return {type: 'order', prompt: 'رتّبي الحروف لتكتبي الكلمة اللي هتسمعيها', say: word, lang: 'en-US',
      target: word, expected: word, options: scrambled.map((letter, tile) => ({value: letter, tile}))};
  });
  const sentences = [
    {stem:'She is ___.', cue:'👧 😊', answer:'happy', options:['happy','apple','bus']},
    {stem:'This is my ___.', cue:'👩', answer:'mother', options:['mother','green','run']},
    {stem:'This is an ___.', cue:'🍎', answer:'apple', options:['apple','happy','swim']},
    {stem:'It is ___.', cue:'🌳 💚', answer:'green', options:['green','mother','bus']},
    {stem:'I can ___.', cue:'🏃', answer:'run', options:['run','apple','happy']},
  ];
  return sentences.map(({stem, cue, answer, options}) => ({
    type:'choice', prompt:'بصي على الصورة، واختاري الكلمة اللي تكمل الجملة.', visual:`${cue}　${stem}`,
    say:stem.replace('___', '...'),
    lang:'en-US', target:answer, expected:answer,
    options:options.map(value=>({value,label:value})),
  }));
}

function mathNumberBank(program) {
  const text = program.units.flatMap(unit => unit.lessons.flatMap(lesson => [
    lesson.focus, lesson.title, ...(lesson.board?.tokens || []).map(token => token.text),
  ])).filter(Boolean).join(' ');
  const values = (text.match(/[0-9٠-٩]+/g) || []).map(value => Number(value.replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))))).filter(value => Number.isFinite(value) && value >= 0 && value <= 20);
  for (const [word, value] of Object.entries({zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10})) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(text)) values.push(value);
  }
  const unique = [...new Set(values)].sort((a, b) => a - b);
  return unique.length ? unique : [0,1,2,3,4,5,6,7,8,9,10];
}

function buildMathWritingTasks(program, stageIndex) {
  const numberBank = mathNumberBank(program);
  const earlyTargets = [...new Set([0,2,5,8,10].filter(value => numberBank.includes(value)).concat(numberBank.filter(value => value <= 10)))].slice(0,5);
  while (earlyTargets.length < 5) earlyTargets.push([0,2,5,8,10][earlyTargets.length]);
  if (stageIndex === 0) return earlyTargets.map(target => {
    if (target === 0) return {type:'draw', target:'0', mode:'memory', prompt:'اكتبي أول عدد: ؟ ، 1', visual:'؟　　1', say:'اكتبي العدد اللي بييجي قبل واحد.', lang:'ar-EG', expected:'0'};
    if (target === 10) return {type:'draw', target:'10', mode:'memory', prompt:'اكتبي العدد اللي بعد 9', visual:'9　　؟', say:'اكتبي العدد اللي بييجي بعد تسعة.', lang:'ar-EG', expected:'10'};
    const left = Math.max(0, target - 1), right = Math.min(20, target + 1);
    return {type: 'draw', target: String(target), mode: 'memory',
      prompt: `اكتبي العدد الناقص: ${left} ، ؟ ، ${right}`, visual: `${left}　　؟　　${right}`,
      say: `العدد اللي قبل ${right} وبعد ${left}، اكتبيه بإصبعك.`, lang: 'ar-EG', expected: String(target)};
  });
  const teenTargets = [11,13,15,17,19].filter(value => numberBank.includes(value));
  const sequenceTargets = teenTargets.length >= 5 ? teenTargets : [11,13,15,17,19];
  if (stageIndex === 1) return sequenceTargets.map(target => ({type:'draw',target:String(target),mode:'memory',
    prompt:`كمّلي التسلسل واكتبي العدد: ${target-1} ، ؟ ، ${target+1}`,visual:`${target-1}　　؟　　${target+1}`,
    say:`اكتبي العدد اللي بين ${target-1} و${target+1}.`,lang:'ar-EG',expected:String(target)}));
  if (stageIndex === 2) return [12,15,18,13,19].map(target => ({type:'draw',target:String(target%10),mode:'memory',
    prompt:`كام واحد في العدد ${target}؟`,visual:`١ عشرة + ؟ آحاد = ${target}`,
    say:`العدد ${target} فيه عشرة واحدة. اكتبي كام واحد فاضل.`,lang:'ar-EG',expected:String(target%10)}));
  if (stageIndex === 3) return [[12,17],[14,14],[20,15],[9,13],[18,11]].map(([left,right]) => ({
    type: 'choice', prompt: 'أنهي عدد أكبر؟', visual: `${left}　　أم　　${right}`,
    say: `قارني العدد ${left} والعدد ${right}، واختاري الأكبر.`, lang: 'ar-EG',
    target: left === right ? 'same' : left > right ? 'first' : 'second', expected: left > right ? String(left) : left < right ? String(right) : 'العددان قد بعض',
    options: [{value:'first',label:String(left)}, {value:'second',label:String(right)}, {value:'same',label:'قد بعض'}],
  }));
  if (stageIndex === 4) return [[2,3,'+'],[6,2,'−'],[4,3,'+'],[8,5,'−'],[5,4,'+']].map(([left,right,op]) => {
    const answer = op === '+' ? left + right : left - right;
    const removed = op === '−' ? ` − ${'🍎'.repeat(right)} 🧺` : ` + ${'🍎'.repeat(right)}`;
    return {type:'choice', prompt:'عدّي الصور واختاري الناتج', visual:`${'🍎'.repeat(left)}${removed}　=　؟`,
      say:`${left} ${op === '+' ? 'زائد' : 'ناقص'} ${right} يساوي كام؟`, lang:'ar-EG', target:String(answer), expected:String(answer),
      options:makeWritingOptions(String(answer), [String(Math.min(10,answer+1)), String(Math.max(0,answer-1)), String(Math.min(10,answer+2))]).map(value=>({value,label:value}))};
  });
  return [[2,1,'+','🐠'],[5,2,'−','🍪'],[3,3,'+','⭐'],[6,4,'−','🍎'],[4,2,'+','🧸']].map(([left,right,op,icon]) => {
    const answer = op === '+' ? left + right : left - right;
    const story = op === '+' ? `كان معاها ${left} ${icon} وجالها ${right} كمان. بقى معاها كام؟` : `كان معاها ${left} ${icon} وشالت ${right}. فاضل كام؟`;
    return {type:'choice', prompt:'اسمعي الحكاية وعدّي الصور.', visual:`${icon.repeat(left)} ${op === '+' ? '✨' : '🧺'} ${icon.repeat(right)}`,
      say:story, lang:'ar-EG', target:String(answer), expected:String(answer),
      options:makeWritingOptions(String(answer), [String(answer+1), String(Math.max(0,answer-1)), String(answer+2)]).map(value=>({value,label:value}))};
  });
}

function startWritingPath(program, stageIndex) {
  if (!writingStageUnlocked(program, stageIndex)) return;
  if (isActive || isStarting) stopSession();
  const items = program.subject === 'math' ? buildMathWritingTasks(program, stageIndex) : buildEnglishWritingTasks(program, stageIndex);
  traceState = {mode:'advanced', programId:program.id, stageIndex, items, index:0, results:[], attempts:0, selected:[]};
  $('#parentSheet').classList.remove('open');
  $('#traceSheet').classList.add('open'); $('#traceSheet').setAttribute('aria-hidden','false');
  $('#traceTitle').textContent = program.subject === 'math' ? '🔢 تحدّي الماث' : '✍️ تحدّي الكتابة';
  $('#traceVisual').hidden = true; $('#traceHear').hidden = true; $('#traceChoices').hidden = true;
  $('#traceClear').hidden = false;
  $('#traceCanvas').onpointerdown = tracePointerDown; $('#traceCanvas').onpointermove = tracePointerMove;
  $('#traceCanvas').onpointerup = tracePointerUp; $('#traceCanvas').onpointercancel = tracePointerUp;
  $('#traceClose').onclick = closeTraceTest; $('#traceClear').onclick = resetWritingAttempt;
  $('#traceNext').onclick = checkWritingDraw;
  $('#traceHear').onclick = () => speakWritingTask();
  renderWritingTask();
}

function speakWritingTask() {
  if (!traceState) return;
  let text = '';
  if (traceState.mode === 'advanced') {
    const item = traceState.items?.[traceState.index];
    if (!item) return;
    text = item.prompt && item.say && item.say !== item.prompt ? `${item.prompt} ${item.say}` : item.say || item.prompt || '';
  } else {
    const target = traceState.prompts?.[traceState.index];
    if (!target) return;
    text = `اتبعي النقط بإصبعك واكتبي ${target.value}. ${target.clue || ''}`;
  }
  if (!text) return;
  $('#traceFeedback').textContent = 'لولو بتقولك السؤال… 🎧';
  speakTraceFeedback(text);
}

function renderWritingTask() {
  const state = traceState, item = state?.items[state.index];
  if (!item) return;
  $('#traceCount').textContent = `السؤال ${state.index + 1} من ${state.items.length}`;
  $('#tracePrompt').textContent = item.prompt;
  $('#traceVisual').hidden = !item.visual;
  $('#traceVisual').textContent = item.visual || '';
  $('#traceHear').hidden = !item.say;
  $('#traceChoices').replaceChildren(); $('#traceChoices').hidden = true;
  $('#traceCanvas').hidden = item.type !== 'draw';
  $('#traceClear').hidden = item.type !== 'draw' && item.type !== 'order';
  $('#traceNext').hidden = item.type !== 'draw' && item.type !== 'order';
  $('#traceFeedback').textContent = item.type === 'draw' ? 'اكتبي بإصبعك، وخدي وقتك 💛' : 'اختاري أو رتّبي إجابتك 💛';
  state.selected = []; state.attempts = 0;
  if (item.type === 'draw') {
    state.currentItemMode = item.mode; state.prompts = state.items; state.mask = null;
    drawTraceTarget();
  } else {
    $('#traceChoices').hidden = false;
    if (item.type === 'order') {
      updateOrderDisplay();
      for (const tile of item.options) {
        const tileButton = addWritingChoice(tile.value, () => {
        if (state.selected.length >= item.target.length || state.selected.includes(tile)) return;
        state.selected.push(tile);
        tileButton.disabled = true; tileButton.classList.add('selected');
        updateOrderDisplay();
        });
        tileButton.setAttribute('aria-label', `الحرف ${tile.value}، قطعة رقم ${tile.tile + 1}`);
      }
    } else {
      for (const choice of item.options) {
        const value = typeof choice === 'string' ? choice : choice.value;
        const label = typeof choice === 'string' ? choice : choice.label;
        addWritingChoice(label, () => submitWritingAnswer(value === item.target, value));
      }
    }
  }
  speakWritingTask();
}

function addWritingChoice(label, action) {
  const button = document.createElement('button'); button.type='button'; button.className='trace-choice'; button.textContent=label; button.onclick=action;
  $('#traceChoices').appendChild(button);
  return button;
}
function resetWritingAttempt() {
  if (!traceState || traceState.mode !== 'advanced') { drawTraceTarget(); return; }
  const item = traceState.items[traceState.index];
  if (item.type === 'order') {
    traceState.selected = [];
    $('#traceChoices').querySelectorAll('button').forEach(button => { button.disabled = false; button.classList.remove('selected'); });
    updateOrderDisplay();
    return;
  }
  drawTraceTarget();
}
function updateOrderDisplay() {
  const item = traceState.items[traceState.index];
  $('#traceVisual').hidden = false;
  $('#traceVisual').textContent = `حروفك: ${traceState.selected.map(tile=>tile.value).join(' ') || [...item.target].map(()=> '＿').join(' ')}`;
}
function checkWritingDraw() {
  if (!traceState || traceState.mode !== 'advanced') return;
  const item = traceState.items[traceState.index];
  if (item.type === 'order') { submitWritingAnswer(true, item.target); return; }
  if (!traceState.hasStroke) { $('#traceFeedback').textContent='جربي تكتبي الإجابة الأول 🌼'; return; }
  const score = gradeTrace(); traceState.attempts++;
  if (score < 48 && traceState.attempts < 2) {
    $('#traceFeedback').textContent='قريبة، امسحي وجربي تاني. ركّزي في شكل الحرف أو الرقم 💛';
    speakTraceFeedback('قريبة، جربي تاني يا بطلة'); drawTraceTarget(); return;
  }
  submitWritingAnswer(score >= 62, item.target, score);
}
function submitWritingAnswer(correct, answer, score = null) {
  const state = traceState, item = state?.items[state.index];
  if (!state || state.mode !== 'advanced' || state.waiting) return;
  if (item.type === 'order' && state.selected.length !== item.target.length) {
    $('#traceFeedback').textContent='استخدمي كل الحروف الأول، وبعدها اضغطي «قيّمي كتابتي» 💛'; return;
  }
  state.waiting = true;
  const finalCorrect = item.type === 'order' ? state.selected.map(tile=>tile.value).join('') === item.target : correct;
  const childAnswer = item.type === 'order' ? state.selected.map(tile=>tile.value).join('') : String(answer);
  state.results.push({prompt:item.prompt, answer:childAnswer, expected:item.expected || item.target, correct:finalCorrect, score});
  $('#traceChoices').querySelectorAll('button').forEach(button=>button.disabled=true);
  const feedback = finalCorrect ? 'برافو! إجابة ممتازة ⭐' : `الإجابة الصح ${item.expected || item.target}. نكمل ونتعلمها سوا 🌱`;
  $('#traceFeedback').textContent = score === null ? feedback : `${feedback} · ${score}%`;
  speakTraceFeedback(feedback);
  setTimeout(() => {
    if (!traceState || traceState !== state) return;
    state.waiting=false;
    if (state.index + 1 < state.items.length) { state.index++; renderWritingTask(); }
    else finishWritingPath();
  }, 1000);
}

function finishWritingPath() {
  const state = traceState;
  const correct = state.results.filter(item=>item.correct).length;
  const percent = Math.round(correct / state.results.length * 100);
  const programResults = writingPathResults[state.programId] || {};
  const old = programResults[state.stageIndex] || {};
  const attempt = {percent, items:state.results, completedAt:new Date().toISOString()};
  const history = [...(old.history || []), attempt].slice(-10);
  programResults[state.stageIndex] = {percent:Math.max(percent, old.bestPercent || old.percent || 0), bestPercent:Math.max(percent, old.bestPercent || old.percent || 0), attempts:(old.attempts||0)+1, items:state.results, history};
  writingPathResults[state.programId] = programResults;
  localStorage.setItem('lolo-writing-path-results', JSON.stringify(writingPathResults));
  $('#traceCanvas').hidden=true; $('#traceHear').hidden=true; $('#traceChoices').hidden=true; $('#traceVisual').hidden=true; $('#traceClear').hidden=true; $('#traceNext').hidden=true;
  $('#traceCount').textContent = `${correct} من ${state.results.length} إجابات صح`;
  $('#tracePrompt').textContent = percent >= 75 ? 'عدّيتي المرحلة! المرحلة اللي بعدها بقت مفتوحة 🎉' : 'تدريب جميل! خلينا نعيد المرحلة عشان تثبتيها 🌼';
  $('#traceFeedback').textContent = `نتيجتك ${percent}٪`;
  speakTraceFeedback(percent >= 75 ? 'عديتي المرحلة، برافو يا بطلة!' : 'تدريب جميل، نعيد المرحلة ونتعلم أكتر');
  const program = programList().find(item=>item.id===state.programId);
  if (program) refreshLessonPicker(program.id, $('#unitSelect')?.value);
  renderParentReport();
}

function showPickerTab(tab) {
  const tests = tab === 'tests';
  $('#lessonTab').setAttribute('aria-selected', String(!tests));
  $('#testsTab').setAttribute('aria-selected', String(tests));
  $('#lessonPanel').hidden = tests;
  $('#testsPanel').hidden = !tests;
}

function traceTargets(lesson) {
  const focus = [lesson.focus, lesson.title, lesson.goal, ...(lesson.board?.tokens || []).map(token => token.text)].filter(Boolean).join(' ');
  if (lesson.subject === 'math' || lesson.strand === 'math' || lesson.programId === 'math') {
    const digits = [...focus.matchAll(/[0-9٠-٩]+/g)].flatMap(match => [...match[0]].map(digit => digit.replace(/[٠-٩]/g, value => String('٠١٢٣٤٥٦٧٨٩'.indexOf(value)))));
    const numberWords = {zero:'0',one:'1',two:'2',three:'3',four:'4',five:'5',six:'6',seven:'7',eight:'8',nine:'9',ten:'10'};
    for (const word of focus.toLowerCase().match(/[a-z]+/g) || []) if (numberWords[word]) digits.push(numberWords[word]);
    const unique = [...new Set(digits)].slice(0, 5);
    return unique.map(value => ({value, clue: `الرقم ${value}`}));
  }
  const words = [...focus.matchAll(/[A-Za-z]+/g)].map(match => match[0]);
  const targets = [];
  for (const word of words) {
    for (const letter of [...word.toUpperCase()]) {
      if (!targets.some(item => item.value === letter)) targets.push({value: letter, clue: `حرف ${letter} من كلمة ${word}`});
      if (targets.length === 5) return targets;
    }
  }
  return targets;
}

let traceState = null;
function startTraceTest(lessonId) {
  const lesson = allLessons().find(item => item.id === lessonId);
  const targets = lesson && traceTargets(lesson);
  $('#traceClose').onclick = closeTraceTest;
  if (!targets?.length) {
    traceState = null;
    $('#tracePrompt').textContent = 'الدرس ده مفيهوش حروف أو أرقام مناسبة لاختبار الكتابة باللمس.';
    $('#traceSheet').classList.add('open');
    $('#traceSheet').setAttribute('aria-hidden', 'false');
    $('#traceCanvas').hidden = true;
    $('#traceNext').hidden = true;
    return;
  }
  if (isActive || isStarting) stopSession();
  const prompts = Array.from({length: 5}, (_, index) => targets[index % targets.length]);
  traceState = {lesson, prompts, scores: [], index: 0};
  $('#parentSheet').classList.remove('open');
  $('#traceSheet').classList.add('open');
  $('#traceSheet').setAttribute('aria-hidden', 'false');
  $('#traceTitle').textContent = '✍️ نكتب ونتعلّم';
  $('#traceVisual').hidden = true; $('#traceHear').hidden = false; $('#traceChoices').hidden = true;
  $('#traceCanvas').hidden = false;
  $('#traceClear').hidden = false;
  $('#traceNext').hidden = false;
  $('#traceClose').onclick = closeTraceTest;
  $('#traceNext').onclick = nextTraceTarget;
  $('#traceClear').onclick = () => drawTraceTarget();
  $('#traceHear').onclick = speakWritingTask;
  const canvas = $('#traceCanvas');
  canvas.onpointerdown = tracePointerDown;
  canvas.onpointermove = tracePointerMove;
  canvas.onpointerup = tracePointerUp;
  canvas.onpointercancel = tracePointerUp;
  drawTraceTarget();
  speakWritingTask();
}

function closeTraceTest() {
  traceSpeechRequestId++;
  traceSpeechAudio?.pause(); traceSpeechAudio = null;
  $('#traceSheet').classList.remove('open');
  $('#traceSheet').setAttribute('aria-hidden', 'true');
  traceState = null;
}

function drawTraceTarget() {
  if (!traceState) return;
  const canvas = $('#traceCanvas'), ctx = canvas.getContext('2d', {willReadFrequently: true});
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const target = traceState.prompts[traceState.index];
  const advanced = traceState.mode === 'advanced';
  const targetValue = String(advanced ? target.target : target.value);
  if (!advanced) $('#tracePrompt').textContent = `اتبعي النقط بإصبعك: ${target.clue}`;
  if (!advanced) $('#traceCount').textContent = `المحاولة ${traceState.index + 1} من 5`;
  const mask = document.createElement('canvas'); mask.width = canvas.width; mask.height = canvas.height;
  const mctx = mask.getContext('2d', {willReadFrequently: true});
  mctx.fillStyle = '#000'; mctx.textAlign = 'center'; mctx.textBaseline = 'middle';
  let size = targetValue.length > 1 ? 170 : 220;
  mctx.font = `900 ${size}px Arial, sans-serif`;
  mctx.fillText(targetValue, mask.width / 2, mask.height / 2, mask.width - 30);
  const pixels = mctx.getImageData(0, 0, mask.width, mask.height).data;
  const bounds = {left: mask.width, right: 0, top: mask.height, bottom: 0};
  for (let y = 0; y < mask.height; y += 2) for (let x = 0; x < mask.width; x += 2) {
    if (pixels[(y * mask.width + x) * 4 + 3] > 100) {
      bounds.left = Math.min(bounds.left, x); bounds.right = Math.max(bounds.right, x);
      bounds.top = Math.min(bounds.top, y); bounds.bottom = Math.max(bounds.bottom, y);
    }
  }
  if (!advanced || traceState.currentItemMode === 'guided') {
    ctx.fillStyle = '#b6a8e9';
    for (let y = bounds.top; y <= bounds.bottom; y += 9) for (let x = bounds.left; x <= bounds.right; x += 9) {
      if (pixels[(y * mask.width + x) * 4 + 3] > 110) { ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill(); }
    }
  } else if (traceState.currentItemMode === 'copy') {
    ctx.save(); ctx.globalAlpha = .16; ctx.fillStyle = '#7962dc'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `900 ${size}px Arial, sans-serif`; ctx.fillText(targetValue, canvas.width / 2, canvas.height / 2, canvas.width - 30); ctx.restore();
  }
  traceState.mask = mask;
  traceState.hasStroke = false;
}

function tracePoint(event) {
  const rect = event.currentTarget.getBoundingClientRect();
  return {x: (event.clientX - rect.left) * event.currentTarget.width / rect.width,
    y: (event.clientY - rect.top) * event.currentTarget.height / rect.height};
}
function tracePointerDown(event) {
  if (!traceState) return;
  event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
  const ctx = event.currentTarget.getContext('2d'), point = tracePoint(event);
  traceState.hasStroke = true; traceState.last = point;
  ctx.beginPath(); ctx.arc(point.x, point.y, 7, 0, Math.PI * 2); ctx.fillStyle = '#ff779a'; ctx.fill();
}
function tracePointerMove(event) {
  if (!traceState?.last || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
  event.preventDefault(); const ctx = event.currentTarget.getContext('2d'), point = tracePoint(event);
  ctx.beginPath(); ctx.moveTo(traceState.last.x, traceState.last.y); ctx.lineTo(point.x, point.y);
  ctx.lineWidth = 14; ctx.lineCap = 'round'; ctx.strokeStyle = '#ff779a'; ctx.stroke(); traceState.last = point;
}
function tracePointerUp(event) {
  if (!traceState) return;
  event?.preventDefault?.();
  traceState.last = null;
}
function gradeTrace() {
  const canvas = $('#traceCanvas'), ink = canvas.getContext('2d', {willReadFrequently: true}).getImageData(0, 0, canvas.width, canvas.height).data;
  const target = traceState.mask.getContext('2d', {willReadFrequently: true}).getImageData(0, 0, canvas.width, canvas.height).data;
  const nearInkCanvas = document.createElement('canvas'); nearInkCanvas.width = canvas.width; nearInkCanvas.height = canvas.height;
  const nearInkCtx = nearInkCanvas.getContext('2d');
  const inkMask = nearInkCtx.createImageData(canvas.width, canvas.height);
  for (let i = 3; i < ink.length; i += 4) {
    if (ink[i - 3] > 190 && ink[i - 2] < 185 && ink[i - 1] > 110 && ink[i - 1] < 210) {
      inkMask.data[i - 3] = inkMask.data[i - 2] = inkMask.data[i - 1] = inkMask.data[i] = 255;
    }
  }
  nearInkCtx.putImageData(inkMask, 0, 0);
  const blurredInkCanvas = document.createElement('canvas'); blurredInkCanvas.width = canvas.width; blurredInkCanvas.height = canvas.height;
  const blurredInkCtx = blurredInkCanvas.getContext('2d', {willReadFrequently: true}); blurredInkCtx.filter = 'blur(8px)'; blurredInkCtx.drawImage(nearInkCanvas, 0, 0);
  const nearInk = blurredInkCtx.getImageData(0, 0, canvas.width, canvas.height).data;
  const nearTargetCanvas = document.createElement('canvas'); nearTargetCanvas.width = canvas.width; nearTargetCanvas.height = canvas.height;
  const nearTargetCtx = nearTargetCanvas.getContext('2d', {willReadFrequently: true}); nearTargetCtx.filter = 'blur(8px)'; nearTargetCtx.drawImage(traceState.mask, 0, 0); nearTargetCtx.filter = 'none';
  const nearTarget = nearTargetCtx.getImageData(0, 0, canvas.width, canvas.height).data;
  let targetPixels = 0, matched = 0, inkPixels = 0, closeInkPixels = 0;
  for (let i = 3; i < ink.length; i += 4) {
    const t = target[i] > 100;
    const drawn = ink[i - 3] > 190 && ink[i - 2] < 185 && ink[i - 1] > 110 && ink[i - 1] < 210;
    if (t) { targetPixels++; if (nearInk[i] > 18) matched++; }
    if (drawn) { inkPixels++; if (nearTarget[i] > 18) closeInkPixels++; }
  }
  const coverage = targetPixels ? matched / targetPixels : 0;
  const precision = inkPixels ? closeInkPixels / inkPixels : 0;
  return Math.round(100 * Math.max(0, Math.min(1, coverage * .75 + precision * .25)));
}
function nextTraceTarget() {
  if (!traceState) return;
  if (!traceState.hasStroke) {
    $('#traceFeedback').textContent = 'جربي تمشي على النقط الأول، وأنا معاكي 💛';
    return;
  }
  const score = gradeTrace();
  const feedback = score >= 68 ? 'برافو! مشيتي على النقط كويس جدًا! ⭐' : score >= 38 ? 'قريبة قوي! حاولي تمشي على النقط واحدة واحدة 💛' : 'لسه محتاجة تدريب بسيط. امسحي وجربي تاني 🌱';
  $('#traceFeedback').textContent = `${feedback} (${score}٪)`;
  speakTraceFeedback(feedback);
  if (score < 38) { drawTraceTarget(); return; }
  traceState.scores.push({value: traceState.prompts[traceState.index].value, score});
  if (traceState.index < 4) { traceState.index++; drawTraceTarget(); speakWritingTask(); return; }
  const scores = traceState.scores.map(item => item.score);
  const percent = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const old = traceResults[traceState.lesson.id];
  traceResults[traceState.lesson.id] = {percent, attempts: (old?.attempts || 0) + 1, scores: traceState.scores, completedAt: new Date().toISOString()};
  localStorage.setItem('lolo-trace-results', JSON.stringify(traceResults));
  $('#traceFeedback').textContent = `خلصتي الاختبار! نتيجتك ${percent}٪ 🎉`;
  $('#traceCount').textContent = 'ممتاز، خلصتي الخمس محاولات!';
  $('#traceCanvas').hidden = true; $('#traceNext').hidden = true;
  renderParentReport(); refreshLessonPicker(traceState.lesson.programId, traceState.lesson.unitId);
}
function speakTraceFeedback(text, lang = 'ar-EG') {
  const requestId = ++traceSpeechRequestId;
  traceSpeechAudio?.pause();
  traceSpeechAudio = null;
  fetch('/api/challenge-audio', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({text, lang}),
  }).then(async response => {
    const data = await response.json();
    if (!response.ok || !data.audio) throw new Error(data.error || 'صوت لولو مش جاهز دلوقتي.');
    if (requestId !== traceSpeechRequestId) return;
    const binary = atob(data.audio), bytes = new Uint8Array(binary.length);
    for (let index=0; index<binary.length; index++) bytes[index] = binary.charCodeAt(index);
    const audioUrl = URL.createObjectURL(new Blob([bytes], {type:data.mimeType || 'audio/wav'}));
    const audio = new Audio(audioUrl); traceSpeechAudio = audio;
    audio.onended = () => { URL.revokeObjectURL(audioUrl); if (traceSpeechAudio === audio) traceSpeechAudio = null; };
    audio.onerror = () => { URL.revokeObjectURL(audioUrl); if (traceSpeechAudio === audio) traceSpeechAudio = null; };
    await audio.play();
  }).catch(error => {
    if (requestId !== traceSpeechRequestId) return;
    $('#traceFeedback').textContent = `${error.message || 'صوت لولو مش متاح.'} اضغطي «اسمعي السؤال تاني» للمحاولة.`;
  });
}

function chooseLesson(lessonId, mode = 'lesson') {
  if (isStarting && !isActive) {
    setStatus('لولو بتجهز الدرس، استني لحظة صغيرة.');
    return;
  }
  const lesson = allLessons().find(item => item.id === lessonId);
  if (!lesson) return;
  if (isActive || isStarting) stopSession();
  answerPending = false;
  pendingChildAnswer = '';
  pendingTutorFeedback = '';
  answerTurnId = 0;
  gradedAnswerTurnId = 0;
  clearCompletionFollowUp();
  currentLesson = lesson;
  activeAnswerEvents = [];
  mathScene = null;
  $('#mathGroups').replaceChildren(); $('#mathObjects').replaceChildren(); $('#mathActions').replaceChildren(); $('#mathEquation').textContent = '';
  sessionMode = mode;
  $('#app').classList.toggle('assessment', mode === 'test');
  $('#app').classList.remove('in-lesson');
  localStorage.setItem('lolo-current-lesson', lesson.id);
  localStorage.setItem('lolo-explicit-lesson-choice', 'true');
  cardsFor(currentLesson);
  updateLessonBadge(currentLesson);
  updateDashboardLesson();
  updateProgress();
  refreshLessonPicker(currentLesson.programId, currentLesson.unitId);
  $('#parentClose').click();
  setStatus(mode === 'test' ? `اختبار ${lesson.title} جاهز. دوسي «يلا نبدأ» لما تبقوا مستعدين.` : `درس ${lesson.title} جاهز. دوسي «يلا نبدأ» لما تبقوا مستعدين.`);
}

function selectProgram(programId) {
  const program = programList().find(item => item.id === programId);
  if (!program) return;
  if (isActive || isStarting) stopSession();
  localStorage.setItem('lolo-selected-program', program.id);
  if (program.id !== 'foundation') localStorage.setItem('lolo-path-program', program.id);
  localStorage.setItem('lolo-grade-id', program.gradeId || 'grade-1');
  const lessons = allLessons().filter(lesson => lesson.programId === program.id);
  currentLesson = (parentSettings.learningPath === 'foundation-first' ? allLessons().find(lesson => lesson.programId === 'foundation' && !mastered.has(lesson.id)) : null)
    || lessons.find(lesson => !mastered.has(lesson.id)) || lessons[0] || null;
  sessionMode = 'lesson';
  $('#app').classList.remove('assessment', 'in-lesson');
  if (currentLesson) {
    localStorage.setItem('lolo-current-lesson', currentLesson.id);
    cardsFor(currentLesson); updateLessonBadge(currentLesson); updateDashboardLesson();
    refreshLessonPicker(program.id, currentLesson.unitId, program.gradeId);
  }
}

function enterAppFromWelcome() {
  const gradeId = $('#welcomeGradeSelect').value;
  const programId = $('#welcomeProgramSelect').value;
  if (!gradeId || !programId) return;
  selectProgram(programId);
  localStorage.setItem('lolo-onboarding-complete', 'true');
  localStorage.setItem('lolo-welcome-tour-v1-complete', 'true');
  localStorage.setItem('lolo-explicit-lesson-choice', 'true');
  $('#app').classList.add('ready');
  $('#welcomeError').textContent = '';
  $('#welcomeAudio').pause();
  setStatus('اختيارك اتحفظ. دوسي «يلا نبدأ» لما تكوني جاهزة.');
}

function updateDashboardLesson() {
  if (!currentLesson) return;
  const icons = {math: '🔢', phonics: '🔊', grammar: '🧩', speaking: '🗣️', review: '⭐'};
  const program = programList().find(item => item.id === currentLesson.programId);
  const subjectName = program?.subject === 'math' ? 'ماث' : currentLesson.programId === 'foundation' ? 'تأسيس إنجليزي' : 'إنجليزي';
  $('#dashboardLessonIcon').textContent = icons[currentLesson.strand] || '🌱';
  $('#dashboardLessonTitle').textContent = currentLesson.title || currentLesson.focus;
  $('#dashboardMode').textContent = `${subjectName} · ${sessionMode === 'test' ? 'اختبار شفهي' : 'الدرس الجاي'}`;
}

function updateLessonBadge(lesson) {
  const icons = {math: '🔢', phonics: '🔊', grammar: '🧩', speaking: '🗣️', review: '⭐'};
  const labels = {math: 'درس ماث', phonics: 'درس فونكس', grammar: 'درس جرامر', speaking: 'درس كلام', review: 'درس مراجعة'};
  $('#lessonBadgeIcon').textContent = icons[lesson?.strand] || '🌱';
  $('#lessonBadge').setAttribute('aria-label', `${labels[lesson?.strand] || 'درس تأسيس'}: ${lesson?.title || ''}`);
  $('#welcomeLessonIcon').textContent = icons[lesson?.strand] || '🌱';
  $('#welcomeLessonTitle').textContent = lesson?.title || 'درس تأسيس';
  $('#welcomeLessonChoice').classList.toggle('show', localStorage.getItem('lolo-explicit-lesson-choice') === 'true');
}

function cardsFor(lesson) {
  $('#cards').replaceChildren();
  updateLessonBoard(lesson);
  const isMath = programList().find(program => program.id === lesson?.programId)?.subject === 'math';
  $('#app').classList.toggle('math-active', isMath);
  if (!isMath || mathScene?.lessonId !== lesson?.id) { mathScene = null; $('#mathGroups').replaceChildren(); $('#mathObjects').replaceChildren(); $('#mathActions').replaceChildren(); $('#mathEquation').textContent = ''; }
  if (isMath && !mathScene) showMathScene(initialMathScene(lesson));
  const cards = lesson?.cards || [['🌼', 'زهرة'], ['🐱', 'حيوانات'], ['🍎', 'أكل']];
  for (const [emoji, label] of cards) {
    const button = document.createElement('button');
    button.className = 'card';
    button.type = 'button';
    button.textContent = emoji;
    button.setAttribute('aria-label', label);
    button.onclick = () => sendChoice(label);
    $('#cards').appendChild(button);
  }
}

function initialMathScene(lesson) {
  const focus = `${lesson?.focus || ''} ${lesson?.title || ''} ${lesson?.goal || ''}`.toLowerCase();
  if (/zero|empty set|مفيش|صفر/.test(focus)) return {scene: 'objects', object: 'apple', count: 0};
  if (/compare|more|less|أكتر|أكبر|أصغر|مقارن/.test(focus)) return {scene: 'comparison', object: 'apple', second_object: 'cookie', count: 3, second_count: 2};
  if (/sequence daily events|morning|night|days of the week|week|بيانات|data|sort|الصبح|الليل|الأسبوع|بيانات/.test(focus)) return {scene: 'daily_time'};
  if (/count and represent 11.?15|11.?15/.test(focus)) return {scene: 'objects', object: 'apple', count: 11};
  if (/count and represent 16.?20|16.?20/.test(focus)) return {scene: 'objects', object: 'apple', count: 16};
  if (/count quantities 0.?10|count.*one to five|counting objects/.test(focus)) return {scene: 'objects', object: 'apple', count: 5};
  if (/measure|length|height|weight|capacity|أطول|أقصر|أثقل|أخف|السعة|نقيس/.test(focus)) return {scene: 'measurement', object: 'block', second_object: 'block', count: 3, second_count: 2};
  if (/shape|شكل|دائرة|مربع|مثلث|مستطيل/.test(focus)) {
    const shapes = ['circle', 'square', 'triangle', 'rectangle'].filter((shape, index) => {
      const words = [['circle', 'دائرة'], ['square', 'مربع'], ['triangle', 'مثلث'], ['rectangle', 'مستطيل']][index];
      return words.some(word => focus.includes(word));
    });
    return {scene: 'shapes', shape: shapes[0] || 'circle', shapes: shapes.length ? shapes : ['circle'], count: 1};
  }
  if (/number|numeral|sequence|missing|before and after|رقم|أعداد|العدد|ترتيب|قبل وبعد/.test(focus)) return {scene: 'number_line', numbers: [0, 1, 2, 3, 4, 5]};
  if (/pattern|نمط|يتكرر/.test(focus)) return {scene: 'pattern', sequence: ['red', 'blue', 'red', 'blue', 'red']};
  if (/subtract|take away|طرح|ناقص|يتبقى/.test(focus)) return {scene: 'subtraction', object: 'cookie', count: 5, amount: 2};
  if (/add|addition|جمع|زود/.test(focus)) return {scene: 'addition', object: 'cookie', count: 3, amount: 1};
  if (/tens|place value|عشرات|آحاد/.test(focus)) return {scene: 'place_value', count: 12};
  return {scene: 'objects', object: 'apple', count: 5};
}

const MATH_OBJECTS = {cookie: ['🍪', 'بسكوتة'], apple: ['🍎', 'تفاحة'], block: ['🧱', 'مكعب'], ball: ['⚽', 'كورة'], flower: ['🌼', 'وردة'], fish: ['🐠', 'سمكة'], car: ['🚗', 'عربية'], star: ['⭐', 'نجمة']};
const MATH_OBJECT_PLURALS = {cookie: 'بسكوتات', apple: 'تفاحات', block: 'مكعبات', ball: 'كُرات', flower: 'وردات', fish: 'سمكات', car: 'عربيات', star: 'نجوم'};
const MATH_SHAPES = {circle: '🔵', square: '🟦', triangle: '🔺', rectangle: '🟪', sphere: '⚽', cube: '🧊', cylinder: '🥫'};
const MATH_PATTERN = {red: '🔴', blue: '🔵', yellow: '🟡', green: '🟢', circle: '⚪', square: '🟦', triangle: '🔺', star: '⭐'};
const MATH_SHAPE_NAMES = {circle: 'دائرة زرقاء', square: 'مربع أزرق', triangle: 'مثلث', rectangle: 'مستطيل بنفسجي', sphere: 'كرة', cube: 'مكعب', cylinder: 'أسطوانة'};
const MATH_PATTERN_NAMES = {red: 'دائرة حمراء', blue: 'دائرة زرقاء', yellow: 'دائرة صفراء', green: 'دائرة خضراء', circle: 'دائرة بيضاء', square: 'مربع أزرق', triangle: 'مثلث', star: 'نجمة'};

function boundedCount(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.max(0, Math.min(20, number)) : fallback;
}

function mathObjectButton(icon, label, index, onClick, extraClass = '') {
  const button = document.createElement('button');
  button.type = 'button'; button.className = `math-object ${extraClass}`.trim();
  button.textContent = icon; button.setAttribute('aria-label', label);
  if (onClick) button.onclick = () => onClick(index, button);
  return button;
}

function sendMathInteraction(text) {
  if (!isActive) return;
  clearTimeout(mathInteractionTimer);
  text += ` الحالة المرئية الدقيقة الآن: ${mathVisualState()}. دي لمسة أو حركة على الشاشة وليست إجابة ولا تتحسب في شريط التقدم. علقي عليها بصوتك بجملة تشجيع للمحاولة، ثم اطلبي من الطفلة أن تقول الإجابة أو اسم الصورة بصوتها. لا تسجلي الإجابة ولا تمدحي صحتها قبل سماعها، ولا تذكري أشياء أو ألواناً أو أعداداً غير موجودة في الحالة.`;
  mathInteractionTimer = setTimeout(() => { mathInteractionTimer = null; sendTeacherTurn(text); }, 450);
}

function mathVisualState() {
  if (!mathScene) return 'لا يوجد مشهد ماث مرئي حالياً.';
  const noun = MATH_OBJECTS[mathScene.object]?.[1] || 'عنصر';
  const plural = MATH_OBJECT_PLURALS[mathScene.object] || noun;
  if (mathScene.scene === 'objects') return mathScene.count === 0 ? `المجموعة فارغة: لا توجد ${plural} معروضة` : `${mathScene.count} ${plural}، لُمِس منها ${mathScene.counted.size}`;
  if (mathScene.scene === 'addition') return `${mathScene.count} ${plural} أساسية، أضيف إليها ${mathScene.added}، والمجموع الظاهر ${mathScene.count + mathScene.added}`;
  if (mathScene.scene === 'subtraction') return `${mathScene.count} ${plural} في البداية، أُزيل منها ${mathScene.removed}، والمتبقي ${mathScene.count - mathScene.removed}`;
  if (mathScene.scene === 'comparison' || mathScene.scene === 'measurement') return `المجموعة الأولى: ${mathScene.count} ${plural}. المجموعة الثانية: ${mathScene.secondCount} ${MATH_OBJECT_PLURALS[mathScene.secondObject] || MATH_OBJECTS[mathScene.secondObject]?.[1] || 'عناصر'}`;
  if (mathScene.scene === 'place_value') return `${Math.floor(mathScene.count / 10)} مجموعات عشرية مرئية، كل مجموعة فيها 10 مكعبات صغيرة مرسومة، و${mathScene.count % 10} مكعبات آحاد`;
  if (mathScene.scene === 'shapes') return `الأشكال الظاهرة فقط: ${mathScene.shapes.map(shape => MATH_SHAPE_NAMES[shape]).join('، ')}`;
  if (mathScene.scene === 'pattern') return `النمط الظاهر بالترتيب: ${mathScene.sequence.map(item => MATH_PATTERN_NAMES[item]).join('، ')}`;
  if (mathScene.scene === 'number_line') return `الأعداد الظاهرة على البلاطات: ${mathScene.numbers.join('، ')}`;
  if (mathScene.scene === 'daily_time') return 'الصور الظاهرة فقط: شروق الشمس، طبق طعام، حقيبة، قمر';
  return `المشهد الحالي: ${mathScene.scene}`;
}

function mathOpeningScript() {
  if (!mathScene) return 'أهلاً يا بطلة! مساحة اللعب لسه فاضية، هجهزها وبعدها نبدأ سوا.';
  const noun = MATH_OBJECTS[mathScene.object]?.[1] || 'عنصر';
  const plural = MATH_OBJECT_PLURALS[mathScene.object] || noun;
  if (mathScene.scene === 'objects') return mathScene.count === 0
    ? `أهلاً يا بطلة! بصي، المجموعة فاضية ومفيهاش ولا ${noun}. يعني عندنا صفر. تقدري تلمسي المكان الفاضي؟`
    : `أهلاً يا بطلة! قدامك ${mathScene.count} ${plural}. يلا نعدّهم سوا، المسِي أول واحدة وقوليلي لمسنا كام؟`;
  if (mathScene.scene === 'addition') return `أهلاً يا بطلة! قدامك ${mathScene.count} ${plural} وزرار عليه زائد واحد. اضغطيه مرة، وبعدين نعدّهم سوا. يلا نبدأ!`;
  if (mathScene.scene === 'subtraction') return `أهلاً يا بطلة! قدامك ${mathScene.count} ${plural}. هنشيل منهم ${mathScene.amount}، المسِي ${mathScene.amount} منهم بإيدك، وبعدها نشوف فاضل كام.`;
  if (mathScene.scene === 'comparison' || mathScene.scene === 'measurement') return `أهلاً يا بطلة! قدامك ${mathScene.count} ${plural} في المجموعة الأولى، و${mathScene.secondCount} ${MATH_OBJECT_PLURALS[mathScene.secondObject] || MATH_OBJECTS[mathScene.secondObject]?.[1] || 'عناصر'} في التانية. بصي عليهم وقوليلي أنهي مجموعة فيها حاجات أكتر؟`;
  if (mathScene.scene === 'place_value') return `أهلاً يا بطلة! قدامك ${Math.floor(mathScene.count / 10)} مجموعة عشرية، كل مجموعة فيها عشرة مكعبات صغيرة، ومعاهم ${mathScene.count % 10} مكعبات آحاد. يلا نعدّ الآحاد سوا.`;
  if (mathScene.scene === 'shapes') return `أهلاً يا بطلة! قدامك ${mathScene.shapes.map(shape => MATH_SHAPE_NAMES[shape]).join(' و')}. وريني باللمس ${MATH_SHAPE_NAMES[mathScene.shapes[0]]}.`;
  if (mathScene.scene === 'pattern') return `أهلاً يا بطلة! بصي على الترتيب الظاهر: ${mathScene.sequence.map(item => MATH_PATTERN_NAMES[item]).join('، ')}. إيه اللون أو الشكل اللي اتكرر؟`;
  if (mathScene.scene === 'number_line') return `أهلاً يا بطلة! قدامك الأرقام ${mathScene.numbers.join('، ')}. وريني باللمس الرقم ${mathScene.numbers[Math.min(2, mathScene.numbers.length - 1)]}.`;
  if (mathScene.scene === 'daily_time') return 'أهلاً يا بطلة! قدامك صور الشمس، طبق الأكل، الشنطة، والقمر. خلينا نبص عليهم سوا: أنهي صورة بتحبيها أكتر؟';
  return `أهلاً يا بطلة! بصي على مساحة اللعب اللي قدامك: ${mathVisualState()}. يلا نبدأ بحاجة واحدة منها.`;
}

function drawMathObjects(container, count, object, options = {}) {
  const [icon, noun] = MATH_OBJECTS[object] || MATH_OBJECTS.cookie;
  container.replaceChildren();
  for (let index = 0; index < count; index++) {
    const classes = [options.added?.has(index) ? 'is-added' : '', options.targetCount && index >= count - options.targetCount ? 'is-target' : '', options.counted?.has(index) ? 'is-counted' : ''].filter(Boolean).join(' ');
    const button = mathObjectButton(icon, noun, index, options.onTap, classes);
    container.appendChild(button);
  }
}

function showMathScene(args = {}) {
  const program = programList().find(item => item.id === currentLesson?.programId);
  if (program?.subject !== 'math' || (args.lesson_id && args.lesson_id !== currentLesson?.id)) return {shown: false, reason: 'الدرس الحالي ليس ماث.'};
  const scene = ['objects', 'addition', 'subtraction', 'comparison', 'place_value', 'shapes', 'pattern', 'measurement', 'daily_time', 'number_line'].includes(args.scene) ? args.scene : 'objects';
  const object = Object.hasOwn(MATH_OBJECTS, args.object) ? args.object : 'cookie';
  const secondObject = Object.hasOwn(MATH_OBJECTS, args.second_object) ? args.second_object : 'apple';
  const count = boundedCount(args.count, 5);
  const amount = boundedCount(args.amount, 1);
  const secondCount = boundedCount(args.second_count, 3);
  const shape = Object.hasOwn(MATH_SHAPES, args.shape) ? args.shape : 'circle';
  const shapes = Array.isArray(args.shapes) ? args.shapes.filter(item => Object.hasOwn(MATH_SHAPES, item)).slice(0, 6) : [shape];
  const numbers = Array.isArray(args.numbers) ? args.numbers.filter(value => Number.isInteger(value) && value >= 0 && value <= 20).slice(0, 12) : Array.from({length: 11}, (_, i) => i);
  const sequence = Array.isArray(args.sequence) ? args.sequence.slice(0, 10).filter(item => Object.hasOwn(MATH_PATTERN, item)) : [];
  mathScene = {lessonId: currentLesson.id, scene, object, secondObject, count, amount, secondCount, shape, shapes, numbers, removed: 0, added: 0, counted: new Set(), sequence};
  $('#mathGroups').replaceChildren(); $('#mathObjects').replaceChildren(); $('#mathActions').replaceChildren();
  const [icon, noun] = MATH_OBJECTS[object];
  const [secondIcon, secondNoun] = MATH_OBJECTS[secondObject];
  $('#mathMission').textContent = ({objects: 'هنعدّهم واحدة واحدة', addition: 'هنزود حاجة كمان', subtraction: 'هنشيل ونشوف الباقي', comparison: 'هنقارن المجموعتين', place_value: 'عشرات وآحاد بالمكعبات', shapes: 'أشكال تتشاف وتتلمس', pattern: 'كمّلي الشكل اللي بيتكرر', measurement: 'نشوف مين أطول أو أتقل', daily_time: 'نشوف ترتيب يومنا'})[scene];
  $('#mathEquation').textContent = !['addition', 'subtraction'].includes(scene) && sessionMode !== 'test' && args.equation && /^[0-9+\-=?×÷ ]{1,24}$/.test(args.equation) ? args.equation : '';

  if (scene === 'comparison' || scene === 'measurement') {
    for (const [groupIndex, group] of [{count, icon, noun}, {count: secondCount, icon: secondIcon, noun: secondNoun}].entries()) {
      const tray = document.createElement('div'); tray.className = 'math-group';
      const label = document.createElement('span'); label.className = 'math-group-label'; label.textContent = group.noun;
      tray.appendChild(label);
      for (let i = 0; i < group.count; i++) tray.appendChild(mathObjectButton(group.icon, group.noun, i, (_index, button) => {
        button.classList.toggle('is-counted');
        sendMathInteraction(`الطفلة لمست ${group.noun} من المجموعة ${groupIndex === 0 ? 'الأولى' : 'الثانية'}. قولي تعليقاً قصيراً مرتبطاً بالمقارنة الظاهرة أمامها، ثم سؤالاً واحداً عنها.`);
      }));
      $('#mathGroups').appendChild(tray);
    }
  } else if (scene === 'place_value') {
    const tens = Math.floor(count / 10), ones = count % 10;
    const tray = document.createElement('div'); tray.className = 'math-group';
    const label = document.createElement('span'); label.className = 'math-group-label'; label.textContent = 'عشرات'; tray.appendChild(label);
    for (let i = 0; i < tens; i++) {
      const pack = document.createElement('div'); pack.setAttribute('aria-label', 'عشرة مكعبات'); pack.title = 'عشرة مكعبات';
      pack.style.cssText = 'display:grid;grid-template-columns:repeat(5,12px);gap:2px;padding:3px;border-radius:8px;background:#e8fff3';
      for (let block = 0; block < 10; block++) { const cell = document.createElement('span'); cell.textContent = '🟧'; cell.style.cssText = 'width:12px;height:12px;font-size:10px;line-height:12px'; pack.appendChild(cell); }
      tray.appendChild(pack);
    }
    $('#mathGroups').appendChild(tray);
    const onesTray = document.createElement('div'); onesTray.className = 'math-group';
    const onesLabel = document.createElement('span'); onesLabel.className = 'math-group-label'; onesLabel.textContent = 'آحاد'; onesTray.appendChild(onesLabel);
    for (let i = 0; i < ones; i++) onesTray.appendChild(mathObjectButton('🟦', 'مكعب واحد', i, null));
    $('#mathGroups').appendChild(onesTray);
  } else if (scene === 'shapes') {
    for (const [i, visibleShape] of mathScene.shapes.entries()) {
      const button = mathObjectButton(visibleShape === 'rectangle' ? '▬' : MATH_SHAPES[visibleShape], MATH_SHAPE_NAMES[visibleShape], i, (_index, element) => {
        element.classList.toggle('is-counted');
        sendMathInteraction(`الطفلة لمست شكل ${MATH_SHAPE_NAMES[visibleShape]} من الأشكال الظاهرة. انطقي اسمه بالإنجليزية إن كان هدف الدرس، واطلبي منها تقوله بصوتها.`);
      });
      if (visibleShape === 'rectangle') button.style.color = '#9867d5';
      $('#mathObjects').appendChild(button);
    }
  } else if (scene === 'pattern') {
    const sequence = mathScene.sequence.length ? mathScene.sequence : ['red', 'blue', 'red', 'blue', 'red'];
    sequence.forEach((item, index) => $('#mathObjects').appendChild(mathObjectButton(MATH_PATTERN[item], item, index, (_value, button) => {
      button.classList.toggle('is-counted');
      sendMathInteraction(`الطفلة لمست العنصر ${index + 1} في النمط المعروض. وصفي النمط من نفس الألوان الظاهرة واسأليها ما الذي يأتي بعده.`);
    })));
  } else if (scene === 'number_line') {
    mathScene.numbers.forEach(number => {
      const button = mathObjectButton(String(number), `العدد ${number}`, number, (value, element) => {
        element.classList.add('is-counted');
        sendMathInteraction(`الطفلة لمست العدد ${value} على خط الأعداد. اطلبي منها أن تقول العدد بصوتها وتشرح اختيارها بكلمة أو جملة بسيطة.`);
      }, '');
      $('#mathObjects').appendChild(button);
    });
  } else if (scene === 'daily_time') {
    ['🌅', '🍽️', '🎒', '🌙'].forEach((icon, index) => $('#mathObjects').appendChild(mathObjectButton(icon, 'حدث في اليوم', index, (i, button) => {
      button.classList.toggle('is-counted');
      sendMathInteraction(`الطفلة اختارت صورة الحدث رقم ${i + 1} في ترتيب اليوم. تابعي معها السؤال بالصوت خطوة واحدة.`);
    })));
  } else {
    const tapHandler = (index, button) => {
      if (scene === 'subtraction') {
        if (button.classList.contains('is-taken') || mathScene.removed >= mathScene.amount) return;
        button.classList.add('is-taken'); mathScene.removed += 1;
        const remaining = Math.max(0, mathScene.count - mathScene.removed);
        $('#mathFeedback').textContent = `خدنا ${mathScene.removed}… فاضل ${remaining} ${noun}`;
        $('#mathEquation').textContent = `${mathScene.count} − ${mathScene.removed} = ${remaining}`;
        sendMathInteraction(`الطفلة لمست وأزاحت ${mathScene.removed} من ${mathScene.amount} ${noun} المطلوبة؛ بقي أمامها ${remaining} من أصل ${mathScene.count}. ${mathScene.removed === mathScene.amount ? 'اسأليها كم بقي.' : 'علقي بجملة قصيرة وشجعيها تكمل اللمس.'} لا تسميها مكعبات.`);
      } else {
        if (mathScene.counted.has(index)) return;
        mathScene.counted.add(index); button.classList.add('is-counted');
        $('#mathFeedback').textContent = `لمستي ${mathScene.counted.size} من ${mathScene.count} ${noun} 👏`;
        sendMathInteraction(`الطفلة لمست ${mathScene.counted.size} من ${mathScene.count} ${noun} الظاهرة. ${mathScene.counted.size === mathScene.count ? 'اسأليها ما العدد النهائي وتحققي قبل المدح.' : 'ردي عليها بتشجيع قصير واطلبي منها تلمس اللي بعدها.'}`);
      }
    };
    const startCount = scene === 'addition' ? count : count;
    drawMathObjects($('#mathObjects'), startCount, object, {onTap: tapHandler, counted: mathScene.counted});
    if (scene === 'addition') {
      const plus = document.createElement('button'); plus.type = 'button'; plus.className = 'math-action'; plus.textContent = `➕ ${amount}`; plus.setAttribute('aria-label', `زودي ${amount}`);
      plus.onclick = () => {
        if (mathScene.added >= mathScene.amount) return;
        mathScene.added += 1;
        const button = mathObjectButton(icon, noun, mathScene.count + mathScene.added - 1, null, 'is-added');
        $('#mathObjects').appendChild(button);
        $('#mathEquation').textContent = `${mathScene.count} + ${mathScene.added} = ${mathScene.count + mathScene.added}`;
        $('#mathFeedback').textContent = `زدنا واحدة، بقوا ${mathScene.count + mathScene.added} ${noun}`;
        sendMathInteraction(`الطفلة أضافت ${mathScene.added} من ${mathScene.amount} ${noun}. المعروض الآن ${mathScene.count + mathScene.added}. ${mathScene.added === mathScene.amount ? 'اسأليها كم صار العدد.' : 'علقي بجملة قصيرة واطلبي منها تضيف الباقي.'} استخدمي نفس الشيء الظاهر.`);
      };
      $('#mathActions').appendChild(plus);
    }
  }
  if (scene === 'subtraction') $('#mathFeedback').textContent = `فيه ${count} ${noun}. اضغطي على ${amount} منهم واسحبيهم 👆`;
  else if (scene === 'addition') $('#mathFeedback').textContent = `ابدئي بـ ${count} ${noun}، واضغطي ➕ عشان نزود ${amount} 👆`;
  else if (scene === 'objects') $('#mathFeedback').textContent = count === 0 ? `المجموعة فاضية… مفيش ${noun} هنا` : `المسي كل ${noun} مرة وإحنا بنعد 👆`;
  else if (scene === 'comparison') $('#mathFeedback').textContent = 'بصي على المجموعتين… مين فيهم أكتر؟';
  else if (scene === 'measurement') $('#mathFeedback').textContent = 'قارني بين المجموعتين وشوفي الفرق بعينك';
  else if (scene === 'place_value') $('#mathFeedback').textContent = 'العشرة مجموعة كاملة، والباقي آحاد';
  else if (scene === 'shapes') $('#mathFeedback').textContent = 'المسي الشكل واسمعي اسمه';
  else if (scene === 'pattern') $('#mathFeedback').textContent = 'بصي على الترتيب واسمعي إيه اللي بيتكرر';
  else if (scene === 'number_line') $('#mathFeedback').textContent = 'المسي العدد اللي سمعتيه على خط الأعداد 👆';
  else if (scene === 'daily_time') $('#mathFeedback').textContent = 'رتبي صور اليوم واحدة واحدة';
  return {shown: true, lessonId: currentLesson.id, scene, visualState: mathVisualState()};
}

function updateLessonBoard(lesson) {
  const board = lesson?.board;
  const tokens = board?.tokens || [];
  const container = $('#boardTokens');
  container.replaceChildren();
  const focusIndex = board?.focusIndex ?? Math.max(0, tokens.findIndex(token => ['sound', 'word', 'noun', 'detail'].includes(token.role)));
  tokens.forEach((token, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `lesson-token token-${token.role || 'word'}${index === focusIndex ? ' is-new' : ''}`;
    button.textContent = token.text;
    button.setAttribute('aria-label', `اسمعي كلمة ${token.text}`);
    button.onclick = () => {
      if (!isActive) return;
      const prompt = `الطفلة ضغطت على كلمة ${token.text} الظاهرة في اللوحة. انطقيها بوضوح، اشرحي معناها بالمصري في جملة قصيرة، ثم ارجعي لنشاط الدرس.`;
      if (activeProvider === 'openai') sendOpenAIText(prompt);
      else send({realtimeInput: {text: prompt}});
    };
    container.appendChild(button);
  });
  $('#boardPicture').textContent = board?.picture || '✨';
  $('#lessonBoard').setAttribute('aria-label', `كلمات الدرس: ${tokens.map(token => token.text).join('، ')}`);
}

function highlightBoardSpeech(transcript) {
  const spoken = transcript.toLowerCase().replace(/[^\p{L}\p{N}' ]/gu, ' ');
  for (const button of $('#boardTokens').querySelectorAll('.lesson-token')) {
    const word = button.textContent.toLowerCase().replace(/[^\p{L}\p{N}' ]/gu, ' ').trim();
    if (!word || (word.length === 1 && !new RegExp(`\\b${word}\\b`).test(spoken)) || !spoken.includes(word)) continue;
    button.classList.remove('speaking');
    void button.offsetWidth;
    button.classList.add('speaking');
    setTimeout(() => button.classList.remove('speaking'), 650);
  }
}

function updateProgress() {
  const lessons = allLessons();
  renderTopProgress(lessons);
  $('#parentProgress').textContent = parentProgressSummary();
}

function renderTopProgress(lessons = allLessons()) {
  const active = isActive || isStarting;
  const fill = $('#progressFill');
  const steps = $('#progressSteps');
  const status = $('#progressStatus');
  fill.classList.toggle('global', !active);
  if (!active) {
    const percent = lessons.length ? Math.round(mastered.size / lessons.length * 100) : 0;
    const honors = lessons.reduce((sum, lesson) => sum + (Number(lessonExcellence[lesson.id]) || 0), 0);
    fill.style.width = `${percent}%`;
    $('#progressCaption').textContent = 'تقدم المنهج';
    $('#progressNumbers').textContent = `${mastered.size}/${lessons.length}${honors ? ` · 🏅 ${honors}` : ''}`;
    steps.hidden = true;
    status.textContent = '';
    status.classList.remove('has-error');
    $('#progressIcon').textContent = '⭐';
    return;
  }
  const target = sessionMode === 'test' ? 5 : 2;
  const replay = lessonWasMasteredAtStart && sessionMode === 'lesson';
  const lessonHistory = Array.isArray(lessonStats[currentLesson?.id]?.history) ? lessonStats[currentLesson.id].history : [];
  const savedLessonEvents = lessonHistory.filter(item => item.mode !== 'test');
  let barEvents = activeAnswerEvents;
  if (sessionMode === 'lesson' && !replay) {
    const stats = lessonStats[currentLesson?.id] || {};
    const oldCorrect = Math.max(0, (Number(stats.correct) || 0) - lessonHistory.filter(item => item.is_correct).length);
    const oldWrong = Math.max(0, (Number(stats.wrong) || 0) - lessonHistory.filter(item => !item.is_correct).length);
    // Older versions saved totals only; put earlier mistakes before known correct
    // answers so a new correct response can clear their red bar marker.
    const priorSummary = oldWrong ? [{answer: '', is_correct: false, legacy: true}] : [];
    for (let index = 0; index < Math.min(target, oldCorrect); index++) priorSummary.push({answer: '', is_correct: true, legacy: true});
    barEvents = [...priorSummary, ...savedLessonEvents];
  }
  const correct = Math.min(target, barEvents.filter(item => item.is_correct).length);
  const wrong = barEvents.filter(item => !item.is_correct).length;
  const percent = Math.min(100, Math.round(correct / target * 100));
  const priorHonors = replay ? Number(lessonExcellence[currentLesson?.id]) || 0 : 0;
  $('#progressCaption').textContent = sessionMode === 'test' ? 'تقدم الاختبار' : replay ? 'إعادة الدرس · تفوق' : 'تقدم الدرس';
  $('#progressNumbers').textContent = `${correct}/${target} صح${replay ? ` · 🏅 ${priorHonors + (replayHonoredThisSession ? 1 : 0)}` : ''}`;
  fill.style.width = `${percent}%`;
  steps.hidden = false;
  steps.replaceChildren();
  let ordered;
  if (sessionMode === 'test') {
    ordered = Array.from({length: target}, (_, index) => activeAnswerEvents.find(item => item.question_number === index + 1));
  } else {
    ordered = Array.from({length: target}, () => null);
    let milestone = 0;
    for (const item of barEvents) {
      if (milestone >= target) break;
      ordered[milestone] = item;
      if (item.is_correct) milestone++;
    }
  }
  const pendingIndex = answerPending
    ? (sessionMode === 'test' ? ordered.findIndex(item => !item) : correct < target ? correct : -1)
    : -1;
  const unresolvedWrong = ordered.filter(item => item && !item.is_correct).length;
  for (let index = 0; index < target; index++) {
    const item = ordered[index];
    const marker = document.createElement('span');
    marker.className = `progress-step${item ? item.is_correct ? ' correct' : ' wrong' : index === pendingIndex ? ' pending' : ''}`;
    marker.textContent = item ? item.is_correct ? '✓' : '×' : index === pendingIndex ? '…' : String(index + 1);
    steps.appendChild(marker);
  }
  if (replay) {
    const medal = document.createElement('span');
    medal.className = `progress-step excellence${replayHonoredThisSession ? ' earned' : ''}`;
    medal.textContent = replayHonoredThisSession ? '🏅' : '☆';
    medal.title = replayHonoredThisSession ? 'شارة تفوق جديدة' : 'شارة التفوق تنتظرك بعد الإعادة';
    steps.appendChild(medal);
  }
  status.textContent = replayHonoredThisSession ? 'تفوق جديد! كسبتي شارة زيادة 🏅' : answerPending ? 'سمعت إجابتك، لولو بتراجعها…' : unresolvedWrong ? 'حاولي تاني، إنتي قدها 💛' : wrong ? `صححتي ${Math.min(wrong, correct)} إجابة! كمّلي يا بطلة ✨` : replay ? 'جاوبي بصوتك عشان تكسبي شارة تفوق زيادة ✨' : 'كل إجابة صح بتقربك من النجمة ✨';
  status.classList.toggle('has-error', unresolvedWrong > 0);
  $('#progressIcon').textContent = unresolvedWrong ? '💛' : '⭐';
}

function recordLessonAnswer(lessonId, answer, isCorrect, questionNumber) {
  if (typeof answer === 'number' && Number.isFinite(answer)) answer = String(answer);
  if (typeof isCorrect === 'string' && /^(true|false)$/i.test(isCorrect.trim())) isCorrect = isCorrect.trim().toLowerCase() === 'true';
  if (!isActive || lessonId !== currentLesson?.id || typeof answer !== 'string' || !answer.trim() || typeof isCorrect !== 'boolean') {
    setStatus('لولو ماقدرتش تسجل تقييم الإجابة دي. قوليها مرة تانية بصوتك.');
    return {recorded: false};
  }
  if (answerTurnId && gradedAnswerTurnId === answerTurnId) return {recorded: true, duplicate: true};
  // Count each spoken response as its own attempt; live models sometimes reuse
  // a question number, which must not hide a later wrong answer.
  let question = activeAnswerEvents.length + 1;
  if (sessionMode === 'test' && question > 5) return {recorded: false, reason: 'اكتملت أسئلة الاختبار.'};
  if (!question) return {recorded: false};
  if (activeAnswerEvents.some(item => item.question_number === question)) return {recorded: true, duplicate: true};
  answerPending = false;
  pendingChildAnswer = '';
  pendingTutorFeedback = '';
  gradedAnswerTurnId = answerTurnId;
  const events = lessonStats[lessonId] || {correct: 0, wrong: 0};
  events[isCorrect ? 'correct' : 'wrong'] = (Number(events[isCorrect ? 'correct' : 'wrong']) || 0) + 1;
  events.history = Array.isArray(events.history) ? events.history : [];
  events.history.push({answer: answer.trim(), is_correct: isCorrect, mode: sessionMode, completedAt: new Date().toISOString()});
  events.history = events.history.slice(-100);
  lessonStats[lessonId] = events;
  activeAnswerEvents.push({answer: answer.trim(), is_correct: isCorrect, question_number: question});
  localStorage.setItem('lolo-lesson-stats', JSON.stringify(lessonStats));
  updateProgress();
  renderParentReport();
  if (currentLesson) refreshLessonPicker(currentLesson.programId, currentLesson.unitId);
  let mastery = null;
  if (sessionMode === 'lesson') {
    const verifiedAnswers = activeAnswerEvents.filter(item => item.is_correct).slice(0, 2).map(item => item.answer);
    if (verifiedAnswers.length === 2) mastery = updateCurrentLesson(lessonId, 2, verifiedAnswers);
  }
  return {recorded: true, correct: events.correct, wrong: events.wrong, percent: Math.round(events.correct / (events.correct + events.wrong) * 100), mastery};
}

function appendTranscript(current, next) {
  if (!next) return current;
  // Gemini may send cumulative transcript snapshots; OpenAI sends deltas.
  if (next.startsWith(current)) return next;
  if (current.endsWith(next)) return current;
  return current + next;
}

function recordFromSpokenFeedback() {
  if (!isActive || !answerPending || !['lesson', 'test'].includes(sessionMode) || !pendingChildAnswer.trim()) return false;
  const feedback = pendingTutorFeedback.trim().toLocaleLowerCase();
  if (!feedback) return false;
  const wrong = /غلط|خطأ|مش\s*(?:صح|صحيحة|كده|مظبوط)|لأ|لا[,، ]+(?:الإجابة|الاجابة)|الإجابة.{0,18}(?:غلط|خطأ|مش)|الاجابة.{0,18}(?:غلط|خطأ|مش)|قريبة.{0,12}(?:بس|لكن)|نجرب\s*(?:تاني|مرة)|نحاول\s*(?:تاني|مرة)|حاولي\s*(?:تاني|مرة)|جربي\s*(?:تاني|مرة)|wrong answer|incorrect|try again/.test(feedback);
  const correct = /(?:الإجابة|الاجابة|إجابتك|اجابتك).{0,12}(?:صح|صحيحة|مظبوط|مظبوطة)|(?:كده|بالظبط|بالضبط).{0,8}(?:صح|مظبوط)|(?:صح|صحيح|مظبوط|مظبوطة)(?: يا بطلة| يا شطورة|!|،|\.|$)|correct answer|that's right|exactly/.test(feedback);
  if (!wrong && !correct) return false;
  const result = recordLessonAnswer(currentLesson?.id, pendingChildAnswer, !wrong && correct, activeAnswerEvents.length + 1);
  return !!result.recorded;
}

function settleUnscoredAnswer() {
  if (!answerPending) return;
  answerPending = false;
  pendingChildAnswer = '';
  pendingTutorFeedback = '';
  updateProgress();
}

function lessonRewardCards(lesson) {
  const source = (lesson?.cards || []).map(([icon, label]) => ({icon, label})).filter(item => item.icon);
  const distinct = source.filter((item, index) => source.findIndex(other => other.icon === item.icon) === index);
  return distinct.length >= 2 ? distinct : [...distinct, {icon: '⭐', label: 'نجمة'}];
}

function rewardGameKind(lesson) {
  const options = lesson?.subject === 'math' || lesson?.strand === 'math'
    ? ['count', 'pattern', 'match', 'stars']
    : lesson?.strand === 'phonics'
      ? ['match', 'memory', 'pattern', 'stars']
      : lesson?.strand === 'grammar'
        ? ['pattern', 'match', 'memory', 'stars']
        : ['memory', 'match', 'stars', 'pattern'];
  const index = [...(lesson?.id || '')].reduce((sum, char) => sum + char.charCodeAt(0), 0) + mastered.size;
  return options[index % options.length];
}

function showRewardGame(lesson) {
  const cards = lessonRewardCards(lesson);
  const game = {kind: rewardGameKind(lesson), lessonId: lesson.id, cards, attempts: 0};
  const [first, second, third] = [cards[0], cards[1], cards[2] || cards[0]];
  const demo = $('#rewardDemo');
  const options = $('#rewardOptions');
  const prompt = $('#rewardInstruction');
  const title = $('#rewardTitle');
  demo.replaceChildren(); options.replaceChildren();
  if (game.kind === 'count') {
    const count = 1 + ((mastered.size - 1 + 3) % 3);
    game.answer = String(count);
    game.voicePrompt = `عدّي الصور اللي ظهرت في لعبة المكافأة، واختاري العدد الصح.`;
    title.textContent = 'عدّي الصور!';
    prompt.textContent = 'عدّيهم واختاري العدد';
    demo.textContent = Array(count).fill(first.icon).join(' ');
    for (let number = 1; number <= 3; number++) addRewardOption(String(number), String(number), game);
  } else if (game.kind === 'pattern') {
    game.answer = first.icon;
    game.voicePrompt = 'كمّلي النمط في لعبة المكافأة: بصّي على الصور واختاري الصورة اللي تيجي بعدهم.';
    title.textContent = 'كمّلي النمط!';
    prompt.textContent = 'إيه الصورة اللي تيجي بعد كده؟';
    demo.textContent = `${first.icon}　${second.icon}　${first.icon}　❔`;
    addRewardOption(first.icon, first.icon, game); addRewardOption(second.icon, second.icon, game);
  } else if (game.kind === 'memory') {
    game.answer = third.icon;
    game.memoryCards = [first, second, third];
    game.voicePrompt = 'بصي على الصور في لعبة المكافأة واحفظيهم، بعدين اضغطي زرار الإخفاء واختاري الصورة اللي راحت.';
    title.textContent = 'لعبة الذاكرة!';
    prompt.textContent = 'بصي كويس… وبعدها دوري على الصورة اللي اختفت';
    demo.textContent = game.memoryCards.map(item => item.icon).join('　');
    const hide = document.createElement('button');
    hide.type = 'button'; hide.className = 'reward-main-action'; hide.textContent = 'اخفي صورة 🙈';
    hide.onclick = () => {
      demo.textContent = `${first.icon}　❔　${second.icon}`;
      options.replaceChildren();
      for (const item of game.memoryCards) addRewardOption(item.icon, item.icon, game);
      hide.remove();
    };
    options.appendChild(hide);
  } else if (game.kind === 'stars') {
    game.collected = new Set(); game.voicePrompt = 'ساعدي الصورة اللي في لعبة المكافأة تجمع النجوم! المسِي النجوم الثلاثة.';
    title.textContent = 'نجوم المكافأة!'; prompt.textContent = 'المسي النجوم واجمعيهم كلهم';
    demo.textContent = `${first.icon}　✨`;
    for (let index = 0; index < 3; index++) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'reward-option'; button.textContent = '⭐';
      button.setAttribute('aria-label', 'نجمة');
      button.onclick = () => {
        if (button.disabled) return;
        button.disabled = true; button.classList.add('correct'); button.textContent = '✨';
        game.collected.add(index); game.attempts++;
        if (game.collected.size === 3) { $('#rewardInstruction').textContent = 'جمعتيهم كلهم! ✨'; setTimeout(() => finishRewardGame(true), 850); }
      };
      options.appendChild(button);
    }
  } else {
    const target = cards[(cards.indexOf(first) + 1) % cards.length];
    game.answer = target.icon;
    game.voicePrompt = 'بصي على الصورة اللي فوق في لعبة المكافأة، واختاري الصورة اللي شبهها.';
    title.textContent = 'دوري على التوأم!'; prompt.textContent = 'اختاري الصورة اللي زي دي';
    demo.textContent = target.icon;
    const choices = [target, ...cards.filter(item => item.icon !== target.icon).slice(0, 2)];
    choices.sort((a, b) => (a.icon.charCodeAt(0) + mastered.size) % 3 - (b.icon.charCodeAt(0) + mastered.size) % 3);
    for (const item of choices) addRewardOption(item.icon, item.icon, game);
  }
  $('#rewardOverlay').hidden = false;
  document.body.style.overflow = 'hidden';
  if (micStream) micStream.getAudioTracks().forEach(track => { track.enabled = false; });
  const duration = Math.max(4, Math.min(15, Number(parentSettings.rewardSeconds) || 9)) * 1000;
  const timerBar = document.querySelector('.reward-timer span');
  timerBar.style.animation = 'none'; void timerBar.offsetWidth; timerBar.style.animation = `reward-time ${duration}ms linear forwards`;
  game.timeout = setTimeout(() => finishRewardGame(false), duration);
  activeRewardGame = game;
  return {voicePrompt: game.voicePrompt, kind: game.kind};
}

function addRewardOption(label, value, game) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'reward-option'; button.textContent = label;
  button.setAttribute('aria-label', label);
  button.onclick = () => {
    if (!activeRewardGame || button.disabled) return;
    game.attempts++;
    if (value === game.answer) {
      button.classList.add('correct'); button.disabled = true;
      $('#rewardInstruction').textContent = 'شطورة! كسبتي المكافأة! 🌟';
      setTimeout(() => finishRewardGame(true), 850);
    } else {
      button.classList.add('wrong'); setTimeout(() => button.classList.remove('wrong'), 350);
      $('#rewardInstruction').textContent = 'جربي صورة تانية، مفيش غلط في اللعبة 💛';
    }
  };
  $('#rewardOptions').appendChild(button);
}

function finishRewardGame(completed) {
  const game = activeRewardGame;
  if (!game) return;
  clearTimeout(game.timeout);
  activeRewardGame = null;
  $('#rewardOverlay').hidden = true;
  document.body.style.overflow = '';
  if (micStream) micStream.getAudioTracks().forEach(track => { track.enabled = true; });
  if (isActive && currentLesson?.id === game.lessonId) {
    if (rewardFollowUp) scheduleCompletionFollowUp(game.lessonId, rewardFollowUp);
    const prompt = completed
      ? 'انتهت لعبة المكافأة وفازت الطفلة. افرحي بها بجملة واحدة، ثم قولي: «الدرس ده خلصناه! تحبي تخلي ماما تختارلك درس تاني؟» وانتظري جوابها من غير ما تعيدي الدرس.'
      : 'انتهت لعبة المكافأة. قولي لها بجملة لطيفة إنها تقدر تلعبها مرة تانية بعد درس جديد، ثم قولي: «الدرس ده خلصناه! تحبي تخلي ماما تختارلك درس تاني؟» وانتظري جوابها من غير ما تعيدي الدرس.';
    if (activeProvider === 'openai') sendOpenAIText(prompt);
    else send({clientContent: {turns: [{role: 'user', parts: [{text: prompt}]}], turnComplete: true}});
  }
  rewardFollowUp = null;
}

function clearCompletionFollowUp() {
  if (completionFollowUpTimer) clearTimeout(completionFollowUpTimer);
  completionFollowUpTimer = null;
  completionFollowUpPending = false;
}

function noteTutorOutput() {
  lastTutorOutputAt = Date.now();
  if (completionFollowUpPending) clearCompletionFollowUp();
}

function scheduleCompletionFollowUp(lessonId, result) {
  clearCompletionFollowUp();
  if (!result?.saved) return;
  completionFollowUpPending = true;
  completionFollowUpTimer = setTimeout(() => {
    completionFollowUpTimer = null;
    if (!completionFollowUpPending || !isActive || currentLesson?.id !== lessonId) return clearCompletionFollowUp();
    const prompt = result.rewardGame
      ? 'انتهت لعبة المكافأة ولم تكملي الكلام بعدها. افرحي بها بجملة قصيرة ثم قولي «الدرس ده خلصناه! تحبي تخلي ماما تختارلك درس تاني؟» وانتظري جوابها من غير إعادة الشرح.'
      : result.excellenceAwarded
      ? 'راجعت الطفلة الدرس المتقن وأجابت إجابتين صحيحتين. قولي بوضوح إنها كسبت شارة تفوق جديدة، ثم اسأليها «تحبي تخلي ماما تختارلك درس تاني؟» وانتظري جوابها.'
      : result.courseComplete
      ? 'انتهى الدرس الحالي ولم يصدر منك رد مسموع بعد أداة الإتقان. تكلمي الآن بصوت لولو: افرحي بها بجملة قصيرة ثم قولي «الدرس ده خلصناه! تحبي تخلي ماما تختارلك درس تاني؟» وإذا رفضت قولي لها حرفياً «ادي التليفون لماما وقوليلها: لولو قالتلي إني خلصت الدرس ده، واختاريلي درس تاني». لا تعيدي الدرس.'
      : 'انتهى الدرس الحالي ولم يصدر منك رد مسموع بعد أداة الإتقان. تكلمي الآن بصوت لولو: افرحي بها بجملة قصيرة ثم قولي «الدرس ده خلصناه! تحبي تخلي ماما تختارلك درس تاني؟» وانتظري جوابها من غير إعادة الشرح.';
    completionFollowUpPending = false;
    if (activeProvider === 'openai') sendOpenAIText(prompt);
    else send({clientContent: {turns: [{role: 'user', parts: [{text: prompt}]}], turnComplete: true}});
  }, 6500);
}

function parentProgressSummary() {
  const programId = $('#trackSelect')?.value || currentLesson?.programId;
  const lessons = allLessons().filter(lesson => !programId || lesson.programId === programId);
  const completed = lessons.filter(lesson => mastered.has(lesson.id)).length;
  const testCount = lessons.filter(lesson => testResults[lesson.id]).length;
  const honors = lessons.reduce((sum, lesson) => sum + (Number(lessonExcellence[lesson.id]) || 0), 0);
  const path = writingPathResults[programId] || {};
  const advanced = Object.values(path).filter(result => (result?.bestPercent || result?.percent || 0) >= 75).length;
  return `في المنهج ده: ${completed} من ${lessons.length} درس تمّوا · ${testCount} اختبار ${testCount === 1 ? 'محفوظ' : 'محفوظين'} · ${advanced} مراحل كتابة وماث متقدمة متقنة${honors ? ` · 🏅 ${honors} شارات تفوق` : ''}.`;
}

function setStatus(message) {
  $('#liveStatus').textContent = message;
  const startup = $('#startupStatus');
  if (startup) {
    startup.textContent = message;
    startup.classList.toggle('show', isStarting || $('#errorDot').classList.contains('show'));
  }
}

function showError(message) {
  $('#errorDot').textContent = '⚠️';
  $('#errorDot').title = message;
  $('#errorDot').setAttribute('aria-label', message);
  $('#errorDot').classList.add('show');
  setStatus(message);
  if (!$('#app').classList.contains('ready')) $('#welcomeError').textContent = message;
  console.error(message);
}

function setListening(on) {
  $('#mic').classList.toggle('live', on);
  $('#mic').textContent = on ? '⏹️' : '🎙️';
  $('#mic').setAttribute('aria-label', on ? 'أوقفي الدرس الصوتي' : 'ابدئي الدرس الصوتي');
  $('#buddy').classList.toggle('active', on);
  $('#soundWave').classList.toggle('on', on && !modelSpeaking);
}

function send(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function sendOpenAIText(text) {
  if (realtimeChannel?.readyState !== 'open') return;
  realtimeChannel.send(JSON.stringify({type: 'conversation.item.create', item: {
    type: 'message', role: 'user', content: [{type: 'input_text', text}],
  }}));
  realtimeChannel.send(JSON.stringify({type: 'response.create'}));
}

function sendChoice(label) {
  if (!isActive) return;
  const text = `لمست الطفلة صورة «${label}» من الصور الظاهرة. اللمسة تفاعل فقط وليست إجابة ولا تتحسب في شريط التقدم. ردي بصوتك بالمصري: شجعي اختيارها من غير ما تقولي إن الإجابة صح، انطقي الكلمة الإنجليزية المرتبطة بالصورة من سياق الدرس، ثم قولي لها مثلاً «برافو على اختيارك، حاولي تقوليها معايا». انتظري محاولتها الصوتية، وبعدها قيّمي كلامها كإجابة وحدثي التقدم بأداة record_lesson_answer عند وضوحها. لا تطلبي منها القراءة أو الكتابة ولا تصفي أي صورة غير الظاهرة.`;
  sendTeacherTurn(text);
}

function sendTeacherTurn(text) {
  if (!isActive) return;
  if (activeProvider === 'openai') sendOpenAIText(text);
  else send({clientContent: {turns: [{role: 'user', parts: [{text}]}], turnComplete: true}});
}

function stopPlayback() {
  for (const source of playingSources) {
    try { source.stop(); } catch {}
  }
  playingSources.clear();
  nextAudioTime = audioContext?.currentTime || 0;
}

function closeSession() {
  clearTimeout(sessionLimitTimer);
  sessionLimitTimer = null;
  if (setupHandshake) {
    setupHandshake.reject(new Error('اتقفل اتصال الدرس قبل ما يجهز.'));
    setupHandshake = null;
  }
  isActive = false;
  isStarting = false;
  clearTimeout(mathInteractionTimer);
  mathInteractionTimer = null;
  if (activeRewardGame) clearTimeout(activeRewardGame.timeout);
  activeRewardGame = null;
  rewardFollowUp = null;
  $('#rewardOverlay').hidden = true;
  document.body.style.overflow = '';
  answerPending = false;
  pendingChildAnswer = '';
  pendingTutorFeedback = '';
  answerTurnId = 0;
  gradedAnswerTurnId = 0;
  clearCompletionFollowUp();
  modelSpeaking = false;
  if (audioWorklet) audioWorklet.port.onmessage = null;
  try { audioWorklet?.disconnect(); } catch {}
  try { micSource?.disconnect(); } catch {}
  if (micStream) micStream.getTracks().forEach(track => track.stop());
  if (socket) {
    socket.onmessage = null;
    socket.onclose = null;
    try { socket.close(); } catch {}
  }
  try { realtimeChannel?.close(); } catch {}
  try { realtimePeer?.close(); } catch {}
  if (remoteAudio) { remoteAudio.srcObject = null; remoteAudio.remove(); }
  stopPlayback();
  if (audioContext && audioContext.state !== 'closed') audioContext.close().catch(() => {});
  audioWorklet = null;
  micSource = null;
  micStream = null;
  socket = null;
  realtimeChannel = null;
  realtimePeer = null;
  remoteAudio = null;
  activeProvider = null;
  audioContext = null;
  setListening(false);
  $('#buddy').classList.remove('talking');
  $('#soundWave').classList.remove('on');
  updateProgress();
}

function floatPcmToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function streamAudioToGemini(buffer) {
  if (!isActive || activeProvider === 'openai' || socket?.readyState !== WebSocket.OPEN) return;
  send({realtimeInput: {audio: {data: floatPcmToBase64(buffer), mimeType: 'audio/pcm;rate=16000'}}});
}

function playPcm24k(base64) {
  if (!audioContext || audioContext.state === 'closed') return;
  const binary = atob(base64);
  const count = Math.floor(binary.length / 2);
  const bytes = new Uint8Array(count * 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const audio = audioContext.createBuffer(1, count, 24000);
  const channel = audio.getChannelData(0);
  for (let i = 0; i < count; i++) channel[i] = view.getInt16(i * 2, true) / 32768;
  const source = audioContext.createBufferSource();
  source.buffer = audio;
  source.connect(audioContext.destination);
  source.onended = () => playingSources.delete(source);
  const startAt = Math.max(audioContext.currentTime + 0.025, nextAudioTime);
  source.start(startAt);
  nextAudioTime = startAt + audio.duration;
  playingSources.add(source);
}

function lessonForModel(lesson) {
  if (!lesson) return null;
  const subject = programList().find(program => program.id === lesson.programId)?.subject;
  return {
    id: lesson.id,
    title: lesson.title || lesson.focus,
    focus: lesson.focus,
    goal: lesson.goal,
    unit: lesson.unitTitle,
    cards: subject === 'math' ? [] : (lesson.cards || []).map(card => card[1]),
    visualState: subject === 'math' ? mathVisualState() : `الصور الظاهرة: ${(lesson.cards || []).map(card => card[1]).join('، ')}`,
  };
}

function selectLessonInApp(lesson) {
  if (!lesson) return false;
  answerPending = false;
  pendingChildAnswer = '';
  pendingTutorFeedback = '';
  answerTurnId = 0;
  gradedAnswerTurnId = 0;
  clearCompletionFollowUp();
  currentLesson = lesson;
  sessionMode = 'lesson';
  lessonWasMasteredAtStart = false;
  replayHonoredThisSession = false;
  activeAnswerEvents = [];
  $('#app').classList.remove('assessment');
  localStorage.setItem('lolo-current-lesson', lesson.id);
  localStorage.setItem('lolo-selected-program', lesson.programId);
  cardsFor(lesson);
  updateLessonBadge(lesson);
  updateDashboardLesson();
  updateProgress();
  refreshLessonPicker(lesson.programId, lesson.unitId);
  return true;
}

function updateCurrentLesson(lessonId, correctResponses, evidence) {
  const verifiedEvidence = Array.isArray(evidence) && evidence.length === 2 && evidence.every(item => typeof item === 'string' && item.trim());
  if (sessionMode !== 'lesson' || lessonId !== currentLesson?.id || Number(correctResponses) !== 2 || !verifiedEvidence) return {saved: false, next: null};
  const alreadySaved = mastered.has(lessonId);
  let excellenceAward = null;
  if (!alreadySaved) {
    mastered.add(lessonId);
    localStorage.setItem('lolo-mastered', JSON.stringify([...mastered]));
  } else if (lessonWasMasteredAtStart && !replayHonoredThisSession) {
    lessonExcellence[lessonId] = (Number(lessonExcellence[lessonId]) || 0) + 1;
    localStorage.setItem('lolo-lesson-excellence', JSON.stringify(lessonExcellence));
    replayHonoredThisSession = true;
    excellenceAward = lessonExcellence[lessonId];
  }
  updateProgress();
  refreshLessonPicker(currentLesson.programId, currentLesson.unitId);
  const next = lessonAfterCurrent();
  const programLessons = allLessons().filter(lesson => lesson.programId === currentLesson.programId);
  const courseComplete = !next && programLessons.length > 0 && programLessons.every(lesson => mastered.has(lesson.id));
  const rewardGame = alreadySaved || !parentSettings.rewardEnabled ? null : showRewardGame(currentLesson);
  const result = {saved: true, alreadySaved, excellenceAwarded: excellenceAward, excellenceCount: Number(lessonExcellence[lessonId]) || 0, nextLesson: next ? {id: next.id, title: next.title || next.focus, focus: next.focus, goal: next.goal} : null, courseComplete, rewardGame};
  if (rewardGame) rewardFollowUp = result;
  else scheduleCompletionFollowUp(lessonId, result);
  return result;
}

function startNextLesson(lessonId) {
  if (sessionMode !== 'lesson' || lessonId !== currentLesson?.id) return {started: false, reason: 'الدرس الحالي تغيّر.'};
  const next = lessonAfterCurrent();
  if (!next) {
    const programLessons = allLessons().filter(lesson => lesson.programId === currentLesson.programId);
    const courseComplete = programLessons.length > 0 && programLessons.every(lesson => mastered.has(lesson.id));
    return {started: false, courseComplete, reason: courseComplete ? 'اكتملت دروس المسار.' : 'لا يوجد درس غير متقن بعد هذا الدرس.'};
  }
  selectLessonInApp(next);
  return {started: true, currentLesson: lessonForModel(next)};
}

function openParentPickerFromTutor() {
  if (isActive || isStarting) stopSession();
  openParentSettings('lessons');
  $('#parentProgress').textContent = 'لولو قالت إن الدرس خلص. اختاري لها الدرس أو الاختبار المناسب من القائمة.';
  return {opened: true};
}

function saveTestResult(lessonId, questionResults, totalQuestions) {
  if (sessionMode !== 'test' || lessonId !== currentLesson?.id || totalQuestions !== 5 || !Array.isArray(questionResults) || questionResults.length !== 5 || questionResults.some(item => typeof item?.question !== 'string' || !item.question.trim() || typeof item?.answer !== 'string' || !item.answer.trim() || typeof item?.correct_answer !== 'string' || !item.correct_answer.trim() || typeof item.is_correct !== 'boolean')) {
    return {saved: false};
  }
  for (const [index, item] of questionResults.entries()) {
    if (activeAnswerEvents.some(event => event.question_number === index + 1)) continue;
    const stats = lessonStats[lessonId] || {correct: 0, wrong: 0};
    stats[item.is_correct ? 'correct' : 'wrong'] = (Number(stats[item.is_correct ? 'correct' : 'wrong']) || 0) + 1;
    stats.history = Array.isArray(stats.history) ? stats.history : [];
    stats.history.push({answer: item.answer.trim(), is_correct: item.is_correct, mode: 'test', completedAt: new Date().toISOString()});
    stats.history = stats.history.slice(-100);
    lessonStats[lessonId] = stats;
    activeAnswerEvents.push({answer: item.answer, is_correct: item.is_correct, question_number: index + 1});
  }
  localStorage.setItem('lolo-lesson-stats', JSON.stringify(lessonStats));
  const correctAnswers = questionResults.filter(item => item.is_correct).length;
  const attempts = (testResults[lessonId]?.attempts || 0) + 1;
  const history = [...(testResults[lessonId]?.history || []), {
    questionResults: questionResults.map(item => ({question: item.question.trim(), answer: item.answer.trim(), correct_answer: item.correct_answer.trim(), is_correct: item.is_correct})),
    correct: correctAnswers, total: totalQuestions, completedAt: new Date().toISOString(),
  }].slice(-10);
  testResults[lessonId] = {
    correct: correctAnswers,
    total: totalQuestions,
    passed: correctAnswers >= 4,
    attempts,
    completedAt: new Date().toISOString(),
    questionResults: history.at(-1).questionResults,
    history,
  };
  localStorage.setItem('lolo-test-results', JSON.stringify(testResults));
  updateProgress();
  renderParentReport();
  refreshLessonPicker(currentLesson.programId, currentLesson.unitId);
  return {saved: true, correct: correctAnswers, total: totalQuestions, passed: correctAnswers >= 4, attempts};
}

function handleToolCall(toolCall) {
  const functionResponses = [];
  for (const call of toolCall.functionCalls || []) {
    if (call.name === 'show_math_scene') {
      functionResponses.push({name: call.name, id: call.id, response: {result: showMathScene(call.args || {})}});
    } else if (call.name === 'record_lesson_mastery') {
      const result = updateCurrentLesson(call.args?.lesson_id, call.args?.correct_responses, call.args?.evidence);
      functionResponses.push({name: call.name, id: call.id, response: {result}});
    } else if (call.name === 'record_lesson_answer') {
      const result = recordLessonAnswer(call.args?.lesson_id || currentLesson?.id, call.args?.answer, call.args?.is_correct, call.args?.question_number);
      functionResponses.push({name: call.name, id: call.id, response: {result}});
    } else if (call.name === 'start_next_lesson') {
      functionResponses.push({name: call.name, id: call.id, response: {result: startNextLesson(call.args?.lesson_id)}});
    } else if (call.name === 'open_parent_picker') {
      functionResponses.push({name: call.name, id: call.id, response: {result: openParentPickerFromTutor()}});
    } else if (call.name === 'record_lesson_test_result') {
      const result = saveTestResult(call.args?.lesson_id, call.args?.question_results, Number(call.args?.total_questions));
      functionResponses.push({name: call.name, id: call.id, response: {result}});
    }
  }
  if (functionResponses.length) send({toolResponse: {functionResponses}});
}

function handleOpenAIToolCall(name, args, callId) {
  const call = {name, id: callId, args};
  const result = name === 'show_math_scene'
    ? showMathScene(args || {})
    : name === 'record_lesson_mastery'
    ? updateCurrentLesson(args?.lesson_id, args?.correct_responses, args?.evidence)
    : name === 'record_lesson_answer'
      ? recordLessonAnswer(args?.lesson_id || currentLesson?.id, args?.answer, args?.is_correct, args?.question_number)
    : name === 'start_next_lesson'
      ? startNextLesson(args?.lesson_id)
    : name === 'open_parent_picker'
      ? openParentPickerFromTutor()
    : name === 'record_lesson_test_result'
      ? saveTestResult(args?.lesson_id, args?.question_results, Number(args?.total_questions))
      : null;
  if (result && realtimeChannel?.readyState === 'open') {
    realtimeChannel.send(JSON.stringify({type: 'conversation.item.create', item: {
      type: 'function_call_output', call_id: call.id, output: JSON.stringify(result),
    }}));
    realtimeChannel.send(JSON.stringify({type: 'response.create'}));
  }
}

function handleOpenAIMessage(event) {
  let message;
  try { message = JSON.parse(event.data); } catch { return; }
  if (message.type === 'response.output_audio.delta') noteTutorOutput();
  if (message.type === 'response.output_audio_transcript.delta' || message.type === 'response.output_audio_transcript.done' || message.type === 'response.output_text.delta') {
    const transcript = message.delta || message.transcript || '';
    if (transcript) { noteTutorOutput(); pendingTutorFeedback = appendTranscript(pendingTutorFeedback, transcript); setStatus('لولو بتتكلم'); highlightBoardSpeech(transcript); }
  } else if (message.type === 'conversation.item.input_audio_transcription.completed') {
    if (isActive) {
      if (!answerPending) { answerTurnId++; pendingChildAnswer = ''; pendingTutorFeedback = ''; }
      pendingChildAnswer = message.transcript || '';
      answerPending = true; updateProgress();
    }
  } else if (message.type === 'input_audio_buffer.speech_started') {
    setStatus('سامعة صوتك');
  } else if (message.type === 'response.created') {
    modelSpeaking = true; $('#buddy').classList.add('talking'); $('#soundWave').classList.add('on');
  } else if (message.type === 'response.done') {
    recordFromSpokenFeedback();
    settleUnscoredAnswer();
    modelSpeaking = false; $('#buddy').classList.remove('talking'); setStatus('دورك تتكلمي');
  } else if (message.type === 'response.function_call_arguments.done') {
    let args = {};
    try { args = JSON.parse(message.arguments || '{}'); } catch {}
    handleOpenAIToolCall(message.name, args, message.call_id);
  } else if (message.type === 'error') {
    const detail = message.error?.message || 'حصلت مشكلة في جلسة OpenAI.';
    if (setupHandshake) { setupHandshake.reject(new Error(detail)); setupHandshake = null; }
    else showError(detail);
  }
}

async function handleGeminiMessage(event) {
  let message;
  try {
    let data = event.data;
    if (data instanceof ArrayBuffer) data = new TextDecoder().decode(data);
    else if (data instanceof Blob) data = await data.text();
    message = JSON.parse(data);
  } catch { return; }
  if (message.setupComplete) {
    if (setupHandshake) {
      setupHandshake.resolve();
      setupHandshake = null;
    }
    isActive = true;
    isStarting = false;
    if (!$('#app').classList.contains('ready')) {
      localStorage.setItem('lolo-onboarding-complete', 'true');
      localStorage.setItem('lolo-welcome-tour-v1-complete', 'true');
      $('#app').classList.add('ready');
    }
    $('#mic').disabled = false;
    setListening(true);
    setStatus('المعلمة سامعاكي');
    return;
  }
  if (message.serverContent) {
    const content = message.serverContent;
    if (content.interrupted) {
      stopPlayback();
      modelSpeaking = false;
      $('#buddy').classList.remove('talking');
      $('#soundWave').classList.add('on');
      setStatus('دورك تتكلمي');
    }
    for (const part of content.modelTurn?.parts || []) {
      if (part.inlineData?.data) {
        noteTutorOutput();
        modelSpeaking = true;
        $('#buddy').classList.add('talking');
        $('#soundWave').classList.add('on');
        playPcm24k(part.inlineData.data);
      }
    }
    if (content.inputTranscription?.text) {
      setStatus('سامعة صوتك');
      if (!answerPending) { answerTurnId++; pendingChildAnswer = ''; pendingTutorFeedback = ''; }
      pendingChildAnswer = appendTranscript(pendingChildAnswer, content.inputTranscription.text);
    }
    if (content.outputTranscription?.text) {
      noteTutorOutput();
      pendingTutorFeedback = appendTranscript(pendingTutorFeedback, content.outputTranscription.text);
      setStatus('لولو بتتكلم');
      highlightBoardSpeech(content.outputTranscription.text);
    }
    if (content.inputTranscription?.text && isActive) {
      answerPending = true;
      updateProgress();
    }
    if (content.turnComplete || content.generationComplete) {
      recordFromSpokenFeedback();
      settleUnscoredAnswer();
      modelSpeaking = false;
      $('#buddy').classList.remove('talking');
      $('#soundWave').classList.add('on');
      setStatus('دورك تتكلمي');
    }
  }
  if (message.toolCall) handleToolCall(message.toolCall);
  if (message.goAway) setStatus('هنقفل الدرس بعد اللحظة دي');
  if (message.error) {
    const detail = message.error.message || 'حصلت مشكلة في جلسة Gemini.';
    if (setupHandshake) {
      setupHandshake.reject(new Error(detail));
      setupHandshake = null;
    } else {
      showError(detail);
    }
  }
}

function closeProviderTransport() {
  if (setupHandshake) { setupHandshake.reject(new Error('تغيير مزود الصوت.')); setupHandshake = null; }
  if (socket) { socket.onmessage = null; socket.onclose = null; socket.onerror = null; try { socket.close(); } catch {} }
  try { realtimeChannel?.close(); } catch {}
  try { realtimePeer?.close(); } catch {}
  if (remoteAudio) { remoteAudio.srcObject = null; remoteAudio.remove(); }
  socket = null; realtimeChannel = null; realtimePeer = null; remoteAudio = null; activeProvider = null;
}

async function providerToken(provider) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  let response;
  try {
    response = await fetch('/api/provider-token', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, signal: controller.signal,
      body: JSON.stringify({provider, lessonId: currentLesson?.id || 'course-complete', mode: sessionMode, alreadyMastered: sessionMode === 'lesson' && mastered.has(currentLesson?.id), excellenceCount: Number(lessonExcellence[currentLesson?.id]) || 0, teacherSettings: {speechPace: parentSettings.speechPace, hintLevel: parentSettings.hintLevel, repeatWords: parentSettings.repeatWords}}),
    });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`انتهت مهلة الاتصال بـ ${provider}.`);
    throw error;
  } finally { clearTimeout(timeout); }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'تعذر تجهيز مزود الصوت.');
  return data;
}

function waitForSetup(timeoutMs, name) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (setupHandshake) { setupHandshake = null; reject(new Error(`${name} ما أكدش جاهزية الاتصال.`)); }
    }, timeoutMs);
    setupHandshake = {resolve: () => { clearTimeout(timeout); setupHandshake = null; resolve(); }, reject: error => { clearTimeout(timeout); setupHandshake = null; reject(error); }};
  });
}

async function connectGemini(provider) {
  const data = await providerToken(provider);
  activeProvider = provider;
  const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(data.token)}`;
  const ready = waitForSetup(12000, 'Gemini');
  ready.catch(() => {});
  socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  socket.onmessage = handleGeminiMessage;
  socket.onopen = () => socket.send(JSON.stringify({setup: {model: data.model, ...data.config}}));
  socket.onerror = () => { if (setupHandshake) setupHandshake.reject(new Error('تعذر فتح اتصال Gemini Live.')); };
  socket.onclose = event => {
    if (setupHandshake) setupHandshake.reject(new Error(`Gemini قفل الاتصال قبل التجهيز؛ رمز ${event.code}.`));
    if (isActive) { closeSession(); if (event.code !== 1000) showError('اتقطع اتصال Gemini. ابدئي الدرس مرة تانية.'); }
  };
  await ready;
}

async function connectOpenAI() {
  if (!window.RTCPeerConnection) throw new Error('المتصفح لا يدعم اتصال OpenAI الصوتي.');
  const data = await providerToken('openai');
  activeProvider = 'openai';
  realtimePeer = new RTCPeerConnection();
  remoteAudio = document.createElement('audio');
  remoteAudio.autoplay = true; remoteAudio.playsInline = true; remoteAudio.style.display = 'none';
  document.body.appendChild(remoteAudio);
  realtimePeer.ontrack = event => { remoteAudio.srcObject = event.streams[0]; remoteAudio.play().catch(() => {}); };
  for (const track of micStream.getAudioTracks()) realtimePeer.addTrack(track, micStream);
  realtimeChannel = realtimePeer.createDataChannel('oai-events');
  realtimeChannel.onmessage = handleOpenAIMessage;
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('OpenAI لم يجهز القناة الصوتية.')), 12000);
    realtimeChannel.onopen = () => { clearTimeout(timer); resolve(); };
    realtimeChannel.onerror = () => { clearTimeout(timer); reject(new Error('تعذر فتح قناة OpenAI الصوتية.')); };
  });
  ready.catch(() => {});
  const offer = await realtimePeer.createOffer();
  await realtimePeer.setLocalDescription(offer);
  const response = await fetch('https://api.openai.com/v1/realtime/calls', {
    method: 'POST', body: offer.sdp,
    headers: {Authorization: `Bearer ${data.token}`, 'Content-Type': 'application/sdp'},
  });
  if (!response.ok) {
    const rawError = await response.text();
    let detail = rawError;
    try { detail = JSON.parse(rawError).error?.message || rawError; } catch {}
    throw new Error(`OpenAI رفض اتصال الصوت (HTTP ${response.status})${detail ? `: ${detail.slice(0, 240)}` : '.'}`);
  }
  await realtimePeer.setRemoteDescription({type: 'answer', sdp: await response.text()});
  await ready;
}

async function startSession() {
  if (isStarting || isActive) return;
  isStarting = true;
  answerPending = false;
  pendingChildAnswer = '';
  pendingTutorFeedback = '';
  answerTurnId = 0;
  gradedAnswerTurnId = 0;
  clearCompletionFollowUp();
  activeAnswerEvents = [];
  updateProgress();
  $('#welcomeStart').disabled = true; $('#mic').disabled = true;
  $('#errorDot').classList.remove('show'); $('#welcomeError').textContent = '';
  currentLesson = currentLesson || nextLesson();
  lessonWasMasteredAtStart = sessionMode === 'lesson' && mastered.has(currentLesson?.id);
  replayHonoredThisSession = false;
  cardsFor(currentLesson); updateProgress(); setStatus('جاري توصيل لولو');
  try {
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode || !window.WebSocket) throw new Error('الميكروفون يحتاج متصفحاً حديثاً ورابط HTTPS أو localhost.');
    const providerStatusPromise = fetch('/api/status').then(response => {
      if (!response.ok) throw new Error('تعذر قراءة إعدادات الصوت.');
      return response.json();
    });
    micStream = await navigator.mediaDevices.getUserMedia({audio: {channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true}, video: false});
    audioContext = new AudioContext({latencyHint: 'interactive'}); await audioContext.resume(); await audioContext.audioWorklet.addModule('/pcm-processor.js');
    micSource = audioContext.createMediaStreamSource(micStream);
    audioWorklet = new AudioWorkletNode(audioContext, 'pcm16-input', {numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1]});
    audioWorklet.port.onmessage = event => streamAudioToGemini(event.data);
    micSource.connect(audioWorklet); audioWorklet.connect(audioContext.destination);
    const status = await providerStatusPromise;
    const order = ['openai', 'gemini', 'gemini-backup'].filter(provider => status.providers?.includes(provider));
    if (!order.length) throw new Error('مفيش مفاتيح API متسجلة في ملف .env.');
    const failures = [];
    for (const provider of order) {
      setStatus('لولو بتجهز الدرس…');
      try { if (provider === 'openai') await connectOpenAI(); else await connectGemini(provider); break; }
      catch (error) { failures.push({provider, message: error.message}); closeProviderTransport(); }
    }
    if (!activeProvider) throw new Error('تعذر الاتصال بكل مزودي الصوت. ' + failures.map(item => item.message).join(' — '));
    isActive = true; isStarting = false;
    updateProgress();
    $('#app').classList.add('in-lesson');
    if (!$('#app').classList.contains('ready')) { localStorage.setItem('lolo-onboarding-complete', 'true'); localStorage.setItem('lolo-welcome-tour-v1-complete', 'true'); $('#app').classList.add('ready'); }
    $('#mic').disabled = false; setListening(true);
    const connectedName = activeProvider === 'openai' ? 'OpenAI' : 'Gemini';
    setStatus('لولو سامعاكي عبر ' + connectedName);
    const openAIFailure = failures.find(item => item.provider === 'openai');
    if (openAIFailure) showError(`${openAIFailure.message} شغالة دلوقتي على ${connectedName} الاحتياطي.`);
    const isMathLesson = programList().find(program => program.id === currentLesson?.programId)?.subject === 'math';
    const mathContext = isMathLesson ? ` الحالة الدقيقة لما يظهر على الشاشة الآن: ${mathVisualState()}. هذه هي الحقيقة الوحيدة عن العناصر المرئية؛ معلومات الدرس وبطاقاته ليست معروضة. لا تذكري أي شيء أو لون أو رقم أو كمية غير واردة في الحالة المرئية. إذا احتجتِ مثالاً جديداً، اعرضيه أولاً بأداة المشهد ثم اذكريه بعد تأكيد ظهور نتيجتها.` : '';
    const visibleCards = (currentLesson?.cards || []).map(card => card[1]).filter(Boolean).join('، ');
    const lessonTitle = currentLesson?.title || currentLesson?.focus || 'درسنا النهارده';
    const replayOpening = lessonWasMasteredAtStart
      ? `الدرس ${lessonTitle} متقن من قبل. ابدئي بسؤالها بصوتك: «إحنا خلصنا الدرس ده قبل كده يا بطلة؛ تحبي نعيده سوا؟» لا تعيدي الشرح ولا تطرحي أسئلة تقييمية ولا تسجلي أي إجابة قبل أن توافق بوضوح. إذا وافقت، ابدئي مراجعة قصيرة لهذا الدرس واسألي سؤالاً واحداً في كل مرة. إذا لم توافق، قولي لها تسلم الهاتف لماما لتختار درساً آخر.`
      : null;
    const opening = replayOpening || (isMathLesson
      ? (sessionMode === 'test'
        ? `ابدئي الآن بصوتك من غير انتظار كلام الطفلة. قدمي سؤال الاختبار الأول فقط: ${mathOpeningScript()} انتظري إجابتها، ولا تذكري شيئاً خارج الحالة المرئية.`
        : `قولي الآن هذه الافتتاحية في رد صوتي واحد: ${mathOpeningScript()} بعد السؤال اسكتي واسمعي إجابتها. لا تضيفي شيئاً غير الموجود في الحالة المرئية.`) + mathContext
      : sessionMode === 'test'
        ? `ابدئي الكلام فوراً: أهلاً يا بطلة، ده اختبار صغير على ${lessonTitle}. هنلعب خمس أسئلة، سؤال سؤال. ابدئي بأول سؤال مرتبط بالدرس وانتظري إجابتها.`
        : `ابدئي الكلام فوراً من غير انتظار الطفلة: أهلاً يا بطلة! درسنا النهارده ${lessonTitle}. ${currentLesson?.goal || currentLesson?.focus || ''} الصور الظاهرة قدامك هي: ${visibleCards || 'اختيارات الدرس المصورة'}. اشرحي فكرة واحدة بجملتين بسيطتين، واسألي سؤالاً سهلاً من الصور دي عشان تبدأ.`);
    if (activeProvider === 'openai') sendOpenAIText(opening);
    else send({clientContent: {turns: [{role: 'user', parts: [{text: opening}]}], turnComplete: true}});
    sessionLimitTimer = setTimeout(() => {
      if (!isActive) return;
      const breakMessage = 'وقت الدرس خلص دلوقتي. امدحي الطفلة على اللي عملته، وقولي لها إن وقت راحة قصير جه، وما تفتحيش سؤالاً جديداً. بعد رسالة صوتية قصيرة، اقفلي الجلسة بلطف.';
      sendTeacherTurn(breakMessage);
      setTimeout(() => { if (isActive) stopSession(); }, 12000);
    }, Math.max(1, Math.min(30, Number(parentSettings.sessionMinutes) || 10)) * 60 * 1000);
  } catch (error) { closeSession(); showError(error.message || 'مقدرناش نفتح الميكروفون.'); }
  finally { isStarting = false; $('#mic').disabled = false; $('#welcomeStart').disabled = $('#app').classList.contains('ready'); }
}
function stopSession() {
  if (!isActive && !isStarting) return;
  if (socket?.readyState === WebSocket.OPEN) send({realtimeInput: {audioStreamEnd: true}});
  closeSession();
  sessionMode = 'lesson';
  $('#app').classList.remove('assessment');
  $('#app').classList.remove('in-lesson');
  updateDashboardLesson();
  setStatus('انتهى الدرس');
}

$('#mic').onclick = () => isActive || isStarting ? stopSession() : startSession();
$('#rewardSkip').onclick = () => finishRewardGame(false);
$('#homeStart').onclick = startSession;
$('#homeChoose').onclick = () => openParentSettings('lessons');
function saveParentSettings() {
  parentSettings = {
    ...parentSettings,
    sessionMinutes: Math.max(1, Math.min(30, Number($('#sessionMinutes').value) || 10)),
    speechPace: $('#speechPace').value === 'normal' ? 'normal' : 'slow',
    hintLevel: $('#hintLevel').value === 'guided' ? 'guided' : 'gentle',
    repeatWords: $('#repeatWords').checked,
    rewardEnabled: $('#rewardEnabled').checked,
    rewardSeconds: Math.max(4, Math.min(15, Number($('#rewardSeconds').value) || 9)),
    learningPath: $('#learningPath').value === 'foundation-first' ? 'foundation-first' : 'selected',
  };
  localStorage.setItem('lolo-parent-settings', JSON.stringify(parentSettings));
  $('#settingsSaved').textContent = 'اتحفظت الإعدادات على الجهاز ✅';
  if (!isActive && !isStarting && parentSettings.learningPath === 'foundation-first') {
    const firstFoundation = allLessons().find(lesson => lesson.programId === 'foundation' && !mastered.has(lesson.id));
    if (firstFoundation) {
      currentLesson = firstFoundation;
      sessionMode = 'lesson';
      localStorage.setItem('lolo-current-lesson', currentLesson.id);
      localStorage.setItem('lolo-selected-program', currentLesson.programId);
      cardsFor(currentLesson); updateLessonBadge(currentLesson); updateDashboardLesson(); updateProgress();
      refreshLessonPicker(currentLesson.programId, currentLesson.unitId);
    }
  }
  renderParentReport();
}

function renderParentReport() {
  const report = $('#parentReport');
  if (!report) return;
  report.replaceChildren();
  const programId = $('#trackSelect')?.value || currentLesson?.programId || localStorage.getItem('lolo-selected-program');
  const lessons = allLessons().filter(lesson => !programId || lesson.programId === programId);
  const completed = lessons.filter(lesson => mastered.has(lesson.id)).length;
  const testEntries = lessons.filter(lesson => testResults[lesson.id]);
  const traceEntries = lessons.filter(lesson => traceResults[lesson.id]);
  const correct = lessons.reduce((sum, lesson) => sum + (Number(lessonStats[lesson.id]?.correct) || 0), 0);
  const wrong = lessons.reduce((sum, lesson) => sum + (Number(lessonStats[lesson.id]?.wrong) || 0), 0);
  const total = correct + wrong;
  const addCard = (title, body) => {
    const card = document.createElement('div'); card.className = 'parent-report-card';
    const strong = document.createElement('strong'); strong.textContent = `${title} `;
    const text = document.createElement('span'); text.textContent = body;
    card.append(strong, text); report.appendChild(card);
  };
  addCard('الدروس', `${completed} من ${lessons.length} مكتمل`);
  addCard('الإجابات', `${correct} صح · ${wrong} محتاجة مراجعة · ${total ? Math.round(correct / total * 100) : 0}% صح`);
  addCard('الاختبارات', `${testEntries.length} شفهي · ${traceEntries.length} كتابة باللمس`);
  const activeProgram = programList().find(program => program.id === programId);
  if (activeProgram) {
    const pathResults = writingPathResults[activeProgram.id] || {};
    const done = Object.values(pathResults).filter(result => (result?.bestPercent || result?.percent || 0) >= 75).length;
    const stageCount = writingStages(activeProgram).length;
    addCard(activeProgram.subject === 'math' ? 'مسار الماث المتقدم' : 'مسار الكتابة المتقدمة', `${done} من ${stageCount} مراحل متقنة${writingPathOverrides[activeProgram.id] ? ' · فتح وليّ الأمر كل المراحل' : ''}`);
  }
  for (const lesson of lessons) {
    const stats = lessonStats[lesson.id] || {};
    const result = testResults[lesson.id];
    const trace = traceResults[lesson.id];
    if (!stats.correct && !stats.wrong && !result && !trace) continue;
    const details = [];
    if (stats.correct || stats.wrong) details.push(`${stats.correct || 0} صح و${stats.wrong || 0} محتاجة مراجعة`);
    if (result) details.push(`الاختبار ${result.correct}/${result.total}`);
    if (trace) details.push(`الكتابة باللمس ${trace.percent}% · ${trace.scores.map(item => `${item.value} ${item.score}%`).join('، ')}`);
    const history = Array.isArray(stats.history) ? stats.history : [];
    const errors = history.filter(item => item.is_correct === false).slice(-3);
    if (errors.length) details.push(`آخر إجابات للمراجعة: ${errors.map(item => item.answer || 'إجابة غير مسجلة').join('، ')}`);
    if (result?.questionResults?.some(item => !item.is_correct)) details.push(`أسئلة الاختبار: ${result.questionResults.filter(item => !item.is_correct).map(item => `${item.question} (قالت: ${item.answer}؛ الصح: ${item.correct_answer})`).join(' | ')}`);
    addCard(lesson.title || lesson.focus, details.join(' · '));
  }
  if (!lessons.length) addCard('مفيش دروس ظاهرة', 'اختاري الصف والمنهج الأول.');
}

function syncParentSettingsUI() {
  $('#sessionMinutes').value = String(parentSettings.sessionMinutes);
  $('#speechPace').value = parentSettings.speechPace;
  $('#hintLevel').value = parentSettings.hintLevel;
  $('#repeatWords').checked = parentSettings.repeatWords;
  $('#rewardEnabled').checked = parentSettings.rewardEnabled;
  $('#rewardSeconds').value = String(parentSettings.rewardSeconds);
  $('#learningPath').value = parentSettings.learningPath;
}

function showParentTab(tab) {
  const settings = tab === 'settings';
  $('#parentLessonsPanel').hidden = settings;
  $('#parentSettingsPanel').hidden = !settings;
  $('#parentLessonsTab').setAttribute('aria-selected', String(!settings));
  $('#parentSettingsTab').setAttribute('aria-selected', String(settings));
  $('#parentSheetTitle').textContent = settings ? 'إعدادات وليّ الأمر' : 'اختيار الدروس والاختبارات';
  $('#parentScroll').scrollTop = 0;
}

function openParentSettings(tab = 'settings') {
  $('#parentSheet').classList.add('open');
  $('#parentSheet').setAttribute('aria-hidden', 'false');
  showParentTab(tab);
  syncParentSettingsUI();
  renderParentReport();
  $('#parentProgress').textContent = `${parentProgressSummary()} تقدري تختاري أي درس أو تعيدي دروس سابقة في أي وقت.`;
  fetch('/api/status').then(response => response.json()).then(status => {
    const labels = {gemini: 'Gemini الأساسي', openai: 'OpenAI', 'gemini-backup': 'Gemini الاحتياطي'};
    const enabled = (status.providers || []).map(provider => labels[provider]);
    $('#apiState').textContent = enabled.length
      ? `المزوّدات الجاهزة بالترتيب: ${enabled.join(' ← ')}. عند تعذّر الاتصال ينتقل التطبيق تلقائياً للتالي.`
      : 'لا توجد مفاتيح API. أضيفيها إلى .env ثم أعيدي تشغيل الخادم.';
  }).catch(() => $('#apiState').textContent = 'تعذر فحص حالة الخادم.');
}
$('#parentOpen').onclick = () => openParentSettings('settings');
$('#parentOpenWelcome').onclick = () => openParentSettings('settings');
$('#parentLessonsTab').onclick = () => showParentTab('lessons');
$('#parentSettingsTab').onclick = () => showParentTab('settings');
for (const id of ['learningPath', 'sessionMinutes', 'speechPace', 'hintLevel', 'rewardSeconds']) $(`#${id}`).onchange = saveParentSettings;
for (const id of ['repeatWords', 'rewardEnabled']) $(`#${id}`).onchange = saveParentSettings;
$('#lessonTab').onclick = () => showPickerTab('lessons');
$('#testsTab').onclick = () => showPickerTab('tests');
$('#gradeSelect').onchange = () => {
  refreshLessonPicker(null, null, $('#gradeSelect').value);
  selectProgram($('#trackSelect').value);
  renderParentReport();
};
$('#trackSelect').onchange = () => { selectProgram($('#trackSelect').value); renderParentReport(); };
$('#unitSelect').onchange = () => { refreshLessonPicker($('#trackSelect').value, $('#unitSelect').value); renderParentReport(); };
$('#welcomeGradeSelect').onchange = () => syncWelcomePrograms($('#welcomeGradeSelect').value);
$('#welcomeProgramSelect').onchange = () => {
  const programId = $('#welcomeProgramSelect').value;
  if (programId) selectProgram(programId);
  $('#welcomeStart').disabled = !programId;
};
$('#welcomeNext').onclick = () => showWelcomeStep(welcomeStep + 1);
$('#welcomeSkip').onclick = () => showWelcomeStep(2);
document.querySelectorAll('.welcome-audio').forEach(button => {
  button.onclick = () => playWelcomeNarration(button.dataset.audioStep, button);
});
$('#welcomeAudio').onended = () => {
  const button = document.querySelector(`.welcome-audio[data-audio-step="${['welcome', 'howto', 'course'][welcomeStep]}"]`);
  if (button) button.textContent = welcomeStep === 0 ? '🔊 اسمعي ترحيب لولو' : welcomeStep === 1 ? '🔊 اسمعي طريقة اللعب' : '🔊 اسمعي شرح الاختيار';
  $('#welcomeAudioStatus').textContent = 'خلصنا الجولة الصوتية 💛';
};
$('#welcomeStart').onclick = enterAppFromWelcome;
$('#parentClose').onclick = () => {
  $('#parentSheet').classList.remove('open');
  $('#parentSheet').setAttribute('aria-hidden', 'true');
};
$('#parentSheet').onclick = event => {
  if (event.target === $('#parentSheet')) $('#parentClose').click();
};
$('#resetCourse').onclick = () => {
  if (!confirm('نرجع تقدم الدروس للبداية؟')) return;
  stopSession();
  mastered.clear();
  lessonExcellence = {};
  testResults = {};
  traceResults = {};
  writingPathResults = {};
  writingPathOverrides = {};
  lessonStats = {};
  activeAnswerEvents = [];
  sessionMode = 'lesson';
  localStorage.removeItem('lolo-mastered');
  localStorage.removeItem('lolo-lesson-excellence');
  localStorage.removeItem('lolo-test-results');
  localStorage.removeItem('lolo-trace-results');
  localStorage.removeItem('lolo-writing-path-results');
  localStorage.removeItem('lolo-writing-path-overrides');
  localStorage.removeItem('lolo-lesson-stats');
  localStorage.removeItem('lolo-explicit-lesson-choice');
  currentLesson = nextLesson() || allLessons()[0] || null;
  if (currentLesson) localStorage.setItem('lolo-current-lesson', currentLesson.id);
  updateProgress();
  cardsFor(currentLesson);
  updateLessonBadge(currentLesson);
  updateDashboardLesson();
  refreshLessonPicker(currentLesson?.programId, currentLesson?.unitId);
  renderParentReport();
};
$('#clearAnswerHistory').onclick = () => {
  if (!confirm('نمسح سجل الإجابات وتفاصيل الاختبارات؟ تقدم الدروس والشارات هيفضلوا محفوظين.')) return;
  lessonStats = {};
  testResults = {};
  traceResults = {};
  writingPathResults = {};
  localStorage.removeItem('lolo-lesson-stats');
  localStorage.removeItem('lolo-test-results');
  localStorage.removeItem('lolo-trace-results');
  localStorage.removeItem('lolo-writing-path-results');
  updateProgress();
  refreshLessonPicker(currentLesson?.programId, currentLesson?.unitId);
  renderParentReport();
};

if (location.protocol === 'file:') {
  location.replace('http://localhost:4173/');
} else {
  fetch('/curriculum.json').then(response => {
    if (!response.ok) throw new Error();
    return response.json();
  }).then(data => {
    course = data;
    const needsCurriculumSetup = !localStorage.getItem('lolo-selected-program');
    const savedLessonId = localStorage.getItem('lolo-current-lesson');
    const selectedProgram = localStorage.getItem('lolo-selected-program');
    currentLesson = allLessons().find(lesson => lesson.id === savedLessonId && (!selectedProgram || lesson.programId === selectedProgram))
      || (selectedProgram ? allLessons().find(lesson => lesson.programId === selectedProgram && !mastered.has(lesson.id)) : null)
      || nextLesson();
    if (currentLesson) localStorage.setItem('lolo-current-lesson', currentLesson.id);
    updateLessonBadge(currentLesson);
    updateDashboardLesson();
    refreshLessonPicker(currentLesson?.programId, currentLesson?.unitId);
    if (needsCurriculumSetup) {
      localStorage.removeItem('lolo-selected-program');
      localStorage.removeItem('lolo-grade-id');
      fillGradeSelect($('#welcomeGradeSelect'), '', true);
      syncWelcomePrograms('', '');
    } else {
      const welcomeProgram = programList().find(program => program.id === selectedProgram);
      fillGradeSelect($('#welcomeGradeSelect'), welcomeProgram?.gradeId || '');
      syncWelcomePrograms(welcomeProgram?.gradeId || '', selectedProgram);
    }
    showWelcomeStep(0);
    cardsFor(currentLesson);
    updateProgress();
    $('#mic').disabled = false;
    if (localStorage.getItem('lolo-welcome-tour-v1-complete') === 'true' && !needsCurriculumSetup) $('#app').classList.add('ready');
  }).catch(() => {
    showError('المنهج مش ظاهر. راجعي ملفات التطبيق.');
    $('#mic').disabled = false;
  });
}
