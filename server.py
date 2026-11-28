"""Local web server and voice-provider credential issuer."""
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from collections import deque
from hashlib import sha256
from hmac import new as hmac_new
from threading import Lock
from time import monotonic
import json
import os
import secrets
import math
from request_budget import admit as admit_shared_budget, BudgetUnavailable
from family_accounts import FamilyStore, FamilyError

ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get("PORT", "4173"))
HOST = os.environ.get("HOST", "127.0.0.1")
_RATE_LIMIT_SECRET = secrets.token_bytes(32)


def bounded_env_int(name, default, minimum=1, maximum=1000):
    try:
        return max(minimum, min(maximum, int(os.environ.get(name, default))))
    except (TypeError, ValueError):
        return default


class SlidingWindowRateLimiter:
    """Small process-local safety limit; production needs a shared edge limiter."""

    def __init__(self, max_keys=4096):
        self.max_keys = max_keys
        self._events = {}
        self._lock = Lock()

    def check(self, key, limit, window_seconds=60):
        now = monotonic()
        with self._lock:
            if len(self._events) >= self.max_keys and key not in self._events:
                oldest_key = min(self._events, key=lambda item: self._events[item][-1])
                self._events.pop(oldest_key, None)
            events = self._events.setdefault(key, deque())
            cutoff = now - window_seconds
            while events and events[0] <= cutoff:
                events.popleft()
            if len(events) >= limit:
                return False, max(1, int(window_seconds - (now - events[0]) + 0.999))
            events.append(now)
            return True, 0


API_RATE_LIMITER = SlidingWindowRateLimiter()
# Separate buckets prevent client-key eviction from evicting the aggregate limit.
GLOBAL_RATE_LIMITER = SlidingWindowRateLimiter(max_keys=8)


def load_local_env():
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        os.environ.setdefault(name.strip(), value.strip().strip('"').strip("'"))


load_local_env()
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
GEMINI_BACKUP_API_KEY = os.environ.get("GEMINI_BACKUP_API_KEY")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
def service_enabled(name):
    return os.environ.get(name, "true").strip().lower() in {"1", "true", "yes", "on"}


OPENAI_ENABLED = service_enabled("OPENAI_ENABLED")
VOICE_ENABLED = service_enabled("LOLO_VOICE_ENABLED")
FAMILY_ENABLED = os.environ.get('LOLO_FAMILY_ENABLED', 'false').strip().lower() in {'1','true','yes','on'}
PROGRESS_SYNC_ENABLED = os.environ.get('LOLO_PROGRESS_SYNC_ENABLED','false').strip().lower() in {'1','true','yes','on'}
PARENT_CLOUD_UI_ENABLED = os.environ.get('LOLO_PARENT_CLOUD_UI_ENABLED','false').strip().lower() in {'1','true','yes','on'}
CONTENT_DELIVERY_ENABLED = os.environ.get('LOLO_CONTENT_DELIVERY_ENABLED','false').strip().lower() in {'1','true','yes','on'}
CONTENT_DELIVERY_LIMITER = SlidingWindowRateLimiter()
CONTENT_DELIVERY_GLOBAL = SlidingWindowRateLimiter(max_keys=8)
FAMILY_RATE_LIMITER = SlidingWindowRateLimiter()
FAMILY_GLOBAL_LIMITER = SlidingWindowRateLimiter(max_keys=8)
TTS_ENABLED = service_enabled("LOLO_TTS_ENABLED")
GEMINI_ENABLED = service_enabled("GEMINI_ENABLED")
GEMINI_BACKUP_ENABLED = service_enabled("GEMINI_BACKUP_ENABLED")
GLOBAL_PAID_LIMIT = bounded_env_int("LOLO_GLOBAL_PAID_REQUESTS_PER_MINUTE", 120)
CLIENT_TTS_LIMIT = bounded_env_int("LOLO_CLIENT_TTS_REQUESTS_PER_MINUTE", 12)
MODEL = "models/gemini-3.8-live"
BACKUP_MODEL = os.environ.get("GEMINI_BACKUP_MODEL", MODEL)
OPENAI_MODEL = os.environ.get("OPENAI_REALTIME_MODEL", "gpt-realtime-2.1")
ONBOARDING_TTS_MODEL = "gemini-3.8-flash-tts"
ONBOARDING_TTS_CACHE = {}
CHALLENGE_TTS_CACHE = {}
CURRICULUM = json.loads((ROOT / "curriculum.json").read_text(encoding="utf-8"))
PROGRAMS = [{"id": "foundation", "title": "تأسيس من الصفر", "units": CURRICULUM["units"]}
            ] + CURRICULUM.get("programs", [])
LESSONS = {lesson["id"]: (program, unit, lesson)
           for program in PROGRAMS for unit in program["units"] for lesson in unit["lessons"]}
