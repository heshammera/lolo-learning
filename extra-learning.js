/* Separate, bounded practice plans for signed supplemental content. */
(() => {
  const schema=typeof module!=='undefined'&&module.exports?require('./content-schema.js'):window.LoloContentSchema;
  const clone=v=>JSON.parse(JSON.stringify(v));
  function plan(p,scope,unitId=null,lessonId=null){
    if(!p||!schema.validate(p.content).valid||!['lesson','unit','curriculum'].includes(scope))return null;
    let lessons=p.content.units.flatMap(u=>u.lessons.map(l=>({unitId:u.id,lesson:l})));
    if(scope==='unit'||scope==='lesson')lessons=lessons.filter(x=>x.unitId===unitId);
    if(scope==='lesson')lessons=lessons.filter(x=>x.lesson.id===lessonId);
    if(!lessons.length)return null;
    const steps=lessons.flatMap(x=>x.lesson.activities.map(a=>({lessonId:x.lesson.id,activityId:a.id})));
    return {draftId:p.draftId,releaseId:p.releaseId,sequence:p.sequence,scope,unitId:scope==='curriculum'?null:unitId,lessonId:scope==='lesson'?lessonId:null,steps,index:0,correct:0};
  }
  function valid(p,s){
    if(!s||typeof s!=='object')return false;
    const expected=plan(p,s.scope,s.unitId,s.lessonId);
    return !!expected&&s.draftId===expected.draftId&&s.releaseId===expected.releaseId&&s.sequence===expected.sequence&&JSON.stringify(s.steps)===JSON.stringify(expected.steps)&&Number.isInteger(s.index)&&s.index>=0&&s.index<=expected.steps.length&&Number.isInteger(s.correct)&&s.correct>=0&&s.correct<=s.index;
  }
  function current(p,s){
    if(!valid(p,s)||s.index===s.steps.length)return null;
    const step=s.steps[s.index],lesson=p.content.units.flatMap(u=>u.lessons).find(l=>l.id===step.lessonId);
    return {lessonTitle:lesson.title,goal:lesson.goal,activity:clone(lesson.activities.find(a=>a.id===step.activityId))};
  }
  function advance(p,s,activityId,result){
    const item=current(p,s);
    if(!item||item.activity.id!==activityId||!['correct','incorrect'].includes(result?.status))return null;
    return {...s,index:s.index+1,correct:s.correct+(result.status==='correct'?1:0)};
  }
  const api=Object.freeze({plan,valid,current,advance});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(typeof window!=='undefined')window.LoloExtraLearning=api;
})();
