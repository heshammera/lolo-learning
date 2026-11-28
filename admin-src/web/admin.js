'use strict';
const $=id=>document.getElementById(id);
let entries=[],identity=null,generation=0,draftId=null,draftRevision=0,draftBusy=false,draftBaseline='',draftState='draft';
async function api(path,body){
  const options={credentials:'same-origin',cache:'no-store',redirect:'error'};
  if(body!==undefined)Object.assign(options,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const response=await fetch(path,options);
  if(!response.ok){let details=null;try{details=await response.json();}catch{}throw Object.assign(new Error('تعذر تنفيذ الطلب.'),{status:response.status,details});}
  return response.json();
}
function clear(message=''){
  generation++;identity=null;entries=[];clearDrafts();clearBilling();
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
  $('draftList').replaceChildren();$('draftJson').value='';draftBaseline='';draftState='draft';$('workflowActions').replaceChildren();$('releaseHistory').replaceChildren();$('workflowState').textContent='';$('visualEditor').replaceChildren();$('draftPreview').hidden=true;$('draftSample').replaceChildren();$('draftStatus').textContent='';
}
const workflowLabels={draft:'مسودة',review:'قيد المراجعة',approved:'معتمد',published:'إصدار تجريبي محفوظ'};
function renderWorkflow(){
  const box=$('workflowActions');box.replaceChildren();$('releaseHistory').replaceChildren();
  $('workflowState').textContent=$('draftJson').value?'الحالة: '+(workflowLabels[draftState]||draftState):'';
  const editable=identity?.permissions.includes('curriculum:edit')&&draftState==='draft';
  $('saveDraft').hidden=!editable;$('checkDraft').hidden=!editable;
  if(!draftId||!identity)return;
  const permissions=identity.permissions;
  function add(label,action,permission,states){
    if(!states.includes(draftState)||!permissions.includes(permission))return;
    const b=document.createElement('button');b.type='button';b.textContent=label;
    b.onclick=()=>workflowAction(action);box.append(b);
  }
  add('إرسال للمراجعة','submit','curriculum:edit',['draft']);
  add('اعتماد المنهج','approve','curriculum:review',['review']);
  add('إعادة للمسودة','return','curriculum:review',['review','approved']);
  add('حفظ إصدار تجريبي','publish','curriculum:publish',['approved']);
  add('فتح تعديل جديد','reopen','curriculum:edit',['published']);
  const h=document.createElement('button');h.type='button';h.textContent='سجل الإصدارات';h.onclick=()=>loadReleases();box.append(h);
}
async function workflowAction(action){
  if(draftBusy||!draftId)return;
  if($('draftJson').value!==draftBaseline){$('draftStatus').textContent='احفظ التعديلات قبل تغيير الحالة.';return;}
  if(!confirm('تأكيد تغيير حالة المنهج؟ الإصدار التجريبي لا يصل إلى الطلاب.'))return;
  const g=generation,id=draftId;draftBusy=true;$('visualEditor').disabled=true;
  try{
    await api('/api/draft/transition',{id,revision:draftRevision,action});
    const data=await api('/api/draft/read',{id});
    if(g!==generation)return;draftBusy=false;setDraft(data);await loadDrafts();$('draftStatus').textContent='تم تحديث حالة المنهج.';
  }catch(e){if(g===generation)$('draftStatus').textContent=e.status===403?'الصلاحية غير كافية؛ الاعتماد يتطلب مراجعًا غير آخر محرر.':'تعذر تحديث الحالة؛ افتح أحدث نسخة وتحقق من التوافق.';}
  finally{draftBusy=false;$('visualEditor').disabled=false;}
}
async function loadReleases(){
  if(!draftId||draftBusy)return;
  const g=generation,id=draftId;
  try{
    const result=await api('/api/draft/history',{id});
    if(g!==generation||id!==draftId)return;
    const box=$('releaseHistory');box.replaceChildren();
    const active=result.releases.find(r=>r.active);
    for(const r of result.releases){
      const row=document.createElement('div');row.className='cms-row';
      const name=document.createElement('span');name.textContent='إصدار '+r.version+(r.active?' · نشط تجريبيًا':'');row.append(name);
      if(!r.active&&active&&identity?.permissions.includes('curriculum:publish')){
        const b=document.createElement('button');b.type='button';b.textContent='رجوع لهذا الإصدار';
        b.onclick=async()=>{if(draftBusy||id!==draftId||!confirm('استعادة هذا الإصدار التجريبي دون حذف أي نسخة؟'))return;draftBusy=true;try{await api('/api/draft/rollback',{id,target:r.id,expectedActive:active.id});draftBusy=false;if(g===generation&&id===draftId)await loadReleases();}catch{if(g===generation)$('draftStatus').textContent='تعذر الرجوع؛ راجع حالة الإصدار.';}finally{draftBusy=false;}};row.append(b);
      }
      box.append(row);
    }
    if(!result.releases.length)box.textContent='لا توجد إصدارات محفوظة.';
  }catch{if(g===generation)$('draftStatus').textContent='تعذر قراءة سجل الإصدارات.';}
}
function canEditDraft(){return !!identity?.permissions.includes('curriculum:edit')&&!draftBusy&&draftState==='draft';}
function confirmDiscard(){return !$('draftJson').value||$('draftJson').value===draftBaseline||confirm('توجد تغييرات غير محفوظة. هل تريد فتح مسودة أخرى؟');}
function renderEditor(){
  renderWorkflow();
  $('draftPreview').hidden=true;$('draftSample').replaceChildren();
  if(!$('draftJson').value){$('visualEditor').replaceChildren();return;}
  window.LoloCmsEditor.mount($('visualEditor'),{
    read:()=>JSON.parse($('draftJson').value),
    write:data=>{$('draftJson').value=JSON.stringify(data,null,2);},
    library:()=>entries,
    editable:canEditDraft,
    preview:a=>{
      if(!identity?.permissions.includes('curriculum:read'))return;
      $('draftPreview').hidden=false;
      if(!window.LoloActivities?.render(a,$('draftSample')))$('draftSample').textContent='راجع إعدادات النشاط قبل المعاينة.';
      $('draftPreview').scrollIntoView({block:'nearest'});
    }
  });
}
$('closeDraftPreview').onclick=()=>{$('draftPreview').hidden=true;$('draftSample').replaceChildren();};
function setDraft(data){
  draftId=data?.id||null;draftRevision=data?.revision||0;draftState=data?.status||'draft';
  $('draftJson').value=JSON.stringify(data?.content||{schemaVersion:1,subjectId:'science',gradeId:'grade-1',title:'مسودة علوم',units:[{id:'unit-1',title:'النباتات',lessons:[{id:'lesson-1',title:'احتياجات النبات',goal:'التعرف على احتياجات النبات',activities:[{id:'activity-1',type:'true-false',version:1,prompt:'النبات يحتاج الماء.',config:{answer:true}}]}]}]},null,2);
  draftBaseline=$('draftJson').value;renderEditor();
}
async function loadDrafts(){
  const g=generation;
  const data=await api('/api/drafts');if(g!==generation)return;
  $('draftList').replaceChildren();
  for(const d of data.drafts){
    const btn=document.createElement('button');btn.textContent=d.title+' · v'+d.revision+' · '+(d.status||'draft');
    btn.onclick=async()=>{const current=generation;try{if($('draftEditor').hidden||draftBusy||!confirmDiscard())return;draftBusy=true;try{const item=await api('/api/draft/read',{id:d.id});if(current===generation){draftBusy=false;setDraft(item);}}finally{draftBusy=false;}}catch{$('draftStatus').textContent='تعذر فتح المسودة.';}};
    $('draftList').append(btn);
  }
}
$('draftNav').onclick=()=>$('drafts').scrollIntoView({block:'start'});
$('newDraft').onclick=()=>{if(draftBusy||!identity?.permissions.includes('curriculum:edit')||!confirmDiscard())return;setDraft(null);$('draftStatus').textContent='مسودة جديدة غير محفوظة.';};
async function draftAction(save){
  if(!canEditDraft())return;
  draftBusy=true;$('visualEditor').disabled=true;const g=generation;
  const buttons=[$('checkDraft'),$('saveDraft'),$('newDraft')];buttons.forEach(b=>b.disabled=true);
  try{
    const content=JSON.parse($('draftJson').value);
    const result=await api(save?'/api/draft/save':'/api/draft/check',save?{id:draftId,revision:draftRevision,content}:{content});
    if(g!==generation)return;
    if(save){draftId=result.id;draftRevision=result.revision;draftState=result.status||'draft';draftBaseline=$('draftJson').value;$('draftStatus').textContent='تم حفظ المسودة · إصدار '+draftRevision;await loadDrafts();renderWorkflow();}
    else $('draftStatus').textContent=result.valid?'المحتوى متوافق مع المحرك الحالي؛ لم يُنشر.':result.issues.map(i=>i.code+' — '+i.path).join('\n');
  }catch(e){
    if(g!==generation)return;
    if(e.status===401||e.status===403){await refresh();return;}
    $('draftStatus').textContent=e.status===409?'تم تعديل المسودة من حساب آخر. افتح أحدث نسخة؛ التغييرات المحلية لم تُحفظ.':e.details?.validation?.issues?.map(i=>i.code+' — '+i.path).join('\n')||'تعذر تنفيذ الطلب أو صيغة JSON غير صحيحة.';
  }finally{draftBusy=false;$('visualEditor').disabled=false;buttons.forEach(b=>b.disabled=false);}
}
$('checkDraft').onclick=()=>draftAction(false);$('saveDraft').onclick=()=>draftAction(true);
function clearBilling(){
  clearRemoteConfig();
  $('discountSecret').textContent='';$('discountCampaign').value='';$('discountHistory').replaceChildren();
  clearGrant();$('trialSecret').textContent='';$('trialCampaign').value='';$('trialHistory').replaceChildren();
  $('billingNav').hidden=true;$('billingPanel').hidden=true;$('billingPlans').replaceChildren();$('billingHistory').replaceChildren();$('billingStatus').textContent='';
}
let grantPreview=null,grantBusy=false;
function clearGrant(){grantPreview=null;$('grantEmail').value='';$('grantState').textContent='';for(const id of ['grantCreate','grantExtend','grantRevoke'])$(id).disabled=true;}
async function grantTask(fn){if(grantBusy||!identity?.permissions.includes('billing:manage'))return;const g=generation;grantBusy=true;try{await fn(g);}catch(e){if(g===generation)$('billingStatus').textContent=e.status===409?'تغيرت الحالة أو يوجد اشتراك نشط. أعد البحث.':'تعذر تنفيذ العملية التجريبية.';}finally{grantBusy=false;}}
function showGrant(email,result){grantPreview={email,revision:result.grant?.revision||0};$('grantState').textContent=result.grant?JSON.stringify(result.grant):'لا يوجد تفعيل يدوي سابق.';$('grantCreate').disabled=result.active;$('grantExtend').disabled=!result.grant||!!result.grant.revokedAt||Date.parse(result.grant.endsAt)<=Date.now();$('grantRevoke').disabled=$('grantExtend').disabled;if(result.grant)$('grantPlan').value=result.grant.planId;}
$('grantEmail').oninput=()=>{grantPreview=null;for(const id of ['grantCreate','grantExtend','grantRevoke'])$(id).disabled=true;$('grantState').textContent='';};
$('grantLookup').onclick=()=>grantTask(async g=>{const email=$('grantEmail').value.trim();const result=await api('/api/billing/grant/read',{email});if(g===generation&&email===$('grantEmail').value.trim())showGrant(email,result);});
for(const [id,action] of [['grantCreate','grant'],['grantExtend','extend'],['grantRevoke','revoke']])$(id).onclick=()=>grantTask(async g=>{const p=grantPreview;if(!p||p.email!==$('grantEmail').value.trim()||!confirm('تأكيد إجراء الاشتراك التجريبي؟'))return;await api('/api/billing/grant/change',{email:p.email,action,planId:action==='revoke'?null:$('grantPlan').value,days:action==='revoke'?0:Number($('grantDays').value),revision:p.revision});const r=await api('/api/billing/grant/read',{email:p.email});if(g===generation&&p.email===$('grantEmail').value.trim())showGrant(p.email,r);});
$('trialCreate').onclick=()=>grantTask(async g=>{if(!confirm('إنشاء كود تجربة؟ سيظهر الكود مرة واحدة.'))return;const r=await api('/api/billing/coupon/create',{campaign:$('trialCampaign').value,planId:$('trialPlan').value,days:Number($('trialDays').value),maxUses:Number($('trialUses').value),validDays:Number($('trialValidity').value)});if(g===generation)$('trialSecret').textContent=r.code;});
$('trialList').onclick=()=>grantTask(async g=>{const r=await api('/api/billing/coupons');if(g!==generation)return;$('trialHistory').replaceChildren();for(const c of r.coupons){const row=document.createElement('p');row.textContent=c.campaign+' · '+c.planId+' · '+c.used+'/'+c.maxUses+' · '+(c.enabled?'متاح':'متوقف')+' ';if(c.enabled){const b=document.createElement('button');b.textContent='إيقاف الكود';b.onclick=()=>grantTask(async current=>{if(!confirm('إيقاف الكود؟'))return;await api('/api/billing/coupon/disable',{id:c.id});if(current===generation){b.disabled=true;row.append(document.createTextNode(' تم الإيقاف'));}});row.append(b);}$('trialHistory').append(row);}});
$('discountCreate').onclick=()=>grantTask(async g=>{if(!confirm('إنشاء كوبون خصم تجريبي؟ سيظهر الكود مرة واحدة.'))return;const r=await api('/api/billing/discount/create',{campaign:$('discountCampaign').value,planId:$('discountPlan').value,period:$('discountPeriod').value,kind:$('discountKind').value,value:Number($('discountValue').value),maxUses:Number($('discountUses').value),validDays:Number($('discountValidity').value)});if(g===generation)$('discountSecret').textContent=r.code;});
$('discountList').onclick=()=>grantTask(async g=>{const r=await api('/api/billing/discounts');if(g!==generation)return;$('discountHistory').replaceChildren();for(const c of r.discounts){const row=document.createElement('p');row.textContent=c.campaign+' · '+c.planId+' · '+c.period+' · '+c.reservedOrUsed+'/'+c.maxUses+' · '+(c.enabled?'متاح':'متوقف')+' ';if(c.enabled){const b=document.createElement('button');b.textContent='إيقاف';b.onclick=()=>grantTask(async current=>{if(!confirm('إيقاف الكوبون؟'))return;await api('/api/billing/discount/disable',{id:c.id});if(current===generation){b.disabled=true;row.append(document.createTextNode(' تم الإيقاف'));}});row.append(b);}$('discountHistory').append(row);}});
let remoteRevision=null,remoteBusy=false;
const remoteFlags={onlineMaintenance:'remoteMaintenance',voice:'remoteVoice',pronunciation:'remotePronunciation',cloudSync:'remoteCloud',homework:'remoteHomework'};
function clearRemoteConfig(){remoteRevision=null;$('remoteConfigPanel').hidden=true;$('remoteConfigFields').disabled=true;$('remoteConfigLog').replaceChildren();$('remoteConfigStatus').textContent='';$('remoteMessage').value='';for(const id of Object.values(remoteFlags))$(id).checked=false;$('remoteMinimum').value='';$('remoteRecommended').value='';}
function renderRemoteConfig(r){if(r.testOnly!==true||!Number.isInteger(r.revision))throw Error('Invalid configuration');remoteRevision=r.revision;for(const [key,id] of Object.entries(remoteFlags))$(id).checked=r.policy[key]===true;$('remoteMinimum').value=r.policy.minimumAndroidVersionCode;$('remoteRecommended').value=r.policy.recommendedAndroidVersionCode;$('remoteMessage').value=r.policy.message;$('remoteConfigFields').disabled=false;$('remoteConfigStatus').textContent='إصدار الإعدادات: '+r.revision;}
async function remoteTask(fn){if(remoteBusy||!identity?.permissions.includes('settings:manage'))return;const g=generation;remoteBusy=true;$('remoteConfigFields').disabled=true;try{await fn(g);}catch(e){if(g===generation){remoteRevision=null;$('remoteConfigStatus').textContent=e.status===409?'الإعدادات تغيرت؛ حمّل النسخة الأحدث.':'تعذر تنفيذ طلب الإعدادات التجريبية.';}}finally{remoteBusy=false;if(g===generation)$('remoteConfigFields').disabled=remoteRevision===null;}}
$('remoteConfigRead').onclick=()=>remoteTask(async g=>{const r=await api('/api/settings/config');if(g===generation)renderRemoteConfig(r);});
$('remoteConfigSave').onclick=()=>{if(remoteRevision===null||!confirm('حفظ إعدادات بيئة الاختبار فقط؟'))return;const policy=Object.fromEntries(Object.entries(remoteFlags).map(([k,id])=>[k,$(id).checked]));Object.assign(policy,{minimumAndroidVersionCode:Number($('remoteMinimum').value),recommendedAndroidVersionCode:Number($('remoteRecommended').value),message:$('remoteMessage').value});const revision=remoteRevision;remoteTask(async g=>{const r=await api('/api/settings/config',{revision,policy});if(g===generation)renderRemoteConfig(r);});};
$('remoteConfigHistory').onclick=()=>remoteTask(async g=>{const r=await api('/api/settings/config/history');if(g!==generation||r.testOnly!==true)return;$('remoteConfigLog').replaceChildren();for(const c of r.changes){const pre=document.createElement('pre');pre.textContent='إصدار '+c.revision+' · '+c.changedAt+'\n'+JSON.stringify(c.after,null,2);$('remoteConfigLog').append(pre);}});
let billingBusy=false;
const billingFields=[['monthlyMinor','السعر الشهري (قرش)',0,100000000],['yearlyMinor','السعر السنوي (قرش)',0,100000000],['childLimit','عدد الطلاب',1,12],['voiceSecondsMonthly','ثواني المحادثة شهريًا',0,360000],['pronunciationAttemptsMonthly','محاولات النطق شهريًا',0,10000]];
async function loadBilling(){
  if(billingBusy||!identity?.permissions.includes('billing:manage'))return;
  const g=generation;billingBusy=true;$('billingRefresh').disabled=true;
  $('billingPlans').replaceChildren();$('billingHistory').replaceChildren();
  try{
    const data=await api('/api/billing/plans');if(g!==generation)return;
    for(const plan of data.plans){
      const form=document.createElement('form'),heading=document.createElement('h3');heading.textContent=plan.id.toUpperCase()+' · '+(plan.monthlyMinor/100)+' ج.م / شهر';form.append(heading);
      const inputs={};
      for(const [key,label,min,max] of billingFields){const l=document.createElement('label'),el=document.createElement('input');l.textContent=label;el.type='number';el.min=min;el.max=max;el.step=1;el.required=true;el.value=plan[key];l.append(el);form.append(l);inputs[key]=el;}
      const label=document.createElement('label'),enabled=document.createElement('input');enabled.type='checkbox';enabled.checked=plan.enabled;label.append(enabled,document.createTextNode('إتاحة الباقة للشراء'));form.append(label);
      const button=document.createElement('button');button.type='submit';button.textContent='حفظ الباقة';form.append(button);
      form.onsubmit=async e=>{e.preventDefault();if(g!==generation||billingBusy||!identity?.permissions.includes('billing:manage')||!confirm('حفظ إعدادات الباقة التجريبية؟'))return;const values={enabled:enabled.checked};for(const key of Object.keys(inputs)){if(!inputs[key].value)return;values[key]=Number(inputs[key].value);}
        billingBusy=true;button.disabled=true;try{await api('/api/billing/plan',{planId:plan.id,revision:plan.revision,values});if(g===generation){billingBusy=false;await loadBilling();$('billingStatus').textContent='تم حفظ الباقة التجريبية.';}}catch(err){if(g===generation)$('billingStatus').textContent=err.status===409?'تغيرت الباقة. حدّث القائمة قبل الحفظ.':'تعذر حفظ الباقة.';}finally{billingBusy=false;button.disabled=false;}};
      $('billingPlans').append(form);
    }
    const h=await api('/api/billing/history');if(g!==generation)return;
    for(const item of h.changes){const row=document.createElement('p');row.textContent=item.planId+' · '+item.changedAt+' · '+item.actorId+' · '+JSON.stringify(item.before)+' ← '+JSON.stringify(item.after);$('billingHistory').append(row);}
    $('billingStatus').textContent='تم تحميل إعدادات الاختبار.';
  }catch(err){if(g===generation)$('billingStatus').textContent=err.status===503?'إدارة الاشتراكات التجريبية غير مفعّلة.':'تعذر تحميل الباقات.';}
  finally{billingBusy=false;$('billingRefresh').disabled=false;}
}
$('billingRefresh').onclick=loadBilling;$('billingNav').onclick=()=>$('billingPanel').scrollIntoView({block:'start'});
async function refresh(){
  const g=++generation;
  try{
    const current=await api('/api/session');if(g!==generation)return;
    $('preview').hidden=true;$('sample').replaceChildren();
    identity=current;$('login').hidden=true;$('workspace').hidden=false;$('logout').hidden=false;$('message').textContent='';
    $('role').textContent='ROLE / '+current.role;
    clearBilling();$('billingPanel').hidden=!current.permissions.includes('billing:manage');$('billingNav').hidden=$('billingPanel').hidden;
  $('remoteConfigPanel').hidden=!identity?.permissions.includes('settings:manage');
    const canRead=current.permissions.includes('curriculum:read'),canEdit=current.permissions.includes('curriculum:edit');
    $('drafts').hidden=!canRead;$('draftNav').hidden=!canRead;$('draftEditor').hidden=!canRead;$('draftJson').readOnly=!canEdit;$('newDraft').hidden=!canEdit;$('checkDraft').hidden=!canEdit;$('saveDraft').hidden=!canEdit;
    if(!canRead)clearDrafts();
    else{if(!canEdit){$('draftJson').value='';draftBaseline='';draftId=null;draftRevision=0;renderEditor();}else if(!$('draftJson').value)setDraft(null);await loadDrafts();if(g!==generation)return;}
    const allowed=current.permissions.includes('library:read');
    $('library').hidden=!allowed;$('libraryNav').hidden=!allowed;
    if(!allowed){entries=[];$('cards').replaceChildren();$('sample').replaceChildren();return;}
    const result=await api('/api/library');if(g!==generation)return;
    await loadEngine();if(g!==generation)return;
    entries=result.activities;
    $('total').textContent=entries.length;$('implemented').textContent=entries.filter(e=>e.status==='implemented').length;$('planned').textContent=entries.filter(e=>e.status==='planned').length;
    $('category').replaceChildren(new Option('كل الأقسام',''));
    for(const [id,label] of new Map(entries.map(e=>[e.category,e.categoryLabel])))$('category').append(new Option(label,id));
    render();renderEditor();
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
