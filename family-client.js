(() => {
  const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  const tokenPattern=/^[A-Za-z0-9_-]{43}$/;
  const bands=new Set(['4-6','7-9','10-12','13-17','unspecified']);
  const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
  const validSnapshot=s=>plain(s)&&Object.keys(s).sort().join(',')==='completedLessonIds,curriculumVersion,path,schemaVersion'&&s.schemaVersion===1&&typeof s.curriculumVersion==='string'&&s.curriculumVersion.length>0&&s.curriculumVersion.length<=100&&Array.isArray(s.completedLessonIds)&&s.completedLessonIds.length<=2000&&s.completedLessonIds.every(id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(id))&&new Set(s.completedLessonIds).size===s.completedLessonIds.length&&(s.path===null||plain(s.path));
  const clone=v=>JSON.parse(JSON.stringify(v));
  function mergeSnapshots(local,remote){
    if(!validSnapshot(local)||!validSnapshot(remote)||local.curriculumVersion!==remote.curriculumVersion)return null;
    // Union only. Retain the remote path exactly, including null. Local path remains on device.
    const completedLessonIds=[...new Set([...local.completedLessonIds,...remote.completedLessonIds])].sort();
    if(completedLessonIds.length>2000)return null;
    return {schemaVersion:1,curriculumVersion:local.curriculumVersion,completedLessonIds,path:clone(remote.path)};
  }
  function create(request,{allowed=()=>false,now=Date.now,randomId=()=>crypto.randomUUID(),queueStore=null,linkStore=null}={}){
    let generation=0,session=null,controller=null,busy=false,children=[],preview=null;
    function clear(){
      generation++;controller?.abort();controller=null;session=null;children=[];preview=null;busy=false;
    }
    function live(){return allowed()&&session&&session.expires>now();}
    function state(){return {signedIn:!!live(),busy,children:live()?children.map(c=>({...c})):[],preview:live()&&preview?JSON.parse(JSON.stringify(preview)):null};}
    const fail=(message,status)=>Object.assign(new Error(message),{status});
    function readLink(){
      if(!linkStore)return {valid:true,value:null};
      try{
        const raw=linkStore.read();
        if(raw===null)return {valid:true,value:null};
        if(!plain(raw)||Object.keys(raw).sort().join(',')!=='childId,localProfileId,parentId,retryApproved,version'||raw.version!==1||!uuid.test(raw.parentId)||!uuid.test(raw.childId)||typeof raw.localProfileId!=='string'||!raw.localProfileId||typeof raw.retryApproved!=='boolean')return {valid:false,value:null};
        return {valid:true,value:clone(raw)};
      }catch{return {valid:false,value:null};}
    }
    function linkState(localProfileId){
      const link=readLink();
      const value=link.value;
      const authorized=!!(value&&live()&&value.localProfileId===localProfileId&&value.parentId===session.parentId&&children.some(c=>c.id===value.childId));
      return {valid:link.valid,linked:!!value,authorized,childId:authorized?value.childId:null,retryApproved:authorized&&value.retryApproved};
    }
    function permittedTarget(childId,localProfileId){
      const link=readLink(),value=link.value;
      return link.valid&&(!value||!!(live()&&value.parentId===session.parentId&&value.childId===childId&&value.localProfileId===localProfileId));
    }
    function link(childId,localProfileId,retryApproved=false){
      if(!linkStore||!live()||busy||!children.some(c=>c.id===childId)||typeof localProfileId!=='string'||!localProfileId||typeof retryApproved!=='boolean'||queued())return false;
      const prior=readLink();
      if(!prior.valid||prior.value)return false;
      if(!linkStore.write({version:1,parentId:session.parentId,childId,localProfileId,retryApproved}))return false;
      preview=null;return true;
    }
    function unlink(localProfileId){
      if(!linkStore||!live()||busy||queued()||!linkState(localProfileId).authorized)return false;
      if(!linkStore.remove())return false;
      preview=null;return true;
    }
    async function retryLinked(localProfileId,snapshot){
      // Only an already approved durable request, never a new upload.
      const link=linkState(localProfileId),q=queued();
      if(!link.authorized||!link.retryApproved||!q||q.status!=='pending'||q.childId!==link.childId||q.localProfileId!==localProfileId||JSON.stringify(snapshot)!==JSON.stringify(q.version===2?q.localSnapshot:q.snapshot))return false;
      await sendQueued(q,localProfileId,snapshot);return true;
    }
    async function call(body,requiresSession=true){
      if(!allowed()||busy)throw fail('افتحي لوحة ولي الأمر أولًا.');
      if(requiresSession&&!live()){clear();throw fail('سجّلي الدخول من جديد.',401);}
      const g=generation,abort=new AbortController();controller=abort;busy=true;
      try{
        const headers={'Content-Type':'application/json'};
        if(requiresSession)headers.Authorization='Bearer '+session.token;
        const response=await request('/api/family',{method:'POST',headers,body:JSON.stringify(body),signal:abort.signal});
        if(g!==generation||!allowed())throw fail('انتهت صلاحية لوحة ولي الأمر.');
        if(response.status===401){clear();throw fail('بيانات الدخول غير صحيحة أو انتهت الجلسة.',401);}
        if(!response.ok)throw fail(response.status===409?'التقدم اتغيّر على جهاز آخر. راجعي النسخة الأحدث.':'تعذر تنفيذ الطلب الآن.',response.status);
        const data=await response.json();
        if(g!==generation||!allowed())throw fail('انتهت صلاحية لوحة ولي الأمر.');
        return data;
      }finally{if(g===generation){busy=false;controller=null;}}
    }
    async function login(email,password){
      if(busy)throw fail('استني انتهاء الطلب الحالي.');
      clear();const g=generation;
      const result=await call({action:'login',email,password},false);
      if(g!==generation||!allowed())throw fail('اتقفلت لوحة ولي الأمر.');
      const expires=Date.parse(result?.expiresAt);
      if(!tokenPattern.test(result?.token||'')||!uuid.test(result?.parentId||'')||!Number.isFinite(expires)||expires<=now())throw fail('استجابة الدخول غير صالحة.');
      session={token:result.token,expires,parentId:result.parentId};return state();
    }
    async function list(){
      const result=await call({action:'children'});
      if(!Array.isArray(result?.children)||result.children.length>12||!result.children.every(c=>uuid.test(c?.id||'')&&typeof c.nickname==='string'&&c.nickname.length<=40&&bands.has(c.ageBand))||new Set(result.children.map(c=>c.id)).size!==result.children.length)throw fail('تعذر قراءة ملفات الحساب.');
      children=result.children.map(c=>({id:c.id,nickname:c.nickname,ageBand:c.ageBand}));preview=null;return state();
    }
    async function add(nickname,ageBand){
      if(typeof nickname!=='string'||!nickname.trim()||nickname.trim().length>40||!bands.has(ageBand))throw fail('راجعي الاسم المستعار والفئة العمرية.');
      await call({action:'createChild',nickname:nickname.trim(),ageBand});return list();
    }
    async function compare(childId,localProfileId,snapshot){
      if(!children.some(c=>c.id===childId)||!localProfileId||!snapshot||!permittedTarget(childId,localProfileId))throw fail('اختاري ملفًا صالحًا.');
      preview=null;
      const data=await call({action:'readProgress',childId});
      if(!Number.isSafeInteger(data?.revision)||data.revision<0||(data.revision===0?data.snapshot!==null:!data.snapshot||typeof data.snapshot!=='object'))throw fail('استجابة المزامنة غير صالحة.');
      preview={childId,localProfileId,revision:data.revision,remote:data.snapshot,local:clone(snapshot),operationId:randomId(),merged:data.revision>0?mergeSnapshots(snapshot,data.snapshot):null};
      return state();
    }
    function queued(){
      try{
        const q=queueStore?.read();
        if(!q||![1,2].includes(q.version)||!uuid.test(q.parentId)||!uuid.test(q.childId)||!uuid.test(q.operationId)||typeof q.localProfileId!=='string'||!Number.isSafeInteger(q.baseRevision)||q.baseRevision<0||q.baseRevision>=Number.MAX_SAFE_INTEGER-1||!validSnapshot(q.snapshot)||!['pending','conflict'].includes(q.status))return null;
        if(q.version===1&&q.baseRevision!==0)return null;
        if(q.version===2&&(q.baseRevision<1||!validSnapshot(q.localSnapshot)||q.localSnapshot.curriculumVersion!==q.snapshot.curriculumVersion||!q.localSnapshot.completedLessonIds.every(id=>q.snapshot.completedLessonIds.includes(id))))return null;
        return q;
      }catch{return null;}
    }
    function pending(){
      const q=queued();
      if(!q)return null;
      const authorized=!!live()&&session.parentId===q.parentId&&children.some(c=>c.id===q.childId)&&permittedTarget(q.childId,q.localProfileId);
      return {status:q.status,authorized,localProfileId:q.localProfileId,kind:q.version===2?'merge':'initial'};
    }
    function discard(){
      if(!allowed()||busy)return false;
      return queueStore?.remove()===true;
    }
    async function sendQueued(q,localProfileId,snapshot){
      if(!live()||!permittedTarget(q.childId,localProfileId)||session.parentId!==q.parentId||!children.some(c=>c.id===q.childId)||q.localProfileId!==localProfileId||JSON.stringify(snapshot)!==JSON.stringify(q.version===2?q.localSnapshot:q.snapshot)||q.status!=='pending')throw fail('الطلب المحفوظ يحتاج مراجعة الحساب والملف والتقدم.',409);
      try{
        const result=await call({action:'writeProgress',childId:q.childId,baseRevision:q.baseRevision,operationId:q.operationId,snapshot:q.snapshot});
        if(result?.revision!==q.baseRevision+1)throw fail('تعذر تأكيد الحفظ.');
        if(queueStore&&!queueStore.remove())throw fail('تم إرسال الطلب، لكن تعذر تحديث حالة الطابور.');
        preview=null;return result;
      }catch(e){
        if(e.status===409){preview=null;if(queueStore)queueStore.write({...q,status:'conflict'});}
        throw e;
      }
    }
    async function resume(localProfileId,snapshot){
      const q=queued();
      if(!q)throw fail('مفيش طلب محفوظ.');
      return sendQueued(q,localProfileId,snapshot);
    }
    async function upload(localProfileId,snapshot){
      const p=preview;
      if(!p||!permittedTarget(p.childId,localProfileId)||p.localProfileId!==localProfileId||JSON.stringify(snapshot)!==JSON.stringify(p.local)||!children.some(c=>c.id===p.childId))throw fail('التقدم المحلي تغيّر. اعملي معاينة جديدة.');
      // Initial backup only: never overwrite an existing remote snapshot in this milestone.
      if(p.revision!==0)throw fail('في نسخة محفوظة بالفعل. الاستبدال غير متاح في النسخة التجريبية.',409);
      if(!live()||busy)throw fail('سجّلي الدخول من جديد.',401);
      if(queued())throw fail('في طلب محفوظ بالفعل. راجعيه قبل إنشاء طلب جديد.',409);
      const q={version:1,parentId:session.parentId,childId:p.childId,localProfileId,baseRevision:0,operationId:p.operationId,snapshot:p.local,status:'pending'};
      if(queueStore&&!queueStore.write(q))throw fail('تعذر حفظ الطلب محليًا. لم يُرسل.');
      return sendQueued(q,localProfileId,snapshot);
    }
    async function merge(localProfileId,snapshot){
      const p=preview;
      if(!p||!permittedTarget(p.childId,localProfileId)||p.revision<1||!p.merged||p.localProfileId!==localProfileId||JSON.stringify(snapshot)!==JSON.stringify(p.local)||!children.some(c=>c.id===p.childId))throw fail('اعملي معاينة دمج جديدة.',409);
      if(!live()||busy)throw fail('سجّلي الدخول من جديد.',401);
      if(queued())throw fail('راجعي الطلب المحفوظ أولًا.',409);
      if(!queueStore)throw fail('التخزين المحلي غير متاح. لم يُرسل الطلب.');
      const q={version:2,parentId:session.parentId,childId:p.childId,localProfileId,baseRevision:p.revision,operationId:p.operationId,snapshot:clone(p.merged),localSnapshot:clone(p.local),status:'pending'};
      if(!queueStore.write(q))throw fail('تعذر حفظ الطلب محليًا. لم يُرسل.');
      return sendQueued(q,localProfileId,snapshot);
    }
    async function logout(){try{if(live())await call({action:'logout'});}finally{clear();}}
    return Object.freeze({state,clear,login,list,add,compare,upload,merge,pending,resume,discard,logout,link,unlink,linkState,retryLinked});
  }
  const api=Object.freeze({create,mergeSnapshots});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(typeof window!=='undefined')window.LoloFamilyClient=api;
})();