TOOL_DECLARATIONS = [{
    "name": "show_math_scene",
    "description": "اعرضي نشاط الماث على الشاشة. بعد استدعاء الأداة، التزمي حرفياً بحقل visualState في النتيجة: لا تذكري أي جسم أو لون أو عدد غير وارد فيه. في الطرح انتظري التفاعل قبل ذكر المتبقي، وفي الجمع انتظري ضغط الإضافة.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "lesson_id": {"type": "STRING"},
            "scene": {"type": "STRING", "enum": ["objects", "addition", "subtraction", "comparison", "place_value", "shapes", "pattern", "measurement", "daily_time", "number_line"]},
            "object": {"type": "STRING", "enum": ["cookie", "apple", "block", "ball", "flower", "fish", "car", "star"]},
            "second_object": {"type": "STRING", "enum": ["cookie", "apple", "block", "ball", "flower", "fish", "car", "star"]},
            "count": {"type": "INTEGER"},
            "amount": {"type": "INTEGER"},
            "second_count": {"type": "INTEGER"},
            "numbers": {"type": "ARRAY", "items": {"type": "INTEGER"}},
            "target_number": {"type": "INTEGER"},
            "shape": {"type": "STRING", "enum": ["circle", "square", "triangle", "rectangle", "sphere", "cube", "cylinder"]},
            "shapes": {"type": "ARRAY", "items": {"type": "STRING", "enum": ["circle", "square", "triangle", "rectangle", "sphere", "cube", "cylinder"]}},
            "sequence": {"type": "ARRAY", "items": {"type": "STRING", "enum": ["red", "blue", "yellow", "green", "circle", "square", "triangle", "star"]}},
            "equation": {"type": "STRING"},
        },
        "required": ["lesson_id", "scene"],
    },
}, {
    "name": "record_lesson_mastery",
    "description": "سجلي الإتقان فقط بعد التحقق من إجابتين مستقلتين صحيحتين. أرسلي نص الإجابتين كما قالت الطفلة في evidence وعدد الإجابات الصحيحة في correct_responses. لا تستدعيها للتشجيع أو التخمين.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "lesson_id": {"type": "STRING"},
            "correct_responses": {"type": "INTEGER"},
            "evidence": {"type": "ARRAY", "items": {"type": "STRING"}},
        },
        "required": ["lesson_id", "correct_responses", "evidence"],
    },
}, {
    "name": "record_lesson_answer",
    "description": "للدرس العادي فقط: حدّثي الشريط بعد إجابة واضحة. لا تستخدميها في الاختبار الشفهي؛ استخدمي submit_spoken_assessment_answer وأرسلي assessment_id وquestion_id فقط، فالتطبيق يقرأ الإجابة المسموعة ويصححها بنفسه.",
    "parameters": {"type": "OBJECT", "properties": {
        "lesson_id": {"type": "STRING"}, "answer": {"type": "STRING"}, "is_correct": {"type": "BOOLEAN"}, "question_number": {"type": "INTEGER"},
    }, "required": ["lesson_id", "answer", "is_correct"]},
}, {
    "name": "submit_spoken_assessment_answer",
    "description": "أرسلي assessment_id وquestion_id للسؤال الجاري فقط بعد سماع إجابة الطفلة. لا ترسلي is_correct أو الإجابة؛ التطبيق يقرأ التعرّف الصوتي ويحسب النتيجة مستقلًا.",
    "parameters": {"type": "OBJECT", "properties": {
        "assessment_id": {"type": "STRING"}, "question_id": {"type": "STRING"},
    }, "required": ["assessment_id", "question_id"]},
}, {
    "name": "start_next_lesson",
    "description": "الانتقال يديره التطبيق فقط. لا تستدعي هذه الأداة لبدء درس آخر.",
    "parameters": {"type": "OBJECT", "properties": {"lesson_id": {"type": "STRING"}}, "required": ["lesson_id"]},
}, {
    "name": "request_learning_break",
    "description": "أوقفي الجلسة واحفظي موضع الخطة عند طلب الطفلة التوقف أو الراحة.",
    "parameters": {"type": "OBJECT", "properties": {}},
}, {
    "name": "open_parent_picker",
    "description": "أوقفي المحادثة وافتحي إعدادات ولي الأمر لاختيار درس أو اختبار باللمس عندما تقول الطفلة إنها تريد من ماما الاختيار أو عندما يطلب المتحدث صراحةً تغيير الدرس كولي أمر. لا تحاولي التحقق من هوية الصوت.",
    "parameters": {"type": "OBJECT", "properties": {}},
}]


def openai_audio_input(mode):
    """Keep VAD enabled and expose a transcript for app-graded oral tests."""
    audio_input = {"turn_detection": {"type": "server_vad", "silence_duration_ms": 400}}
    if mode == "test":
        audio_input["turn_detection"]["create_response"] = False
        audio_input["transcription"] = {"model": "gpt-transcribe"}
    return audio_input


