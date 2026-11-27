/* Admin authoring metadata; not part of the student asset bundle. */
const engine=require('../activity-engine.js');
const pilot=require('../activity-pilot.js');
const groups=Object.freeze({
  questions:'الأسئلة والتقييم',interaction:'الأنشطة التفاعلية',voice:'الصوت واللغة',writing:'الكتابة والرسم',
  math:'الرياضيات',science:'العلوم والاستكشاف',reading:'القراءة والقصص',games:'الألعاب التعليمية',homework:'الواجبات'
});
const definitions=[
  ['choice','questions','اختيار من متعدد','اختيار إجابة واحدة من 2–8 خيارات.',[],['options','answer']],
  ['true-false','questions','صح أو خطأ','تقييم عبارة بإجابة منطقية.',[],['answer']],
  ['multi-choice','questions','اختيار عدة إجابات','تحديد مجموعة الإجابات الصحيحة.',[],['options','answers']],
  ['sequence','interaction','ترتيب العناصر','ترتيب أحداث أو كلمات أو مراحل.',[],['items','answer']],
  ['match','interaction','توصيل العناصر','مطابقة عناصر باستخدام قوائم اختيار.',[],['left','right','pairs']],
  ['numeric','math','إجابة رقمية','إجابة عدد صحيح محدودة النطاق.',[],['answer']],
  ['classify','interaction','تصنيف العناصر','وضع العناصر في مجموعات محددة.',[],['items','groups','assignments']],
  ['fill-blank','questions','أكمل الفراغات','إكمال كلمة أو عبارة مع بدائل مقبولة.',[],['answers']],
  ['free-text','questions','إجابة نصية قصيرة','مطابقة بدائل نصية معتمدة؛ لا يقيم الإنشاء الحر أو المعنى.',[],['answers']],
  ['image-hotspot','interaction','تحديد أجزاء الرسم','اختيار منطقة في رسم نبات أو وجه مدمج، مع بديل نصي.',[],['diagram','answer']],
  ['drag-drop','interaction','السحب والإفلات','تصنيف العناصر بالسحب أو النقر مع بديل قوائم اختيار للوحة المفاتيح.',[],['items','groups','assignments']],
  ['speech-repeat','voice','الاستماع والتكرار','استماع محلي ثم مطابقة الكلمات بالتعرف المحلي؛ لا يقيس النطق.',['local-audio','local-recognition','session-parent-permission'],['locale','text']],
  ['phoneme-score','voice','تقييم النطق المتخصص','تقييم الصوت على مستوى الفونيمات، لا مجرد تفريغ الكلام.',['microphone','specialized-provider','consent'],[]],
  ['dictation','voice','الإملاء الصوتي','الاستماع إلى صوت الجهاز المحلي ثم مطابقة النص المكتوب.',['local-audio'],['locale','text']],
  ['conversation','voice','المحادثة التفاعلية','محادثة مقيدة بأهداف الدرس وسياسات الطفل.',['microphone','network','consent'],[]],
  ['trace','writing','تتبع الحروف والأرقام','تتبع هندسي لرموز محدودة؛ ليس تعرفًا على الخط.',[],['glyph']],
  ['free-drawing','writing','الرسم الحر','لوحة محلية تسجل الإكمال دون درجة أو حفظ الرسم.',[],[]],
  ['coloring','writing','التلوين','تلوين ثلاثة أشكال بألوان محددة.',[],['answers']],
  ['number-line','math','خط الأعداد','اختيار علامة عددية على خط محدود قابل للتنقل بلوحة المفاتيح.',[],['min','max','step','answer']],
  ['fractions','math','الكسور المكافئة','إدخال بسط ومقام وتقييم التكافؤ الحسابي للكسور بين صفر وواحد.',[],['numerator','denominator']],
  ['geometry','math','الأشكال الهندسية','اختيار شكل من خمسة أشكال ثابتة مرسومة داخل التطبيق.',[],['answer']],
  ['equations','math','المعادلات الخطية','حل معادلة خطية بمعامل موجب وحل صحيح دون تنفيذ تعبيرات برمجية.',[],['coefficient','constant','result']],
  ['science-simulation','science','محاكاة الميزان','تغيير عدد الأثقال في نموذج ميزان كفتين تعليمي مبسط.',[],['leftMass','unitMass','maxCount']],
  ['interactive-story','reading','قصة تفاعلية','صفحات نصية متفرعة حسب الاختيار مع مسارات منتهية قابلة للتحقق.',[],['scenes']],
  ['reading-aloud','reading','القراءة الجهرية','مطابقة النص المتعرف عليه محليًا؛ ليست درجة طلاقة أو نطق.',['local-recognition','session-parent-permission'],['locale','text']],
  ['memory-game','games','لعبة الذاكرة','كشف أزواج بطاقات نصية أو رموز ضمن عدد محاولات محدد.',[],['items','maxTurns']],
  ['puzzle','games','بازل الترتيب','تبديل قطع نصية أو رموز حتى الوصول إلى ترتيب معتمد.',[],['items','answer']],
  ['maze','games','المتاهة','شبكة ممرات قابلة للتعديل والتحقق من إمكانية الوصول.',[],['grid']],
  ['homework-upload','homework','رفع الواجبات','رفع ملف بإذن ولي الأمر ومراجعة الخصوصية.',['network','consent','secure-upload'],[]],
];
const examples=new Map(pilot.lessons.flatMap(l=>l.activities).map(a=>[a.type,a]));
const clone=v=>JSON.parse(JSON.stringify(v));
function catalog(){
  return definitions.map(([id,category,label,description,requirements,fields])=>{
    const runtime=Object.hasOwn(engine.types,id)?engine.types[id]:null;
    return {id,category,categoryLabel:groups[category],label,description,status:runtime?'implemented':'planned',
      versions:runtime?[runtime.version]:[],offline:runtime?runtime.offline:null,
      evaluator:runtime?.evaluator||null,renderer:runtime?.renderer||null,
      requirements:[...requirements],configFields:[...fields],example:runtime&&examples.has(id)?clone(examples.get(id)):null};
  });
}
function compatibility(entry,target){
  if(entry.status!=='implemented')return 'planned';
  if(!target||!Object.hasOwn(target,entry.id)||!Array.isArray(target[entry.id])||!entry.versions.some(v=>target[entry.id].includes(v)))return 'unsupported-client';
  return 'compatible';
}
function query({search='',category='',status='',offline=null,target=Object.fromEntries(Object.entries(engine.types).map(([k,v])=>[k,[v.version]]))}={}){
  const term=String(search).normalize('NFKC').trim().toLowerCase();
  return catalog().map(entry=>({...entry,compatibility:compatibility(entry,target)})).filter(e=>
    (!category||e.category===category)&&(!status||e.status===status)&&(offline===null||e.offline===offline)&&
    (!term||[e.id,e.label,e.description,e.categoryLabel].some(v=>v.normalize('NFKC').toLowerCase().includes(term))));
}
function audit(){
  const entries=catalog(),ids=new Set(entries.map(e=>e.id)),expected=[...Object.keys(engine.types),...engine.planned];
  const errors=[];
  if(ids.size!==entries.length||expected.length!==entries.length||expected.some(id=>!ids.has(id)))errors.push('Registry coverage mismatch');
  for(const e of entries){
    if(e.status==='implemented'&&(!e.example||!engine.validate(e.example).valid||e.example.type!==e.id||e.example.version!==e.versions[0]||
      Object.keys(e.example.config).sort().join(',')!==e.configFields.slice().sort().join(',')))errors.push('Invalid authoring template: '+e.id);
    if(e.status==='planned'&&(e.example||e.versions.length||e.offline!==null))errors.push('Planned entry overclaims capability: '+e.id);
  }
  return {valid:errors.length===0,errors,implemented:entries.filter(e=>e.status==='implemented').length,planned:entries.filter(e=>e.status==='planned').length};
}
module.exports=Object.freeze({groups,catalog,query,compatibility,audit});
