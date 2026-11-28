const $ = selector => document.querySelector(selector);
const storage = window.LoloStorage;
const assessmentEngine = window.LoloAssessment.create();
const curriculumEngine = window.LoloCurriculum;
const learningEngine = window.LoloLearning;
const pathEngine = window.LoloLearningPath;
const subjectCatalog=window.LoloSubjectCatalog;
const visualAssessment=window.LoloVisualAssessment;
const visualBank=window.LoloVisualBank;
const VISUAL_HISTORY_KEY='lolo-visual-assessment-v1';
let visualHistory=storage.getJSON(VISUAL_HISTORY_KEY,{});
let visualSession=null;
let visualBankReady=false;
const nativeBundle=window.LoloNativeBundled===true;
const nativeApi=nativeBundle ? options=>{
  const plugin=window.Capacitor?.Plugins?.CapacitorHttp;
  if(!plugin?.request)throw new Error('خدمة الاتصال في التطبيق غير متاحة.');
  return plugin.request(options);
} : null;
const network=window.LoloNetwork.create({nativeRequest:nativeApi,onState:renderNetworkNotice});
const apiFetch=(path,options)=>network.request(path,options);
const PATH_KEY = 'lolo-learning-path-v1';
let activePath = null;
let invalidPath = false;
let learningDeadline = 0;
let pendingPathCompletion = null;
let openAIAudioPlaying = false;
const parentGate = window.LoloParentGate.create(storage);
const sessionTimers = window.LoloSessionTimers.create();
window.addEventListener('lolo-storage-warning', event => showError(event.detail));
if (storage.get('lolo-welcome-tour-v1-complete') === 'true' && storage.get('lolo-selected-program')) $('#app')?.classList.add('ready');

let course = null;
let currentLesson = null;
let mastered = new Set(storage.getJSON('lolo-mastered', []));
let lessonExcellence = storage.getJSON('lolo-lesson-excellence', {});
let testResults = storage.getJSON('lolo-test-results', {});
let traceResults = storage.getJSON('lolo-trace-results', {});
let writingPathResults = storage.getJSON('lolo-writing-path-results', {});
let writingPathOverrides = storage.getJSON('lolo-writing-path-overrides', {});
let traceSpeechRequestId = 0;
let traceSpeechAudio = null;
let lessonStats = storage.getJSON('lolo-lesson-stats', {});
let skillProgress = learningEngine.createStore(storage.getJSON('lolo-skill-progress-v1', {}));
let parentGatePurpose = {type: 'open', tab: 'settings'};
let parentGateAutoLockTimer = null;
let parentGateRecoveryPurpose = 'open';
let parentGateReturnFocus = null;
const DEFAULT_PARENT_SETTINGS = {sessionMinutes: 10, speechPace: 'slow', hintLevel: 'gentle', repeatWords: true, rewardEnabled: true, rewardSeconds: 9, learningPath: 'selected', remindersEnabled:false, dailyReminder:false, reminderHour:17};
let parentSettings = {...DEFAULT_PARENT_SETTINGS, ...storage.getJSON('lolo-parent-settings', {})};
let sessionMode = 'lesson';
let activeAnswerEvents = [];
let activeSpeakingAssessment = null;
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
let sessionController = null;
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

function allLessons() { return subjectCatalog.lessons(course); }

function nextLesson() {
  const selectedProgram = storage.get('lolo-path-program') || storage.get('lolo-selected-program');
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

function programList() { return subjectCatalog.programs(course); }
function lessonSubject(lesson){return subjectCatalog.forProgram(programList().find(p=>p.id===lesson?.programId),course);}

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
  if(navigator.onLine===false&&!welcomeAudioCache.has(step)){network.markOffline();$('#welcomeAudioStatus').textContent='صوت الترحيب يحتاج نت. تقدري تكملي الاختيار من غير صوت.';return;}
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
      const response = await apiFetch('/api/onboarding-audio', {
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
      $('#welcomeAudioStatus').textContent = 'صوت الترحيب مش متاح دلوقتي. تقدري تكملي من غير صوت.';
    }
    $('#welcomeAudioStatus').classList.add('error');
  } finally {
    button.disabled = false;
  }
}

function refreshLessonPicker(programId, unitId, requestedGradeId = '') {
  const programs = programList();
  const savedProgram = programs.find(item => item.id === programId) || programs.find(item => item.id === storage.get('lolo-selected-program'));
  const gradeId = requestedGradeId || savedProgram?.gradeId || storage.get('lolo-grade-id') || programs[0]?.gradeId;
  fillGradeSelect($('#gradeSelect'), gradeId);
  const gradePrograms = programs.filter(item => (item.gradeId || 'grade-1') === gradeId);
  fillSelect($('#trackSelect'), gradePrograms, item => item.id, item => item.curriculumLabel || item.title);
  const program = gradePrograms.find(item => item.id === programId) || gradePrograms.find(item => item.id === storage.get('lolo-selected-program')) || gradePrograms[0];
  if (!program) return;
  $('#trackSelect').value = program.id;
  syncWelcomePrograms(gradeId, program.id);
  fillSelect($('#unitSelect'), program.units, unit => unit.id, unit => unitProgressLabel(unit));
  const unit = program.units.find(item => item.id === unitId) || program.units[0];
  if (!unit) return;
  $('#unitSelect').value = unit.id;
  renderUnitSummary(unit);
  renderLessonChoices(unit);
  renderProgramTests(program);
  renderPathChoice();
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
      button.disabled=!subjectCatalog.forProgram(program,course).spokenRepeat;
      if(button.disabled)button.textContent='الصوت غير متاح';
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
      if(visualBankReady&&visualBank.bank[lesson.id]){
        const visualButton=document.createElement('button');visualButton.type='button';visualButton.className='trace-test-button';
        visualButton.textContent='⭐ فهم بالصور';
        visualButton.setAttribute('aria-label',`تحدي الفهم ${lesson.title||lesson.focus}`);
        visualButton.onclick=()=>{if(!parentGate.isUnlocked())return openParentSettings('lessons');closeParentSettings();openVisualQuiz(lesson.id);};
        row.appendChild(visualButton);
      }
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

function writingStages(program) { const mode=subjectCatalog.forProgram(program,course).writing; return mode==='math'?MATH_WRITING_STAGES:mode==='english'?ENGLISH_WRITING_STAGES:[]; }
function writingStageUnlocked(program, index) {
  if(!Number.isInteger(index)||index<0||index>=writingStages(program).length)return false;
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
  if(!stages.length)return;
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
    storage.set('lolo-writing-path-overrides', JSON.stringify(writingPathOverrides));
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
        const childAnswer = item.answer ? ` · إجابة الطفلة: ${item.answer}` : '';
        const score = Number.isFinite(item.score) ? ` · قرب التتبع: ${item.score}%` : '';
        const attemptCount = Array.isArray(item.attempts) ? item.attempts.length : 1;
        const resultLabel = item.correct ? '✅ صح' : item.status === 'partial' ? '🟠 قريبة وتحتاج تدريب' : `❌ الإجابة: ${item.expected}`;
        answer.textContent = `${item.prompt} · ${resultLabel}${childAnswer}${score} · ${attemptCount} محاولة`;
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
  const assessmentId = window.LoloAssessment.createAssessmentId();
  traceState = {mode:'advanced', programId:program.id, stageIndex, assessmentId, items:items.map((item, index) => ({...item, questionId:`${assessmentId}:q${index + 1}`, attempts:[]})), index:0, results:[], attempts:0, selected:[]};
  closeParentSettings();
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
  speakTraceFeedback(text,'ar-EG',true);
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
  state.selected = []; state.attempts = 0; state.audioBlocked=false;
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
        addWritingChoice(label, () => submitWritingAnswer(null, value));
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
  if(traceState.audioBlocked){$('#traceFeedback').textContent='اسمعي السؤال الأول أو اختاري تدريبًا آخر.';return;}
  const item = traceState.items[traceState.index];
  if (item.type === 'order') { submitWritingAnswer(null, traceState.selected.map(tile=>tile.value).join('')); return; }
  if (!traceState.hasStroke) { $('#traceFeedback').textContent='جربي تكتبي الإجابة الأول 🌼'; return; }
  const score = gradeTrace(); traceState.attempts++;
  const expected = item.expected ?? item.target;
  const evaluation = assessmentEngine.grade({
    questionId:item.questionId,
    attemptId:`${item.questionId}:attempt-${item.attempts.length + 1}`,
    kind:'handwriting', answer:'', expected:item.target,
    acceptedAnswers:item.acceptedAnswers || [item.target], quality:score,
  });
  item.attempts.push(evaluation);
  if (score < 48 && traceState.attempts < 2) {
    $('#traceFeedback').textContent='قريبة، امسحي وجربي تاني. ركّزي في شكل الحرف أو الرقم 💛';
    speakTraceFeedback('قريبة، جربي تاني يا بطلة'); drawTraceTarget(); return;
  }
  submitWritingAnswer(null, item.target, score, evaluation);
}
function submitWritingAnswer(_callerCorrect, answer, score = null, recordedEvaluation = null) {
  if(traceState?.audioBlocked){$('#traceFeedback').textContent='اسمعي السؤال الأول أو اختاري تدريبًا آخر.';return;}
  const state = traceState, item = state?.items[state.index];
  if (!state || state.mode !== 'advanced' || state.waiting) return;
  if (item.type === 'order' && state.selected.length !== item.target.length) {
    $('#traceFeedback').textContent='استخدمي كل الحروف الأول، وبعدها اضغطي «قيّمي كتابتي» 💛'; return;
  }
  state.waiting = true;
  const childAnswer = score === null ? String(answer) : 'كتبت بإصبعها';
  const expected = item.expected ?? item.target;
  const answerKey = item.target ?? expected;
  const evaluation = recordedEvaluation || assessmentEngine.grade({
    questionId:item.questionId,
    attemptId:`${item.questionId}:attempt-${item.attempts.length + 1}`,
    kind:score === null ? (item.lang === 'ar-EG' && /^\d+$/.test(String(expected)) ? 'math' : 'text') : 'handwriting',
    answer:childAnswer,
    expected:answerKey,
    acceptedAnswers:item.acceptedAnswers || [answerKey],
    quality:score,
  });
  if (!recordedEvaluation) item.attempts.push(evaluation);
  const finalCorrect = evaluation.isCorrect === true;
  state.results.push({questionId:evaluation.questionId, attemptId:evaluation.attemptId, attempts:item.attempts, prompt:item.prompt, answer:childAnswer, expected, correct:finalCorrect, status:evaluation.status, confidence:evaluation.confidence, score:evaluation.score});
  $('#traceChoices').querySelectorAll('button').forEach(button=>button.disabled=true);
  const feedback = evaluation.status === 'partial' ? 'قريبة جدًا! شكل كتابتك محتاج محاولة كمان 🌼' : finalCorrect ? 'برافو! إجابة ممتازة ⭐' : `الإجابة الصح ${expected}. نكمل ونتعلمها سوا 🌱`;
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
  storage.set('lolo-writing-path-results', JSON.stringify(writingPathResults));
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
  if(!subjectCatalog.profile(lesson?.subjectId,course).writing)return [];
  const focus = [lesson.focus, lesson.title, lesson.goal, ...(lesson.board?.tokens || []).map(token => token.text)].filter(Boolean).join(' ');
  if (subjectCatalog.profile(lesson.subjectId,course).writing==='math') {
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
  closeParentSettings();
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
  releaseTraceSpeech();
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
  storage.set('lolo-trace-results', JSON.stringify(traceResults));
  $('#traceFeedback').textContent = `خلصتي الاختبار! نتيجتك ${percent}٪ 🎉`;
  $('#traceCount').textContent = 'ممتاز، خلصتي الخمس محاولات!';
  $('#traceCanvas').hidden = true; $('#traceNext').hidden = true;
  renderParentReport(); refreshLessonPicker(traceState.lesson.programId, traceState.lesson.unitId);
}
function localSpeech(text,lang='ar-EG',onEnd=null,onError=null){
  if(!window.speechSynthesis||!window.SpeechSynthesisUtterance)return false;
  try{
    const voices=window.speechSynthesis.getVoices();
    const prefix=lang.split('-')[0].toLowerCase();
    const voice=voices.find(v=>v.localService&&v.lang.toLowerCase()===lang.toLowerCase())||voices.find(v=>v.localService&&v.lang.toLowerCase().split('-')[0]===prefix);
    if(!voice)return false;
    const utterance=new SpeechSynthesisUtterance(text);utterance.voice=voice;utterance.lang=voice.lang;utterance.rate=.85;
    if(onEnd)utterance.onend=onEnd;if(onError)utterance.onerror=onError;
    window.speechSynthesis.cancel();window.speechSynthesis.speak(utterance);return true;
  }catch{return false;}
}
function audioOnlyWritingTask(){
  return traceState?.mode==='advanced' && [1,3].includes(traceState.stageIndex) &&
    programList().find(p=>p.id===traceState.programId)?.subject!=='math';
}
function releaseTraceSpeech(){
  const audio=traceSpeechAudio;traceSpeechAudio=null;
  if(audio){audio.onended=null;audio.onerror=null;audio.pause();if(audio.dataset.loloObjectUrl)URL.revokeObjectURL(audio.dataset.loloObjectUrl);}
  window.speechSynthesis?.cancel();
}
function offlineWritingFallback(text,lang,isQuestion,requestId){
  const state=traceState;
  const stillCurrent=()=>requestId===traceSpeechRequestId&&state===traceState;
  if(isQuestion&&audioOnlyWritingTask()){
    const item=state.items[state.index];
    const fail=()=>{if(stillCurrent()){state.audioBlocked=true;$('#traceFeedback').textContent='السؤال ده محتاج صوت إنجليزي. وصّلي النت أو اختاري تدريبًا بصريًا تاني.';}};
    state.audioBlocked=true;
    const canSpeak=localSpeech(item.say,item.lang||'en-US',()=>{
      if(stillCurrent()){state.audioBlocked=false;$('#traceFeedback').textContent='صوت الجهاز المحلي · دلوقتي تقدري تجاوبي.';}
    },fail);
    if(canSpeak)$('#traceFeedback').textContent='اسمعي السؤال بصوت الجهاز المحلي.';
    else fail();
    return;
  }
  const item=isQuestion&&state?.mode==='advanced'?state.items[state.index]:null;
  if(item?.prompt==='اسمعي الحكاية وعدّي الصور.'&&item.say)$('#tracePrompt').textContent=item.say;
  const spoken=localSpeech(text,lang);
  // Do not overwrite score/correction when optional narration is unavailable.
  if(isQuestion)$('#traceFeedback').textContent=spoken?'صوت الجهاز المحلي · تقدري تكملي التدريب.':'الصوت مش متاح؛ كمّلي التدريب من التعليمات الظاهرة.';
}
function speakTraceFeedback(text,lang='ar-EG',isQuestion=false){
  const requestId=++traceSpeechRequestId,state=traceState;
  releaseTraceSpeech();
  const stillCurrent=()=>requestId===traceSpeechRequestId&&state===traceState;
  const needsAudio=isQuestion&&audioOnlyWritingTask();
  if(needsAudio)state.audioBlocked=true;
  const fallback=()=>{if(stillCurrent())offlineWritingFallback(text,lang,isQuestion,requestId);};
  if(navigator.onLine===false){network.markOffline();fallback();return;}
  apiFetch('/api/challenge-audio',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,lang})})
    .then(async response=>{
      const data=await response.json();
      if(!response.ok||!data.audio)throw Error('Audio unavailable');
      if(!stillCurrent())return;
      const bytes=Uint8Array.from(atob(data.audio),ch=>ch.charCodeAt(0));
      const audioUrl=URL.createObjectURL(new Blob([bytes],{type:data.mimeType||'audio/wav'}));
      const audio=new Audio(audioUrl);traceSpeechAudio=audio;audio.dataset.loloObjectUrl=audioUrl;
      audio.onended=()=>{if(stillCurrent()&&needsAudio)state.audioBlocked=false;URL.revokeObjectURL(audioUrl);if(traceSpeechAudio===audio)traceSpeechAudio=null;};
      audio.onerror=()=>{URL.revokeObjectURL(audioUrl);if(traceSpeechAudio===audio)traceSpeechAudio=null;fallback();};
      await audio.play();
    }).catch(fallback);
}

function chooseLesson(lessonId, mode = 'lesson', requestedPath = null) {
  if (!parentGate.isUnlocked()) return openParentSettings('lessons');
  if (isStarting && !isActive) {
    setStatus('لولو بتجهز الدرس، استني لحظة صغيرة.');
    return;
  }
  const lesson = allLessons().find(item => item.id === lessonId);
  if (!lesson) return;
  if(mode==='test'&&!lessonSubject(lesson).spokenRepeat){setStatus('الاختبار الصوتي غير متاح لهذه المادة.');return;}
  const speakingAssessment = mode === 'test' ? assessmentEngine.createSpokenAssessment(lesson) : null;
  if (speakingAssessment && !speakingAssessment.supported) {
    showError('الاختبار الصوتي لهذا الدرس لسه محتاج كلمات واضحة في المنهج.');
    return;
  }
  if (mode === 'lesson') {
    const plan = requestedPath || pathEngine.build(allLessons(), {scope:'lesson', programId:lesson.programId, unitId:lesson.unitId, lessonId:lesson.id}, mastered, course.curriculumVersion);
    if (!plan || !pathEngine.validate(plan, allLessons(), course.curriculumVersion) || pathEngine.current(plan) !== lesson.id) return showError('خطة التعلم غير صالحة.');
    if (!storage.set(PATH_KEY, JSON.stringify(plan))) return;
    activePath = plan; invalidPath = false;
  }
  if (isActive || isStarting) stopSession();
  answerPending = false;
  pendingChildAnswer = '';
  pendingTutorFeedback = '';
  answerTurnId = 0;
  gradedAnswerTurnId = 0;
  clearCompletionFollowUp();
  currentLesson = lesson;
  activeAnswerEvents = [];
  activeSpeakingAssessment = speakingAssessment;
  mathScene = null;
  $('#mathGroups').replaceChildren(); $('#mathObjects').replaceChildren(); $('#mathActions').replaceChildren(); $('#mathEquation').textContent = '';
  sessionMode = mode;
  $('#app').classList.toggle('assessment', mode === 'test');
  $('#app').classList.remove('in-lesson');
  storage.set('lolo-current-lesson', lesson.id);
  storage.set('lolo-selected-program', lesson.programId);
  storage.set('lolo-grade-id', programList().find(p=>p.id===lesson.programId)?.gradeId || '');
  storage.set('lolo-explicit-lesson-choice', 'true');
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
  storage.set('lolo-selected-program', program.id);
  if (program.id !== 'foundation') storage.set('lolo-path-program', program.id);
  storage.set('lolo-grade-id', program.gradeId || 'grade-1');
  const lessons = allLessons().filter(lesson => lesson.programId === program.id);
  currentLesson = (parentSettings.learningPath === 'foundation-first' ? allLessons().find(lesson => lesson.programId === 'foundation' && !mastered.has(lesson.id)) : null)
    || lessons.find(lesson => !mastered.has(lesson.id)) || lessons[0] || null;
  sessionMode = 'lesson';
  $('#app').classList.remove('assessment', 'in-lesson');
  if (currentLesson) {
    storage.set('lolo-current-lesson', currentLesson.id);
    cardsFor(currentLesson); updateLessonBadge(currentLesson); updateDashboardLesson();
    refreshLessonPicker(program.id, currentLesson.unitId, program.gradeId);
  }
}

