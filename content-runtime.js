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
    const accepts=(a,status)=>engine.types[a.type]?.evaluator==='completion-only'?status==='completed':['correct','incorrect'].includes(status);
    if(!Array.isArray(prior)||prior.length>steps.length||!prior.every((r,i)=>r&&Object.keys(r).sort().join(',')==='activityId,status'&&r.activityId===steps[i].activity.id&&accepts(steps[i].activity,r.status)))return null;
    const results=copy(prior);
    let index=results.length,answered=false,correct=results.filter(r=>r.status==='correct').length,total=results.length,stopped=false;
    return Object.freeze({
      current:()=>!stopped&&index<steps.length?copy(steps[index]):null,
      state:()=>({index,total:steps.length,answered,correct,attempted:total,ungraded:results.filter(r=>r.status==='completed').length,done:!stopped&&index===steps.length,stopped}),
      results:()=>copy(results),
      // Accept only the renderer's resolved result for this exact current activity.
      record(activityId,result){
        if(stopped||answered||index>=steps.length||steps[index].activity.id!==activityId||!accepts(steps[index].activity,result?.status))return false;
        results.push({activityId,status:result.status});answered=true;total++;if(result.status==='correct')correct++;return true;
      },
      advance(){if(stopped||!answered||index>=steps.length)return false;index++;answered=false;return true;},
      stop(){stopped=true;}
    });
  }
  // Recommendations only, never mastery, never change the authored learning order.
  function review(p,scope,unitId,lessonId,prior){
    const session=create(p,scope,unitId,lessonId,prior);
    if(!session)return null;
    const steps=plan(p,scope,unitId,lessonId),results=session.results();
    if(!results.length)return {status:'no-evidence',graded:0,ungraded:0,lessons:[],recommendation:null};
    const groups=new Map();let graded=0,ungraded=0;
    for(let i=0;i<results.length;i++){
      const step=steps[i],r=results[i];
      if(!groups.has(step.lessonId))groups.set(step.lessonId,{unitId:step.unitId,lessonId:step.lessonId,title:step.lessonTitle,correct:0,incorrect:0,ungraded:0});
      const group=groups.get(step.lessonId);
      if(r.status==='completed'){group.ungraded++;ungraded++;}
      else{group[r.status]++;graded++;}
    }
    const lessons=[...groups.values()];
    // A single error suggests review, not a diagnosis or a proficiency label.
    // Prioritize largest observed error count, then authored order.
    const needsReview=lessons.filter(l=>l.incorrect>0).sort((a,b)=>b.incorrect-a.incorrect);
    const complete=results.length===steps.length;
    const recommendation=!complete?{kind:'resume'}:needsReview.length?{kind:'review-lesson',unitId:needsReview[0].unitId,lessonId:needsReview[0].lessonId,title:needsReview[0].title}:graded?{kind:'continue'}:{kind:'practice-only'};
    return {status:complete?'complete':'partial',graded,ungraded,lessons,recommendation};
  }
  const api=Object.freeze({plan,create,review});
  if(typeof window!=='undefined')window.LoloContentRuntime=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