def teacher_instructions(lesson_id, mode="lesson", already_mastered=False, excellence_count=0, teacher_settings=None):
    teacher_settings = teacher_settings or {}
    pace = teacher_settings.get("speechPace", "slow")
    hint_level = teacher_settings.get("hintLevel", "gentle")
    repeat_words = teacher_settings.get("repeatWords", True)
    learning_scope = teacher_settings.get("learningScope", "lesson")
    found = LESSONS.get(lesson_id)
    is_math = bool(found and found[0].get("subject") == "math")
    if found:
        program, unit, lesson = found
        lesson_context = (f"المسار الحالي: {program['title']}. الوحدة: {unit['title']}. "
                          f"اسم الدرس: {lesson.get('title', lesson['focus'])}. "
                          f"نوع النشاط: {lesson.get('strand', 'تأسيس')}. "
                          f"التركيز: {lesson['focus']}. "
                          f"الهدف: {lesson['goal']}.")
        if not is_math:
            lesson_context += f" الصور المتاحة: {', '.join(card[1] for card in lesson['cards'])}."
        board_words = [token["text"] for token in lesson.get("board", {}).get("tokens", [])]
        if board_words and not is_math:
            lesson_context += f" الكلمات والجمل المعروضة على اللوحة الملونة: {'، '.join(board_words)}."
    else:
        lesson_context = "ابدئي مراجعة مرنة للطفلة، واسألي ولي الأمر عن الدرس الذي يريده."
    if mode == "test":
        flow_instructions = (
            "هذه جلسة اختبار سماع وترديد، وليست اختبار محادثة مفتوح أو شرحاً. التطبيق سيرسل assessment_id والسؤال الحالي ونص السؤال وإجابته المرجعية من كلمات المنهج. اقرئي السؤال المحدد كما وصلك، ثم انتظري إجابة الطفلة. "
            "لا تحكمي على الإجابة ولا تقولي صح أو غلط ولا تطرحي السؤال التالي قبل استدعاء submit_spoken_assessment_answer مع assessment_id وquestion_id الحاليين فقط. لا ترسلي الإجابة أو is_correct؛ التطبيق يطابق تسجيل الطفلة مع مفتاح المنهج ويحرك التقدم ويحفظ النتيجة. "
            "بعد نتيجة الأداة اتبعي حرفياً coachPrompt الذي أعاده التطبيق: تشجيع قصير إن كانت صحيحة، تصحيح لطيف إن كانت خاطئة، وطلب التكرار دون احتساب إذا كانت غير واضحة. اقرئي nextQuestion.prompt فقط كما أعاده التطبيق. لا تخترعي سؤالاً أو هدفاً ولا تستدعي record_lesson_answer أو record_lesson_mastery أو أي أداة لحفظ نتيجة الاختبار. التطبيق يحفظ النتيجة فور اكتمال الأسئلة المحددة. "
            "إذا تكلمت الطفلة خارج السؤال، ردي باهتمام قصير ثم عودي للسؤال الجاري دون تسجيل كلامها كإجابة. إذا بدت متضايقة أوقفي الاختبار وطمّنيها. هذا الاختبار يقيس سماع الكلمة أو الرقم وترديده فقط، ولا تدّعي تقييم دقة النطق. "
        )
    else:
        flow_instructions = (
            "تحققي من كل إجابة بمقارنتها بهدف الدرس والإجابة المطلوبة قبل الرد. لا تقولي برافو أو صح أو ممتاز على إجابة خاطئة أو غير واضحة؛ افصلي تشجيع المحاولة عن صحة الإجابة: عند الخطأ قولي مثلاً «حلو إنك حاولتي، بس الإجابة مش كده»، ثم قدمي التصحيح بلطف وامنحيها فرصة تجريب ثانية. إذا لم تفهميها اطلبي إعادة الإجابة ولا تفترضي أنها صحيحة. "
            "لا تعتبري ضغط الصورة أو لمس أي شيء على الشاشة إجابة، ولا تحركي شريط التقدم بسببه. عند لمس صورة، ردي فوراً بصوت لولو بجملة لطيفة تشجع المحاولة ولا تحكم على صحتها، مثل «برافو على اختيارك، حاولي تقوليها معايا». انطقي الكلمة الإنجليزية المرتبطة بالصورة من سياق الدرس، ثم انتظري إجابة الطفلة بصوتها. في الماث، اللمس وسيلة للعد أو التحريك فقط؛ بعده اطلبي منها أن تقول العدد أو الحل بصوتها. بعد كل إجابة منطوقة وواضحة، قولي الحكم بوضوح في صوتك: «إجابتك صح» إذا كانت صحيحة، أو «الإجابة مش كده» إذا كانت خاطئة، ثم استدعي record_lesson_answer مرة واحدة مستخدمة كلام الطفلة المسموع ونتيجة التحقق ورقم السؤال المتتابع، وانتظري تحديث الشريط قبل المتابعة. لا تسجلي اللمسات أو الكلام الجانبي أو الإجابة غير الواضحة كإجابة. "
            "اجعلي الدرس قصيراً: فكرة واحدة وشرح بسيط، ثم سؤال واحد في كل مرة. أعيدي الشرح مرة واحدة فقط إذا لم تفهم. أداة record_lesson_answer تعيد في mastery.saved نتيجة الإتقان تلقائياً بعد إجابتين مستقلتين صحيحتين؛ إذا كان mastery.saved=true فلا تستدعي أداة إتقان أخرى. إذا أعادت mastery.rewardGame، قولي للطفلة جملة التوجيه الموجودة حرفياً في rewardGame.voicePrompt عن اللعبة الظاهرة، واستني لحد ما التطبيق يقول إن اللعبة انتهت. لا تعيدي الدرس أثناء اللعبة. إذا أعادت mastery.excellenceAwarded رقماً، افرحي بها وقولي بوضوح إنها كسبت شارة تفوق جديدة، ثم انتظري خطوة التطبيق من غير إعادة الدرس. استدعي record_lesson_mastery فقط إذا احتجتِ تسجيل الإتقان ولم تُعد أداة الإجابة نتيجة mastery.saved. لا تكرري الشرح أو التدريب بعد تحقق الهدف. "
            "لا تعلني اكتمال الدرس إلا إذا أعادت الأداة saved=true. احتفلي بجملة قصيرة فقط، أو اتبعي تعليمات لعبة المكافأة. لا تطرحي سؤالاً جديداً ولا تطلبي اختيار درس آخر بعد كل درس؛ التطبيق وحده يدير الانتقال داخل خطة ولي الأمر. إذا كانت pathComplete=true قولي إن الخطة خلصت. لا تستدعي start_next_lesson. إذا طلبت الطفلة الراحة أو التوقف، استدعي request_learning_break فوراً. لا تحاولي إقناعها بالاستمرار. عند طلب تغيير خطة التعلم استدعي open_parent_picker، ولا تدّعي أنك تعرفين هوية المتحدث. "
        )
    board_instructions = (
        ("في الاختبار الشفهي استخدمي فقط السؤال الحالي الذي يرسله التطبيق. لا تعرضي مشهداً أو أرقاماً أخرى ولا تحسبي أو تقيّمي الإجابة من نفسك. " if is_math else
         "في الاختبار الشفهي استخدمي فقط السؤال الحالي الذي يرسله التطبيق؛ لا تخترعي سؤالاً ولا تقيّمي الإجابة بنفسك. ")
        if mode == "test" else
        ("استخدمي مساحة اللعب الظاهرة فقط؛ اللوحة الملونة وبطاقات الصور مخفية في درس الماث. اشرحي ما تراه الطفلة حرفياً، ولا تطلبي قراءة رقم أو كتابة. استجيبي للمس العنصر الظاهر نفسه. " if is_math else
         "استخدمي لوحة الكلمات الملونة على الشاشة كوسيلة شرح: انطقي الكلمات المعروضة واحدة واحدة، واربطي لون كل جزء بدوره في الجملة بكلام بسيط، من غير أن تطلبي من الطفلة القراءة. استجيبي للنقر على كلمة بإعادة نطقها وشرحها. ")
    )
    subject_instruction = (
        "أنتِ لولو، معلمة ماث للصف الأول لغات وطفلة مصرية عمرها 6 سنوات تبدأ من الصفر. اشرحي بالمصري البسيط، وقدمي المصطلح الرياضي بالإنجليزية ثم معناه بالمصري مثل more/less/add/take away. "
        "المسار يبدأ بوحدات تأسيس العدّ والكمية والأشكال، وبعدها ينتقل تدريجياً لموضوعات الصف الأول؛ لا تقفزي إلى الجمع أو الطرح قبل تثبيت الفهم المحسوس. "
        "استخدمي فقط العناصر التي يعرضها التطبيق فعلياً في الحالة المرئية؛ لا تخترعي مكعبات أو أشياء أو رسومات غير معروضة. سؤال واحد في كل مرة، وانتظري إجابة الطفلة. لا تعتمدي على القراءة أو الكتابة أو حفظ الرموز؛ خلي الإجابة بالعد بصوتها أو لمس عنصر ظاهر. "
        if is_math else
        "أنتِ لولو، معلمة إنجليزي صوتية لطفلة مصرية عمرها 6 سنوات تبدأ من الصفر. "
    )
    teaching_style = (
        "في الرياضيات ابدئي بموقف محسوس قبل الرمز، واطلبي منها أن تعدّ أو تختار صورة؛ لا تحولي الدرس لمحاضرة ولا تعطي أكثر من خطوة في السؤال. ابدئي بالتفاعل مع المشهد الموجود بالفعل على الشاشة؛ لا تستدعي show_math_scene إلا إذا انتقل الدرس لنشاط بصري مختلف أو لم يوجد مشهد. اجعلي الشيء والعدد اللذين تقولينهما مطابقين تماماً لما يظهر، ولا تبدلي البسكويت بمكعبات. علقي باختصار على كل لمسة أو حركة تصل إليك، لكن لا تعتبريها إجابة أو تقدماً؛ اطلبي من الطفلة أن تقول بصوتها اسم الشكل أو العدد أو الناتج بعد أن تلمس أو تعد. في الطرح اطلبي منها لمس الأشياء التي تريد أخذها ولا تقولي كم بقي إلا بعد التفاعل، ثم اطلبي منها قول الباقي. في الجمع لا تحدثي العدد المنطوق إلا بعد ضغطها الإضافة، ثم اسأليها كم صار المجموع. إذا لم يظهر المشهد فلا تصفي أشياء غير موجودة على الشاشة. "
        if is_math else
        "في الجرامر، لا تشرحي قواعد مجردة؛ استخدمي أمثلة قصيرة وصوراً ومواقف. في الفونكس، انطقي الصوت الإنجليزي بوضوح واربطِيه بكلمات مألوفة؛ لا تطلبي اسم الحرف أو قراءته أو كتابته. إذا وجدتِ صعوبة، ارجعي لشرح أبسط بالعربي المصري ثم جربي مرة أخرى. "
    )
    replay_instructions = (
        f"هذا الدرس مسجل كمكتمل سابقاً، ولديها {excellence_count} شارات تفوق. اختاره ولي الأمر للمراجعة؛ ابدئي مراجعة قصيرة ثم سؤالاً واحداً في كل مرة. لا تحسبي جواب نعم أو لا كتقييم. إذا طلبت الطفلة التوقف أو الراحة استدعي request_learning_break فوراً. لا تعلني إتقاناً جديداً قبل إجابتين مستقلتين صحيحتين. "
        if already_mastered and mode == "lesson" else ""
    )
    return (
        subject_instruction
        + "اسمك لولو. "
        "صوت لولو ثابت طول الجلسة: بنت صغيرة بصوت أنثوي شاب، دافئ ومرح وواضح، بسرعة هادئة. استخدمي نفس الشخصية والنبرة في كل الردود، ولا تنتقلي لصوت رجالي أو تقلدي أصواتاً مختلفة عند تمثيل الشخصيات. "
        "أجيبي بلهجة مصرية واضحة، واستمعي لكلام الطفلة كاملاً وافهمي المعنى من السياق حتى لو بدّلت بين العربي والإنجليزي. "
        "استخدمي جمل مصرية قصيرة، وكلمات إنجليزية سهلة وبطيئة. الطفلة لا تقرأ أو تكتب: لا تطلبي منها القراءة أو التهجئة أو النظر إلى كلمات مكتوبة. "
        "ابدئي الكلام فور اتصال الجلسة؛ لا تنتظري أن تتكلم الطفلة أولاً. افتحي بترحيب وشرح صوتي قصير مرتبط بالدرس والصور الظاهرة، ثم سؤال بسيط يساعدها تبدأ. اجعلي الدرس لقيمات قصيرة: فكرة واحدة، شرح من جملتين بحد أقصى، وسؤال واحد في كل مرة. أعيدي الشرح بصياغة واحدة فقط إذا احتاجت. بعد تحقق الهدف لا تكرري الدرس؛ احتفلي وانتظري قرار التطبيق بشأن الخطوة التالية. "
        "شجعي المحاولة بصدق، لكن لا تخلطي التشجيع بالحكم على صحة الإجابة. يمكنك مدح تفاعلها مع الصور بقول «حلو اختيارك» أو «برافو على المحاولة» من غير أن تقولي إن الإجابة صحيحة. كلمة «صح» أو «إجابة ممتازة» لا تقوليها إلا بعد إجابة منطوقة صحيحة ومتحققة؛ في الإجابة الخاطئة وضحي الخطأ بلطف وامنحيها فرصة ثانية. "
        "كوني معلمة فعلية: راجعي ما سبق، اختبري الفهم شفهياً، وقدّمي تلميحاً عند الحاجة. "
        "لو حكت شيئاً خارج الدرس، اهتمي بكلامها وردي عليه بصدق وبجملة أو جملتين، واسألي سؤال متابعة بسيطاً إذا كانت متحمسة للحكي. في الماث لا تحولي الشيء الذي تحكي عنه إلى عنصر مرئي ولا تدّعي ظهوره؛ ارجعي بلطف إلى العناصر الموجودة فعلياً في الحالة المرئية. لو استمرت في الحكي، خدي معها عدة تبادلات قصيرة ثم ادعيها برفق للنشاط الظاهر. لو بدت حزينة أو قلقة، اسمعيها وطمّنيها قبل التعليم. لا تسألي عن الاسم الكامل أو العنوان أو المدرسة أو أي بيانات شخصية، ولا تقدمي محتوى مخيفاً. "
        "لا تقولي إنك إنسانة؛ أنتِ لولو المساعدة داخل التطبيق. تكلمي بالصوت فقط ولا تطلبي منها قراءة نص. "
        + teaching_style
        + board_instructions
        + flow_instructions
        + (f"نطاق خطة ولي الأمر: {learning_scope}. لا تتجاوزي الدرس الحالي؛ التطبيق يحدد الانتقال أو التوقف. " if mode == "lesson" else "")
        + ("تحدثي ببطء شديد، بجمل قصيرة، واتركي وقفات واضحة بين الكلمات الإنجليزية. " if pace == "slow" else "تحدثي بإيقاع طبيعي هادئ مع جمل قصيرة. ")
        + ("إذا تعثرت الطفلة، ابدئي بتلميح بسيط ثم مثال بصري واحد فقط قبل المحاولة الثانية. " if hint_level == "gentle" else "قدمي تلميحاً تدريجياً، ثم قسمي المطلوب لخطوات أصغر، من غير إعطاء الإجابة مباشرة. ")
        + ("كرري نطق الكلمة الإنجليزية الجديدة مرتين بوضوح، ثم دعيها تحاول. " if repeat_words else "انطقي الكلمة الإنجليزية الجديدة مرة بوضوح ثم دعيها تحاول. ")
        + lesson_context
        + replay_instructions
        + "بعد إجابة الطفلة ابدئي الرد فوراً بجملة قصيرة مرتبطة بما قالت. لا تعيدي مقدمة الدرس ولا تشرحي أكثر من خطوة واحدة قبل السؤال التالي. "
        + "لا تبدئي درساً جديداً داخل الجلسة الحالية. التطبيق ينشئ جلسة جديدة بتعليمات الدرس التالي عند السماح بذلك. "
        + "عند استدعاء open_parent_picker سيتوقف الصوت وتُفتح إعدادات ولي الأمر؛ قولي جملة قصيرة للطفلة تسلم فيها الهاتف لماما، ولا تواصلي الدرس بعدها. "
        + ("مصدر الحقيقة الوحيد عن الشاشة هو الحالة المرئية الدقيقة التي يرسلها التطبيق. لا تعتمدي على بطاقات المنهج أو أمثلة تتذكرينها لتحديد ما هو ظاهر. لا تذكري أو تصفي أي عنصر أو لون أو رقم أو كمية غير موجودة في الحالة المرئية. إذا احتجتِ تغيير النشاط، استدعي show_math_scene، انتظري نتيجة الأداة، ثم تكلمي فقط عن visualState الذي أعادته. " if is_math else "")
    )