function enterAppFromWelcome() {
  const gradeId = $('#welcomeGradeSelect').value;
  const programId = $('#welcomeProgramSelect').value;
  if (!gradeId || !programId) return;
  selectProgram(programId);
  if (currentLesson && !activePath && !invalidPath) {
    activePath = pathEngine.build(allLessons(), {scope:'lesson',programId:currentLesson.programId,unitId:currentLesson.unitId,lessonId:currentLesson.id}, mastered, course.curriculumVersion);
    if (activePath) storage.set(PATH_KEY, JSON.stringify(activePath));
  }
  storage.set('lolo-onboarding-complete', 'true');
  storage.set('lolo-welcome-tour-v1-complete', 'true');
  storage.set('lolo-explicit-lesson-choice', 'true');
  $('#app').classList.add('ready');
  $('#welcomeError').textContent = '';
  $('#welcomeAudio').pause();
  setStatus('اختيارك اتحفظ. دوسي «يلا نبدأ» لما تكوني جاهزة.');
}

function updateDashboardLesson() {
  if (!currentLesson) return;
  const icons = {math: '🔢', phonics: '🔊', grammar: '🧩', speaking: '🗣️', review: '⭐'};
  const program = programList().find(item => item.id === currentLesson.programId);
  const profile=subjectCatalog.forProgram(program,course);
  const subjectName=currentLesson.programId==='foundation'?'تأسيس إنجليزي':profile.label;
  $('#dashboardLessonIcon').textContent = icons[currentLesson.strand] || (currentLesson.programId==='foundation'?'🌱':profile.icon);
  $('#dashboardLessonTitle').textContent = currentLesson.title || currentLesson.focus;
  $('#dashboardMode').textContent = `${subjectName} · ${sessionMode === 'test' ? 'اختبار شفهي' : 'الدرس الجاي'}`;
  renderPathStatus();
}

function renderPathChoice() {
  const scope = $('#pathScope').value;
  const spec = {scope, programId:$('#trackSelect').value, unitId:$('#unitSelect').value,
    skipPreviouslyCompleted:$('#pathSkipCompleted').checked};
  const single = scope === 'lesson';
  $('#pathSkipLabel').hidden = single;
  $('#pathApply').hidden = single;
  $('#unitSelect').disabled = scope === 'curriculum';
  $('#lessonChoices').hidden = !single;
  const plan = single ? null : pathEngine.build(allLessons(),spec,mastered,course?.curriculumVersion);
  $('#pathPreview').textContent = single ? 'اختاري درسًا واحدًا من القائمة.' : plan
    ? `الخطة تشمل ${plan.lessonIds.length} درس · تخطي ${plan.skippedLessonIds.length} درس مكتمل سابقًا.`
    : 'اختاري منهجًا أو وحدة صالحة.';
  $('#pathApply').disabled = !plan || !plan.lessonIds.length;
}
function applyPathChoice() {
  if (!parentGate.isUnlocked()) return openParentSettings('lessons');
  const plan = pathEngine.build(allLessons(), {scope:$('#pathScope').value,programId:$('#trackSelect').value,
    unitId:$('#unitSelect').value,skipPreviouslyCompleted:$('#pathSkipCompleted').checked}, mastered,course?.curriculumVersion);
  const first = pathEngine.current(plan);
  if (first) chooseLesson(first,'lesson',plan);
}
function renderPathStatus() {
  const el = $('#pathStatus');
  const liveEl=$('#livePathStatus');
  if (invalidPath) { el.textContent = 'الخطة المحفوظة تحتاج مراجعة ولي الأمر.'; liveEl.textContent=el.textContent; return; }
  if (!activePath) { el.textContent = ''; liveEl.textContent=''; return; }
  const program = programList().find(p=>p.id===activePath.programId);
  const unit = program?.units.find(u=>u.id===activePath.unitId);
  const label = activePath.scope==='unit' ? (unit?.title || 'الوحدة') : activePath.scope==='curriculum' ? (program?.title || 'المنهج بالكامل') : 'درس واحد';
  const total = activePath.lessonIds.length;
  el.textContent = activePath.status === 'completed'
    ? `${label} · اكتملت الخطة (${total} من ${total})`
    : `${label} · ${activePath.currentIndex} من ${total} درس اكتمل`;
  liveEl.textContent=sessionMode==='test' ? '' : el.textContent;
}
function updateLessonBadge(lesson) {
  const icons = {math: '🔢', phonics: '🔊', grammar: '🧩', speaking: '🗣️', review: '⭐'};
  const labels = {math: 'درس ماث', phonics: 'درس فونكس', grammar: 'درس جرامر', speaking: 'درس كلام', review: 'درس مراجعة'};
  $('#lessonBadgeIcon').textContent = icons[lesson?.strand] || '🌱';
  $('#lessonBadge').setAttribute('aria-label', `${labels[lesson?.strand] || 'درس تأسيس'}: ${lesson?.title || ''}`);
  $('#welcomeLessonIcon').textContent = icons[lesson?.strand] || '🌱';
  $('#welcomeLessonTitle').textContent = lesson?.title || 'درس تأسيس';
  $('#welcomeLessonChoice').classList.toggle('show', storage.get('lolo-explicit-lesson-choice') === 'true');
}

