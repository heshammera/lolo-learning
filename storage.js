(() => {
  let warningSent = false;

  function warn(message) {
    if (warningSent || typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    warningSent = true;
    queueMicrotask(() => window.dispatchEvent(new CustomEvent('lolo-storage-warning', {detail: message})));
  }

  const PROFILE_KEY='lolo-local-profiles-v1';
  const LEGACY='default';
  const SCOPED=new Set(['lolo-current-lesson','lolo-explicit-lesson-choice','lolo-grade-id','lolo-lesson-excellence','lolo-lesson-stats','lolo-mastered','lolo-onboarding-complete','lolo-parent-settings','lolo-path-program','lolo-selected-program','lolo-skill-progress-v1','lolo-test-results','lolo-trace-results','lolo-welcome-tour-v1-complete','lolo-writing-path-overrides','lolo-writing-path-results','lolo-learning-path-v1','lolo-visual-assessment-v1','lolo-pending-cloud-backup-v1','lolo-cloud-profile-link-v1','lolo-extra-practice-v1','lolo-learning-reminder-dismissed-day-v1']);
  const idValid=id=>id===LEGACY||(typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id));
  const nameValid=name=>typeof name==='string'&&name.trim().length>=1&&name.trim().length<=40&&!/[\p{C}]/u.test(name);
  function readProfiles(){
    try{
      const raw=window.localStorage.getItem(PROFILE_KEY);
      if(raw===null)return {raw,record:{version:1,activeId:LEGACY,profiles:[{id:LEGACY,name:'ملف التعلم الأول'}]}};
      const r=JSON.parse(raw);
      if(r?.version!==1||!Array.isArray(r.profiles)||r.profiles.length<1||r.profiles.length>12||!r.profiles.every(p=>idValid(p?.id)&&nameValid(p.name))||new Set(r.profiles.map(p=>p.id)).size!==r.profiles.length||!r.profiles.some(p=>p.id===LEGACY)||!r.profiles.some(p=>p.id===r.activeId))throw Error('Invalid registry');
      return {raw,record:r};
    }catch{warn('ملفات التعلم محتاجة مراجعة. البيانات الأصلية محفوظة، ولم نفتح ملفًا آخر تلقائيًا.');return null;}
  }
  // Pin the namespace to the document lifetime, so late callbacks cannot write to another child.
  const initial=readProfiles();
  const activeId=initial?.record.activeId||null;
  function physicalKey(key){
    if(!SCOPED.has(key))return key;
    if(!activeId)return null;
    return activeId===LEGACY?key:'lolo-profile:'+activeId+':'+key;
  }
  function mutateProfiles(operation){
    const current=readProfiles();
    if(!current||!activeId||current.record.activeId!==activeId)return false;
    try{
      const next=operation(current.record);
      if(!next||window.localStorage.getItem(PROFILE_KEY)!==current.raw)return false;
      window.localStorage.setItem(PROFILE_KEY,JSON.stringify(next));
      return true;
    }catch{warn('ماقدرناش نحفظ ملفات التعلم على الجهاز.');return false;}
  }
  const profiles=Object.freeze({
    key:PROFILE_KEY,activeId,
    list:()=>readProfiles()?.record.profiles.map(p=>({...p}))||[],
    current:()=>readProfiles()?.record.profiles.find(p=>p.id===activeId)||null,
    selectedId:()=>readProfiles()?.record.activeId||null,
    create(name){
      if(!nameValid(name))return false;
      return mutateProfiles(r=>{
        if(r.profiles.length>=12)return null;
        const id=window.crypto.randomUUID();
        return {...r,profiles:[...r.profiles,{id,name:name.trim()}]};
      });
    },
    importCopy(name,entries){
      if(!nameValid(name)||!entries||typeof entries!=='object'||Array.isArray(entries))return false;
      const allowed=new Set(['lolo-mastered','lolo-learning-path-v1','lolo-selected-program','lolo-grade-id','lolo-current-lesson','lolo-welcome-tour-v1-complete']);
      if(!Object.keys(entries).length||!Object.entries(entries).every(([key,value])=>allowed.has(key)&&typeof value==='string'&&value.length<=32768))return false;
      const current=readProfiles();
      if(!current||current.record.activeId!==activeId||current.record.profiles.length>=12)return false;
      const id=window.crypto.randomUUID(), written=[];
      try{
        for(const [key,value] of Object.entries(entries)){
          const full='lolo-profile:'+id+':'+key;
          if(window.localStorage.getItem(full)!==null)throw Error('Profile collision');
          window.localStorage.setItem(full,value);written.push(full);
        }
        if(window.localStorage.getItem(PROFILE_KEY)!==current.raw)throw Error('Profile registry changed');
        // Publish registry only after all new keys were written. No existing profile keys are modified.
        window.localStorage.setItem(PROFILE_KEY,JSON.stringify({...current.record,profiles:[...current.record.profiles,{id,name:name.trim()}]}));
        return id;
      }catch{
        for(const key of written){try{window.localStorage.removeItem(key);}catch{}}
        warn('تعذر استعادة النسخة على الجهاز. الملفات الموجودة لم تتغير.');return false;
      }
    },
    rename(id,name){
      if(!nameValid(name))return false;
      return mutateProfiles(r=>r.profiles.some(p=>p.id===id)?{...r,profiles:r.profiles.map(p=>p.id===id?{...p,name:name.trim()}:p)}:null);
    },
    select(id){
      return mutateProfiles(r=>r.profiles.some(p=>p.id===id)?{...r,activeId:id}:null);
    },
  });
  function get(key) {
    key=physicalKey(key);if(key===null)return null;
    try { return window.localStorage.getItem(key); }
    catch { warn('الحفظ على الجهاز مش متاح دلوقتي؛ ممكن التقدم مايتحفظش.'); return null; }
  }

  function getJSON(key, fallback) {
    const raw = get(key);
    if (raw === null) return fallback;
    try {
      const value = JSON.parse(raw);
      const valid = Array.isArray(fallback)
        ? Array.isArray(value)
        : !!value && typeof value === 'object' && !Array.isArray(value);
      if (valid) return value;
    } catch {}
    warn('في بيانات محفوظة محتاجة مراجعة؛ فتحنا التطبيق بالبيانات السليمة الموجودة.');
    return fallback;
  }

  function set(key, value) {
    key=physicalKey(key);if(key===null)return false;
    try { window.localStorage.setItem(key, String(value)); return true; }
    catch { warn('ماقدرناش نحفظ التقدم على الجهاز. فضّي مساحة أو راجعي إعدادات المتصفح.'); return false; }
  }

  function remove(key) {
    key=physicalKey(key);if(key===null)return false;
    try { window.localStorage.removeItem(key); return true; }
    catch { warn('ماقدرناش نحدّث البيانات المحفوظة على الجهاز.'); return false; }
  }

  window.LoloStorage = Object.freeze({get, getJSON, set, remove, profiles});
})();
