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
  ['image-hotspot','interaction','اختيار جزء من الصورة','اختيار مناطق محددة في صورة.',['image'],[]],
  ['drag-drop','interaction','السحب والإفلات','تحريك العناصر مع بديل مناسب للوحة المفاتيح.',['accessible-drag'],[]],
  ['speech-repeat','voice','الاستماع والتكرار','نشاط صوتي موحد؛ توجد وظيفة قديمة منفصلة.',['microphone','audio'],[]],
  ['phoneme-score','voice','تقييم النطق المتخصص','تقييم الصوت على مستوى الفونيمات، لا مجرد تفريغ الكلام.',['microphone','specialized-provider','consent'],[]],
  ['dictation','voice','الإملاء الصوتي','الاستماع وكتابة الإجابة.',['audio'],[]],
  ['conversation','voice','المحادثة التفاعلية','محادثة مقيدة بأهداف الدرس وسياسات الطفل.',['microphone','network','consent'],[]],
  ['trace','writing','تتبع الحروف والأرقام','تتبع مسار موحد؛ توجد وظيفة قديمة منفصلة.',['canvas'],[]],
  ['free-drawing','writing','الرسم الحر','مساحة رسم مع تغذية راجعة مناسبة.',['canvas'],[]],
  ['coloring','writing','التلوين','تلوين مناطق محددة.',['canvas'],[]],
  ['number-line','math','خط الأعداد','اختيار علامة عددية على خط محدود قابل للتنقل بلوحة المفاتيح.',[],['min','max','step','answer']],
  ['fractions','math','الكسور المكافئة','إدخال بسط ومقام وتقييم التكافؤ الحسابي للكسور بين صفر وواحد.',[],['numerator','denominator']],
  ['geometry','math','الهندسة','التعرف على الأشكال وخصائصها.',['interactive-graphics'],[]],
  ['equations','math','المعادلات','تقييم تعبيرات رياضية دون تنفيذ كود.',['math-parser'],[]],
  ['science-simulation','science','محاكاة علمية','تجربة افتراضية بضوابط محددة مسبقًا.',['simulation-runtime'],[]],
  ['interactive-story','reading','قصة تفاعلية','مسارات قراءة واختيارات قصصية.',['media'],[]],
  ['reading-aloud','reading','القراءة الجهرية','قياس القراءة بمؤشرات مدروسة.',['microphone','consent'],[]],
  ['memory-game','games','لعبة الذاكرة','مطابقة البطاقات بالذاكرة.',['game-runtime'],[]],
  ['puzzle','games','البازل','تركيب قطع أو عناصر.',['game-runtime'],[]],
  ['maze','games','المتاهة','التنقل داخل مسار محدد.',['game-runtime'],[]],
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