function cardsFor(lesson) {
  $('#cards').replaceChildren();
  updateLessonBoard(lesson);
  const isMath = lessonSubject(lesson).scene==='math';
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
  const target = sessionMode === 'test' ? (activeSpeakingAssessment?.questions.length || 5) : 2;
  const replay = lessonWasMasteredAtStart && sessionMode === 'lesson';
  const lessonHistory = Array.isArray(lessonStats[currentLesson?.id]?.history) ? lessonStats[currentLesson.id].history : [];
  const savedLessonEvents = lessonHistory.filter(item => item.mode !== 'test');
  let barEvents = activeAnswerEvents;
  if (sessionMode === 'lesson' && !replay && !activePath) {
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

function recordLessonAnswer(lessonId, answer, isCorrect, questionNumber, questionId = '') {
  if (pendingPathCompletion) return {recorded:false, reason:'انتهى الدرس الحالي.'};
  if (sessionMode === 'test') return {recorded: false, reason: 'الاختبار يقيّم الإجابة من محرك المنهج، وليس من تقدير المعلمة.'};
  if (typeof answer === 'number' && Number.isFinite(answer)) answer = String(answer);
  if (typeof isCorrect === 'string' && /^(true|false)$/i.test(isCorrect.trim())) isCorrect = isCorrect.trim().toLowerCase() === 'true';
  if (!isActive || lessonId !== currentLesson?.id || typeof answer !== 'string' || !answer.trim() || typeof isCorrect !== 'boolean') {
    setStatus('لولو ماقدرتش تسجل تقييم الإجابة دي. قوليها مرة تانية بصوتك.');
    return {recorded: false};
  }
  if (!pathEngine.mayRecordTurn(answerTurnId,gradedAnswerTurnId)) {
    return {recorded:false,duplicate:answerTurnId>0 && gradedAnswerTurnId===answerTurnId,reason:'مفيش محاولة صوتية جديدة للتقييم.'};
  }
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
  events.history.push({answer: answer.trim(), is_correct: isCorrect, mode: sessionMode, curriculumVersion: course?.curriculumVersion || null, lessonVersion: currentLesson?.version || null, completedAt: new Date().toISOString()});
  events.history = events.history.slice(-100);
  lessonStats[lessonId] = events;
  activeAnswerEvents.push({answer: answer.trim(), is_correct: isCorrect, question_number: question});
  const didSave=storage.set('lolo-lesson-stats', JSON.stringify(lessonStats));
  if(didSave&&isActive){const feedback=$('#sessionFeedback');feedback.dataset.result=isCorrect?'correct':'practice';feedback.textContent=isCorrect?'محاولة جميلة! ⭐':'نجرّب تاني براحتنا 🌱';feedback.hidden=false;}
  updateProgress();
  renderParentReport();
  if (currentLesson && !$('#parentSheet').classList.contains('open')) refreshLessonPicker(currentLesson.programId, currentLesson.unitId);
  let mastery = null;
  if (sessionMode === 'lesson') {
    const verifiedAnswers = activeAnswerEvents.filter(item => item.is_correct).slice(0, 2).map(item => item.answer);
    if (verifiedAnswers.length === 2) mastery = updateCurrentLesson(lessonId, 2, verifiedAnswers);
  }
  return {recorded: true, correct: events.correct, wrong: events.wrong, percent: Math.round(events.correct / (events.correct + events.wrong) * 100), mastery};
}

function saveSpokenAssessmentResult(assessment) {
  if (!assessment?.supported || assessment.currentIndex !== assessment.questions.length || assessment.results.length !== assessment.questions.length) return null;
  const total = assessment.questions.length;
  const correct = assessment.results.filter(item => item.isCorrect).length;
  const previous = testResults[assessment.lessonId] || {};
  const resultHistory = [...(previous.history || []), {
    assessmentId: assessment.assessmentId,
    curriculumVersion: course?.curriculumVersion || null,
    lessonVersion: currentLesson?.version || null,
    questionResults: assessment.results.map(item => ({
      questionId: item.questionId,
      attemptId: item.attemptId,
      question: item.question,
      answer: item.answer,
      correct_answer: item.correctAnswer,
      is_correct: item.isCorrect,
      status: item.status,
      confidence: item.confidence,
    })),
    correct, total, completedAt: new Date().toISOString(),
  }].slice(-10);
  testResults[assessment.lessonId] = {
    assessmentId: assessment.assessmentId,
    curriculumVersion: course?.curriculumVersion || null,
    lessonVersion: currentLesson?.version || null,
    correct, total, passed: correct / total >= 0.75,
    attempts: (Number(previous.attempts) || 0) + 1,
    completedAt: new Date().toISOString(),
    questionResults: resultHistory.at(-1).questionResults,
    history: resultHistory,
  };
  storage.set('lolo-test-results', JSON.stringify(testResults));
  for (const skillId of currentLesson?.skillIds || []) {
    const recorded = learningEngine.recordAssessment(skillProgress, skillId, {
      assessmentId: assessment.assessmentId,
      curriculumVersion: course?.curriculumVersion || null,
      lessonVersion: currentLesson?.version || null,
      correct,
      total,
      completedAt: testResults[assessment.lessonId].completedAt,
    });
    skillProgress = recorded.progress;
  }
  storage.set('lolo-skill-progress-v1', JSON.stringify(skillProgress));
  renderParentReport();
  if (currentLesson) refreshLessonPicker(currentLesson.programId, currentLesson.unitId);
  return testResults[assessment.lessonId];
}

function recordSpokenAssessmentAnswer(assessmentId, questionId, turnId) {
  const assessment = activeSpeakingAssessment;
  if (!isActive || sessionMode !== 'test' || !assessment?.supported || assessmentId !== assessment.assessmentId || assessment.lessonId !== currentLesson?.id) {
    return {recorded: false, reason: 'جلسة الاختبار تغيّرت.'};
  }
  if (turnId && gradedAnswerTurnId === turnId && assessment.lastResponse) return {...assessment.lastResponse, duplicate: true};
  const question = assessment.questions[assessment.currentIndex];
  if (!question || question.questionId !== questionId) return {recorded: false, reason: 'معرّف السؤال لا يطابق السؤال الحالي.'};
  const answer = pendingChildAnswer.trim();
  if (!answerPending || !answer) return {recorded: false, unresolved: true, reason: 'لسه ماوصلتش إجابة صوتية واضحة.'};

  const attemptId = `${question.questionId}:voice-${turnId || assessment.attempts + 1}`;
  const evaluation = assessmentEngine.gradeSpokenResponse(assessment, questionId, answer, attemptId);
  if (evaluation.unresolved) {
    answerPending = false;
    pendingChildAnswer = '';
    pendingTutorFeedback = '';
    gradedAnswerTurnId = turnId;
    const response = {...evaluation, assessmentId, totalQuestions: assessment.questions.length, retryQuestion: question.prompt};
    assessment.lastResponse = response;
    updateProgress();
    return response;
  }
  if (!evaluation.recorded) return evaluation;

  for (const skillId of currentLesson?.skillIds || []) {
    const recorded = learningEngine.recordResponse(skillProgress, skillId, {
      attemptId,
      questionId: evaluation.questionId,
      isCorrect: evaluation.isCorrect,
      curriculumVersion: course?.curriculumVersion || null,
      lessonVersion: currentLesson?.version || null,
    });
    skillProgress = recorded.progress;
  }
  storage.set('lolo-skill-progress-v1', JSON.stringify(skillProgress));

  answerPending = false;
  pendingChildAnswer = '';
  pendingTutorFeedback = '';
  gradedAnswerTurnId = turnId;
  const questionNumber = evaluation.questionNumber;
  const events = lessonStats[assessment.lessonId] || {correct: 0, wrong: 0};
  events[evaluation.isCorrect ? 'correct' : 'wrong'] = (Number(events[evaluation.isCorrect ? 'correct' : 'wrong']) || 0) + 1;
  events.history = Array.isArray(events.history) ? events.history : [];
  events.history.push({
    answer: answer,
    is_correct: evaluation.isCorrect,
    mode: 'test',
    assessmentId,
    curriculumVersion: course?.curriculumVersion || null,
    lessonVersion: currentLesson?.version || null,
    questionId: evaluation.questionId,
    attemptId: evaluation.attemptId,
    question: evaluation.question,
    correct_answer: evaluation.correctAnswer,
    confidence: evaluation.confidence,
    completedAt: new Date().toISOString(),
  });
  events.history = events.history.slice(-100);
  lessonStats[assessment.lessonId] = events;
  activeAnswerEvents.push({answer, is_correct: evaluation.isCorrect, question_number: questionNumber, question_id: evaluation.questionId, attempt_id: evaluation.attemptId});
  storage.set('lolo-lesson-stats', JSON.stringify(lessonStats));
  updateProgress();
  renderParentReport();
  refreshLessonPicker(currentLesson.programId, currentLesson.unitId);

  const saved = evaluation.complete ? saveSpokenAssessmentResult(assessment) : null;
  const response = {
    ...evaluation,
    assessmentId,
    nextQuestion: evaluation.nextQuestion ? {questionId: evaluation.nextQuestion.questionId, prompt: evaluation.nextQuestion.prompt} : null,
    testResult: saved ? {correct: saved.correct, total: saved.total, passed: saved.passed} : null,
  };
  response.coachPrompt = spokenAssessmentCoachPrompt(response);
  assessment.lastResponse = response;
  return response;
}

function spokenAssessmentCoachPrompt(result) {
  if (result.unresolved) return `لم يصل تقييم واضح، ولم تُسجّل درجة. قولي للطفلة بلطف أن تكرر نفس السؤال: «${result.retryQuestion}». لا تقولي صح أو غلط. بعد سماع إجابتها أرسلي submit_spoken_assessment_answer بالمعرّفين assessment_id=${result.assessmentId} وquestion_id=${result.questionId} فقط.`;
  if (!result.recorded) return 'لم تُسجل الإجابة. لا تعلّقي على صحتها، واطلبي إعادة السؤال الحالي.';
  const feedback = result.isCorrect
    ? 'محرك التقييم تحقق محلياً من صحة الإجابة؛ امدحي المحاولة بجملة قصيرة.'
    : `محرك التقييم تحقق محلياً أن الإجابة غير مطابقة. صححي بلطف وقولي الإجابة المقبولة: ${result.correctAnswer}.`;
  if (result.complete) {
    const summary = result.testResult || {correct: result.correct ? 1 : 0, total: result.totalQuestions, passed: false};
    return `${feedback} انتهى الاختبار. قولي النتيجة المسجلة من المحرك: ${summary.correct} من ${summary.total}، بجملة مشجعة، ثم قولي «تحبي تخلي ماما تختارلك درس تاني؟». لا تطرحي سؤالاً جديداً ولا تعدلي النتيجة.`;
  }
  return `${feedback} انتقلي الآن للسؤال التالي المحدد فقط واقرئيه كما هو: «${result.nextQuestion?.prompt || ''}». لا تخترعي سؤالاً ولا إجابة جديدة. بعد سماع إجابتها أرسلي submit_spoken_assessment_answer بالمعرّفين assessment_id=${result.assessmentId} وquestion_id=${result.nextQuestion?.questionId || ''} فقط.`;
}

function submitSpokenAssessmentAnswer(assessmentId, questionId) {
  return recordSpokenAssessmentAnswer(assessmentId, questionId, answerTurnId);
}

function appendTranscript(current, next) {
  if (!next) return current;
  // Gemini may send cumulative transcript snapshots; OpenAI sends deltas.
  if (next.startsWith(current)) return next;
  if (current.endsWith(next)) return current;
  return current + next;
}

function recordFromSpokenFeedback() {
  if (sessionMode === 'test' && activeSpeakingAssessment && answerPending && pendingChildAnswer.trim()) {
    const result = recordSpokenAssessmentAnswer(activeSpeakingAssessment.assessmentId, activeSpeakingAssessment.questions[activeSpeakingAssessment.currentIndex]?.questionId, answerTurnId);
    if (!result.recorded || result.duplicate) return !!result.recorded;
    const followUp = spokenAssessmentCoachPrompt(result);
    if (activeProvider === 'openai') sendOpenAIText(followUp);
    else send({clientContent: {turns: [{role: 'user', parts: [{text: followUp}]}], turnComplete: true}});
    return true;
  }
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
        if (game.collected.size === 3) { $('#rewardInstruction').textContent = 'جمعتيهم كلهم! ✨'; setTimeout(() => { if (activeRewardGame === game) finishRewardGame(true); }, 850); }
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
  game.timeout = setTimeout(() => { if (activeRewardGame === game) finishRewardGame(false); }, duration);
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
      setTimeout(() => { if (activeRewardGame === game) finishRewardGame(true); }, 850);
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
  if (isActive && currentLesson?.id === game.lessonId && pendingPathCompletion) {
    const prompt = completed ? 'افرحي بفوزها بجملة قصيرة فقط.' : 'شجعي محاولتها بجملة قصيرة فقط.';
    sendTeacherTurn(prompt + ' لا تطرحي سؤالاً جديداً؛ التطبيق يدير الخطوة التالية.');
    scheduleCompletionFollowUp(game.lessonId, rewardFollowUp);
  } else if (micStream) micStream.getAudioTracks().forEach(track => { track.enabled = true; });
  rewardFollowUp = null;
}
function clearCompletionFollowUp() {
  if (completionFollowUpTimer) clearTimeout(completionFollowUpTimer);
  completionFollowUpTimer = null;
  completionFollowUpPending = false;
}
function noteTutorOutput() { lastTutorOutputAt = Date.now(); }
function scheduleCompletionFollowUp(lessonId, result) {
  clearCompletionFollowUp();
  const pending = pendingPathCompletion;
  if (!result?.saved || !pending || pending.lessonId !== lessonId) return;
  completionFollowUpPending = true;
  const armedAt = Date.now();
  const check = () => {
    const nextId = pathEngine.current(activePath);
    const decision = pathEngine.transition({
      active:isActive, sameCompletion:completionFollowUpPending && pendingPathCompletion===pending && currentLesson?.id===lessonId,
      hidden:document.visibilityState==='hidden',now:Date.now(),deadline:learningDeadline,armedAt,
      lastOutputAt:lastTutorOutputAt,modelSpeaking,audioPlaying:openAIAudioPlaying,queuedAudio:playingSources.size,
      rewardActive:!!activeRewardGame,nextLessonId:nextId,
    });
    if (decision === 'ignore') return;
    if (decision === 'advance' || decision === 'complete') {
      const next = allLessons().find(l => l.id === nextId);
      const deadline = learningDeadline;
      closeSession(true);
      if (!next) { learningDeadline = 0; setStatus('برافو! خطة التعلم خلصت.'); renderPathStatus(); return; }
      selectLessonInApp(next);
      learningDeadline = deadline;
      if (document.visibilityState !== 'hidden' && Date.now() < deadline) startSession(true);
      return;
    }
    if (decision === 'pause') {
      stopSession();
      setStatus('التقدم اتحفظ. استكملي الخطة لما تكوني جاهزة.');
      return;
    }
    completionFollowUpTimer = setTimeout(check, 250);
  };
  completionFollowUpTimer = setTimeout(check, 250);
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

function renderSessionVisual(){
  const panel=$('#lessonSessionPanel');if(!panel)return;
  const phase=isStarting?'connecting':!isActive?'idle':modelSpeaking?'speaking':'active';
  panel.dataset.phase=phase;
  $('#sessionLessonTitle').textContent=currentLesson?.title||currentLesson?.focus||'الدرس الحالي';
  const labels={connecting:['لولو بتجهز الدرس','بنوصل جلسة الصوت. تقدري توقفيها في أي وقت.'],idle:['جاهزة للتعلم','اختاري وقتًا مناسبًا للتدريب.'],speaking:['لولو بتتكلم','اسمعي لولو براحتك.'],active:['جلسة الصوت شغالة','جاوبي لما لولو تطلب منك.']};
  $('#sessionPhase').textContent=labels[phase][0];$('#sessionHint').textContent=labels[phase][1];
  $('#sessionControlLabel').textContent=phase==='idle'?'بدء الدرس الصوتي':'إيقاف جلسة الصوت';
  if(phase==='idle'||phase==='connecting')$('#sessionFeedback').hidden=true;
}
function setStatus(message) {
  renderSessionVisual();
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
  renderSessionVisual();
}

function send(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function sendOpenAIText(text) {
  if (realtimeChannel?.readyState !== 'open') return;
  realtimeChannel.send(JSON.stringify({type: 'conversation.item.create', item: {
    type: 'message', role: 'user', content: [{type: 'input_text', text}],
  }}));
  realtimeChannel.send(JSON.stringify({type: 'response.create', response: {
    ...(sessionMode === 'test' ? {tool_choice: 'none'} : {}),
  }}));
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

function closeSession(preserveDeadline = false) {
  if (!preserveDeadline) learningDeadline = 0;
  pendingPathCompletion = null;
  openAIAudioPlaying = false;
  sessionTimers.invalidate();
  sessionController?.abort();
  sessionController = null;
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
  activeSpeakingAssessment = null;
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
  $('#mic').disabled = false;
  $('#welcomeStart').disabled = $('#app').classList.contains('ready');
  $('#buddy').classList.remove('talking');
  $('#soundWave').classList.remove('on');
  $('#app').classList.remove('in-lesson');
  if (!preserveDeadline && sessionMode==='lesson') {
    const planned=allLessons().find(l=>l.id===pathEngine.current(activePath));
    if (planned && planned.id!==currentLesson?.id) selectLessonInApp(planned);
  }
  updateProgress();
  renderPathStatus();
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
  storage.set('lolo-current-lesson', lesson.id);
  storage.set('lolo-selected-program', lesson.programId);
  cardsFor(lesson);
  updateLessonBadge(lesson);
  updateDashboardLesson();
  updateProgress();
  refreshLessonPicker(lesson.programId, lesson.unitId);
  return true;
}

function updateCurrentLesson(lessonId, correctResponses, evidence) {
  const verifiedEvidence = Array.isArray(evidence) && evidence.length === 2 && evidence.every(item => typeof item === 'string' && item.trim());
  if (!isActive || sessionMode !== 'lesson' || lessonId !== currentLesson?.id || Number(correctResponses) !== 2 || !verifiedEvidence || pendingPathCompletion || activeAnswerEvents.filter(a=>a.is_correct).length < 2) return {saved:false,next:null};
  const advanced = pathEngine.advance(activePath, lessonId);
  if (!advanced || !storage.set(PATH_KEY, JSON.stringify(advanced))) return {saved:false,next:null};
  activePath = advanced;
  pendingPathCompletion = {lessonId};
  if (micStream) micStream.getAudioTracks().forEach(track => { track.enabled = false; });
  renderPathStatus();
  const alreadySaved = mastered.has(lessonId);
  let excellenceAward = null;
  if (!alreadySaved) {
    mastered.add(lessonId);
    storage.set('lolo-mastered', JSON.stringify([...mastered]));
  } else if (lessonWasMasteredAtStart && !replayHonoredThisSession) {
    lessonExcellence[lessonId] = (Number(lessonExcellence[lessonId]) || 0) + 1;
    storage.set('lolo-lesson-excellence', JSON.stringify(lessonExcellence));
    replayHonoredThisSession = true;
    excellenceAward = lessonExcellence[lessonId];
  }
  updateProgress();
  if (!$('#parentSheet').classList.contains('open')) refreshLessonPicker(currentLesson.programId, currentLesson.unitId);
  const next = allLessons().find(l => l.id === pathEngine.current(activePath));
  const courseComplete = activePath.scope === 'curriculum' && activePath.status === 'completed';
  const rewardGame = alreadySaved || !parentSettings.rewardEnabled ? null : showRewardGame(currentLesson);
  const result = {saved: true, scope:activePath.scope, pathComplete:activePath.status==='completed', autoAdvance:!!next, alreadySaved, excellenceAwarded: excellenceAward, excellenceCount: Number(lessonExcellence[lessonId]) || 0, nextLesson: next ? {id: next.id, title: next.title || next.focus, focus: next.focus, goal: next.goal} : null, courseComplete, rewardGame};
  if (rewardGame) rewardFollowUp = result;
  else scheduleCompletionFollowUp(lessonId, result);
  return result;
}

function startNextLesson(lessonId) {
  return {started:false, reason:'التطبيق وحده ينقل الدرس حسب خطة ولي الأمر بعد انتهاء التفاعل والمكافأة.', pathComplete:activePath?.status==='completed'};
}

function requestLearningBreak() {
  stopSession();
  setStatus('وقت راحة. تقدري تكملي الخطة لما تكوني جاهزة.');
  return {paused:true};
}

function openParentPickerFromTutor() {
  if (isActive || isStarting) stopSession();
  openParentSettings('lessons');
  $('#parentProgress').textContent = 'لولو قالت إن الدرس خلص. اختاري لها الدرس أو الاختبار المناسب من القائمة.';
  return {opened: true};
}

function saveTestResult(lessonId, questionResults, totalQuestions) {
  return {saved: false, reason: 'نتائج الاختبار تُحسب وتحفظ من محرك التقييم بعد تسجيل كل إجابة صوتية.'};
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
    } else if (call.name === 'request_learning_break') {
      functionResponses.push({name:call.name,id:call.id,response:{result:requestLearningBreak()}});
      break;
    } else if (call.name === 'open_parent_picker') {
      functionResponses.push({name: call.name, id: call.id, response: {result: openParentPickerFromTutor()}});
    } else if (call.name === 'record_lesson_test_result') {
      const result = saveTestResult(call.args?.lesson_id, call.args?.question_results, Number(call.args?.total_questions));
      functionResponses.push({name: call.name, id: call.id, response: {result}});
    } else if (call.name === 'submit_spoken_assessment_answer') {
      const result = submitSpokenAssessmentAnswer(call.args?.assessment_id, call.args?.question_id);
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
    : name === 'request_learning_break'
      ? requestLearningBreak()
    : name === 'open_parent_picker'
      ? openParentPickerFromTutor()
    : name === 'record_lesson_test_result'
      ? saveTestResult(args?.lesson_id, args?.question_results, Number(args?.total_questions))
    : name === 'submit_spoken_assessment_answer'
      ? submitSpokenAssessmentAnswer(args?.assessment_id, args?.question_id)
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
  if (message.type === 'output_audio_buffer.started') openAIAudioPlaying = true;
  if (message.type === 'output_audio_buffer.stopped' || message.type === 'output_audio_buffer.cleared') openAIAudioPlaying = false;
  if (message.type === 'response.output_audio.delta') noteTutorOutput();
  if (message.type === 'response.output_audio_transcript.delta' || message.type === 'response.output_audio_transcript.done' || message.type === 'response.output_text.delta') {
    const transcript = message.delta || message.transcript || '';
    if (transcript) { noteTutorOutput(); pendingTutorFeedback = appendTranscript(pendingTutorFeedback, transcript); setStatus('لولو بتتكلم'); highlightBoardSpeech(transcript); }
  } else if (message.type === 'conversation.item.input_audio_transcription.completed') {
    if (isActive) {
      if (!answerPending) { answerTurnId++; pendingChildAnswer = ''; pendingTutorFeedback = ''; }
      pendingChildAnswer = message.transcript || '';
      answerPending = true; updateProgress();
      if (sessionMode === 'test' && activeSpeakingAssessment) {
        const question = activeSpeakingAssessment.questions[activeSpeakingAssessment.currentIndex];
        const result = recordSpokenAssessmentAnswer(activeSpeakingAssessment.assessmentId, question?.questionId, answerTurnId);
        if (result.recorded || result.unresolved) sendOpenAIText(result.coachPrompt || spokenAssessmentCoachPrompt(result));
      }
    }
  } else if (message.type === 'input_audio_buffer.speech_started') {
    if (isActive && sessionMode==='lesson' && !pendingPathCompletion) {
      answerTurnId++; answerPending=true; pendingChildAnswer=''; pendingTutorFeedback='';
    }
    setStatus('سامعة صوتك');
  } else if (message.type === 'response.created') {
    modelSpeaking = true; $('#buddy').classList.add('talking'); $('#soundWave').classList.add('on'); renderSessionVisual();
  } else if (message.type === 'response.done') {
    recordFromSpokenFeedback();
    settleUnscoredAnswer();
    modelSpeaking = false; $('#buddy').classList.remove('talking'); setStatus('دورك تتكلمي');
  } else if (message.type === 'response.function_call_arguments.done') {
    let args = {};
    try { args = JSON.parse(message.arguments || '{}'); } catch {}
    handleOpenAIToolCall(message.name, args, message.call_id);
  } else if (message.type === 'error') {
    const detail = 'حصلت مشكلة مؤقتة في جلسة الصوت.';
    if (setupHandshake) { setupHandshake.reject(new Error(detail)); setupHandshake = null; }
    else showError(detail);
  }
}

async function handleGeminiMessage(event, sessionId, sessionSocket) {
  let message;
  try {
    let data = event.data;
    if (data instanceof ArrayBuffer) data = new TextDecoder().decode(data);
    else if (data instanceof Blob) data = await data.text();
    message = JSON.parse(data);
  } catch { return; }
  if (!sessionTimers.isCurrent(sessionId) || socket !== sessionSocket) return;
  if (message.setupComplete) {
    if (setupHandshake) {
      setupHandshake.resolve();
      setupHandshake = null;
    }
    isActive = true;
    isStarting = false;
    if (!$('#app').classList.contains('ready')) {
      storage.set('lolo-onboarding-complete', 'true');
      storage.set('lolo-welcome-tour-v1-complete', 'true');
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
        renderSessionVisual();
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
      if (!message.toolCall) recordFromSpokenFeedback();
      settleUnscoredAnswer();
      modelSpeaking = false;
      $('#buddy').classList.remove('talking');
      $('#soundWave').classList.add('on');
      setStatus('دورك تتكلمي');
    }
  }
  if (message.toolCall) handleToolCall(message.toolCall);
  if (message.goAway) {
    // Provider is ending the connection. Stop safely without issuing another token.
    pauseInterruptedVoice(sessionId);
    return;
  }
  if (message.error) {
    const detail = 'حصلت مشكلة مؤقتة في جلسة الصوت.';
    if (setupHandshake) {
      setupHandshake.reject(new Error(detail));
      setupHandshake = null;
    } else if(isActive){
      pauseInterruptedVoice(sessionId);
    }
  }
}

function pauseInterruptedVoice(sessionId) {
  if(!sessionTimers.isCurrent(sessionId)||!isActive)return;
  stopSession();
  setStatus('الصوت اتوقف مؤقتًا. تقدم الدروس محفوظ، والتدريبات المحلية متاحة. اضغطي ابدئي لما تكوني جاهزة.');
}
function closeProviderTransport() {
  if (setupHandshake) { setupHandshake.reject(new Error('تغيير مزود الصوت.')); setupHandshake = null; }
  if (socket) { socket.onmessage = null; socket.onclose = null; socket.onerror = null; try { socket.close(); } catch {} }
  try { realtimeChannel?.close(); } catch {}
  try { realtimePeer?.close(); } catch {}
  if (remoteAudio) { remoteAudio.srcObject = null; remoteAudio.remove(); }
  socket = null; realtimeChannel = null; realtimePeer = null; remoteAudio = null; activeProvider = null;
}

async function providerToken(provider, sessionSignal) {
  const requestController = new AbortController();
  const abortWithSession = () => requestController.abort();
  if (sessionSignal?.aborted) requestController.abort();
  else sessionSignal?.addEventListener('abort', abortWithSession, {once: true});
  const timeout = setTimeout(() => requestController.abort(), 12000);
  let response;
  try {
    response = await apiFetch('/api/provider-token', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, signal: requestController.signal,
      body: JSON.stringify({provider, lessonId: currentLesson?.id || 'course-complete', mode: sessionMode, alreadyMastered: sessionMode === 'lesson' && mastered.has(currentLesson?.id), excellenceCount: Number(lessonExcellence[currentLesson?.id]) || 0, teacherSettings: {speechPace: parentSettings.speechPace, hintLevel: parentSettings.hintLevel, repeatWords: parentSettings.repeatWords, learningScope:activePath?.scope || 'lesson'}}),
    });
  } catch (error) {
    if (sessionSignal?.aborted) throw Object.assign(new Error('اتقفلت الجلسة قبل تجهيز الاتصال.'),{stopFallback:true});
    // The server may already have issued a paid credential. Do not retry an ambiguous transport failure.
    throw Object.assign(new Error('تعذر تجهيز الاتصال الآن. جربي مرة تانية لما تكوني جاهزة.'),{stopFallback:true});
  } finally { clearTimeout(timeout); sessionSignal?.removeEventListener('abort', abortWithSession); }
  let data;
  try { data=await response.json(); }
  catch { throw Object.assign(new Error('استجابة خدمة الصوت غير مكتملة.'),{status:response.status,stopFallback:true}); }
  if (!response.ok) throw Object.assign(new Error('تعذر تجهيز مزود الصوت.'),{status:response.status});
  if(!data||data.provider!==provider||typeof data.token!=='string'||!data.token||typeof data.model!=='string')throw Object.assign(new Error('استجابة خدمة الصوت غير صالحة.'),{stopFallback:true});
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

async function connectGemini(provider, sessionId, sessionSignal) {
  const data = await providerToken(provider, sessionSignal);
  if (!sessionTimers.isCurrent(sessionId) || sessionSignal.aborted) throw new Error('اتقفلت الجلسة قبل تجهيز الاتصال.');
  activeProvider = provider;
  const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(data.token)}`;
  const ready = waitForSetup(12000, 'Gemini');
  ready.catch(() => {});
  const sessionSocket = new WebSocket(url);
  socket = sessionSocket;
  sessionSocket.binaryType = 'arraybuffer';
  sessionSocket.onmessage = event => { if (sessionTimers.isCurrent(sessionId) && socket === sessionSocket) handleGeminiMessage(event, sessionId, sessionSocket); };
  sessionSocket.onopen = () => {
    if (!sessionTimers.isCurrent(sessionId) || socket !== sessionSocket) return;
    sessionSocket.send(JSON.stringify({setup: {model: data.model, ...data.config}}));
  };
  sessionSocket.onerror = () => { if (sessionTimers.isCurrent(sessionId) && socket === sessionSocket && setupHandshake) setupHandshake.reject(new Error('تعذر فتح اتصال Gemini Live.')); };
  sessionSocket.onclose = event => {
    if (!sessionTimers.isCurrent(sessionId) || socket !== sessionSocket) return;
    if (setupHandshake) setupHandshake.reject(new Error(`Gemini قفل الاتصال قبل التجهيز؛ رمز ${event.code}.`));
    if (isActive) pauseInterruptedVoice(sessionId);
  };
  await ready;
}

async function connectOpenAI(sessionId, sessionSignal) {
  if (!window.RTCPeerConnection) throw new Error('المتصفح لا يدعم اتصال OpenAI الصوتي.');
  const data = await providerToken('openai', sessionSignal);
  if (!sessionTimers.isCurrent(sessionId) || sessionSignal.aborted) throw new Error('اتقفلت الجلسة قبل تجهيز الاتصال.');
  activeProvider = 'openai';
  realtimePeer = new RTCPeerConnection();
  remoteAudio = document.createElement('audio');
  remoteAudio.autoplay = true; remoteAudio.playsInline = true; remoteAudio.style.display = 'none';
  document.body.appendChild(remoteAudio);
  const sessionPeer = realtimePeer;
  const sessionAudio = remoteAudio;
  sessionPeer.onconnectionstatechange = () => {
    if (!sessionTimers.isCurrent(sessionId) || realtimePeer !== sessionPeer) return;
    if(sessionPeer.connectionState==='disconnected'){
      sessionTimers.schedule(sessionId,5000,()=>{
        if(realtimePeer===sessionPeer&&sessionPeer.connectionState==='disconnected')pauseInterruptedVoice(sessionId);
      });
    }
    if (sessionPeer.connectionState === 'failed' || sessionPeer.connectionState === 'closed') {
      if (setupHandshake) setupHandshake.reject(new Error('اتقطع اتصال OpenAI أثناء تجهيز الدرس.'));
      else if (isActive) pauseInterruptedVoice(sessionId);
    }
  };
  sessionPeer.ontrack = event => {
    if (!sessionTimers.isCurrent(sessionId) || realtimePeer !== sessionPeer) return;
    sessionAudio.srcObject = event.streams[0]; sessionAudio.play().catch(() => {});
  };
  for (const track of micStream.getAudioTracks()) sessionPeer.addTrack(track, micStream);
  const sessionChannel = sessionPeer.createDataChannel('oai-events');
  realtimeChannel = sessionChannel;
  sessionChannel.onmessage = event => { if (sessionTimers.isCurrent(sessionId) && realtimeChannel === sessionChannel) handleOpenAIMessage(event); };
  const ready = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sessionSignal.removeEventListener('abort', abortReady);
      callback(value);
    };
    const abortReady = () => finish(reject, new Error('اتقفلت الجلسة قبل تجهيز قناة OpenAI.'));
    const timer = setTimeout(() => finish(reject, new Error('OpenAI لم يجهز القناة الصوتية.')), 12000);
    sessionChannel.onopen = () => finish(resolve);
    sessionChannel.onerror = () => {
      if (!sessionTimers.isCurrent(sessionId) || realtimeChannel !== sessionChannel) return;
      if (!settled) finish(reject, new Error('تعذر فتح قناة OpenAI الصوتية.'));
      else if (isActive) pauseInterruptedVoice(sessionId);
    };
    sessionChannel.onclose = () => {
      if (!sessionTimers.isCurrent(sessionId) || realtimeChannel !== sessionChannel) return;
      if (!settled) finish(reject, new Error('OpenAI قفل القناة الصوتية.'));
      else if (isActive) pauseInterruptedVoice(sessionId);
    };
    sessionSignal.addEventListener('abort', abortReady, {once: true});
  });
  ready.catch(() => {});
  const offer = await sessionPeer.createOffer();
  if (!sessionTimers.isCurrent(sessionId) || sessionSignal.aborted) throw new Error('اتقفلت الجلسة قبل تجهيز الاتصال.');
  await sessionPeer.setLocalDescription(offer);
  if (!sessionTimers.isCurrent(sessionId) || sessionSignal.aborted) throw new Error('اتقفلت الجلسة قبل تجهيز الاتصال.');
  const response = await fetch('https://api.openai.com/v1/realtime/calls', {
    method: 'POST', body: offer.sdp, signal: sessionSignal,
    headers: {Authorization: `Bearer ${data.token}`, 'Content-Type': 'application/sdp'},
  });
  if (!response.ok) {
    throw Object.assign(new Error('تعذر اتصال الصوت بمزود الخدمة.'),{status:response.status});
  }
  if (!sessionTimers.isCurrent(sessionId) || sessionSignal.aborted) throw new Error('اتقفلت الجلسة قبل تجهيز الاتصال.');
  await sessionPeer.setRemoteDescription({type: 'answer', sdp: await response.text()});
  await ready;
}

async function startSession(continuing = false) {
  if (isStarting || isActive || !course || document.visibilityState === 'hidden') return;
  if(navigator.onLine===false){network.markOffline();renderNetworkNotice('offline');setStatus('الصوت الذكي محتاج نت. التدريب المحلي متاح.');return;}
  if (sessionMode === 'lesson') {
    if (invalidPath || activePath?.status === 'completed') { setStatus('اختاري خطة تعلم جديدة من لوحة ولي الأمر.'); return; }
    if (!activePath && currentLesson) {
      activePath = pathEngine.build(allLessons(),{scope:'lesson',programId:currentLesson.programId,unitId:currentLesson.unitId,lessonId:currentLesson.id},mastered,course.curriculumVersion);
      if (!activePath || !storage.set(PATH_KEY,JSON.stringify(activePath))) return;
    }
    const planned = allLessons().find(l=>l.id===pathEngine.current(activePath));
    if (!planned) return showError('اختاري خطة تعلم صالحة.');
    if (planned.id !== currentLesson?.id) selectLessonInApp(planned);
  }
  if (continuing !== true || !learningDeadline) learningDeadline = Date.now() + Math.max(1,Math.min(30,Number(parentSettings.sessionMinutes)||10))*60000;
  if (Date.now() >= learningDeadline) return;
  currentLesson = currentLesson || nextLesson();
  if(!storage.profiles.activeId){setStatus('ملفات التعلم تحتاج مراجعة ولي الأمر.');return;}
  if(!currentLesson||!lessonSubject(currentLesson).live){setStatus('الصوت الذكي غير متاح لهذه المادة بعد. تقدري تكملي التدريب المحلي.');openOfflinePractice();return;}
  if (sessionMode === 'test' && (!activeSpeakingAssessment || activeSpeakingAssessment.lessonId !== currentLesson?.id)) {
    activeSpeakingAssessment = assessmentEngine.createSpokenAssessment(currentLesson);
    if (!activeSpeakingAssessment.supported) {
      showError('الاختبار الصوتي لهذا الدرس غير جاهز بعد.');
      return;
    }
  }
  const sessionId = sessionTimers.begin();
  const requestController = new AbortController();
  sessionController = requestController;
  isStarting = true;
  sessionTimers.schedule(sessionId, Math.max(0, learningDeadline-Date.now()), () => {
    stopSession();
    setStatus('وقت الراحة! تقدمك محفوظ. تقدري تكملي بعدين.');
  });
  answerPending = false;
  pendingChildAnswer = '';
  pendingTutorFeedback = '';
  answerTurnId = 0;
  gradedAnswerTurnId = 0;
  clearCompletionFollowUp();
  activeAnswerEvents = [];
  updateProgress();
  $('#welcomeStart').disabled = true; $('#mic').disabled = false; setListening(true);
  $('#errorDot').classList.remove('show'); $('#welcomeError').textContent = '';
  currentLesson = currentLesson || nextLesson();
  lessonWasMasteredAtStart = sessionMode === 'lesson' && mastered.has(currentLesson?.id);
  replayHonoredThisSession = false;
  cardsFor(currentLesson); updateProgress(); setStatus('جاري توصيل لولو');
  try {
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode || !window.WebSocket) throw new Error('الميكروفون يحتاج متصفحاً حديثاً ورابط HTTPS أو localhost.');
    const providerStatusPromise = apiFetch('/api/status', {signal: requestController.signal}).then(response => {
      if (!response.ok) throw new Error('تعذر قراءة إعدادات الصوت.');
      return response.json();
    });
    providerStatusPromise.catch(() => {});
    const acquiredStream = await navigator.mediaDevices.getUserMedia({audio: {channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true}, video: false});
    if (!sessionTimers.isCurrent(sessionId) || requestController.signal.aborted) {
      acquiredStream.getTracks().forEach(track => track.stop());
      return;
    }
    micStream = acquiredStream;
    for(const track of acquiredStream.getAudioTracks()){
      track.enabled=false;
      track.addEventListener('ended',()=>{
        if(!sessionTimers.isCurrent(sessionId)||micStream!==acquiredStream)return;
        if(isActive||isStarting){stopSession();setStatus('الميكروفون مش متاح. تقدمك محفوظ والتدريبات المحلية متاحة.');}
      },{once:true});
    }
    audioContext = new AudioContext({latencyHint: 'interactive'}); await audioContext.resume(); await audioContext.audioWorklet.addModule('/pcm-processor.js');
    if (!sessionTimers.isCurrent(sessionId) || requestController.signal.aborted) return;
    micSource = audioContext.createMediaStreamSource(micStream);
    audioWorklet = new AudioWorkletNode(audioContext, 'pcm16-input', {numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1]});
    audioWorklet.port.onmessage = event => { if (sessionTimers.isCurrent(sessionId)) streamAudioToGemini(event.data); };
    micSource.connect(audioWorklet); audioWorklet.connect(audioContext.destination);
    const status = await providerStatusPromise;
    if (!sessionTimers.isCurrent(sessionId) || requestController.signal.aborted) return;
    const order = ['openai', 'gemini', 'gemini-backup'].filter(provider => status.providers?.includes(provider));
    if (!order.length) throw new Error('الصوت الذكي غير متاح دلوقتي. تقدري تكملي التدريب المحلي.');
    const failures = [];
    for (const provider of order) {
      setStatus('لولو بتجهز الدرس…');
      try {
        if (provider === 'openai') await connectOpenAI(sessionId, requestController.signal);
        else await connectGemini(provider, sessionId, requestController.signal);
        if (!sessionTimers.isCurrent(sessionId) || requestController.signal.aborted) return;
        break;
      }
      catch (error) {
        if (!sessionTimers.isCurrent(sessionId) || requestController.signal.aborted) return;
        failures.push({provider, message: error.message});
        closeProviderTransport();
        if(!window.LoloSessionTimers.shouldTryNextProvider({status:error.status,stopFallback:error.stopFallback,online:navigator.onLine!==false,aborted:requestController.signal.aborted,deadline:learningDeadline}))break;
      }
    }
    if (!sessionTimers.isCurrent(sessionId) || requestController.signal.aborted) return;
    if (!activeProvider) throw new Error('تعذر الاتصال بكل مزودي الصوت. ' + failures.map(item => item.message).join(' — '));
    isActive = true; isStarting = false;
    micStream?.getAudioTracks().forEach(track=>{track.enabled=true;});
    if (sessionMode === 'lesson') {
      const introduced = learningEngine.markIntroduced(skillProgress, currentLesson?.skillIds || [], {
        curriculumVersion: course?.curriculumVersion || null,
        lessonVersion: currentLesson?.version || null,
      });
      skillProgress = introduced.progress;
      storage.set('lolo-skill-progress-v1', JSON.stringify(skillProgress));
    }
    updateProgress();
    $('#app').classList.add('in-lesson');
    if (!$('#app').classList.contains('ready')) { storage.set('lolo-onboarding-complete', 'true'); storage.set('lolo-welcome-tour-v1-complete', 'true'); $('#app').classList.add('ready'); }
    $('#mic').disabled = false; setListening(true);
    const connectedName = activeProvider === 'openai' ? 'OpenAI' : 'Gemini';
    setStatus('لولو سامعاكي عبر ' + connectedName);
    if(failures.length)setStatus('لولو جاهزة مع مزود الصوت المتاح.');
    const isMathLesson = programList().find(program => program.id === currentLesson?.programId)?.subject === 'math';
    const mathContext = isMathLesson ? ` الحالة الدقيقة لما يظهر على الشاشة الآن: ${mathVisualState()}. هذه هي الحقيقة الوحيدة عن العناصر المرئية؛ معلومات الدرس وبطاقاته ليست معروضة. لا تذكري أي شيء أو لون أو رقم أو كمية غير واردة في الحالة المرئية. إذا احتجتِ مثالاً جديداً، اعرضيه أولاً بأداة المشهد ثم اذكريه بعد تأكيد ظهور نتيجتها.` : '';
    const visibleCards = (currentLesson?.cards || []).map(card => card[1]).filter(Boolean).join('، ');
    const lessonTitle = currentLesson?.title || currentLesson?.focus || 'درسنا النهارده';
    const replayOpening = lessonWasMasteredAtStart
      ? `الدرس ${lessonTitle} متقن من قبل ومختار للمراجعة ضمن خطة ولي الأمر. ابدئي بمراجعة قصيرة واسألي سؤالاً واحداً في كل مرة. لو الطفلة طلبت الراحة أو التوقف، احترمي طلبها واستدعي request_learning_break.`
      : null;
    const firstAssessmentQuestion = activeSpeakingAssessment?.questions[0];
    const opening = replayOpening || (sessionMode === 'test'
      ? `ابدئي فوراً بصوت لولو: «أهلاً يا بطلة! ده اختبار سماع وترديد صغير على ${lessonTitle}. هسمّعك كلمات من درسنا وإنتي تكرريها معايا». عدد الأسئلة ${activeSpeakingAssessment.questions.length}. اقرئي السؤال الأول كما هو فقط: «${firstAssessmentQuestion.prompt}». assessment_id هو ${activeSpeakingAssessment.assessmentId} وquestion_id هو ${firstAssessmentQuestion.questionId}. بعد سماع جوابها، لا تقولي صح أو غلط ولا السؤال التالي؛ استدعي submit_spoken_assessment_answer بالمعرّفين فقط، ثم اتبعي coachPrompt الذي يرجع من التطبيق.`
      : isMathLesson
        ? `قولي الآن هذه الافتتاحية في رد صوتي واحد: ${mathOpeningScript()} بعد السؤال اسكتي واسمعي إجابتها. لا تضيفي شيئاً غير الموجود في الحالة المرئية.${mathContext}`
        : `ابدئي الكلام فوراً من غير انتظار الطفلة: أهلاً يا بطلة! درسنا النهارده ${lessonTitle}. ${currentLesson?.goal || currentLesson?.focus || ''} الصور الظاهرة قدامك هي: ${visibleCards || 'اختيارات الدرس المصورة'}. اشرحي فكرة واحدة بجملتين بسيطتين، واسألي سؤالاً سهلاً من الصور دي عشان تبدأ.`);
    if (activeProvider === 'openai') sendOpenAIText(opening);
    else send({clientContent: {turns: [{role: 'user', parts: [{text: opening}]}], turnComplete: true}});

  } catch (error) {
    if (sessionTimers.isCurrent(sessionId)) {
      closeSession();
      if(navigator.onLine===false||network.getState()==='offline'||network.getState()==='unreachable'){
        renderNetworkNotice(network.getState());setStatus('الصوت توقف. تقدمك محفوظ والتدريبات المحلية متاحة.');
      }else showError(error.message || 'مقدرناش نفتح الميكروفون.');
    }
  } finally {
    if (sessionTimers.isCurrent(sessionId)) {
      isStarting = false;
      $('#mic').disabled = false;
      $('#welcomeStart').disabled = $('#app').classList.contains('ready');
      if (!isActive && sessionController === requestController) sessionController = null;
    }
  }
}
function stopSession() {
  if (!isActive && !isStarting) return;
  if (socket?.readyState === WebSocket.OPEN) send({realtimeInput: {audioStreamEnd: true}});
  closeSession();
  sessionMode = 'lesson';
  $('#app').classList.remove('assessment');
  $('#app').classList.remove('in-lesson');
  const planned=allLessons().find(l=>l.id===pathEngine.current(activePath));
  if (planned && planned.id!==currentLesson?.id) selectLessonInApp(planned);
  updateDashboardLesson();
  setStatus('انتهى الدرس');
}

$('#mic').onclick = () => isActive || isStarting ? stopSession() : startSession();
$('#sessionBack').onclick=()=>{if(isActive||isStarting)stopSession();else{$('#app').classList.remove('in-lesson');renderSessionVisual();}$('#homeStart').focus();};
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && (isActive || isStarting)) stopSession();
});
window.addEventListener('pagehide', () => {
  if (isActive || isStarting) stopSession();
});
$('#rewardSkip').onclick = () => finishRewardGame(false);
$('#homeStart').onclick = () => startSession();
$('#homeChoose').onclick = () => openParentSettings('lessons');
let noticeTimer=null;
function renderNetworkNotice(state){
  const banner=$('#networkNotice');if(!banner)return;
  clearTimeout(noticeTimer);
  banner.dataset.state=state;
  banner.hidden=false;
  const title=$('#networkTitle'),detail=$('#networkDetail'),retry=$('#networkRetry');
  retry.hidden=state==='online';retry.disabled=state==='checking';
  if(state==='online'){
    title.textContent='الاتصال رجع';detail.textContent='تقدري تكملي الصوت لما تكوني جاهزة.';
    noticeTimer=setTimeout(()=>{if(network.getState()==='online')banner.hidden=true;},3500);
  }else if(state==='checking'){
    title.textContent='بنتأكد من الاتصال';detail.textContent='كمّلي التدريبات المحلية في الوقت ده.';
  }else{
    title.textContent=state==='offline'?'وضع بدون إنترنت':'خدمة الصوت مش متاحة دلوقتي';
    detail.textContent='المناهج والتدريبات محفوظة على الجهاز. الصوت الذكي يحتاج اتصال.';
  }
}
$('#networkRetry').onclick=()=>network.probe();
window.addEventListener('offline',()=>{
  network.markOffline();renderNetworkNotice('offline');
  if(isActive||isStarting){stopSession();setStatus('الصوت توقف. تقدمك محفوظ.');}
});
window.addEventListener('online',()=>{network.probe();});
if(network.getState()==='offline')renderNetworkNotice('offline');
if(!nativeBundle&&!window.Capacitor?.isNativePlatform?.()&&'serviceWorker' in navigator&&window.isSecureContext){
  navigator.serviceWorker.register('/sw.js').catch(()=>{ /* App still works online; installation is not assumed. */ });
}
function openOfflinePractice(requestedLessonId=null){
  if(!course||invalidPath){setStatus('اختاري خطة تعلم صالحة من لوحة ولي الأمر.');return;}
  if(isActive||isStarting)stopSession();
  const explicit=typeof requestedLessonId==='string';
  if(explicit&&(!parentGate.isUnlocked()||!$('#parentSheet').classList.contains('open')))return;
  const lesson=explicit?allLessons().find(l=>l.id===requestedLessonId):allLessons().find(l=>l.id===pathEngine.current(activePath))||currentLesson;
  if(!lesson)return;
  const dialog=$('#offlinePractice');
  $('#practiceTitle').textContent=lesson.title||lesson.focus||'نتدرّب سوا';
  $('#practiceGoal').textContent=lesson.goal||'راجعي محتوى الدرس.';
  $('#practiceFeedback').textContent='';
  const words=$('#practiceWords'),cards=$('#practiceCards');words.replaceChildren();cards.replaceChildren();
  for(const token of lesson.board?.tokens||[]){
    if(!token.text)continue;
    const button=document.createElement('button');button.type='button';button.textContent=token.text;
    button.onclick=()=>{$('#practiceFeedback').textContent=token.text;localSpeech(token.text,/[A-Za-z]/.test(token.text)?'en-US':'ar-EG');};
    words.append(button);
  }
  for(const [emoji,label] of lesson.cards||[]){
    const button=document.createElement('button');button.type='button';button.textContent=emoji;button.setAttribute('aria-label',label);
    button.onclick=()=>{$('#practiceFeedback').textContent=label;localSpeech(label,'ar-EG');};cards.append(button);
  }
  $('#practiceQuiz').hidden=!visualBankReady||!visualBank.bank[lesson.id];
  $('#practiceQuiz').onclick=()=>{dialog.close();openVisualQuiz(lesson.id);};
  $('#practiceTrace').hidden=!traceTargets(lesson).length;
  $('#practiceTrace').onclick=()=>{dialog.close();startTraceTest(lesson.id);};
  dialog.showModal();
}
function openVisualQuiz(lessonId){
  if(!visualBankReady||invalidPath||!visualBank.bank[lessonId])return;
  if(isActive||isStarting)stopSession();
  const lesson=allLessons().find(l=>l.id===lessonId);
  if(!lesson)return;
  visualSession=visualAssessment.create(visualBank.bank,lessonId,window.LoloAssessment.createAssessmentId(),visualBank.version);
  if(!visualSession)return;
  $('#visualQuizTitle').textContent=lesson.title||lesson.focus;
  renderVisualQuiz();
  $('#visualQuiz').showModal();
}
function renderVisualQuiz(){
  const state=visualSession,q=visualAssessment.current(state);
  if(!state||!q)return;
  $('#visualQuizProgress').textContent=`السؤال ${state.index+1} من ${state.questions.length}`;
  $('#visualQuizPrompt').textContent=q.prompt;$('#visualQuizPicture').textContent=q.visual;
  $('#visualQuizFeedback').textContent='';$('#visualQuizNext').hidden=true;$('#visualQuizDone').hidden=true;
  const options=$('#visualQuizOptions');options.replaceChildren();
  for(const option of q.options){
    const button=document.createElement('button');button.type='button';button.textContent=option.label;
    button.onclick=()=>{
      if(visualSession!==state)return;
      const submitted=visualAssessment.submit(state,q.id,option.id);
      if(!submitted)return;
      visualSession=submitted.state;
      for(const b of options.children)b.disabled=true;
      button.classList.add(submitted.result.correct?'correct':'incorrect');
      $('#visualQuizFeedback').textContent=submitted.result.correct?'برافو! إجابة جميلة ⭐':`محاولة جميلة! الإجابة هي: ${submitted.correctLabel}`;
      $('#visualQuizNext').textContent=visualAssessment.current(visualSession)?'السؤال التالي':'عرض النتيجة';
      $('#visualQuizNext').hidden=false;
    };options.append(button);
  }
}
$('#visualQuizNext').onclick=()=>{
  if(!visualSession)return;
  if(visualAssessment.current(visualSession)){renderVisualQuiz();return;}
  const result=visualAssessment.summarize(visualSession,visualBank.bank,visualBank.version,new Date().toISOString());
  const saved=visualAssessment.save(visualHistory,result);
  if(saved.recorded&&storage.set(VISUAL_HISTORY_KEY,JSON.stringify(saved.history)))visualHistory=saved.history;
  $('#visualQuizOptions').replaceChildren();$('#visualQuizPicture').textContent='🌟';
  $('#visualQuizProgress').textContent='انتهى التحدّي';
  $('#visualQuizPrompt').textContent=result?`نتيجتك: ${result.correct} من ${result.total}`:'لم تُحفظ النتيجة.';
  $('#visualQuizFeedback').textContent=result&&saved.recorded&&visualHistory[result.lessonId]?.some(r=>r.assessmentId===result.assessmentId)?'النتيجة محفوظة في تقرير ولي الأمر.':'تعذر حفظ النتيجة على الجهاز.';
  $('#visualQuizNext').hidden=true;$('#visualQuizDone').hidden=false;
  visualSession=null;renderParentReport();
};
$('#visualQuizClose').onclick=$('#visualQuizDone').onclick=()=>$('#visualQuiz').close();
$('#visualQuiz').addEventListener('close',()=>{visualSession=null;});
$('#homePractice').onclick=openOfflinePractice;
$('#practiceClose').onclick=$('#practiceBack').onclick=()=>$('#offlinePractice').close();
$('#offlinePractice').addEventListener('close',()=>window.speechSynthesis?.cancel());
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
    remindersEnabled: $('#remindersEnabled').checked,
    dailyReminder: $('#dailyReminder').checked,
    reminderHour: Math.max(0,Math.min(23,Number($('#reminderHour').value)||0)),
  };
  storage.set('lolo-parent-settings', JSON.stringify(parentSettings));
  $('#settingsSaved').textContent = 'اتحفظت الإعدادات على الجهاز ✅';
  if (!activePath && !invalidPath && !isActive && !isStarting && parentSettings.learningPath === 'foundation-first') {
    const firstFoundation = allLessons().find(lesson => lesson.programId === 'foundation' && !mastered.has(lesson.id));
    if (firstFoundation) {
      currentLesson = firstFoundation;
      sessionMode = 'lesson';
      storage.set('lolo-current-lesson', currentLesson.id);
      storage.set('lolo-selected-program', currentLesson.programId);
      cardsFor(currentLesson); updateLessonBadge(currentLesson); updateDashboardLesson(); updateProgress();
      refreshLessonPicker(currentLesson.programId, currentLesson.unitId);
    }
  }
  renderParentReport();
}

let nativeReminderBusy=false;
function nativeReminderAllowed(){return parentGate.isUnlocked()&&$('#parentSheet').classList.contains('open')&&document.visibilityState!=='hidden';}
async function refreshNativeReminder(action='status'){
  const plugin=window.Capacitor?.Plugins?.LearningReminder,panel=$('#nativeReminderPanel');
  if(!plugin||!window.Capacitor?.isNativePlatform?.()||!nativeReminderAllowed()){panel.hidden=true;return;}
  if(nativeReminderBusy)return;nativeReminderBusy=true;panel.hidden=false;
  for(const id of ['nativeReminderPermission','nativeReminderEnable','nativeReminderDisable'])$(id).disabled=true;
  try{
    let r;
    if(action==='permission')r=await plugin.requestNotificationPermission();
    else if(action==='enable')r=await plugin.enable({hour:Number($('#nativeReminderHour').value)});
    else if(action==='disable')r=await plugin.disable();
    else r=await plugin.status();
    if(!nativeReminderAllowed())return;
    if(action!=='permission')$('#nativeReminderHour').value=String(r.hour);
    $('#nativeReminderStatus').textContent=r.enabled?'التذكير مفعّل على هذا الجهاز.':r.permission?'يمكن تشغيل تذكير الهاتف.':'الإذن غير متاح. راجع إعدادات إشعارات Android.';
  }catch{if(nativeReminderAllowed())$('#nativeReminderStatus').textContent='تعذر تغيير إعداد إشعار الهاتف.';}
  finally{nativeReminderBusy=false;for(const id of ['nativeReminderPermission','nativeReminderEnable','nativeReminderDisable'])$(id).disabled=false;}
}
$('#nativeReminderPermission').onclick=()=>refreshNativeReminder('permission');
$('#nativeReminderEnable').onclick=()=>{if(nativeReminderAllowed()&&confirm('تشغيل تذكير عام يومي على هذا الجهاز؟'))refreshNativeReminder('enable');};
$('#nativeReminderDisable').onclick=()=>refreshNativeReminder('disable');
function renderLearningReminders(){
  const target=$('#learningReminders');if(!target)return;target.replaceChildren();
  if(!parentGate.isUnlocked()||!$('#parentSheet').classList.contains('open')||document.visibilityState==='hidden'||!window.LoloLearningReminders)return;
  const programId=$('#trackSelect')?.value||currentLesson?.programId||storage.get('lolo-selected-program');
  const lessons=allLessons().filter(l=>!programId||l.programId===programId);
  const due=[],times=[];
  for(const l of lessons){
    const records=(l.skillIds||[]).map(id=>learningEngine.getRecord(skillProgress,id)).filter(r=>r.curriculumVersion===course?.curriculumVersion&&r.lessonVersion===l.version);
    const dates=records.map(r=>Date.parse(r.nextReviewAt)).filter(Number.isFinite);
    if(dates.length)due.push({lessonId:l.id,title:l.title||l.focus||l.id,dueAt:Math.min(...dates)});
    for(const r of records)times.push(Date.parse(r.lastPracticedAt),Date.parse(r.lastAssessmentAt));
    times.push(Date.parse(testResults[l.id]?.completedAt),Date.parse(traceResults[l.id]?.completedAt));
    if(Array.isArray(visualHistory[l.id]))for(const r of visualHistory[l.id])if(r?.bankVersion===visualBank.version)times.push(Date.parse(r.completedAt));
  }
  const notices=window.LoloLearningReminders.derive({enabled:parentSettings.remindersEnabled===true,daily:parentSettings.dailyReminder===true,hour:parentSettings.reminderHour,now:Date.now(),due,practiceTimes:times,dismissedDay:storage.get('lolo-learning-reminder-dismissed-day-v1')});
  if(!notices.length){const p=document.createElement('p');p.textContent=parentSettings.remindersEnabled===true?'لا توجد تذكيرات مستحقة في المنهج المختار.':'التذكيرات متوقفة. فعّليها واحفظي الإعدادات لعرضها هنا.';target.append(p);return;}
  for(const n of notices){
    const row=document.createElement('div');row.className='parent-report-card';
    const text=document.createElement('p');text.textContent=n.kind==='review'?'حان موعد مراجعة: '+n.title:'تذكير لطيف: يمكنك تخصيص وقت قصير للتدريب اليوم إذا كان مناسبًا.';row.append(text);
    const b=document.createElement('button');b.type='button';b.className='small-btn';b.textContent=n.kind==='review'?'فتح التدريب المحلي':'إخفاء تذكير اليوم';
    b.onclick=()=>{if(!parentGate.isUnlocked()||!$('#parentSheet').classList.contains('open'))return;if(n.kind==='review'){openOfflinePractice(n.lessonId);}else if(storage.set('lolo-learning-reminder-dismissed-day-v1',n.day)){renderLearningReminders();}};row.append(b);target.append(row);
  }
}
function renderParentReport() {
  renderLearningReminders();
  const report = $('#parentReport');
  if (!report) return;
  report.replaceChildren();
  const programId = $('#trackSelect')?.value || currentLesson?.programId || storage.get('lolo-selected-program');
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
  const analytics=window.LoloLearningAnalytics?.summarize({lessons,completedIds:[...mastered],tests:testResults,traces:traceResults,visual:visualHistory,visualVersion:visualBank.version,curriculumVersion:course?.curriculumVersion});
  if(analytics?.summary){
    const a=analytics.summary;
    addCard('تحليل النتائج الحالية',a.latestPercent===null?'لا توجد اختبارات ترديد قابلة للمقارنة مع إصدار المنهج الحالي.':a.latestPercent+'% من '+a.latestTotal+' سؤالًا في أحدث اختبار لكل درس · '+a.assessed+' / '+a.lessonCount+' درس له اختبار');
    const panel=document.createElement('details');panel.className='parent-report-card';
    const heading=document.createElement('summary');heading.textContent='النتائج حسب الدرس وأولويات المراجعة';panel.append(heading);
    const note=document.createElement('p');note.textContent='التقييم خاص بالترديد وليس بالنطق أو الإتقان العام. الكتابة والفهم بالصور نتائج تدريبية مستقلة. لا نصنف الدرس قبل توفر خمسة أسئلة في أحدث اختبار.';panel.append(note);
    const labels={'practice':'يحتاج تدريبًا','strong-result':'نتيجة ترديد قوية','developing':'في مرحلة التحسن','limited-evidence':'أدلة قليلة','not-assessed':'لا يوجد اختبار حديث مطابق'};
    for(const row of analytics.rows){
      const section=document.createElement('div');section.className='parent-analytics-row';
      const name=document.createElement('strong');name.textContent=row.title+' · '+labels[row.status];section.append(name);
      const text=document.createElement('p');const pieces=[];
      if(row.latest){pieces.push('أحدث اختبار: '+row.latest.correct+'/'+row.latest.total+' ('+row.latest.percent+'%)');if(row.trend!==null)pieces.push('التغير عن الاختبار السابق: '+(row.trend>0?'+':'')+row.trend+' نقطة مئوية');}
      if(row.hasUncomparableTest)pieces.push('النتائج القديمة غير داخلة في التحليل الحالي');
      if(row.tracePercent!==null)pieces.push('الكتابة: '+row.tracePercent+'%');
      if(row.visualPercent!==null)pieces.push('الفهم بالصور: '+row.visualPercent+'%');
      text.textContent=pieces.join(' · ')||'لا توجد نتائج حديثة قابلة للعرض.';section.append(text);
      if(row.latest){const meter=document.createElement('progress');meter.max=100;meter.value=row.latest.percent;meter.setAttribute('aria-label','نتيجة الترديد '+row.title);section.append(meter);}
      if(a.priorities.includes(row.id)){const button=document.createElement('button');button.type='button';button.className='small-btn';button.textContent='اختيار الدرس للمراجعة';button.onclick=()=>{if(parentGate.isUnlocked()&&$('#parentSheet').classList.contains('open'))chooseLesson(row.id,'test');};section.append(button);}
      panel.append(section);
    }
    report.append(panel);
    const dueLessonIds=lessons.filter(lesson=>(lesson.skillIds||[]).some(id=>{
      const r=learningEngine.getRecord(skillProgress,id);
      return r.curriculumVersion===course?.curriculumVersion&&r.lessonVersion===lesson.version&&learningEngine.getStatus(skillProgress,id)===learningEngine.STATUS.REVIEW_REQUIRED;
    })).map(l=>l.id);
    const eligibleIds=lessons.filter(l=>l.board?.tokens?.some(t=>t.text)||l.cards?.length||traceTargets(l).length||visualBankReady&&visualBank.bank[l.id]).map(l=>l.id);
    const suggestions=window.LoloLearningAnalytics.recommend(analytics,{dueLessonIds,eligibleIds});
    const rec=document.createElement('div');rec.className='parent-report-card';rec.id='adaptiveRecommendations';
    const heading2=document.createElement('strong');heading2.textContent='خطة تدريب مقترحة (حتى 3 دروس)';rec.append(heading2);
    const reasonLabels={'scheduled-review':'حان موعد المراجعة','practice':'آخر نتيجة ترديد تحتاج تدريبًا','consolidate':'تثبيت المعلومات','new-lesson':'درس جديد غير مختبر'};
    if(!suggestions.length){const t=document.createElement('p');t.textContent='لا توجد أولويات واضحة حاليًا في هذا المنهج. يمكنك اختيار الدروس يدويًا.';rec.append(t);}
    for(const item of suggestions){
      const row=document.createElement('div');row.className='parent-analytics-row';
      const t=document.createElement('p');t.textContent=item.title+' · '+reasonLabels[item.reason]+(item.percent===null?'':' · '+item.percent+'%');row.append(t);
      const b=document.createElement('button');b.type='button';b.className='small-btn';b.textContent='تدريب محلي على الدرس';
      b.onclick=()=>{if(parentGate.isUnlocked()&&$('#parentSheet').classList.contains('open'))openOfflinePractice(item.lessonId);};row.append(b);rec.append(row);
    }
    report.append(rec);
  }
  addCard('الاختبارات', `${testEntries.length} شفهي · ${traceEntries.length} كتابة باللمس`);
  const visualEntries=lessons.filter(l=>Array.isArray(visualHistory[l.id])&&visualHistory[l.id].some(r=>r?.bankVersion===visualBank.version));
  if(visualEntries.length)addCard('تحدّي الفهم بالصور',`${visualEntries.length} دروس لها نتائج محلية مستقلة · محتوى تجريبي، لا يمثل إتقان المنهج`);
  const skillIds = new Set(lessons.flatMap(lesson => lesson.skillIds || []));
  const skillStates = [...skillIds].map(skillId => ({skillId, status: learningEngine.getStatus(skillProgress, skillId)}));
  const skillCounts = Object.fromEntries(Object.values(learningEngine.STATUS).map(status => [status, 0]));
  for (const item of skillStates) skillCounts[item.status] += 1;
  const dueIds = new Set(learningEngine.getDueSkillIds(skillProgress));
  const dueLesson = lessons.find(lesson => (lesson.skillIds || []).some(skillId => dueIds.has(skillId)));
  const skillCard = document.createElement('div'); skillCard.className = 'parent-report-card';
  const skillTitle = document.createElement('strong'); skillTitle.textContent = 'متابعة الترديد ';
  const skillText = document.createElement('span'); skillText.textContent = `${skillCounts[learningEngine.STATUS.MASTERED]} متقنة · ${skillCounts[learningEngine.STATUS.PROFICIENT]} متقدمة · ${skillCounts[learningEngine.STATUS.REVIEW_REQUIRED]} للمراجعة`;
  skillCard.append(skillTitle, skillText);
  if (dueLesson) {
    const reviewButton = document.createElement('button');
    reviewButton.type = 'button'; reviewButton.className = 'small-btn'; reviewButton.textContent = `ابدئي مراجعة: ${dueLesson.title || dueLesson.focus}`;
    reviewButton.addEventListener('click', () => chooseLesson(dueLesson.id, 'test'));
    skillCard.appendChild(reviewButton);
  }
  report.appendChild(skillCard);
  const activeProgram = programList().find(program => program.id === programId);
  if (activeProgram) {
    const pathResults = writingPathResults[activeProgram.id] || {};
    const done = Object.values(pathResults).filter(result => (result?.bestPercent || result?.percent || 0) >= 75).length;
    const stageCount = writingStages(activeProgram).length;
    if(stageCount)addCard(activeProgram.subject === 'math' ? 'مسار الماث المتقدم' : 'مسار الكتابة المتقدمة', `${done} من ${stageCount} مراحل متقنة${writingPathOverrides[activeProgram.id] ? ' · فتح وليّ الأمر كل المراحل' : ''}`);
  }
  for (const lesson of lessons) {
    const stats = lessonStats[lesson.id] || {};
    const result = testResults[lesson.id];
    const trace = traceResults[lesson.id];
    const lessonSkillStates = (lesson.skillIds || []).map(skillId => ({skillId, status: learningEngine.getStatus(skillProgress, skillId)}));
    const visualResult=Array.isArray(visualHistory[lesson.id])?visualHistory[lesson.id].filter(r=>r?.bankVersion===visualBank.version).at(-1):null;
    if (!stats.correct && !stats.wrong && !result && !trace && !visualResult && lessonSkillStates.every(item => item.status === learningEngine.STATUS.NOT_STARTED)) continue;
    const details = [];
    for (const item of lessonSkillStates) {
      const record = learningEngine.getRecord(skillProgress, item.skillId);
      details.push(`حالة الترديد: ${learningEngine.getStatusLabel(item.status)}${record.nextReviewAt ? ` · المراجعة ${new Date(record.nextReviewAt).toLocaleDateString('ar-EG')}` : ''}`);
    }
    if (stats.correct || stats.wrong) details.push(`${stats.correct || 0} صح و${stats.wrong || 0} محتاجة مراجعة`);
    if (result) details.push(`اختبار الترديد ${result.correct}/${result.total}`);
    if (visualResult) details.push(`تحدّي الفهم بالصور: ${visualResult.correct}/${visualResult.total}`);
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
  $('#remindersEnabled').checked=parentSettings.remindersEnabled===true;
  $('#dailyReminder').checked=parentSettings.dailyReminder===true;
  $('#reminderHour').value=String(Number.isInteger(parentSettings.reminderHour)&&parentSettings.reminderHour>=0&&parentSettings.reminderHour<=23?parentSettings.reminderHour:17);
}

function showParentTab(tab) {
  const settings = tab === 'settings';
  if(!settings){resetCloudFamily();clearLocalBackup();}
  $('#parentLessonsPanel').hidden = settings;
  $('#parentSettingsPanel').hidden = !settings;
  $('#parentLessonsTab').setAttribute('aria-selected', String(!settings));
  $('#parentSettingsTab').setAttribute('aria-selected', String(settings));
  $('#parentSheetTitle').textContent = settings ? 'إعدادات وليّ الأمر' : 'اختيار الدروس والاختبارات';
  $('#parentScroll').scrollTop = 0;
}

function setParentGateView(view, title, intro = '') {
  if ($('#parentGate').hidden) parentGateReturnFocus = document.activeElement;
  $('#parentGate').hidden = false;
  document.body.classList.add('parent-gate-open');
  $('#parentGate').setAttribute('aria-hidden', 'false');
  $('#parentGateTitle').textContent = title;
  $('#parentGateIntro').textContent = intro;
  $('#parentGateStatus').textContent = '';
  document.querySelectorAll('[data-gate-view]').forEach(element => { element.hidden = element.dataset.gateView !== view; });
  const firstInput = $(`#parentGate [data-gate-view="${view}"] input`);
  firstInput?.focus();
}

function closeParentGateModal(restoreFocus = true) {
  $('#parentGate').hidden = true;
  $('#parentGate').setAttribute('aria-hidden', 'true');
  document.body.classList.remove('parent-gate-open');
  $('#parentGate').querySelectorAll('input').forEach(input => { input.value = ''; });
  $('#parentGateStatus').textContent = '';
  const returnFocus = parentGateReturnFocus;
  parentGateReturnFocus = null;
  if (restoreFocus && returnFocus?.isConnected && typeof returnFocus.focus === 'function') returnFocus.focus();
}

function closeParentSettings() {
  $('#nativeReminderPanel').hidden=true;$('#nativeReminderStatus').textContent='';
  $('#learningReminders')?.replaceChildren();
  clearLocalBackup();
  clearExtraParent();
  resetCloudFamily();
  clearTimeout(parentGateAutoLockTimer);
  parentGateAutoLockTimer = null;
  parentGate.lock();
  $('#parentSheet').classList.remove('open');
  $('#parentSheet').setAttribute('aria-hidden', 'true');
}

function scheduleParentAutoLock() {
  clearTimeout(parentGateAutoLockTimer);
  parentGateAutoLockTimer = setTimeout(() => {
    if (!parentGate.isUnlocked()) {
      closeParentSettings();
      $('#parentProgress').textContent = 'اتقفلت لوحة وليّ الأمر بعد فترة من غير استخدام.';
    }
  }, parentGate.autoLockMs + 50);
}

function showParentGate(view, title, intro) {
  setParentGateView(view, title, intro);
}

function displayRecoveryCode(code, purpose) {
  parentGateRecoveryPurpose = purpose;
  $('#parentGateRecoveryOutput').textContent = code;
  setParentGateView('recovery-display', 'احتفظي برمز الاستعادة', 'اكتبي الرمز في مكان آمن. مش هنقدر نعرضه مرة تانية.');
  $('#parentGateRecoveryDone').focus();
}

function parentGateError(result) {
  const messages = {
    PIN_FORMAT: 'اكتبي ٦ أرقام بالضبط.', PIN_MISMATCH: 'الرقمان مش متطابقين.',
    INCORRECT_PIN: 'الرقم السري مش صحيح.', INCORRECT_RECOVERY_CODE: 'رمز الاستعادة مش صحيح.',
    LOCKED: `المحاولات كتير. استني ${Math.max(1, Math.ceil((result.retryAfterMs || 60000) / 60000))} دقيقة وجربي تاني.`,
    STORAGE_UNAVAILABLE: 'تعذر حفظ الحماية على الجهاز. تأكدي من مساحة التخزين وجربي تاني.',
    SECURE_CRYPTO_UNAVAILABLE: 'المتصفح لا يدعم الحماية المشفرة المطلوبة. افتحي التطبيق من رابط آمن أو localhost.',
    ALREADY_CONFIGURED: 'الحماية متفعلة بالفعل. اكتبي الرقم السري لفتح اللوحة.',
    NOT_CONFIGURED: 'الحماية غير مضبوطة. ابدئي بإعداد رقم سري جديد.',
  };
  $('#parentGateStatus').textContent = messages[result?.reason] || 'ماقدرناش نكمل العملية. راجعي البيانات وجربي تاني.';
}

function renderLocalProfiles(){
  if(!parentGate.isUnlocked())return;
  const list=$('#localProfilesList');list.replaceChildren();
  const profiles=storage.profiles.list();
  for(const profile of profiles){
    const row=document.createElement('div');row.className='local-profile-row';row.dataset.active=String(profile.id===storage.profiles.activeId);
    const name=document.createElement('strong');name.textContent=profile.name+(profile.id===storage.profiles.activeId?' · الملف الحالي':'');
    const rename=document.createElement('button');rename.type='button';rename.textContent='تعديل الاسم';
    rename.onclick=()=>{
      if(!parentGate.isUnlocked())return openParentSettings('settings');
      const value=prompt('اكتبي اسمًا مستعارًا للملف:',profile.name);
      if(value===null)return;
      if(!parentGate.isUnlocked())return openParentSettings('settings');
      if(!storage.profiles.rename(profile.id,value)){$('#localProfilesStatus').textContent='تعذر تعديل الاسم. راجعي الاسم أو أعيدي فتح التطبيق.';return;}
      renderLocalProfiles();renderActiveLocalProfile();
    };
    row.append(name,rename);
    if(profile.id!==storage.profiles.activeId){
      const select=document.createElement('button');select.type='button';select.textContent='فتح الملف';select.dataset.profileId=profile.id;
      select.onclick=()=>{
        if(!parentGate.isUnlocked())return openParentSettings('settings');
        if(isActive||isStarting)stopSession();
        if(!storage.profiles.select(profile.id)){$('#localProfilesStatus').textContent='تعذر فتح الملف. أعيدي فتح التطبيق وجربي تاني.';return;}
        closeParentSettings();location.reload();
      };row.append(select);
    }
    list.append(row);
  }
  $('#localProfileForm').hidden=profiles.length===0||profiles.length>=12;
}
function renderActiveLocalProfile(){
  const profile=storage.profiles.current();
  $('#activeLocalProfile').textContent=profile?'ملف التعلم: '+profile.name:'ملفات التعلم تحتاج مراجعة';
}
$('#localProfileForm').addEventListener('submit',event=>{
  event.preventDefault();
  if(!parentGate.isUnlocked())return openParentSettings('settings');
  const input=$('#localProfileName');
  if(!storage.profiles.create(input.value)){$('#localProfilesStatus').textContent='تعذر إضافة الملف. اختاري اسمًا مستعارًا صالحًا أو راجعي التخزين.';return;}
  input.value='';renderLocalProfiles();$('#localProfilesStatus').textContent='اتضاف ملف جديد. اختاري فتح الملف للبدء.';
});
renderActiveLocalProfile();

let cloudUiEnabled=false,cloudSyncEnabled=false;
const BACKUP_QUEUE_KEY='lolo-pending-cloud-backup-v1';
const CLOUD_LINK_KEY='lolo-cloud-profile-link-v1';
const familyClient=window.LoloFamilyClient.create(apiFetch,{linkStore:{read:()=>{const raw=storage.get(CLOUD_LINK_KEY);return raw===null?null:JSON.parse(raw);},write:v=>storage.profiles.selectedId()===storage.profiles.activeId&&storage.set(CLOUD_LINK_KEY,JSON.stringify(v)),remove:()=>storage.profiles.selectedId()===storage.profiles.activeId&&storage.remove(CLOUD_LINK_KEY)},queueStore:{read:()=>storage.getJSON(BACKUP_QUEUE_KEY,null),write:q=>storage.set(BACKUP_QUEUE_KEY,JSON.stringify(q)),remove:()=>storage.remove(BACKUP_QUEUE_KEY)},allowed:()=>cloudUiEnabled&&!!storage.profiles.activeId&&storage.profiles.selectedId()===storage.profiles.activeId&&parentGate.isUnlocked()&&$('#parentSheet').classList.contains('open')&&!$('#parentSettingsPanel').hidden&&document.visibilityState!=='hidden'});
function resetCloudFamily(){
  familyClient.clear();$('#cloudEmail').value='';$('#cloudPassword').value='';$('#cloudNickname').value='';$('#cloudConfirm').checked=false;$('#cloudMergeConfirm').checked=false;$('#cloudRestoreConfirm').checked=false;$('#cloudLinkConfirm').checked=false;$('#cloudLinkRetry').checked=false;$('#cloudStatus').textContent='';renderCloudFamily();
}
function localProgressSnapshot(){
  if(!course||invalidPath||!storage.profiles.activeId||storage.profiles.selectedId()!==storage.profiles.activeId)return null;
  const ids=new Set(allLessons().map(l=>l.id));
  const path=activePath?JSON.parse(JSON.stringify(activePath)):null;
  if(path&&!pathEngine.validate(path,allLessons(),course.curriculumVersion))return null;
  return {schemaVersion:1,curriculumVersion:course.curriculumVersion,completedLessonIds:[...mastered].filter(id=>ids.has(id)).sort(),path};
}
function restoredProfileEntries(snapshot){
  if(!course||!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)||Object.keys(snapshot).sort().join(',')!=='completedLessonIds,curriculumVersion,path,schemaVersion'||snapshot.schemaVersion!==1||snapshot.curriculumVersion!==course.curriculumVersion)return null;
  const lessons=allLessons(),ids=new Set(lessons.map(l=>l.id)),done=snapshot.completedLessonIds;
  if(!Array.isArray(done)||done.length>ids.size||!done.every(id=>typeof id==='string'&&ids.has(id))||new Set(done).size!==done.length)return null;
  const entries={'lolo-mastered':JSON.stringify(done)};
  if(snapshot.path!==null){
    const path=snapshot.path;
    if(!path||typeof path!=='object'||Object.keys(path).sort().join(',')!=='currentIndex,curriculumVersion,lessonId,lessonIds,programId,schemaVersion,scope,skippedLessonIds,status,unitId'||!pathEngine.validate(path,lessons,course.curriculumVersion))return null;
    const program=programList().find(p=>p.id===path.programId);
    const lesson=lessons.find(l=>l.id===(pathEngine.current(path)||path.lessonIds.at(-1)||path.skippedLessonIds.at(-1)));
    if(!program||!lesson)return null;
    entries['lolo-learning-path-v1']=JSON.stringify(path);
    entries['lolo-selected-program']=program.id;
    if(program.gradeId)entries['lolo-grade-id']=program.gradeId;
    entries['lolo-current-lesson']=lesson.id;
    entries['lolo-welcome-tour-v1-complete']='true';
  }
  return entries;
}
// Limited, offline, parent-authorized migration backup. Never stores credentials or sends requests.
const LOCAL_BACKUP_MAX=32768;
function localBackupAllowed(){
  return parentGate.isUnlocked()&&$('#parentSheet').classList.contains('open')&&!$('#parentSettingsPanel').hidden&&document.visibilityState!=='hidden'&&!!storage.profiles.activeId&&storage.profiles.selectedId()===storage.profiles.activeId;
}
function clearLocalBackup(){
  $('#localBackupText').value='';$('#localBackupName').value='';$('#localBackupConfirm').checked=false;$('#localBackupStatus').textContent='';
}
$('#localBackupExport').onclick=()=>{
  if(!localBackupAllowed())return clearLocalBackup();
  if(isActive||isStarting)stopSession();
  clearLocalBackup();
  const snapshot=localProgressSnapshot();
  if(!restoredProfileEntries(snapshot)){$('#localBackupStatus').textContent='تعذر تجهيز نسخة متوافقة من التقدم.';return;}
  const value=JSON.stringify(snapshot);
  if(value.length>LOCAL_BACKUP_MAX){$('#localBackupStatus').textContent='حجم النسخة أكبر من الحد المتاح.';return;}
  $('#localBackupText').value=value;
  $('#localBackupText').focus();$('#localBackupText').select();
  $('#localBackupStatus').textContent='انسخي النص كاملًا واحفظيه في مكان خاص خارج التطبيق قبل حذفه.';
};
$('#localBackupText').addEventListener('input',()=>{$('#localBackupConfirm').checked=false;});
$('#localBackupName').addEventListener('input',()=>{$('#localBackupConfirm').checked=false;});
$('#localBackupRestore').onclick=()=>{
  if(!localBackupAllowed())return clearLocalBackup();
  if(!$('#localBackupConfirm').checked){$('#localBackupStatus').textContent='أكدي إنشاء ملف تعلم جديد أولًا.';return;}
  const raw=$('#localBackupText').value;
  $('#localBackupConfirm').checked=false;
  let snapshot=null;
  if(raw.length>0&&raw.length<=LOCAL_BACKUP_MAX){try{snapshot=JSON.parse(raw);}catch{}}
  const entries=restoredProfileEntries(snapshot);
  if(!entries){$('#localBackupStatus').textContent='النص غير صالح أو إصدار المنهج غير متوافق. لم يتغير أي ملف.';return;}
  const id=storage.profiles.importCopy($('#localBackupName').value,entries);
  if(!id){$('#localBackupStatus').textContent='تعذر الاستعادة. راجعي الاسم ومساحة التخزين وعدد الملفات.';return;}
  clearLocalBackup();renderLocalProfiles();
  $('#localBackupStatus').textContent='تمت استعادة نسخة مستقلة. افتحي الملف الجديد من ملفات التعلم.';
};
function renderCloudFamily(){
  const s=familyClient.state();$('#cloudFamilyPanel').hidden=!cloudUiEnabled;
  $('#cloudLogin').hidden=s.signedIn;$('#cloudAccount').hidden=!s.signedIn;
  $('#cloudFamilyPanel').querySelectorAll('button,input,select').forEach(el=>el.disabled=s.busy||navigator.onLine===false);
  const list=$('#cloudChildren');list.replaceChildren();
  const profileId=storage.profiles.activeId,link=familyClient.linkState(profileId);
  $('#cloudLinkStatus').textContent=!link.valid?'ربط الملف غير صالح؛ المزامنة متوقفة.':link.linked?(link.authorized?'الملف مرتبط بالحساب السحابي الحالي.':'الملف مرتبط بحساب آخر أو ملف غير متاح؛ سجلي الدخول للحساب المرتبط.'):'الملف غير مرتبط.';
  $('#cloudUnlink').hidden=!link.authorized;$('#cloudUnlink').disabled=s.busy||!!familyClient.pending();
  $('#cloudLinkBox').hidden=!cloudSyncEnabled||!s.signedIn||!link.valid||link.linked||!!familyClient.pending();
  $('#cloudLinkChild').replaceChildren(...s.children.map(c=>new Option(c.nickname,c.id)));
  $('#cloudLinkCreate').disabled=s.busy||!$('#cloudLinkConfirm').checked||!s.children.length||!link.valid||link.linked||!!familyClient.pending();
  for(const child of s.children){
    const row=document.createElement('div');row.className='local-profile-row';
    const name=document.createElement('strong');name.textContent=child.nickname;row.append(name);
    if(cloudSyncEnabled&&link.valid&&(!link.linked||link.authorized&&link.childId===child.id)){
      const button=document.createElement('button');button.type='button';button.textContent='معاينة النسخة';button.disabled=s.busy||navigator.onLine===false;
      button.onclick=()=>{if(!parentGate.isUnlocked())return resetCloudFamily();if(isActive||isStarting)stopSession();$('#cloudConfirm').checked=false;$('#cloudMergeConfirm').checked=false;$('#cloudRestoreConfirm').checked=false;runCloud(()=>familyClient.compare(child.id,storage.profiles.activeId,localProgressSnapshot()),'راجعي الملفين قبل أي حفظ.');};
      row.append(button);
    }list.append(row);
  }
  const q=familyClient.pending();
  $('#cloudPendingBox').hidden=!q||!cloudSyncEnabled;
  if(q){
    $('#cloudPendingText').textContent=q.status==='conflict'?'في تعارض مع نسخة سحابية. راجعي النسخة قبل أي محاولة جديدة.':'في طلب حفظ وافقتِ عليه قبل كده. سجّلي الدخول لنفس الحساب وراجعيه لإكماله.';
    $('#cloudResume').disabled=s.busy||navigator.onLine===false||!q.authorized||q.status!=='pending';
    $('#cloudDiscard').disabled=s.busy;
  }
  const p=s.preview;$('#cloudPreview').hidden=!p||!cloudSyncEnabled;
  if(p){
    const remote=p.remote?.completedLessonIds?.length||0;
    const child=s.children.find(c=>c.id===p.childId);
    $('#cloudPreviewText').textContent=`ملف الجهاز: ${storage.profiles.current()?.name||''} · ${p.local.completedLessonIds.length} درس مكتمل. الملف السحابي: ${child?.nickname||''} · ${remote} درس · إصدار ${p.revision}. ${p.revision?'في نسخة محفوظة؛ الدمج اختياري ولا يستبدل الخطة السحابية.':'لم يُحفظ تقدم سحابي بعد.'}`;
    $('#cloudConfirmLabel').hidden=p.revision!==0;$('#cloudUpload').hidden=p.revision!==0;
    $('#cloudUpload').disabled=s.busy||navigator.onLine===false||!$('#cloudConfirm').checked||p.revision!==0||!!q;
    const canMerge=p.revision>0&&!!restoredProfileEntries(p.remote)&&!!restoredProfileEntries(p.local)&&!!restoredProfileEntries(p.merged);
    $('#cloudMergeBox').hidden=!canMerge;
    $('#cloudMergeText').textContent=canMerge?'بعد الدمج: '+p.merged.completedLessonIds.length+' درس مكتمل. الخطة السحابية ستبقى كما هي، وملف الجهاز لن يتغير.':'';
    $('#cloudMerge').disabled=!canMerge||s.busy||navigator.onLine===false||!$('#cloudMergeConfirm').checked||!!q;
    $('#cloudRestoreBox').hidden=p.revision===0||!restoredProfileEntries(p.remote);
    $('#cloudRestore').disabled=s.busy||!$('#cloudRestoreConfirm').checked||storage.profiles.list().length>=12;
  }
}
async function runCloud(action,success){
  if(!cloudUiEnabled||!parentGate.isUnlocked()||navigator.onLine===false)return;
  $('#cloudStatus').textContent='جاري تنفيذ الطلب…';
  try{const pending=action();renderCloudFamily();await pending;if(parentGate.isUnlocked()&&$('#parentSheet').classList.contains('open')&&!$('#parentSettingsPanel').hidden&&navigator.onLine!==false)$('#cloudStatus').textContent=success;}
  catch(error){if(parentGate.isUnlocked()&&$('#parentSheet').classList.contains('open'))$('#cloudStatus').textContent=error.status===409?'في نسخة محفوظة أو أحدث. اعملي معاينة جديدة؛ لم يُستبدل أي تقدم.':error.status===401?'بيانات الدخول غير صحيحة أو انتهت الجلسة.':'تعذر إتمام الطلب. جربي مرة تانية عند توفر الاتصال.';}
  finally{renderCloudFamily();}
}
$('#cloudLogin').addEventListener('submit',event=>{
  event.preventDefault();
  const email=$('#cloudEmail').value,password=$('#cloudPassword').value;$('#cloudPassword').value='';
  runCloud(async()=>{await familyClient.login(email,password);await familyClient.list();if(cloudSyncEnabled)await familyClient.retryLinked(storage.profiles.activeId,localProgressSnapshot());},'تم تسجيل الدخول ومراجعة الطلبات الموافق عليها.');
});
$('#cloudChildForm').addEventListener('submit',event=>{event.preventDefault();const nickname=$('#cloudNickname').value;$('#cloudNickname').value='';runCloud(()=>familyClient.add(nickname,$('#cloudAgeBand').value),'تم إضافة الملف.');});
$('#cloudRefresh').onclick=()=>runCloud(()=>familyClient.list(),'تم تحديث الملفات.');
$('#cloudLogout').onclick=()=>runCloud(()=>familyClient.logout(),'تم تسجيل الخروج.');
$('#cloudLinkConfirm').onchange=()=>{$('#cloudLinkCreate').disabled=!$('#cloudLinkConfirm').checked||!familyClient.state().signedIn||!$('#cloudLinkChild').value;};
$('#cloudLinkChild').onchange=()=>{$('#cloudLinkConfirm').checked=false;$('#cloudLinkCreate').disabled=true;};
$('#cloudLinkCreate').onclick=()=>{
  if(!cloudSyncEnabled||!parentGate.isUnlocked()||!$('#cloudLinkConfirm').checked)return;
  const ok=familyClient.link($('#cloudLinkChild').value,storage.profiles.activeId,$('#cloudLinkRetry').checked);
  $('#cloudLinkConfirm').checked=false;$('#cloudLinkRetry').checked=false;
  $('#cloudStatus').textContent=ok?'تم ربط الملف على هذا الجهاز. لم يتم إرسال تقدم.':'تعذر الربط. راجعي الحساب والطلبات المحفوظة.';
  renderCloudFamily();
};
$('#cloudUnlink').onclick=()=>{
  if(!cloudSyncEnabled||!parentGate.isUnlocked()||!confirm('إلغاء الربط المحلي؟ لن تُحذف البيانات السحابية.'))return;
  $('#cloudStatus').textContent=familyClient.unlink(storage.profiles.activeId)?'تم إلغاء الربط.':'تعذر إلغاء الربط؛ راجعي الطلبات المحفوظة.';
  renderCloudFamily();
};
$('#cloudConfirm').onchange=renderCloudFamily;
$('#cloudUpload').onclick=()=>{
  if(!$('#cloudConfirm').checked||!cloudSyncEnabled)return;
  $('#cloudConfirm').checked=false;
  runCloud(()=>familyClient.upload(storage.profiles.activeId,localProgressSnapshot()),'تم حفظ النسخة الأولى من التقدم. بيانات الجهاز لم تتغير.');
};
$('#cloudMergeConfirm').onchange=renderCloudFamily;
$('#cloudMerge').onclick=()=>{
  if(!$('#cloudMergeConfirm').checked||!cloudSyncEnabled||!parentGate.isUnlocked())return;
  const p=familyClient.state().preview;
  if(!p||!restoredProfileEntries(p.remote)||!restoredProfileEntries(p.merged)||!restoredProfileEntries(p.local))return;
  $('#cloudMergeConfirm').checked=false;
  runCloud(()=>familyClient.merge(storage.profiles.activeId,localProgressSnapshot()),'تم دمج الدروس المكتملة في السحابة. بيانات الجهاز والخطة السحابية لم تتغير.');
};
$('#cloudResume').onclick=()=>{
  if(!cloudSyncEnabled||!parentGate.isUnlocked()||!familyClient.pending()?.authorized)return;
  runCloud(()=>familyClient.resume(storage.profiles.activeId,localProgressSnapshot()),'تم حفظ التقدم الموافق عليه. بيانات الجهاز لم تتغير.');
};
$('#cloudDiscard').onclick=()=>{
  if(!parentGate.isUnlocked()||!confirm('إلغاء طلب الحفظ المحلي؟ قد يكون الخادم استلمه بالفعل؛ اعملي معاينة جديدة للتحقق.'))return;
  if(familyClient.discard()){$('#cloudStatus').textContent='تم إلغاء الطلب المحلي. لم تُحذف أي نسخة سحابية.';}
  renderCloudFamily();
};
$('#cloudRestoreConfirm').onchange=renderCloudFamily;
$('#cloudRestore').onclick=()=>{
  if(!cloudUiEnabled||!cloudSyncEnabled||!parentGate.isUnlocked()||!$('#cloudRestoreConfirm').checked)return;
  const s=familyClient.state(),p=s.preview;
  if(s.busy||!p||p.revision<1||p.localProfileId!==storage.profiles.activeId)return;
  const entries=restoredProfileEntries(p.remote),child=s.children.find(c=>c.id===p.childId);
  if(!entries||!child)return;
  const name=('نسخة · '+child.nickname).slice(0,40);
  const id=storage.profiles.importCopy(name,entries);
  $('#cloudRestoreConfirm').checked=false;
  $('#cloudStatus').textContent=id?'تمت استعادة نسخة مستقلة على الجهاز. الملف الحالي لم يتغير. افتحي النسخة من ملفات التعلم.':'تعذر استعادة النسخة. راجعي مساحة التخزين وعدد الملفات.';
  renderLocalProfiles();renderCloudFamily();
};
window.addEventListener('offline',resetCloudFamily);
window.addEventListener('online',()=>{if(parentGate.isUnlocked())renderCloudFamily();});
// Additional signed curricula remain separate from existing learning paths and mastery.
const extraStore=window.LoloContentInstall.create({trustedKeys:window.LoloContentTrust});
const extraProgress=window.LoloContentProgress.create(storage);
const extraClient=window.LoloContentClient.create({request:(...args)=>apiFetch(...args),trustedKeys:window.LoloContentTrust});
let extraRemoteItems=[],extraRemoteController=null;
let extraGeneration=0,extraPackage=null,extraSession=null,extraBusy=false,extraContext=null,extraSaved=false;
const extraAllowed=()=>parentGate.isUnlocked()&&$('#parentSheet').classList.contains('open')&&storage.profiles.activeId&&storage.profiles.selectedId()===storage.profiles.activeId;
const extraTrusted=()=>Object.keys(window.LoloContentTrust).length>0;
function clearExtraParent(){
  clearExtraReview();
  extraGeneration++;extraPackage=null;$('#extraContentFile').value='';
  extraRemoteController?.abort();extraRemoteItems=[];$('#extraRemoteSelect').replaceChildren();$('#extraRemoteStatus').textContent='';$('#extraDownload').disabled=true;$('#extraRefreshRemote').disabled=true;
  for(const id of ['extraContentSelect','extraUnit','extraLesson'])$('#'+id).replaceChildren();
  $('#extraStart').disabled=true;$('#extraContentStatus').textContent='';
}
function extraOptions(select,items,label){
  select.replaceChildren(new Option(label,''));
  for(const item of items)select.append(new Option(item.title,item.id));
}
let extraReviewTarget=null;
function clearExtraReview(){
  extraReviewTarget=null;$('#extraReviewPanel').hidden=true;$('#extraReviewText').textContent='';$('#extraReviewSelect').hidden=true;
}
function extraReviewMessage(report){
  if(!report||!report.recommendation)return '';
  const r=report.recommendation;
  if(r.kind==='resume')return 'يوجد تدريب غير مكتمل. استكمليه قبل اقتراح مراجعة جديدة.';
  if(r.kind==='review-lesson')return 'مراجعة مقترحة: '+r.title+' — ظهرت إجابات غير صحيحة في آخر تدريب. هذه توصية تدريبية وليست حكمًا على مستوى الطالب.';
  if(r.kind==='continue')return 'كل الإجابات المقيمة في آخر تدريب صحيحة. يمكنك متابعة المنهج؛ لا تثبت هذه المحاولة وحدها الإتقان.';
  return 'تم إكمال أنشطة تدريبية بلا درجات. لا توجد أدلة كافية لتحديد مراجعة مقيمة.';
}
function renderExtraReview(){
  clearExtraReview();
  if(!extraAllowed()||extraBusy||!extraPackage||$('#extraStart').disabled)return;
  const scope=$('#extraScope').value,unit=$('#extraUnit').value,lesson=$('#extraLesson').value;
  const saved=extraProgress.load(extraPackage,scope,unit,lesson);
  if(!saved.valid||!saved.results.length)return;
  const report=window.LoloContentRuntime.review(extraPackage,scope,unit,lesson,saved.results);
  if(!report)return;
  $('#extraReviewPanel').hidden=false;$('#extraReviewText').textContent=extraReviewMessage(report);
  if(saved.reviewSchedule){const due=saved.reviewSchedule.dueAt;$('#extraReviewText').textContent+=' '+(Date.now()>=due?'حان موعد المراجعة.':'موعد المراجعة المقترح: '+new Date(due).toLocaleDateString('ar-EG')+' (بعد '+saved.reviewSchedule.intervalDays+' يوم من التدريب المجدول).');}
  const rec=report.recommendation;
  if(rec?.kind==='review-lesson'){
    extraReviewTarget={package:extraPackage,generation:extraGeneration,unit:rec.unitId,lesson:rec.lessonId};
    $('#extraReviewSelect').hidden=false;
  }
}
$('#extraReviewSelect').onclick=()=>{
  const t=extraReviewTarget;
  if(!t||!extraAllowed()||extraBusy||t.package!==extraPackage||t.generation!==extraGeneration)return;
  $('#extraScope').value='lesson';$('#extraUnit').value=t.unit;renderExtraScope();
  $('#extraLesson').value=t.lesson;renderExtraScope();
  $('#extraContentStatus').textContent='تم اختيار درس المراجعة. ابدئي التدريب عند الاستعداد.';
};
function renderExtraScope(){
  const scope=$('#extraScope').value,unit=extraPackage?.content.units.find(u=>u.id===$('#extraUnit').value);
  const prior=$('#extraLesson').value;
  extraOptions($('#extraLesson'),unit?.lessons||[],'اختاري الدرس');
  if(unit?.lessons.some(l=>l.id===prior))$('#extraLesson').value=prior;
  $('#extraUnit').disabled=scope==='curriculum';$('#extraLesson').disabled=scope!=='lesson';
  $('#extraStart').disabled=!extraAllowed()||extraBusy||!extraPackage||!(scope==='curriculum'||scope==='unit'&&unit||scope==='lesson'&&unit?.lessons.some(l=>l.id===$('#extraLesson').value));
  renderExtraReview();
}
async function refreshExtraContent(){
  if(!extraAllowed())return;
  const generation=++extraGeneration;extraPackage=null;$('#extraStart').disabled=true;clearExtraReview();
  $('#extraImport').disabled=!extraTrusted()||extraBusy;$('#extraContentFile').disabled=!extraTrusted()||extraBusy;
  $('#extraRefreshRemote').disabled=!extraTrusted()||extraBusy||navigator.onLine===false;$('#extraDownload').disabled=true;
  if(!extraTrusted()){$('#extraContentStatus').textContent='إضافة المناهج غير مفعّلة: لا توجد مفاتيح نشر موثوقة في هذا الإصدار.';return;}
  const result=await extraStore.list();
  if(generation!==extraGeneration||!extraAllowed())return;
  extraOptions($('#extraContentSelect'),(result.items||[]).map(x=>({id:x.draftId,title:x.title+' · v'+x.version})),'اختاري منهجًا مثبتًا');
  $('#extraContentStatus').textContent=result.valid?(result.items.length?'اختاري منهجًا للتدريب.':'لا توجد مناهج إضافية مثبتة.'):'تعذر قراءة المناهج المحفوظة.';
  extraOptions($('#extraUnit'),[],'اختاري الوحدة');renderExtraScope();
}
function updateRemoteButtons(){
  const enabled=extraAllowed()&&extraTrusted()&&!extraBusy&&navigator.onLine!==false;
  $('#extraRefreshRemote').disabled=!enabled;$('#extraDownload').disabled=!enabled||!extraRemoteItems.some(m=>m.draftId===$('#extraRemoteSelect').value);
  $('#extraImport').disabled=!extraAllowed()||!extraTrusted()||extraBusy;
}
$('#extraRemoteSelect').onchange=updateRemoteButtons;
window.addEventListener('online',updateRemoteButtons);
window.addEventListener('offline',()=>{extraRemoteController?.abort();updateRemoteButtons();});
$('#extraRefreshRemote').onclick=async()=>{
  if(!extraAllowed()||!extraTrusted()||extraBusy||navigator.onLine===false)return;
  const g=extraGeneration;extraBusy=true;updateRemoteButtons();renderExtraScope();
  const controller=new AbortController();extraRemoteController=controller;
  try{
    const result=await extraClient.list(controller.signal);
    if(g!==extraGeneration||!extraAllowed()||controller.signal.aborted)return;
    const local=await extraStore.list();
    if(g!==extraGeneration||!extraAllowed()||controller.signal.aborted)return;
    extraRemoteItems=result.valid?result.items:[];
    extraOptions($('#extraRemoteSelect'),extraRemoteItems.map(m=>{
      const current=local.items?.find(x=>x.draftId===m.draftId);
      return {id:m.draftId,title:m.title+' · v'+m.version+(current?(m.sequence>current.sequence?' · تحديث متاح':' · مثبت أو أحدث'):' · جديد')};
    }),'اختاري منهجًا');
    $('#extraRemoteStatus').textContent=result.valid?(extraRemoteItems.length?'القائمة متاحة؛ يتم التحقق من التوقيع قبل التثبيت.':'لا توجد مناهج متاحة بمفتاح موثوق.'):'خدمة التنزيل غير متاحة؛ المناهج المثبتة تعمل بدون إنترنت.';
  }finally{extraBusy=false;extraRemoteController=null;if(extraAllowed()){updateRemoteButtons();renderExtraScope();}}
};
$('#extraDownload').onclick=async()=>{
  if(!extraAllowed()||!extraTrusted()||extraBusy||navigator.onLine===false)return;
  const meta=extraRemoteItems.find(m=>m.draftId===$('#extraRemoteSelect').value);if(!meta)return;
  const g=extraGeneration;extraBusy=true;updateRemoteButtons();renderExtraScope();
  const controller=new AbortController();extraRemoteController=controller;
  try{
    const checked=await extraClient.download(meta,controller.signal);
    if(g!==extraGeneration||!extraAllowed()||controller.signal.aborted)return;
    if(!checked.valid){$('#extraRemoteStatus').textContent='تعذر التحقق من التنزيل: '+checked.code;return;}
    if(!confirm('تثبيت المنهج المعتمد: '+checked.package.content.title+' — إصدار '+checked.package.version+'؟'))return;
    if(g!==extraGeneration||!extraAllowed()||controller.signal.aborted)return;
    const result=await extraStore.install(checked.envelope,meta.draftId);
    if(g!==extraGeneration||!extraAllowed())return;
    $('#extraRemoteStatus').textContent=result.valid?'تم التثبيت على الجهاز.':'تعذر التثبيت: '+result.code;
    if(result.valid){extraBusy=false;await refreshExtraContent();}
  }finally{extraBusy=false;extraRemoteController=null;if(extraAllowed()){updateRemoteButtons();renderExtraScope();}}
};
$('#extraImport').onclick=async()=>{
  if(!extraAllowed()||!extraTrusted()||extraBusy)return;
  const file=$('#extraContentFile').files[0];if(!file||file.size>360000){$('#extraContentStatus').textContent='اختاري ملف JSON صالحًا بحجم مناسب.';return;}
  const generation=extraGeneration;extraBusy=true;$('#extraImport').disabled=true;$('#extraStart').disabled=true;
  try{
    const envelope=JSON.parse(await file.text());
    const checked=await window.LoloContentPackage.verify(envelope,window.LoloContentTrust);
    if(generation!==extraGeneration||!extraAllowed())return;
    if(!checked.valid){$('#extraContentStatus').textContent='الحزمة غير موثوقة أو غير متوافقة: '+checked.code;return;}
    const p=checked.package;
    if(!confirm('تثبيت المنهج: '+p.content.title+' — إصدار '+p.version+'؟'))return;
    if(generation!==extraGeneration||!extraAllowed())return;
    const result=await extraStore.install(envelope,p.draftId);
    if(generation!==extraGeneration||!extraAllowed())return;
    if(result.valid){extraBusy=false;await refreshExtraContent();}
    else $('#extraContentStatus').textContent='تعذر التثبيت: '+result.code;
  }catch{if(generation===extraGeneration&&extraAllowed())$('#extraContentStatus').textContent='تعذر قراءة الحزمة.';}
  finally{extraBusy=false;if(extraAllowed()){$('#extraImport').disabled=!extraTrusted();renderExtraScope();}}
};
$('#extraContentSelect').onchange=async()=>{
  if(!extraAllowed()||extraBusy)return;
  const generation=++extraGeneration,id=$('#extraContentSelect').value;extraPackage=null;$('#extraStart').disabled=true;
  extraOptions($('#extraUnit'),[],'اختاري الوحدة');renderExtraScope();if(!id)return;
  const result=await extraStore.read(id);
  if(generation!==extraGeneration||!extraAllowed())return;
  if(!result.valid){$('#extraContentStatus').textContent='تعذر التحقق من المنهج المثبت.';return;}
  extraPackage=result.package;extraOptions($('#extraUnit'),extraPackage.content.units,'اختاري الوحدة');renderExtraScope();
};
$('#extraUnit').onchange=()=>renderExtraScope();$('#extraScope').onchange=()=>renderExtraScope();$('#extraLesson').onchange=()=>renderExtraScope();
function renderExtraPractice(){
  const session=extraSession;if(!session)return;
  const state=session.state(),step=session.current(),body=$('#extraPracticeBody');
  body.replaceChildren();$('#extraPracticeNext').hidden=true;
  if(state.done){$('#extraPracticeProgress').textContent='انتهى التدريب';$('#extraPracticeGoal').textContent='أجبت بشكل صحيح على '+state.correct+' من '+(state.attempted-state.ungraded)+' نشاط قابل للتقييم.'+(state.ungraded?' وأنهيت '+state.ungraded+' نشاطًا دون درجة.':'')+' النتيجة تدريبية فقط وليست دليل إتقان.';const c=extraContext;if(c){const report=window.LoloContentRuntime.review(c.package,c.scope,c.unit,c.lesson,session.results());const message=extraReviewMessage(report);if(message)$('#extraPracticeGoal').textContent+=' '+message;}return;}
  if(!step)return;
  $('#extraPracticeTitle').textContent=step.lessonTitle;$('#extraPracticeGoal').textContent=step.goal;
  $('#extraPracticeProgress').textContent='النشاط '+(state.index+1)+' من '+state.total;
  window.LoloActivities.render(step.activity,body,result=>{
    if(extraSession!==session||!extraContext||!extraProgress.allowed()||!session.record(step.activity.id,result))return;
    const c=extraContext;extraSaved=extraProgress.save(c.package,c.scope,c.unit,c.lesson,session.results());
    $('#extraPracticeSaved').textContent=extraSaved?'تم حفظ التقدم على هذا الجهاز.':'تعذر حفظ التقدم؛ يمكنك إكمال التدريب لكن قد لا يُحفظ.';
    $('#extraPracticeNext').hidden=false;
  });
}
$('#extraStart').onclick=async()=>{
  if(!extraAllowed()||extraBusy||!extraPackage||$('#extraStart').disabled)return;
  const generation=extraGeneration,id=extraPackage.draftId,scope=$('#extraScope').value,unit=$('#extraUnit').value,lesson=$('#extraLesson').value;
  extraBusy=true;$('#extraStart').disabled=true;
  let latest;
  try{latest=await extraStore.read(id);}finally{extraBusy=false;if(extraAllowed())renderExtraScope();}
  if(generation!==extraGeneration||!extraAllowed()||!latest.valid||latest.package.sequence!==extraPackage?.sequence){if(extraAllowed())$('#extraContentStatus').textContent='المنهج تغيّر أو تعذر التحقق منه. اختاريه مرة أخرى.';return;}
  const saved=extraProgress.load(latest.package,scope,unit,lesson);
  if(!saved.valid){$('#extraContentStatus').textContent='تعذر قراءة سجل التقدم لهذا المنهج؛ لم يتم تغييره.';return;}
  let prior=[];
  if(saved.results.length&&!saved.completed&&confirm('استكمال التدريب من آخر نشاط محفوظ؟ اختر إلغاء للبدء من جديد.'))prior=saved.results;
  else if(saved.results.length&&!confirm('بدء محاولة جديدة واستبدال سجل هذا النطاق؟'))return;
  if(generation!==extraGeneration||!extraAllowed())return;
  const session=window.LoloContentRuntime.create(latest.package,scope,unit,lesson,prior);
  if(!session)return;
  extraContext={package:latest.package,scope,unit,lesson};extraSaved=extraProgress.save(latest.package,scope,unit,lesson,prior);
  $('#extraPracticeSaved').textContent=extraSaved?'التقدم محفوظ محليًا.':'تعذر حفظ التقدم على الجهاز.';
  if(isActive||isStarting)stopSession();
  closeParentSettings();extraSession=session;renderExtraPractice();$('#extraPractice').showModal();
};
$('#extraPracticeNext').onclick=()=>{if(!extraProgress.allowed()){$('#extraPractice').close();return;}if(extraSession?.advance())renderExtraPractice();};
$('#extraPracticeClose').onclick=$('#extraPracticeBack').onclick=()=>$('#extraPractice').close();
$('#extraPractice').addEventListener('close',()=>{extraSession?.stop();extraSession=null;extraContext=null;$('#extraPracticeBody').replaceChildren();});
window.addEventListener('pagehide',()=>{extraSession?.stop();extraSession=null;extraContext=null;});
function renderActivityPreview(){
  if(!parentGate.isUnlocked())return;
  const engine=window.LoloActivities,pilot=window.LoloActivityPilot;
  const select=$('#activityPreviewSelect'),container=$('#activityPreviewContent');
  const compatibility=engine.checkLessons(pilot.lessons);
  $('#activityPreviewStatus').textContent=compatibility.compatible?'الأنشطة التجريبية متوافقة مع المحرك الحالي. لم تُنشر.':'توجد أنشطة غير متوافقة.';
  const activities=pilot.lessons.flatMap(l=>l.activities);
  const prior=select.value;select.replaceChildren();
  for(const a of activities){const option=document.createElement('option');option.value=a.id;option.textContent=engine.types[a.type]?.label||a.type;select.append(option);}
  if(activities.some(a=>a.id===prior))select.value=prior;
  const render=()=>{container.replaceChildren();if(parentGate.isUnlocked()&&compatibility.compatible)engine.render(activities.find(a=>a.id===select.value),container);};
  select.onchange=render;render();
}
function showParentSettingsUnlocked(tab = 'settings') {
  if (!parentGate.isUnlocked()) return openParentSettings(tab);
  $('#parentSheet').classList.add('open');
  $('#parentSheet').setAttribute('aria-hidden', 'false');
  showParentTab(tab);
  $('#parentClose').focus();
  syncParentSettingsUI();
  refreshNativeReminder();
  renderLocalProfiles();
  renderActivityPreview();
  refreshExtraContent();
  renderParentReport();
  $('#parentProgress').textContent = `${parentProgressSummary()} تقدري تختاري درسًا أو وحدة أو منهجًا بالكامل.`;
  $('#pathScope').value = activePath?.scope || 'lesson';
  renderPathChoice();
  scheduleParentAutoLock();
  cloudUiEnabled=false;cloudSyncEnabled=false;resetCloudFamily();
  if(navigator.onLine===false){$('#apiState').textContent='وضع بدون إنترنت: المناهج والتدريبات المحلية متاحة.';return;}
  apiFetch('/api/status').then(response => response.json()).then(status => {
    if(parentGate.isUnlocked()&&$('#parentSheet').classList.contains('open')){cloudUiEnabled=status.familyUiEnabled===true;cloudSyncEnabled=status.progressSyncEnabled===true;renderCloudFamily();}
    const labels = {gemini: 'Gemini الأساسي', openai: 'OpenAI', 'gemini-backup': 'Gemini الاحتياطي'};
    const enabled = (status.providers || []).map(provider => labels[provider]);
    $('#apiState').textContent = enabled.length
      ? `المزوّدات الجاهزة بالترتيب: ${enabled.join(' ← ')}. عند تعذّر الاتصال ينتقل التطبيق تلقائياً للتالي.`
      : 'لا توجد مفاتيح API. أضيفيها إلى .env ثم أعيدي تشغيل الخادم.';
  }).catch(() => $('#apiState').textContent = 'خدمة الصوت غير متاحة الآن. التدريب المحلي متاح.');
}

function openParentSettings(tab = 'settings') {
  parentGatePurpose = {type: 'open', tab};
  if (parentGate.isUnlocked()) return showParentSettingsUnlocked(tab);
  if (parentGate.isConfigured()) showParentGate('verify', 'لوحة وليّ الأمر', 'أدخلي الرقم السري عشان تفتحي الإعدادات أو تختاري درسًا.');
  else showParentGate('setup', 'إعداد حماية وليّ الأمر', 'اختاري رقمًا سريًا واحفظي رمز الاستعادة في مكان آمن.');
}

$('#parentGateSetup').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const result = await parentGate.setup($('#parentGateSetupPin').value, $('#parentGateSetupConfirm').value);
    if (!result.ok) return parentGateError(result);
    displayRecoveryCode(result.recoveryCode, 'open');
  } catch (error) {
    parentGateError({reason: error.message});
  }
});
$('#parentGateVerify').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const result = await parentGate.verifyPin($('#parentGatePin').value);
    if (!result.ok) return parentGateError(result);
    closeParentGateModal(false);
    if (parentGatePurpose.type === 'open') showParentSettingsUnlocked(parentGatePurpose.tab);
    else if (parentGatePurpose.type === 'action') {
      scheduleParentAutoLock();
      runParentSensitiveAction(parentGatePurpose.action);
    }
  } catch (error) {
    parentGateError({reason: error.message});
  }
});
$('#parentGateRecover').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const result = await parentGate.recover($('#parentGateRecoveryCode').value, $('#parentGateRecoveryPin').value, $('#parentGateRecoveryConfirm').value);
    if (!result.ok) return parentGateError(result);
    displayRecoveryCode(result.recoveryCode, 'open');
  } catch (error) {
    parentGateError({reason: error.message});
  }
});
$('#parentGateChange').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const result = await parentGate.changePin($('#parentGateCurrentPin').value, $('#parentGateNewPin').value, $('#parentGateNewConfirm').value);
    if (!result.ok) return parentGateError(result);
    displayRecoveryCode(result.recoveryCode, 'return');
  } catch (error) {
    parentGateError({reason: error.message});
  }
});
$('#parentGateForgot').onclick = () => {
  parentGatePurpose = {type: 'open', tab: 'settings'};
  setParentGateView('recover', 'استعادة الرقم السري', 'أدخلي رمز الاستعادة واختاري رقمًا سريًا جديدًا.');
};
document.querySelectorAll('[data-gate-back]').forEach(button => { button.onclick = () => setParentGateView('verify', 'لوحة وليّ الأمر', 'أدخلي الرقم السري عشان تفتحي الإعدادات أو تختاري درسًا.'); });
document.querySelectorAll('[data-gate-cancel]').forEach(button => { button.onclick = closeParentGateModal; });
$('#parentGateRecoveryDone').onclick = () => {
  const purpose = parentGateRecoveryPurpose;
  closeParentGateModal(false);
  if (purpose === 'open') showParentSettingsUnlocked(parentGatePurpose.tab);
  else { $('#parentClose').focus(); scheduleParentAutoLock(); }
};

