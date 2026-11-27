(() => {
  const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  const tokenPattern=/^[A-Za-z0-9_-]{43}$/;
  const bands=new Set(['4-6','7-9','10-12','13-17','unspecified']);
  function create(request,{allowed=()=>false,now=Date.now,randomId=()=>crypto.randomUUID(),queueStore=null}={}){
    let generation=0,session=null,controller=null,busy=false,children=[],preview=null;
    function clear(){
      generation++;controller?.abort();controller=null;session=null;children=[];preview=null;busy=false;
    }
    function live(){return allowed()&&session&&session.expires>now();}
    function state(){return {signedIn:!!live(),busy,children:live()?children.map(c=>({...c})):[],preview:live()&&preview?JSON.parse(JSON.stringify(preview)):null};}
    const fail=(message,status)=>Object.assign(new Error(message),{status});
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
      if(!children.some(c=>c.id===childId)||!localProfileId||!snapshot)throw fail('اختاري ملفًا صالحًا.');
      preview=null;
      const data=await call({action:'readProgress',childId});
      if(!Number.isSafeInteger(data?.revision)||data.revision<0||(data.revision===0?data.snapshot!==null:!data.snapshot||typeof data.snapshot!=='object'))throw fail('استجابة المزامنة غير صالحة.');
      preview={childId,localProfileId,revision:data.revision,remote:data.snapshot,local:JSON.parse(JSON.stringify(snapshot)),operationId:randomId()};
      return state();
    }
    function queued(){
      try{
        const q=queueStore?.read();
        if(!q||q.version!==1||!uuid.test(q.parentId)||!uuid.test(q.childId)||!uuid.test(q.operationId)||typeof q.localProfileId!=='string'||q.baseRevision!==0||!q.snapshot||!['pending','conflict'].includes(q.status))return null;
        return q;
      }catch{return null;}
    }
    function pending(){
      const q=queued();
      if(!q)return null;
      const authorized=!!live()&&session.parentId===q.parentId&&children.some(c=>c.id===q.childId);
      return {status:q.status,authorized,localProfileId:q.localProfileId};
    }
    function discard(){
      if(!allowed()||busy)return false;
      return queueStore?.remove()===true;
    }
    async function sendQueued(q,localProfileId,snapshot){
      if(!live()||session.parentId!==q.parentId||!children.some(c=>c.id===q.childId)||q.localProfileId!==localProfileId||JSON.stringify(snapshot)!==JSON.stringify(q.snapshot)||q.status!=='pending')throw fail('الطلب المحفوظ يحتاج مراجعة الحساب والملف والتقدم.',409);
      try{
        const result=await call({action:'writeProgress',childId:q.childId,baseRevision:0,operationId:q.operationId,snapshot:q.snapshot});
        if(result?.revision!==1)throw fail('تعذر تأكيد الحفظ.');
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
      if(!p||p.localProfileId!==localProfileId||JSON.stringify(snapshot)!==JSON.stringify(p.local)||!children.some(c=>c.id===p.childId))throw fail('التقدم المحلي تغيّر. اعملي معاينة جديدة.');
      // Initial backup only: never overwrite an existing remote snapshot in this milestone.
      if(p.revision!==0)throw fail('في نسخة محفوظة بالفعل. الاستبدال غير متاح في النسخة التجريبية.',409);
      if(!live()||busy)throw fail('سجّلي الدخول من جديد.',401);
      if(queued())throw fail('في طلب محفوظ بالفعل. راجعيه قبل إنشاء طلب جديد.',409);
      const q={version:1,parentId:session.parentId,childId:p.childId,localProfileId,baseRevision:0,operationId:p.operationId,snapshot:p.local,status:'pending'};
      if(queueStore&&!queueStore.write(q))throw fail('تعذر حفظ الطلب محليًا. لم يُرسل.');
      return sendQueued(q,localProfileId,snapshot);
    }
    async function logout(){try{if(live())await call({action:'logout'});}finally{clear();}}
    return Object.freeze({state,clear,login,list,add,compare,upload,pending,resume,discard,logout});
  }
  const api=Object.freeze({create});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(typeof window!=='undefined')window.LoloFamilyClient=api;
})();
