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
  function current(s){return s?.questions?.[s.index]||null;}
  function submit(s,questionId,optionId){
    const q=current(s);
    if(!q||q.id!==questionId||!q.options.some(o=>o.id===optionId)||s.answers.some(a=>a.questionId===questionId))return null;
    const result={questionId,optionId,correct:optionId===q.correctOptionId};
    return {state:{...s,index:s.index+1,answers:[...s.answers,result]},result,correctLabel:q.options.find(o=>o.id===q.correctOptionId).label};
  }
  function summarize(s,bank,bankVersion,completedAt){
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
    return {history:{...history,[summary.lessonId]:[...prior,summary].slice(-10)},recorded:true};
  }
  const api=Object.freeze({validateBank,create,current,submit,summarize,save});
  if(typeof window!=='undefined')window.LoloVisualAssessment=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
