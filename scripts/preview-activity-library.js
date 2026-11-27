// Generates a local-only, data-only admin prototype in an OS temporary directory.
// Never deploy this as an authenticated administration website.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const library=require('../admin-src/activity-library.cjs');
function html(){
  const audit=library.audit();if(!audit.valid)throw Error(audit.errors.join('; '));
  const engine=fs.readFileSync(path.join(__dirname,'../activity-engine.js'),'utf8');
  const data=JSON.stringify(library.query()).replace(/</g,'\\u003c');
  return '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LOLO | Activity Library</title><style>body{font:16px system-ui;background:#f5f2fb;color:#302448;margin:0}main{max-width:1100px;margin:auto;padding:24px}h1{margin:0;color:#54378c}p{line-height:1.65}.controls{display:flex;flex-wrap:wrap;gap:10px;margin:20px 0}input,select,button{font:inherit;padding:10px;border:1px solid #d4c6ea;border-radius:9px;background:white;color:inherit}button{cursor:pointer}#cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(245px,1fr));gap:12px}.card{background:white;border:1px solid #e2d9ef;border-radius:16px;padding:16px}.card h2{font-size:18px;margin:8px 0}.muted{color:#675b79;font-size:14px}.tag{font-size:13px;font-weight:bold;color:#54408a}#preview{margin-top:20px;background:white;padding:20px;border-radius:16px}fieldset{display:grid;gap:10px;border:1px solid #e2d9ef}label{display:flex;align-items:center;gap:8px;flex-wrap:wrap}#detail{white-space:pre-wrap;font-size:14px}</style><main><p class="tag">LOLO / ADMIN WORKSPACE / LOCAL PROTOTYPE</p><h1>مكتبة الأنشطة | Activity Library</h1><p>معاينة محلية للتطوير فقط. لا توجد صلاحية نشر أو بيانات طلاب أو اتصال بالخادم.</p><div class="controls"><input id="search" placeholder="ابحث عن نشاط" aria-label="البحث"><select id="category" aria-label="الفئة"><option value="">كل الفئات</option></select><select id="status" aria-label="الدعم"><option value="">كل الحالات</option><option value="implemented">منفذ في المحرك</option><option value="planned">مخطط</option></select><select id="offline" aria-label="الاتصال"><option value="">كل متطلبات الاتصال</option><option value="yes">يدعم العمل دون إنترنت</option></select></div><p id="count" role="status"></p><div id="cards"></div><section id="preview" hidden><h2 id="previewTitle"></h2><p id="detail"></p><div id="sample"></div><button id="close" type="button">إغلاق المعاينة</button></section></main><script>'+engine+'</script><script>const entries='+data+';'+String.raw`
const $=id=>document.getElementById(id);
const categories=new Map(entries.map(e=>[e.category,e.categoryLabel]));
for(const [key,label] of categories){const option=document.createElement('option');option.value=key;option.textContent=label;$('category').append(option);}
function preview(e){
  $('preview').hidden=false;$('previewTitle').textContent=e.label;
  $('detail').textContent='المعرّف: '+e.id+' | الإصدار: '+(e.versions.join(', ')||'غير متاح')+'\nحقول الإعداد: '+(e.configFields.join(', ')||'لم تُحدد بعد');
  $('sample').replaceChildren();
  if(e.example)window.LoloActivities.render(e.example,$('sample'));
  else $('sample').textContent='النشاط مخطط له وغير قابل للمعاينة أو النشر.';
  $('preview').scrollIntoView({block:'nearest'});
}
function render(){
  const term=$('search').value.trim().normalize('NFKC').toLowerCase();
  const list=entries.filter(e=>(!term||[e.label,e.id,e.description,e.categoryLabel].some(x=>x.normalize('NFKC').toLowerCase().includes(term)))&&(!$('category').value||e.category===$('category').value)&&(!$('status').value||e.status===$('status').value)&&(!$('offline').value||e.offline===true));
  $('count').textContent=list.length+' نشاط · '+list.filter(e=>e.status==='implemented').length+' منفذ في المحرك';
  $('cards').replaceChildren();
  for(const e of list){
    const card=document.createElement('article');card.className='card';
    const tag=document.createElement('span');tag.className='tag';tag.textContent=e.status==='implemented'?'منفذ · v'+e.versions.join(','):'مخطط · غير مدعوم';
    const h=document.createElement('h2');h.textContent=e.label;
    const p=document.createElement('p');p.textContent=e.description;
    const meta=document.createElement('p');meta.className='muted';meta.textContent=e.categoryLabel+' · '+(e.offline===true?'دون إنترنت':'متطلبات التشغيل قيد التطوير');
    const button=document.createElement('button');button.type='button';button.textContent=e.example?'معاينة النشاط':'عرض التفاصيل';button.onclick=()=>preview(e);
    card.append(tag,h,p,meta,button);$('cards').append(card);
  }
}
$('search').addEventListener('input',render);for(const id of ['category','status','offline'])$(id).addEventListener('change',render);
$('close').onclick=()=>{$('preview').hidden=true;$('sample').replaceChildren();};render();
`+'</script></html>';
}
if(require.main===module){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lolo-activity-library-'));
  const file=path.join(dir,'index.html');fs.writeFileSync(file,html(),{mode:0o600});
  console.log('Local prototype (open in a browser): '+file);
}
module.exports={html};
