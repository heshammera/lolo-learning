/* Generic package practice. Session-local, no legacy mastery/progress writes. */
(() => {
  const schema=typeof module!=='undefined'&&module.exports?require('./content-schema.js'):window.LoloContentSchema;
  const engine=typeof module!=='undefined'&&module.exports?require('./activity-engine.js'):window.LoloActivities;
  const copy=x=>JSON.parse(JSON.stringify(x));
  function plan(p,scope,unitId=null,lessonId=null){
    if(!p||!schema.validate(p.content).valid||!['lesson','unit','curriculum'].includes(scope))return null;
    const units=p.content.units;
    const unit=units.find(u=>u.id===unitId);
    const lesson=unit?.lessons.find(l=>l.id===lessonId);
    if(scope==='lesson'&&!lesson||scope==='unit'&&!unit)return null;
    const selected=scope==='curriculum'?units:scope==='unit'?[unit]:[{...unit,lessons:[lesson]}];
    return selected.flatMap(u=>u.lessons.flatMap(l=>l.activities.map(a=>({unitId:u.id,lessonId:l.id,lessonTitle:l.title,goal:l.goal,activity:copy(a)}))));
  }
  function create(p,scope,unitId,lessonId,prior=[]){
    const steps=plan(p,scope,unitId,lessonId);if(!steps?.length)return null;
    if(!Array.isArray(prior)||prior.length>steps.length||!prior.every((r,i)=>r&&Object.keys(r).sort().join(',')==='activityId,status'&&r.activityId===steps[i].activity.id&&['correct','incorrect'].includes(r.status)))return null;
    const results=copy(prior);
    let index=results.length,answered=false,correct=results.filter(r=>r.status==='correct').length,total=results.length,stopped=false;
    return Object.freeze({
      current:()=>!stopped&&index<steps.length?copy(steps[index]):null,
      state:()=>({index,total:steps.length,answered,correct,attempted:total,done:!stopped&&index===steps.length,stopped}),
      results:()=>copy(results),
      // Accept only the renderer's resolved result for this exact current activity.
      record(activityId,result){
        if(stopped||answered||index>=steps.length||steps[index].activity.id!==activityId||!['correct','incorrect'].includes(result?.status))return false;
        results.push({activityId,status:result.status});answered=true;total++;if(result.status==='correct')correct++;return true;
      },
      advance(){if(stopped||!answered||index>=steps.length)return false;index++;answered=false;return true;},
      stop(){stopped=true;}
    });
  }
  const api=Object.freeze({plan,create});
  if(typeof window!=='undefined')window.LoloContentRuntime=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
