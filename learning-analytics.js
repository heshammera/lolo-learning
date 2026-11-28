/* Read-only local analytics. Evidence channels never mixed into mastery. */
(()=>{
 const own=(o,k)=>o&&typeof o==='object'&&Object.prototype.hasOwnProperty.call(o,k)?o[k]:undefined;
 const count=v=>Number.isSafeInteger(v)&&v>=0&&v<=1000000;
 const percent=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=100;
 const time=v=>typeof v==='string'&&v.length<=40?Date.parse(v):NaN;
 const score=(a,b)=>b?Math.round(100*a/b):null;
 function assessment(r,lesson,version,now){
  if(!r||typeof r.assessmentId!=='string'||!r.assessmentId.length||r.assessmentId.length>200||!count(r.correct)||!count(r.total)||r.total===0||r.correct>r.total||!Number.isFinite(time(r.completedAt))||time(r.completedAt)>now)return null;
  // Unknown or older curriculum versions are not comparable to current tests.
  if(!version||r.curriculumVersion!==version||!lesson.version||r.lessonVersion!==lesson.version)return null;
  return {id:r.assessmentId,correct:r.correct,total:r.total,at:time(r.completedAt),percent:score(r.correct,r.total)};
 }
 function summarize({lessons=[],completedIds=[],tests={},traces={},visual={},visualVersion=null,curriculumVersion=null,now=Date.now()}={}){
  const done=new Set(Array.isArray(completedIds)?completedIds:[]),seen=new Set(),rows=[];
  if(!Array.isArray(lessons)||!Number.isFinite(now))return {rows:[],summary:null};
  for(const l of lessons){
   if(!l||typeof l.id!=='string'||!l.id||seen.has(l.id))continue;seen.add(l.id);
   const raw=own(tests,l.id),history=Array.isArray(raw?.history)?raw.history.slice(-10):[],byId=new Map();
   for(const r of [...history,raw]){
    const a=assessment(r,l,curriculumVersion,now);if(a&&!byId.has(a.id))byId.set(a.id,a);
   }
   const records=[...byId.values()].sort((a,b)=>a.at-b.at);
   const latest=records.at(-1)||null;
   const previous=latest?records.slice(0,-1).reverse().find(r=>r.at<latest.at):null;
   const trace=own(traces,l.id),traceScore=percent(trace?.percent)&&Number.isFinite(time(trace.completedAt))&&time(trace.completedAt)<=now?Math.round(trace.percent):null;
   const vh=own(visual,l.id);
   const visuals=Array.isArray(vh)&&visualVersion? vh.filter(r=>r?.bankVersion===visualVersion&&count(r.correct)&&count(r.total)&&r.total>0&&r.correct<=r.total&&Number.isFinite(time(r.completedAt))&&time(r.completedAt)<=now).sort((a,b)=>time(a.completedAt)-time(b.completedAt)):[];
   const v=visuals.at(-1);
   // At least five questions on latest test before using a category. No global IQ/mastery claim.
   const status=!latest?'not-assessed':latest.total<5?'limited-evidence':latest.percent<60?'practice':latest.percent>=85?'strong-result':'developing';
   rows.push({id:l.id,title:typeof l.title==='string'&&l.title?l.title:typeof l.focus==='string'?l.focus:l.id,
    completed:done.has(l.id),latest,previous,trend:previous?latest.percent-previous.percent:null,status,
    tracePercent:traceScore,visualPercent:v?score(v.correct,v.total):null,hasUncomparableTest:!!raw&&!latest});
  }
  const assessed=rows.filter(r=>r.latest),correct=assessed.reduce((n,r)=>n+r.latest.correct,0),total=assessed.reduce((n,r)=>n+r.latest.total,0);
  const priorities=rows.filter(r=>r.status==='practice').sort((a,b)=>a.latest.percent-b.latest.percent||a.id.localeCompare(b.id)).slice(0,5).map(r=>r.id);
  const strengths=rows.filter(r=>r.status==='strong-result').sort((a,b)=>b.latest.percent-a.latest.percent||a.id.localeCompare(b.id)).slice(0,5).map(r=>r.id);
  return {rows,summary:{lessonCount:rows.length,completed:rows.filter(r=>r.completed).length,assessed:assessed.length,unassessed:rows.length-assessed.length,
   latestCorrect:correct,latestTotal:total,latestPercent:score(correct,total),traceCount:rows.filter(r=>r.tracePercent!==null).length,visualCount:rows.filter(r=>r.visualPercent!==null).length,priorities,strengths}};
 }
 function recommend(report,{dueLessonIds=[],eligibleIds=[],limit=3}={}){
  if(!report?.summary||!Array.isArray(report.rows)||!Array.isArray(dueLessonIds)||!Array.isArray(eligibleIds)||!Number.isInteger(limit)||limit<1||limit>10)return [];
  const due=new Set(dueLessonIds),eligible=new Set(eligibleIds),choices=[];
  for(const row of report.rows){
   if(!eligible.has(row.id))continue;
   let reason=null,rank=9;
   // Review date wins over a strong score; missing evidence is never called weak.
   if(due.has(row.id)){reason='scheduled-review';rank=0;}
   else if(row.status==='practice'){reason='practice';rank=1;}
   else if(row.status==='developing'){reason='consolidate';rank=2;}
   else if(!row.completed&&row.status==='not-assessed'&&!row.hasUncomparableTest){reason='new-lesson';rank=3;}
   if(reason)choices.push({lessonId:row.id,title:row.title,reason,rank,percent:row.latest?.percent??null});
  }
  return choices.sort((a,b)=>a.rank-b.rank||(a.percent??101)-(b.percent??101)).slice(0,limit).map(({rank,...row})=>row);
 }
 const api=Object.freeze({summarize,recommend});
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(typeof window!=='undefined')window.LoloLearningAnalytics=api;
})();