function requestParentSensitiveAction(action) {
  if (!parentGate.isConfigured()) return openParentSettings('settings');
  parentGatePurpose = {type: 'action', action};
  showParentGate('verify', 'تأكيد وليّ الأمر', 'أدخلي الرقم السري لتأكيد العملية.');
}

function runParentSensitiveAction(action) {
  if (action === 'clear-answer-history') return clearAnswerHistory();
  if (action === 'reset-course') return resetCourseProgress();
}
$('#parentOpen').onclick = () => openParentSettings('settings');
$('#parentOpenWelcome').onclick = () => openParentSettings('settings');
$('#changeParentPin').onclick = () => {
  if (!parentGate.isUnlocked()) return openParentSettings('settings');
  parentGatePurpose = {type: 'change'};
  showParentGate('change', 'تغيير الرقم السري', 'أدخلي الرقم الحالي ثم اختاري رقمًا جديدًا.');
};
$('#lockParentGate').onclick = () => { closeParentSettings(); closeParentGateModal(); };
$('#parentSheet').addEventListener('click', () => { parentGate.touch(); if (parentGate.isUnlocked()) scheduleParentAutoLock(); });
$('#parentSheet').addEventListener('keydown', () => { parentGate.touch(); if (parentGate.isUnlocked()) scheduleParentAutoLock(); });
$('#parentLessonsTab').onclick = () => showParentTab('lessons');
$('#parentSettingsTab').onclick = () => showParentTab('settings');
for (const id of ['learningPath', 'sessionMinutes', 'speechPace', 'hintLevel', 'rewardSeconds', 'reminderHour']) $(`#${id}`).onchange = saveParentSettings;
for (const id of ['repeatWords', 'rewardEnabled','remindersEnabled','dailyReminder']) $(`#${id}`).onchange = saveParentSettings;
$('#lessonTab').onclick = () => showPickerTab('lessons');
$('#testsTab').onclick = () => showPickerTab('tests');
$('#gradeSelect').onchange = () => {
  refreshLessonPicker(null, null, $('#gradeSelect').value);
  renderParentReport();
};
$('#trackSelect').onchange = () => { refreshLessonPicker($('#trackSelect').value, null, $('#gradeSelect').value); renderParentReport(); };
$('#pathScope').onchange = renderPathChoice;
$('#pathSkipCompleted').onchange = renderPathChoice;
$('#pathApply').onclick = applyPathChoice;
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
  closeParentSettings();
};
$('#parentSheet').onclick = event => {
  if (event.target === $('#parentSheet')) $('#parentClose').click();
};
function resetCourseProgress() {
  if (!confirm('نرجع تقدم الدروس للبداية؟')) return;
  visualHistory={};storage.remove(VISUAL_HISTORY_KEY);
  stopSession();
  mastered.clear();
  lessonExcellence = {};
  testResults = {};
  traceResults = {};
  writingPathResults = {};
  writingPathOverrides = {};
  skillProgress = learningEngine.createStore({});
  lessonStats = {};
  activeAnswerEvents = [];
  sessionMode = 'lesson';
  storage.remove('lolo-mastered');
  storage.remove('lolo-lesson-excellence');
  storage.remove('lolo-test-results');
  storage.remove('lolo-trace-results');
  storage.remove('lolo-writing-path-results');
  storage.remove('lolo-writing-path-overrides');
  storage.remove('lolo-lesson-stats');
  storage.set('lolo-skill-progress-v1', JSON.stringify(skillProgress));
  storage.remove('lolo-explicit-lesson-choice');
  storage.remove(PATH_KEY); activePath=null; invalidPath=false;
  currentLesson = nextLesson() || allLessons()[0] || null;
  if (currentLesson) storage.set('lolo-current-lesson', currentLesson.id);
  updateProgress();
  cardsFor(currentLesson);
  updateLessonBadge(currentLesson);
  updateDashboardLesson();
  refreshLessonPicker(currentLesson?.programId, currentLesson?.unitId);
  renderParentReport();
}
function clearAnswerHistory() {
  if (!confirm('نمسح سجل الإجابات وتفاصيل الاختبارات؟ تقدم الدروس والشارات هيفضلوا محفوظين.')) return;
  visualHistory={};storage.remove(VISUAL_HISTORY_KEY);
  lessonStats = {};
  testResults = {};
  traceResults = {};
  writingPathResults = {};
  storage.remove('lolo-lesson-stats');
  storage.remove('lolo-test-results');
  storage.remove('lolo-trace-results');
  storage.remove('lolo-writing-path-results');
  updateProgress();
  refreshLessonPicker(currentLesson?.programId, currentLesson?.unitId);
  renderParentReport();
}
$('#resetCourse').onclick = () => requestParentSensitiveAction('reset-course');
$('#clearAnswerHistory').onclick = () => requestParentSensitiveAction('clear-answer-history');
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    clearLocalBackup();
    resetCloudFamily();
    parentGate.lock();
    clearTimeout(parentGateAutoLockTimer);
    parentGateAutoLockTimer = null;
    $('#parentSheet').classList.remove('open');
    $('#parentSheet').setAttribute('aria-hidden', 'true');
    closeParentGateModal();
  }
});
document.addEventListener('keydown', event => {
  if ($('#parentGate').hidden) return;
  if (event.key === 'Escape') { event.preventDefault(); closeParentGateModal(); return; }
  if (event.key !== 'Tab') return;
  const focusable = [...$('#parentGate').querySelectorAll('input:not(:disabled),button:not(:disabled)')].filter(element => !element.closest('[hidden]'));
  if (!focusable.length) return;
  const first = focusable[0]; const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
window.addEventListener('storage', event => {
  if(!event.key||event.key===storage.profiles.key){
    if(storage.profiles.selectedId()!==storage.profiles.activeId){
      if(isActive||isStarting)stopSession();
      closeParentSettings();location.reload();return;
    }
    renderActiveLocalProfile();if(parentGate.isUnlocked())renderLocalProfiles();
  }
  if (event.key && event.key !== window.LoloParentGate.PIN_KEY) return;
  parentGate.lock();
  closeParentSettings();
  closeParentGateModal(false);
});

if (location.protocol === 'file:') {
  location.replace('http://localhost:4173/');
} else {
  window.LoloBoot?.stage(20,'بنحمّل المنهج المحفوظ…');
  const bootRequest=new AbortController();
  const bootTimeout=setTimeout(()=>bootRequest.abort(),15000);
  fetch('/curriculum.json',{signal:bootRequest.signal}).then(response => {
    if (!response.ok) throw new Error();
    return response.json();
  }).then(data => {
    window.LoloBoot?.stage(45,'بنتأكد من المنهج…');
    const validation = curriculumEngine.validateCurriculum(data);
    if (!validation.valid) {
      console.error('Curriculum validation failed:', validation.errors);
      throw new Error('Invalid curriculum data.');
    }
    course = data;
    window.LoloBoot?.stage(70,'بنجهز دروسك وتقدمك…');
    visualBankReady=visualAssessment.validateBank(visualBank.bank,new Set(allLessons().map(l=>l.id))).valid;
    const needsCurriculumSetup = !storage.get('lolo-selected-program');
    const savedLessonId = storage.get('lolo-current-lesson');
    const selectedProgram = storage.get('lolo-selected-program');
    currentLesson = allLessons().find(lesson => lesson.id === savedLessonId && (!selectedProgram || lesson.programId === selectedProgram))
      || (selectedProgram ? allLessons().find(lesson => lesson.programId === selectedProgram && !mastered.has(lesson.id)) : null)
      || nextLesson();
    const savedPath = storage.get(PATH_KEY);
    if (savedPath !== null) {
      const restored = storage.getJSON(PATH_KEY,{});
      if (pathEngine.validate(restored,allLessons(),course.curriculumVersion)) {
        activePath=restored;
        const planned=allLessons().find(l=>l.id===pathEngine.current(restored));
        if (planned) currentLesson=planned;
      } else invalidPath=true;
    } else if (selectedProgram && currentLesson) {
      activePath=pathEngine.build(allLessons(),{scope:'lesson',programId:currentLesson.programId,unitId:currentLesson.unitId,lessonId:currentLesson.id},mastered,course.curriculumVersion);
      if(activePath) storage.set(PATH_KEY,JSON.stringify(activePath));
    }
    if (currentLesson) storage.set('lolo-current-lesson', currentLesson.id);
    updateLessonBadge(currentLesson);
    updateDashboardLesson();
    refreshLessonPicker(currentLesson?.programId, currentLesson?.unitId);
    if (needsCurriculumSetup) {
      storage.remove('lolo-selected-program');
      storage.remove('lolo-grade-id');
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
    if (storage.get('lolo-welcome-tour-v1-complete') === 'true' && !needsCurriculumSetup) $('#app').classList.add('ready');
    window.LoloBoot?.finish();
  }).catch(() => {
    window.LoloBoot?.fail();
    showError(navigator.onLine===false?'المناهج لم تُحفظ على الجهاز بعد. اتصلي بالإنترنت مرة واحدة أو ثبتي نسخة لولو الجديدة.':'المنهج مش ظاهر. راجعي ملفات التطبيق.');
    $('#mic').disabled = false;
  }).finally(()=>clearTimeout(bootTimeout));
}
