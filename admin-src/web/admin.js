'use strict';
const $=id=>document.getElementById(id);
let entries=[],identity=null,generation=0,draftId=null,draftRevision=0;
async function api(path,body){
  const options={credentials:'same-origin',cache:'no-store',redirect:'error'};
  if(body!==undefined)Object.assign(options,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const response=await fetch(path,options);
  if(!response.ok){let details=null;try{details=await response.json();}catch{}throw Object.assign(new Error('تعذر تنفيذ الطلب.'),{status:response.status,details});}
  return response.json();
}
function clear(message=''){
  generation++;identity=null;entries=[];clearDrafts();
  $('login').hidden=false;$('workspace').hidden=true;$('logout').hidden=true;$('library').hidden=true;$('libraryNav').hidden=true;
  $('cards').replaceChildren();$('sample').replaceChildren();$('preview').hidden=true;
  $('password').value='';$('code').value='';$('message').textContent=message;
}
function render(){
  const term=$('search').value.trim().normalize('NFKC').toLowerCase();
  const list=entries.filter(e=>(!term||[e.id,e.label,e.description,e.categoryLabel].some(x=>x.normalize('NFKC').toLowerCase().includes(term)))&&(!$('category').value||e.category===$('category').value)&&(!$('status').value||e.status===$('status').value)&&(!$('offline').value||e.offline===true));
  $('count').textContent=list.length+' نشاط';
  $('cards').replaceChildren();
  for(const e of list){
    const card=document.createElement('article');card.className='card';
    const tag=document.createElement('span');tag.className='tag';tag.textContent=e.status==='implemented'?'منفذ · v'+e.versions.join(','):'مخطط · غير مدعوم';
    const title=document.createElement('h3');title.textContent=e.label;
    const desc=document.createElement('p');desc.textContent=e.description;
    const meta=document.createElement('p');meta.className='muted';meta.textContent=e.categoryLabel+' · '+(e.offline===true?'بدون إنترنت':'قيد التطوير');
    const button=document.createElement('button');button.textContent=e.example?'معاينة النشاط':'عرض التفاصيل';
    button.onclick=async()=>{
      const g=generation;
      try{
        // Re-check the current authorization before opening a new preview.
        const current=await api('/api/session');
        if(g!==generation||!identity)return;
        if(!current.permissions.includes('library:read')){await refresh();return;}
        $('preview').hidden=false;$('previewTitle').textContent=e.label;
        $('detail').textContent='ID: '+e.id+' · الإصدار: '+(e.versions.join(',')||'غير متاح')+' · الحقول: '+(e.configFields.join(', ')||'لم تُحدد');
        $('sample').replaceChildren();
        if(e.example&&window.LoloActivities)window.LoloActivities.render(e.example,$('sample'));
        else $('sample').textContent='لا توجد معاينة مدعومة حاليًا.';
        $('preview').scrollIntoView({block:'nearest'});
      }catch{clear('انتهت الجلسة. سجّل الدخول من جديد.');}
    };
    card.append(tag,title,desc,meta,button);$('cards').append(card);
  }
}
async function loadEngine(){
  if(window.LoloActivities)return;
  await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/activity-engine.js';script.onload=resolve;script.onerror=reject;document.head.append(script);});
}
function clearDrafts(){
  draftId=null;draftRevision=0;$('drafts').hidden=true;$('draftNav').hidden=true;$('draftEditor').hidden=true;
  $('draftList').replaceChildren();$('draftJson').value='';$('draftStatus').textContent='';
}
function setDraft(data){
  draftId=data?.id||null;draftRevision=data?.revision||0;
  $('draftJson').value=JSON.stringify(data?.content||{schemaVersion:1,subjectId:'science',gradeId:'grade-1',title:'مسودة علوم',units:[{id:'unit-1',title:'النباتات',lessons:[{id:'lesson-1',title:'احتياجات النبات',goal:'التعرف على احتياجات النبات',activities:[{id:'activity-1',type:'true-false',version:1,prompt:'النبات يحتاج الماء.',config:{answer:true}}]}]}]},null,2);
}
async function loadDrafts(){
  const g=generation;
  const data=await api('/api/drafts');if(g!==generation)return;
  $('draftList').replaceChildren();
  for(const d of data.drafts){
    const btn=document.createElement('button');btn.textContent=d.title+' · v'+d.revision;
    btn.onclick=async()=>{const current=generation;try{if($('draftEditor').hidden)return;const item=await api('/api/draft/read',{id:d.id});if(current===generation)setDraft(item);}catch{$('draftStatus').textContent='تعذر فتح المسودة.';}};
    $('draftList').append(btn);
  }
}
$('draftNav').onclick=()=>$('drafts').scrollIntoView({block:'start'});
$('newDraft').onclick=()=>{setDraft(null);$('draftStatus').textContent='مسودة جديدة غير محفوظة.';};
async function draftAction(save){
  const g=generation;
  const buttons=[$('checkDraft'),$('saveDraft'),$('newDraft')];buttons.forEach(b=>b.disabled=true);
  try{
    const content=JSON.parse($('draftJson').value);
    const result=await api(save?'/api/draft/save':'/api/draft/check',save?{id:draftId,revision:draftRevision,content}:{content});
    if(g!==generation)return;
    if(save){draftId=result.id;draftRevision=result.revision;$('draftStatus').textContent='تم حفظ المسودة · إصدار '+draftRevision;await loadDrafts();}
    else $('draftStatus').textContent=result.valid?'المحتوى متوافق مع المحرك الحالي؛ لم يُنشر.':result.issues.map(i=>i.code+' — '+i.path).join('\n');
  }catch(e){
    if(g!==generation)return;
    if(e.status===401||e.status===403){await refresh();return;}
    $('draftStatus').textContent=e.status===409?'تم تعديل المسودة من حساب آخر. افتح أحدث نسخة؛ التغييرات المحلية لم تُحفظ.':e.details?.validation?.issues?.map(i=>i.code+' — '+i.path).join('\n')||'تعذر تنفيذ الطلب أو صيغة JSON غير صحيحة.';
  }finally{buttons.forEach(b=>b.disabled=false);}
}
$('checkDraft').onclick=()=>draftAction(false);$('saveDraft').onclick=()=>draftAction(true);
async function refresh(){
  const g=++generation;
  try{
    const current=await api('/api/session');if(g!==generation)return;
    $('preview').hidden=true;$('sample').replaceChildren();
    identity=current;$('login').hidden=true;$('workspace').hidden=false;$('logout').hidden=false;$('message').textContent='';
    $('role').textContent='ROLE / '+current.role;
    const canRead=current.permissions.includes('curriculum:read'),canEdit=current.permissions.includes('curriculum:edit');
    $('drafts').hidden=!canRead;$('draftNav').hidden=!canRead;$('draftEditor').hidden=!canEdit;
    if(!canRead)clearDrafts();
    else{if(!canEdit){$('draftJson').value='';draftId=null;draftRevision=0;}else if(!$('draftJson').value)setDraft(null);await loadDrafts();if(g!==generation)return;}
    const allowed=current.permissions.includes('library:read');
    $('library').hidden=!allowed;$('libraryNav').hidden=!allowed;
    if(!allowed){entries=[];$('cards').replaceChildren();$('sample').replaceChildren();return;}
    const result=await api('/api/library');if(g!==generation)return;
    await loadEngine();if(g!==generation)return;
    entries=result.activities;
    $('total').textContent=entries.length;$('implemented').textContent=entries.filter(e=>e.status==='implemented').length;$('planned').textContent=entries.filter(e=>e.status==='planned').length;
    $('category').replaceChildren(new Option('كل الأقسام',''));
    for(const [id,label] of new Map(entries.map(e=>[e.category,e.categoryLabel])))$('category').append(new Option(label,id));
    render();
  }catch(e){if(g===generation)clear(e.status===401?'سجّل الدخول للمتابعة.':'تعذر تحميل لوحة الإدارة.');}
}
$('loginForm').addEventListener('submit',async e=>{
  e.preventDefault();const btn=e.currentTarget.querySelector('button');btn.disabled=true;
  const data={email:$('email').value,password:$('password').value,code:$('code').value};$('password').value='';$('code').value='';
  try{await api('/api/login',data);await refresh();}catch(e){clear(e.status===429?'محاولات كثيرة، حاول لاحقًا.':'تعذر تسجيل الدخول. راجع البيانات ورمز التحقق.');}finally{btn.disabled=false;}
});
$('logout').onclick=async()=>{try{await api('/api/logout',{});clear('تم تسجيل الخروج.');}catch{clear('تعذر تأكيد إلغاء الجلسة على الخادم. أغلق المتصفح وحاول عند عودة الخدمة.');}};
$('libraryNav').onclick=()=>$('library').scrollIntoView({block:'start'});
$('search').oninput=render;for(const id of ['category','status','offline'])$(id).onchange=render;
$('closePreview').onclick=()=>{$('preview').hidden=true;$('sample').replaceChildren();};
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&identity)refresh();});
setInterval(async()=>{if(!identity)return;const g=generation;try{const s=await api('/api/session');if(g===generation&&JSON.stringify(s.permissions)!==JSON.stringify(identity?.permissions))refresh();}catch{if(g===generation)clear('انتهت الجلسة أو تعذر التحقق منها.');}},30000);
refresh();