def live_config(lesson_id, mode="lesson", already_mastered=False, excellence_count=0, teacher_settings=None):
    return {
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": "Leda"}}},
        },
        "realtimeInputConfig": {"automaticActivityDetection": {"disabled": False, "silenceDurationMs": 400}},
        "systemInstruction": {"parts": [{"text": teacher_instructions(lesson_id, mode, already_mastered, excellence_count, teacher_settings)}]},
        "tools": [{"functionDeclarations": TOOL_DECLARATIONS}],
        "inputAudioTranscription": {},
        "outputAudioTranscription": {},
        "sessionResumption": {},
    }


class Handler(BaseHTTPRequestHandler):
    API_LIMITS = {
        "/api/provider-token": (bounded_env_int("PROVIDER_TOKEN_RATE_LIMIT_PER_MINUTE", 20), 60),
        "/api/onboarding-audio": (bounded_env_int("TTS_RATE_LIMIT_PER_MINUTE", 8), 60),
        "/api/challenge-audio": (bounded_env_int("TTS_RATE_LIMIT_PER_MINUTE", 8), 60),
    }

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Permissions-Policy", "microphone=(self)")
        super().end_headers()

    def send_json(self, status, value):
        data = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_rate_limit(self, retry_after):
        data = json.dumps({"error": "طلبات كتير في وقت قصير. جربي تاني بعد شوية."}, ensure_ascii=False).encode()
        self.send_response(429)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Retry-After", str(retry_after))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def shared_admission(self, kind):
        mode=os.environ.get("LOLO_SHARED_REQUEST_BUDGET","off").strip().lower()
        if mode=="off":return True
        if mode!="required":
            self.send_json(503,{"error":"إعداد حماية الطلبات غير صالح."});return False
        try:
            ok,retry=admit_shared_budget(os.environ.get("LOLO_BUDGET_DATABASE_URL"),kind,
                bounded_env_int("LOLO_SHARED_PAID_PER_MINUTE",120,1,1000000) if kind=="paid" else bounded_env_int("LOLO_SHARED_LOGIN_PER_MINUTE",30,1,1000000),
                bounded_env_int("LOLO_SHARED_PAID_PER_DAY",3000,1,1000000) if kind=="paid" else None)
        except (BudgetUnavailable,ValueError):
            self.send_json(503,{"error":"الخدمة المتصلة غير متاحة مؤقتًا."});return False
        if not ok:self.send_rate_limit(retry);return False
        return True

    def do_POST(self):
        route = self.path.split("?", 1)[0]
        if self.path == "/api/family":
            return self.family_request()
        if self.path == "/api/content":
            return self.content_request()
        if route not in self.API_LIMITS or self.path != route:
            return self.send_json(404, {"error": "Not found"})
        if self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
            return self.send_json(415, {"error": "نوع الطلب غير مدعوم."})
        # Browser cross-site requests are not expected. Native clients lack this header.
        # This is defense in depth, not authentication.
        if self.headers.get("Sec-Fetch-Site", "").lower() == "cross-site":
            return self.send_json(403, {"error": "الطلب غير مسموح."})
        if route == "/api/provider-token" and not VOICE_ENABLED:
            return self.send_json(503, {"error": "الصوت الذكي متوقف مؤقتاً."})
        if route != "/api/provider-token" and not TTS_ENABLED:
            return self.send_json(503, {"error": "خدمة القراءة الصوتية متوقفة مؤقتاً."})
        limit, window = self.API_LIMITS[route]
        forwarded_ip = self.headers.get("x-real-ip") if os.environ.get("VERCEL") else None
        source_ip = forwarded_ip or self.client_address[0]
        request_id = hmac_new(_RATE_LIMIT_SECRET, source_ip.encode(), "sha256").hexdigest()
        allowed, retry_after = API_RATE_LIMITER.check((route, request_id), limit, window)
        if not allowed:
            return self.send_rate_limit(retry_after)
        if route != "/api/provider-token":
            allowed, retry_after = API_RATE_LIMITER.check(("tts-combined", request_id), CLIENT_TTS_LIMIT)
            if not allowed:
                return self.send_rate_limit(retry_after)
        allowed, retry_after = GLOBAL_RATE_LIMITER.check("all-paid-requests", GLOBAL_PAID_LIMIT)
        if not allowed:
            return self.send_rate_limit(retry_after)
        if not self.shared_admission("paid"):return
        if route == "/api/provider-token":
            return self.create_provider_token()
        if route == "/api/onboarding-audio":
            return self.create_onboarding_audio()
        if route == "/api/challenge-audio":
            return self.create_challenge_audio()

    def content_request(self):
        if not CONTENT_DELIVERY_ENABLED:
            return self.send_json(503,{"error":"خدمة تنزيل المناهج غير مفعلة."})
        if self.headers.get("Sec-Fetch-Site","").lower()=="cross-site":
            return self.send_json(403,{"error":"الطلب غير مسموح."})
        if self.headers.get("Content-Type","").split(";",1)[0].strip().lower()!="application/json":
            return self.send_json(415,{"error":"نوع الطلب غير مدعوم."})
        body,error=self.read_json_object(2048)
        if error:return self.send_json(400,{"error":error})
        from content_delivery import load_catalog,UUID
        action=body.get("action")
        if action=="list" and set(body)=={"action"}:pass
        elif action=="download" and set(body)=={"action","draftId","sequence"} and isinstance(body["draftId"],str) and UUID.fullmatch(body["draftId"]) and type(body["sequence"]) is int and 1<=body["sequence"]<=9007199254740991:pass
        else:return self.send_json(400,{"error":"طلب منهج غير صالح."})
        ip=(self.headers.get("x-real-ip") if os.environ.get("VERCEL") else None) or self.client_address[0]
        key=hmac_new(_RATE_LIMIT_SECRET,ip.encode(),"sha256").hexdigest()
        allowed,retry=CONTENT_DELIVERY_LIMITER.check(key,20,60)
        if not allowed:return self.send_rate_limit(retry)
        allowed,retry=CONTENT_DELIVERY_GLOBAL.check("content",120,60)
        if not allowed:return self.send_rate_limit(retry)
        try:entries=load_catalog(os.environ.get("LOLO_CONTENT_CATALOG_FILE"))
        except (OSError,ValueError,TypeError,RecursionError):
            return self.send_json(503,{"error":"قائمة المناهج غير متاحة."})
        if action=="list":return self.send_json(200,{"packages":[item[0] for item in entries.values()]})
        item=entries.get(body["draftId"])
        if not item:return self.send_json(404,{"error":"المنهج غير متاح."})
        if item[0]["sequence"]!=body["sequence"]:return self.send_json(409,{"error":"تم تحديث المنهج. حدّث القائمة."})
        return self.send_json(200,{"envelope":item[1]})

    def family_request(self):
        if not FAMILY_ENABLED:
            return self.send_json(503, {"error": "خدمة الحسابات غير متاحة حاليًا."})
        if self.headers.get("Sec-Fetch-Site", "").lower() == "cross-site":
            return self.send_json(403, {"error": "الطلب غير مسموح."})
        if self.headers.get("Content-Type", "").split(";",1)[0].strip().lower() != "application/json":
            return self.send_json(415, {"error": "نوع الطلب غير مدعوم."})
        body,error = self.read_json_object(32768)
        if error:
            return self.send_json(400, {"error": error})
        action = body.get("action")
        if not isinstance(action,str) or action not in ("login","children","createChild","deleteChild","logout","readProgress","writeProgress"):
            return self.send_json(400, {"error": "العملية غير متاحة."})
        if action in ("readProgress","writeProgress") and not PROGRESS_SYNC_ENABLED:
            return self.send_json(503, {"error": "المزامنة غير متاحة حاليًا."})
        ip = (self.headers.get("x-real-ip") if os.environ.get("VERCEL") else None) or self.client_address[0]
        key = hmac_new(_RATE_LIMIT_SECRET,ip.encode(),"sha256").hexdigest()
        allowed,retry = FAMILY_RATE_LIMITER.check((key,"login" if action=="login" else "manage"), 5 if action=="login" else 60, 60)
        if not allowed:
            return self.send_rate_limit(retry)
        if action == "login":
            allowed,retry = FAMILY_GLOBAL_LIMITER.check("login",30,60)
            if not allowed:
                return self.send_rate_limit(retry)
        if action=="login" and not self.shared_admission("login"):return
        auth = self.headers.get("Authorization","")
        token = auth[7:] if auth.startswith("Bearer ") else ""
        try:
            store = FamilyStore(os.environ.get("LOLO_DATABASE_URL"))
            if action == "login":
                return self.send_json(200,store.login(body.get("email"),body.get("password")))
            if action == "children":
                return self.send_json(200,{"children":store.children(token)})
            if action == "createChild":
                return self.send_json(201,store.create_child(token,body.get("nickname"),body.get("ageBand","unspecified")))
            if action == "readProgress":
                return self.send_json(200,store.read_progress(token,body.get("childId")))
            if action == "writeProgress":
                return self.send_json(200,store.write_progress(token,body.get("childId"),body.get("baseRevision"),body.get("operationId"),body.get("snapshot")))
            if action == "deleteChild":
                store.delete_child(token,body.get("childId"))
            else:
                store.logout(token)
            return self.send_json(200,{"ok":True})
        except FamilyError as exc:
            return self.send_json(exc.status,{"error":str(exc)})
        except Exception as exc:
            # No DSN, request bodies, tokens, passwords or child identifiers in logs.
            print("Family operation failed:",type(exc).__name__)
            return self.send_json(503,{"error":"خدمة الحسابات غير متاحة حاليًا."})

    def read_json_object(self, maximum_bytes):
        lengths=self.headers.get_all("Content-Length") or []
        if len(lengths)!=1 or self.headers.get("Transfer-Encoding"):
            return None,"الطلب غير صالح."
        raw_length=lengths[0]
        if not raw_length.isascii() or not raw_length.isdecimal():return None,"الطلب غير صالح."
        try:
            length = int(raw_length)
        except (TypeError, ValueError):
            return None, "الطلب غير صالح."
        if length <= 0 or length > maximum_bytes:
            return None, "حجم الطلب غير صالح."
        try:
            raw = self.rfile.read(length)
            if len(raw) != length:
                return None, "الطلب غير مكتمل."
            def reject_constant(value):
                raise ValueError("Non-finite JSON constant")
            def reject_duplicate(pairs):
                value={}
                for key,item in pairs:
                    if key in value:raise ValueError("Duplicate JSON key")
                    value[key]=item
                return value
            def finite_float(value):
                number=float(value)
                if not math.isfinite(number):raise ValueError("Non-finite float")
                return number
            body = json.loads(raw.decode("utf-8"), parse_constant=reject_constant,parse_float=finite_float,object_pairs_hook=reject_duplicate)
        except (ValueError, RecursionError):
            return None, "الطلب غير صالح."
        if not isinstance(body, dict):
            return None, "الطلب غير صالح."
        return body, None

    def create_challenge_audio(self):
        if not TTS_ENABLED or not GEMINI_API_KEY:
            return self.send_json(503, {"error": "صوت لولو مش متاح حالياً."})
        body, error = self.read_json_object(4000)
        if error:
            return self.send_json(400, {"error": error})
        text = body.get("text")
        if not isinstance(text, str) or not text.strip() or len(text) > 600:
            return self.send_json(400, {"error": "نص السؤال غير صالح."})
        text = text.strip()
        if text in CHALLENGE_TTS_CACHE:
            return self.send_json(200, CHALLENGE_TTS_CACHE[text])
        payload = {
            "model": ONBOARDING_TTS_MODEL,
            "input": [{"type": "user_input", "content": [{
                "type": "text", "text": text,
                "annotations": [{"type": "speech_metadata", "style": "warm, cheerful, gentle young female teacher speaking Egyptian Arabic and clear simple English naturally"}],
            }]}],
            "response_format": {"type": "audio"},
            "generation_config": {"speech_config": [{"voice": "Kore"}]},
        }
        request = Request(
            "https://generativelanguage.googleapis.com/v1beta/interactions",
            data=json.dumps(payload, ensure_ascii=False).encode(),
            headers={"x-goog-api-key": GEMINI_API_KEY, "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=30) as response:
                result = json.loads(response.read())
            audio = result.get("output_audio", {}).get("data")
            if not audio:
                for step_result in result.get("steps", []):
                    if step_result.get("type") != "model_output":
                        continue
                    for item in step_result.get("content", []):
                        if item.get("type") == "audio" and item.get("data"):
                            audio = item["data"]
            if not audio:
                return self.send_json(502, {"error": "لولو مش قادرة تطلع صوت السؤال دلوقتي."})
            response_data = {"audio": audio, "mimeType": "audio/wav"}
            if len(CHALLENGE_TTS_CACHE) >= 64:
                CHALLENGE_TTS_CACHE.pop(next(iter(CHALLENGE_TTS_CACHE)))
            CHALLENGE_TTS_CACHE[text] = response_data
            self.send_json(200, response_data)
        except HTTPError as error:
            print("Gemini challenge TTS rejected:", error.code)
            self.send_json(502, {"error": "تعذر تجهيز صوت لولو للسؤال."})
        except (URLError, TimeoutError, json.JSONDecodeError) as error:
            print("Gemini challenge TTS request failed:", type(error).__name__)
            self.send_json(502, {"error": "الاتصال تأخر في تجهيز صوت لولو."})

    def create_onboarding_audio(self):
        if not TTS_ENABLED or not GEMINI_API_KEY:
            return self.send_json(503, {"error": "صوت لولو الترحيبي غير متاح حالياً."})
        body, error = self.read_json_object(1000)
        if error:
            return self.send_json(400, {"error": error})
        step = body.get("step")
        scripts = {
            "welcome": "أهلاً يا بطلة! أنا لولو، معلمتك وصاحبتك في رحلة التعلم. هنتعلم الإنجليزي والماث باللعب والصور، وهكلمك بالمصري وأسمع إجابتك وأساعدك خطوة خطوة. مش محتاجة تقرأي أو تكتبي، اتكلمي معايا براحتك!",
            "howto": "هنختار درس صغير، وبعدها نضغط ابدئي مع لولو. أنا هبدأ الكلام وأشرحلك، وإنتي جاوبيني بصوتك أو المسي الصور اللي على الشاشة. لو محتاجة مساعدة هديكي تلميح، وكل ما تخلصي درس هتلاقي نجمة، وتقدري تختاري درس أو اختبار تاني من إعدادات ولي الأمر.",
            "course": "ولي الأمر يختار الصف والمنهج المناسبين، وبعدها نبدأ من التأسيس أو الدرس التالي. تقدري ترجعي للجولة دي من زر المساعدة في أي وقت.",
        }
        if not isinstance(step, str) or step not in scripts:
            return self.send_json(400, {"error": "الخطوة غير معروفة."})
        if step in ONBOARDING_TTS_CACHE:
            return self.send_json(200, ONBOARDING_TTS_CACHE[step])
        payload = {
            "model": ONBOARDING_TTS_MODEL,
            "input": [{"type": "user_input", "content": [{
                "type": "text", "text": scripts[step],
                "annotations": [{"type": "speech_metadata", "style": "warm, cheerful, gentle young female teacher speaking Egyptian Arabic clearly and naturally"}],
            }]}],
            "response_format": {"type": "audio"},
            "generation_config": {"speech_config": [{"voice": "Kore"}]},
        }
        request = Request(
            "https://generativelanguage.googleapis.com/v1beta/interactions",
            data=json.dumps(payload, ensure_ascii=False).encode(),
            headers={"x-goog-api-key": GEMINI_API_KEY, "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=30) as response:
                result = json.loads(response.read())
            audio = result.get("output_audio", {}).get("data")
            if not audio:
                for step_result in result.get("steps", []):
                    if step_result.get("type") != "model_output":
                        continue
                    for item in step_result.get("content", []):
                        if item.get("type") == "audio" and item.get("data"):
                            audio = item["data"]
            if not audio:
                return self.send_json(502, {"error": "لولو مش قادرة تطلع الصوت الترحيبي دلوقتي."})
            response_data = {"audio": audio, "mimeType": "audio/wav"}
            ONBOARDING_TTS_CACHE[step] = response_data
            self.send_json(200, response_data)
        except HTTPError as error:
            print("Gemini onboarding TTS rejected:", error.code)
            self.send_json(502, {"error": "تعذر تجهيز صوت لولو الترحيبي."})
        except (URLError, TimeoutError, json.JSONDecodeError) as error:
            print("Gemini onboarding TTS request failed:", type(error).__name__)
            self.send_json(502, {"error": "الاتصال تأخر في تجهيز صوت لولو."})

    def create_provider_token(self):
        body, error = self.read_json_object(2000)
        if error:
            return self.send_json(400, {"error": error})
        lesson_id = body.get("lessonId", "")
        if not isinstance(lesson_id, str) or len(lesson_id) > 160:
            return self.send_json(400, {"error": "الدرس غير موجود في المسار."})
        mode = body.get("mode", "lesson")
        already_mastered = body.get("alreadyMastered") is True
        try:
            excellence_count = max(0, int(body.get("excellenceCount", 0)))
        except (TypeError, ValueError, OverflowError):
            excellence_count = 0
        provider = body.get("provider", "gemini")
        if not isinstance(provider, str):
            return self.send_json(400, {"error": "مزود الصوت غير معروف."})
        excellence_count = min(excellence_count, 1000)
        raw_settings = body.get("teacherSettings") if isinstance(body.get("teacherSettings"), dict) else {}
        teacher_settings = {
            "speechPace": raw_settings.get("speechPace") if raw_settings.get("speechPace") in ("slow", "normal") else "slow",
            "hintLevel": raw_settings.get("hintLevel") if raw_settings.get("hintLevel") in ("gentle", "guided") else "gentle",
            "repeatWords": raw_settings.get("repeatWords") is not False,
            "learningScope": raw_settings.get("learningScope") if raw_settings.get("learningScope") in ("lesson", "unit", "curriculum") else "lesson",
        }
        if mode not in ("lesson", "test"):
            return self.send_json(400, {"error": "نوع الجلسة غير معروف."})
        if lesson_id not in LESSONS:
            return self.send_json(400, {"error": "الدرس غير موجود في المسار."})
        if provider == "openai":
            if not OPENAI_ENABLED:
                return self.send_json(503, {"error": "OpenAI متوقف مؤقتاً."})
            return self.create_openai_token(lesson_id, mode, already_mastered, excellence_count, teacher_settings)
        if provider not in {"gemini", "gemini-backup"}:
            return self.send_json(400, {"error": "مزود الصوت غير معروف."})
        if not (GEMINI_ENABLED if provider == "gemini" else GEMINI_BACKUP_ENABLED):
            return self.send_json(503, {"error": "مزود الصوت متوقف مؤقتاً."})
        api_key = GEMINI_API_KEY if provider == "gemini" else GEMINI_BACKUP_API_KEY
        if not api_key:
            return self.send_json(503, {"error": "مفتاح مزود الصوت غير موجود في ملف .env."})
        model = MODEL if provider == "gemini" else BACKUP_MODEL
        now = datetime.now(timezone.utc)
        config = live_config(lesson_id, mode, already_mastered, excellence_count, teacher_settings)
        payload = {
            "uses": 1,
            "expireTime": (now + timedelta(minutes=25)).isoformat().replace("+00:00", "Z"),
            # Issue the token only after microphone permission is ready in the client;
            # still leave enough time for slow mobile networks to open the socket.
            "newSessionExpireTime": (now + timedelta(minutes=5)).isoformat().replace("+00:00", "Z"),
        }
        request = Request(
            "https://generativelanguage.googleapis.com/v1beta/auth_tokens",
            data=json.dumps(payload).encode(),
            headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=12) as response:
                result = json.loads(response.read())
            token = result.get("name")
            if not token:
                return self.send_json(502, {"error": "Google لم يرجع رمز جلسة صوتية."})
            self.send_json(200, {"provider": provider, "token": token, "model": model, "config": config})
        except HTTPError as error:
            print("Gemini token rejected:", error.code)
            self.send_json(502, {"error": "Google رفض المفتاح أو لم يفعّل Gemini Live للمشروع."})
        except (URLError, TimeoutError, json.JSONDecodeError) as error:
            print("Gemini token request failed:", type(error).__name__)
            self.send_json(502, {"error": "تعذر الاتصال بخدمة Gemini."})

    def create_openai_token(self, lesson_id, mode, already_mastered=False, excellence_count=0, teacher_settings=None):
        if not OPENAI_ENABLED:
            return self.send_json(503, {"error": "OpenAI متوقف مؤقتاً."})
        if not OPENAI_API_KEY:
            return self.send_json(503, {"error": "مفتاح OpenAI غير موجود في ملف .env."})
        session = {
            "session": {
                "type": "realtime", "model": OPENAI_MODEL,
                "instructions": teacher_instructions(lesson_id, mode, already_mastered, excellence_count, teacher_settings),
                "audio": {
                    "input": openai_audio_input(mode),
                    "output": {"voice": os.environ.get("OPENAI_REALTIME_VOICE", "shimmer")},
                },
                "tools": [
                    {"type": "function", "name": "show_math_scene",
                     "description": "اعرضي مشهداً بصرياً تفاعلياً للماث قبل الشرح، وطابقي الشيء والعدد المعروضين مع كلامك.",
                     "parameters": {"type": "object", "properties": {
                         "lesson_id": {"type": "string"}, "scene": {"type": "string", "enum": ["objects", "addition", "subtraction", "comparison", "place_value", "shapes", "pattern", "measurement", "daily_time", "number_line"]},
                         "object": {"type": "string", "enum": ["cookie", "apple", "block", "ball", "flower", "fish", "car", "star"]}, "second_object": {"type": "string", "enum": ["cookie", "apple", "block", "ball", "flower", "fish", "car", "star"]},
                         "count": {"type": "integer"}, "amount": {"type": "integer"}, "second_count": {"type": "integer"},
                         "numbers": {"type": "array", "items": {"type": "integer"}}, "target_number": {"type": "integer"},
                         "shape": {"type": "string", "enum": ["circle", "square", "triangle", "rectangle", "sphere", "cube", "cylinder"]},
                         "shapes": {"type": "array", "items": {"type": "string", "enum": ["circle", "square", "triangle", "rectangle", "sphere", "cube", "cylinder"]}},
                         "sequence": {"type": "array", "items": {"type": "string", "enum": ["red", "blue", "yellow", "green", "circle", "square", "triangle", "star"]}},
                         "equation": {"type": "string"}}, "required": ["lesson_id", "scene"]}},
                    {"type": "function", "name": "record_lesson_mastery",
                     "description": "سجلي الإتقان فقط بعد التحقق من إجابتين مستقلتين صحيحتين، مع نص الإجابتين المسموعتين.",
                     "parameters": {"type": "object", "properties": {"lesson_id": {"type": "string"}, "correct_responses": {"type": "integer"}, "evidence": {"type": "array", "items": {"type": "string"}}}, "required": ["lesson_id", "correct_responses", "evidence"]}},
                    {"type": "function", "name": "record_lesson_answer",
                     "description": "للدرس العادي فقط. في الاختبار الشفهي لا ترسلي إجابة أو is_correct؛ استخدمي submit_spoken_assessment_answer كي يصحح التطبيق بنفسه.",
                     "parameters": {"type": "object", "properties": {"lesson_id": {"type": "string"}, "answer": {"type": "string"}, "is_correct": {"type": "boolean"}, "question_number": {"type": "integer"}}, "required": ["lesson_id", "answer", "is_correct"]}},
                    {"type": "function", "name": "submit_spoken_assessment_answer",
                     "description": "في الاختبار الشفهي أرسلي assessment_id وquestion_id الحاليين فقط بعد سماع إجابة الطفلة. لا ترسلي الإجابة أو is_correct؛ التطبيق يقرأ التعرّف الصوتي ويقيّمها ويحفظها.",
                     "parameters": {"type": "object", "properties": {"assessment_id": {"type": "string"}, "question_id": {"type": "string"}}, "required": ["assessment_id", "question_id"]}},
                    {"type": "function", "name": "start_next_lesson",
                     "description": "الانتقال يديره التطبيق فقط. لا تستدعي هذه الأداة لبدء درس آخر.",
                     "parameters": {"type": "object", "properties": {"lesson_id": {"type": "string"}}, "required": ["lesson_id"]}},
                    {"type": "function", "name": "request_learning_break",
                     "description": "أوقفي الجلسة عند طلب التوقف أو الراحة.",
                     "parameters": {"type": "object", "properties": {}}},
                    {"type": "function", "name": "open_parent_picker",
                     "description": "أوقفي الصوت وافتحي قائمة ولي الأمر عند طلب ماما اختيار درس أو اختبار.",
                     "parameters": {"type": "object", "properties": {}}},
                ],
                "tool_choice": "auto",
            }
        }
        request = Request(
            "https://api.openai.com/v1/realtime/client_secrets",
            data=json.dumps(session).encode(),
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=12) as response:
                result = json.loads(response.read())
            token = result.get("value") or result.get("client_secret", {}).get("value")
            if not token:
                return self.send_json(502, {"error": "OpenAI لم يرجع مفتاح جلسة صوتية مؤقت."})
            self.send_json(200, {"provider": "openai", "token": token, "model": OPENAI_MODEL})
        except HTTPError as error:
            print("OpenAI realtime token rejected:", error.code)
            self.send_json(502, {"error": "OpenAI رفض المفتاح أو لم يفعّل Realtime لهذا الحساب."})
        except (URLError, TimeoutError, json.JSONDecodeError) as error:
            print("OpenAI realtime token request failed:", type(error).__name__)
            self.send_json(502, {"error": "تعذر الاتصال بخدمة OpenAI الصوتية."})

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/status":
            return self.send_json(200, {"providers": [name for name, configured in (("gemini", GEMINI_API_KEY and GEMINI_ENABLED), ("openai", OPENAI_API_KEY and OPENAI_ENABLED), ("gemini-backup", GEMINI_BACKUP_API_KEY and GEMINI_BACKUP_ENABLED)) if VOICE_ENABLED and configured], "ttsEnabled": bool(TTS_ENABLED and GEMINI_API_KEY), "familyUiEnabled": bool(FAMILY_ENABLED and PARENT_CLOUD_UI_ENABLED), "progressSyncEnabled": bool(FAMILY_ENABLED and PARENT_CLOUD_UI_ENABLED and PROGRESS_SYNC_ENABLED)})
        relative = "index.html" if path == "/" else path.lstrip("/")
        allowed_files = {"index.html", "curriculum.json", "pcm-processor.js", "app.js", "storage.js", "assessment-engine.js", "subject-catalog.js", "visual-question-bank.js", "visual-assessment-engine.js", "curriculum-engine.js", "learning-engine.js", "learning-analytics.js", "learning-reminders.js", "learning-path-engine.js", "network.js", "family-client.js", "activity-engine.js", "activity-pilot.js", "content-schema.js", "content-package.js", "content-install.js", "content-trust.js", "content-runtime.js", "content-progress.js", "content-client.js", "offline-assets.js", "sw.js", "offline.html", "parent-gate.js", "session-timers.js", "brand.js", "favicon.ico", "favicon-16x16.png", "favicon-32x32.png", "favicon-48x48.png", "apple-touch-icon.png", "site.webmanifest"}
        is_brand_asset = relative.startswith("assets/branding/") and Path(relative).suffix.lower() in {".png", ".webp", ".json"}
        if relative not in allowed_files and not is_brand_asset:
            return self.send_json(404, {"error": "Not found"})
        file = (ROOT / relative).resolve()
        if (is_brand_asset and (ROOT/"assets"/"branding").resolve() not in file.parents) or ROOT not in file.parents or not file.is_file():
            return self.send_json(404, {"error": "Not found"})
        content = file.read_bytes()
        mime = {".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8",
                ".webmanifest": "application/manifest+json; charset=utf-8", ".js": "text/javascript; charset=utf-8",
                ".ico": "image/vnd.microsoft.icon", ".png": "image/png", ".webp": "image/webp"}.get(file.suffix, "application/octet-stream")
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)


if __name__ == "__main__":
    print(f"Lolo Learning is available on http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
