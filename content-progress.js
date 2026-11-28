/* Bounded local practice checkpoints, never treated as verified mastery. */
(() => {
  const KEY='lolo-extra-practice-v1',MAX=20;
  const runtime=typeof module!=='undefined'&&module.exports?require('./content-runtime.js'):window.LoloContentRuntime;
  const uid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  const id=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
  const copy=x=>JSON.parse(JSON.stringify(x));
  function selection(p,scope,unitId,lessonId){
    if(!p||!uid.test(p.draftId)||!uid.test(p.releaseId)||!Number.isSafeInteger(p.sequence)||p.sequence<1)return null;
    const steps=runtime.plan(p,scope,unitId,lessonId);if(!steps?.length)return null;
    return {draftId:p.draftId,releaseId:p.releaseId,sequence:p.sequence,scope,unitId:scope==='curriculum'?null:unitId,lessonId:scope==='lesson'?lessonId:null};
  }
  const same=(a,b)=>['draftId','releaseId','sequence','scope','unitId','lessonId'].every(k=>a[k]===b[k]);
  const DAY=86400000,INTERVALS=[1,3,7,14,30];
  const timestamp=t=>Number.isSafeInteger(t)&&t>=0&&t<=8640000000000000-30*DAY;
  function validSchedule(s){
    return s&&Object.keys(s).sort().join(',')==='completedAt,dueAt,intervalDays'&&timestamp(s.completedAt)&&INTERVALS.includes(s.intervalDays)&&s.dueAt===s.completedAt+s.intervalDays*DAY;
  }
  function schedule(previous,report,now){
    if(!report||report.status!=='complete'||!report.graded||!timestamp(now))return previous||null;
    if(previous&&now<previous.completedAt)return previous;
    const strong=report.lessons.every(l=>l.incorrect===0);
    if(strong&&previous&&now<previous.dueAt)return previous;
    const intervalDays=strong&&previous?INTERVALS[Math.min(INTERVALS.indexOf(previous.intervalDays)+1,INTERVALS.length-1)]:1;
    return {completedAt:now,dueAt:now+intervalDays*DAY,intervalDays};
  }
  function validEntry(e){
    return e&&uid.test(e.draftId)&&uid.test(e.releaseId)&&Number.isSafeInteger(e.sequence)&&e.sequence>0&&['lesson','unit','curriculum'].includes(e.scope)&&
      (e.scope==='curriculum'?e.unitId===null:typeof e.unitId==='string'&&id.test(e.unitId))&&
      (e.scope==='lesson'?typeof e.lessonId==='string'&&id.test(e.lessonId):e.lessonId===null)&&
      Array.isArray(e.results)&&e.results.length<=7500&&e.results.every(r=>r&&typeof r.activityId==='string'&&id.test(r.activityId)&&['correct','incorrect','completed'].includes(r.status)&&Object.keys(r).length===2)&&
      Number.isInteger(e.total)&&e.total>=1&&e.total<=7500&&e.results.length<=e.total&&(!Object.hasOwn(e,'reviewSchedule')||validSchedule(e.reviewSchedule));
  }
  function create(storage,{now=Date.now}={}){
    const pinned=storage.profiles.activeId;
    const allowed=()=>!!pinned&&storage.profiles.selectedId()===pinned;
    function read(){
      if(!allowed())return null;
      try{
        const raw=storage.get(KEY);
        if(raw===null)return {version:1,entries:[]};
        const value=JSON.parse(raw);
        if(value?.version!==1||!Array.isArray(value.entries)||value.entries.length>MAX||!value.entries.every(validEntry)||value.entries.some((e,i)=>value.entries.slice(0,i).some(x=>same(x,e))))return null;
        return value;
      }catch{return null;}
    }
    function load(p,scope,unitId,lessonId){
      const key=selection(p,scope,unitId,lessonId),data=read();
      if(!key||!data)return {valid:false,code:'UNAVAILABLE'};
      const item=data.entries.find(e=>same(e,key));
      if(!item)return {valid:true,results:[],completed:false};
      const session=runtime.create(p,scope,unitId,lessonId,item.results);
      if(!session||session.state().total!==item.total)return {valid:false,code:'CORRUPT_CHECKPOINT'};
      return {valid:true,results:copy(item.results),completed:item.results.length===item.total,...(item.reviewSchedule?{reviewSchedule:copy(item.reviewSchedule)}:{})};
    }
    function save(p,scope,unitId,lessonId,results){
      const key=selection(p,scope,unitId,lessonId),data=read();
      if(!key||!data)return false;
      const session=runtime.create(p,scope,unitId,lessonId,results);
      if(!session)return false;
      const entry={...key,results:session.results(),total:session.state().total};
      const previous=data.entries.find(e=>same(e,key)),priorSchedule=previous?.reviewSchedule;
      // A retry of the exact finished checkpoint must not award another interval.
      const newCompletion=entry.results.length===entry.total&&(!previous||previous.results.length!==previous.total);
      const nextSchedule=newCompletion?schedule(priorSchedule,runtime.review(p,scope,unitId,lessonId,entry.results),now()):priorSchedule;
      if(nextSchedule)entry.reviewSchedule=copy(nextSchedule);
      return allowed()&&storage.set(KEY,JSON.stringify({version:1,entries:[entry,...data.entries.filter(e=>!same(e,key))].slice(0,MAX)}))===true;
    }
    return Object.freeze({load,save,allowed});
  }
  const api=Object.freeze({create,key:KEY});
  if(typeof window!=='undefined')window.LoloContentProgress=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
