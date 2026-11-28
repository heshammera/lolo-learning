(() => {
  function validateBank(bank,lessonIds){
    const errors=[],seen=new Set();
    for(const [lessonId,questions] of Object.entries(bank||{})){
      if(!lessonIds.has(lessonId))errors.push('unknown lesson '+lessonId);
      if(!Array.isArray(questions)||questions.length<2){errors.push('too few questions '+lessonId);continue;}
      for(const q of questions){
        if(!q||typeof q.id!=='string'||!q.id||seen.has(q.id)||q.type!=='choice'||typeof q.prompt!=='string'||!q.prompt.trim()||typeof q.visual!=='string'){
          errors.push('invalid question '+lessonId);continue;
        }
        seen.add(q.id);
        const options=q.options;
        if(!Array.isArray(options)||options.length<2||options.length>6||options.some(o=>!o||typeof o.id!=='string'||!o.id||typeof o.label!=='string'||!o.label.trim())||
          new Set(options.map(o=>o.id)).size!==options.length||new Set(options.map(o=>o.label)).size!==options.length||!options.some(o=>o.id===q.correctOptionId))errors.push('invalid options '+q.id);
      }
    }
    return {valid:errors.length===0,errors};
  }
  function create(bank,lessonId,assessmentId,bankVersion,random=Math.random){
    const qs=bank[lessonId];
    if(!qs||!assessmentId||!validateBank({[lessonId]:qs},new Set([lessonId])).valid)return null;
    const questions=qs.map(q=>{
      const options=q.options.map(o=>({...o}));
      for(let i=options.length-1;i>0;i--){const j=Math.max(0,Math.min(i,Math.floor(random()*(i+1))));[options[i],options[j]]=[options[j],options[i]];}
      return {...q,options};
    });
    return {lessonId,assessmentId,bankVersion,questions,index:0,answers:[]};
  }
  function validateAdaptive(bank,lessonIds){
    const result=validateBank(bank,lessonIds);
    for(const [id,qs] of Object.entries(bank||{})){
      if(!Array.isArray(qs)||qs.length<6||qs.length>30||qs.some(q=>![1,2,3].includes(q?.level))||[1,2,3].some(level=>qs.filter(q=>q?.level===level).length<2))result.errors.push('invalid levels '+id);
    }
    return {valid:result.errors.length===0,errors:result.errors};
  }
  const clamp=n=>Math.max(1,Math.min(3,n));
  function pick(pool,used,level,random){
    const candidates=pool.filter(q=>!used.has(q.id));
    if(!candidates.length)return null;
    const distance=Math.min(...candidates.map(q=>Math.abs(q.level-level)));
    const nearest=candidates.filter(q=>Math.abs(q.level-level)===distance);
    const q=nearest[Math.max(0,Math.min(nearest.length-1,Math.floor(random()*nearest.length)))];
    const options=q.options.map(o=>({...o}));
    for(let i=options.length-1;i>0;i--){const j=Math.max(0,Math.min(i,Math.floor(random()*(i+1))));[options[i],options[j]]=[options[j],options[i]];}
    return {...q,options};
  }
  function createAdaptive(bank,lessonId,assessmentId,bankVersion,random=Math.random){
    const qs=bank[lessonId];
    if(!assessmentId||!qs||!validateAdaptive({[lessonId]:qs},new Set([lessonId])).valid)return null;
    const pool=qs.map(q=>({...q,options:q.options.map(o=>({...o}))}));
    return {lessonId,assessmentId,bankVersion,mode:'adaptive',pool,random,limit:5,questions:[pick(pool,new Set(),2,random)],index:0,answers:[]};
  }
  function current(s){return s?.questions?.[s.index]||null;}
  function submit(s,questionId,optionId){
    const q=current(s);
    if(!q||q.id!==questionId||!q.options.some(o=>o.id===optionId)||s.answers.some(a=>a.questionId===questionId))return null;
    const result={questionId,optionId,correct:optionId===q.correctOptionId};
    const next={...s,index:s.index+1,answers:[...s.answers,result]};
    if(s.mode==='adaptive'&&next.index<s.limit){
      const level=clamp(q.level+(result.correct?1:-1));
      const item=pick(s.pool,new Set(s.questions.map(x=>x.id)),level,s.random);
      if(!item)return null;
      next.questions=[...s.questions,item];
    }
    return {state:next,result,correctLabel:q.options.find(o=>o.id===q.correctOptionId).label};
  }
  function summarizeAdaptive(s,bank,bankVersion,completedAt){
    const qs=bank[s?.lessonId];
    if(!qs||s?.mode!=='adaptive'||s.bankVersion!==bankVersion||s.index!==5||s.answers.length!==5||!Number.isFinite(Date.parse(completedAt))||!validateAdaptive({[s.lessonId]:qs},new Set([s.lessonId])).valid)return null;
    const used=new Set(),answers=[];let target=2;
    for(const a of s.answers){
      const remaining=qs.filter(q=>!used.has(q.id));
      const q=remaining.find(q=>q.id===a.questionId);
      if(!q||!q.options.some(o=>o.id===a.optionId)||Math.abs(q.level-target)!==Math.min(...remaining.map(x=>Math.abs(x.level-target))))return null;
      const correct=a.optionId===q.correctOptionId;
      answers.push({questionId:q.id,optionId:a.optionId,correct,level:q.level});
      used.add(q.id);target=clamp(q.level+(correct?1:-1));
    }
    return {assessmentId:s.assessmentId,lessonId:s.lessonId,bankVersion,completedAt,mode:'adaptive',correct:answers.filter(a=>a.correct).length,total:5,answers};
  }
  function summarize(s,bank,bankVersion,completedAt){
    if(s?.mode==='adaptive')return summarizeAdaptive(s,bank,bankVersion,completedAt);
    const qs=bank[s?.lessonId];
    if(!qs||s.bankVersion!==bankVersion||s.index!==qs.length||s.answers.length!==qs.length||!Number.isFinite(Date.parse(completedAt)))return null;
    // Recalculate correctness against immutable bank; never trust supplied flags.
    const answers=qs.map((q,i)=>{
      const a=s.answers[i];if(!a||a.questionId!==q.id||!q.options.some(o=>o.id===a.optionId))return null;
      return {questionId:q.id,optionId:a.optionId,correct:a.optionId===q.correctOptionId};
    });
    if(answers.some(a=>!a))return null;
    return {assessmentId:s.assessmentId,lessonId:s.lessonId,bankVersion,completedAt,correct:answers.filter(a=>a.correct).length,total:answers.length,answers};
  }
  function save(history,summary){
    if(!summary||typeof summary.assessmentId!=='string'||!summary.assessmentId)return {history,recorded:false};
    const prior=Array.isArray(history[summary.lessonId])?history[summary.lessonId]:[];
    if(prior.some(x=>x?.assessmentId===summary.assessmentId))return {history,recorded:false};
    const updated=[...prior,summary];
    // Separate retention for comparable fixed quizzes and adaptive practice.
    const fixed=updated.filter(x=>x?.mode!=='adaptive').slice(-10),adaptive=updated.filter(x=>x?.mode==='adaptive').slice(-10);
    const keep=new Set([...fixed,...adaptive]);
    return {history:{...history,[summary.lessonId]:updated.filter(x=>keep.has(x))},recorded:true};
  }
  const api=Object.freeze({validateBank,validateAdaptive,create,createAdaptive,current,submit,summarize,save});
  if(typeof window!=='undefined')window.LoloVisualAssessment=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
