/* Data-only, versioned activity contracts. No executable content or external requests. */
(() => {
  const types=Object.freeze(Object.fromEntries([
    ['choice','اختيار من متعدد'],['true-false','صح أو خطأ'],['multi-choice','اختيار عدة إجابات'],
    ['sequence','ترتيب العناصر'],['match','توصيل العناصر'],['numeric','إجابة رقمية'],['classify','تصنيف العناصر'],
  ].map(([id,label])=>[id,Object.freeze({id,label,version:1,offline:true,evaluator:'deterministic',renderer:'generic-v1'})])));
  const planned=Object.freeze(['fill-blank','free-text','image-hotspot','drag-drop','speech-repeat','phoneme-score','dictation','conversation','trace','free-drawing','coloring','number-line','fractions','geometry','equations','science-simulation','interactive-story','reading-aloud','memory-game','puzzle','maze','homework-upload']);
  const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
  const exact=(o,keys)=>plain(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
  const id=v=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(v);
  const text=v=>typeof v==='string'&&v.trim().length>0&&v.length<=500;
  const unique=a=>new Set(a).size===a.length;
  const entries=(a,min=2,max=8)=>Array.isArray(a)&&a.length>=min&&a.length<=max&&a.every(v=>exact(v,['id','label'])&&id(v.id)&&text(v.label))&&unique(a.map(v=>v.id))&&unique(a.map(v=>v.label.trim()));
  const sameSet=(a,b)=>Array.isArray(a)&&a.length===b.length&&unique(a)&&a.every(v=>b.includes(v));
  const integer=v=>Number.isSafeInteger(v)&&Math.abs(v)<=1000000;
  function validate(activity){
    if(!exact(activity,['id','type','version','prompt','config'])||!id(activity.id)||!text(activity.prompt))return {valid:false,code:'INVALID_ACTIVITY'};
    if(typeof activity.type!=='string'||!Object.hasOwn(types,activity.type)||activity.version!==1)return {valid:false,code:'UNSUPPORTED_ACTIVITY'};
    const c=activity.config;let valid=false;
    switch(activity.type){
      case 'choice':valid=exact(c,['options','answer'])&&entries(c.options)&&c.options.some(o=>o.id===c.answer);break;
      case 'true-false':valid=exact(c,['answer'])&&typeof c.answer==='boolean';break;
      case 'multi-choice':valid=exact(c,['options','answers'])&&entries(c.options)&&Array.isArray(c.answers)&&c.answers.length>=2&&unique(c.answers)&&c.answers.every(a=>c.options.some(o=>o.id===a));break;
      case 'sequence':valid=exact(c,['items','answer'])&&entries(c.items)&&sameSet(c.answer,c.items.map(o=>o.id));break;
      case 'match':valid=exact(c,['left','right','pairs'])&&entries(c.left)&&entries(c.right)&&c.left.length===c.right.length&&plain(c.pairs)&&sameSet(Object.keys(c.pairs),c.left.map(o=>o.id))&&sameSet(Object.values(c.pairs),c.right.map(o=>o.id));break;
      case 'numeric':valid=exact(c,['answer'])&&integer(c.answer);break;
      case 'classify':valid=exact(c,['items','groups','assignments'])&&entries(c.items)&&entries(c.groups,2,6)&&plain(c.assignments)&&sameSet(Object.keys(c.assignments),c.items.map(o=>o.id))&&Object.values(c.assignments).every(a=>c.groups.some(g=>g.id===a));break;
    }
    return {valid,code:valid?'OK':'INVALID_CONFIG'};
  }
  function evaluate(activity,response){
    if(!validate(activity).valid)return {status:'unresolved'};
    const c=activity.config;let resolved=false,correct=false;
    switch(activity.type){
      case 'choice':resolved=c.options.some(o=>o.id===response);correct=response===c.answer;break;
      case 'true-false':resolved=typeof response==='boolean';correct=response===c.answer;break;
      case 'multi-choice':resolved=Array.isArray(response)&&response.length>0&&unique(response)&&response.every(a=>c.options.some(o=>o.id===a));correct=resolved&&sameSet(response,c.answers);break;
      case 'sequence':resolved=sameSet(response,c.items.map(o=>o.id));correct=resolved&&response.every((x,i)=>x===c.answer[i]);break;
      case 'match':
      case 'classify':{
        const expected=activity.type==='match'?c.pairs:c.assignments;
        const allowed=activity.type==='match'?c.right:c.groups;
        resolved=plain(response)&&sameSet(Object.keys(response),Object.keys(expected))&&Object.values(response).every(x=>allowed.some(o=>o.id===x))&&(activity.type!=='match'||unique(Object.values(response)));
        correct=resolved&&Object.keys(expected).every(k=>response[k]===expected[k]);break;
      }
      case 'numeric':resolved=integer(response);correct=response===c.answer;break;
    }
    return {status:resolved?(correct?'correct':'incorrect'):'unresolved'};
  }
  function checkLessons(lessons,clientVersions=Object.fromEntries(Object.keys(types).map(k=>[k,[1]]))){
    const issues=[],seen=new Set();
    if(!Array.isArray(lessons)||!lessons.length)return {compatible:false,issues:[{code:'NO_LESSONS'}]};
    for(const lesson of lessons){
      if(!id(lesson?.id)||!Array.isArray(lesson.activities)||lesson.activities.length<1||lesson.activities.length>50){issues.push({lessonId:lesson?.id,code:'ACTIVITIES_REQUIRED'});continue;}
      for(const activity of lesson.activities){
        const result=validate(activity);
        const code=!result.valid?result.code:seen.has(activity.id)?'DUPLICATE_ACTIVITY_ID':!Object.hasOwn(clientVersions,activity.type)||!Array.isArray(clientVersions[activity.type])||!clientVersions[activity.type].includes(activity.version)?'CLIENT_VERSION_UNSUPPORTED':null;
        if(code)issues.push({lessonId:lesson.id,activityId:activity?.id,code});
        if(id(activity?.id))seen.add(activity.id);
      }
    }
    return {compatible:issues.length===0,issues};
  }
  // Shared accessible renderer: native form controls, no HTML from curriculum.
  function render(activity,container,onResult){
    container.replaceChildren();
    if(!validate(activity).valid)return false;
    const doc=container.ownerDocument,c=activity.config,form=doc.createElement('form');
    const fieldset=doc.createElement('fieldset'),legend=doc.createElement('legend');
    legend.textContent=activity.prompt;fieldset.append(legend);form.append(fieldset);
    const controls=[];
    function optionList(options,kind){
      for(const o of options){
        const label=doc.createElement('label'),input=doc.createElement('input');
        input.type=kind;input.name='activity-answer';input.value=o.id;label.append(input,doc.createTextNode(o.label));fieldset.append(label);controls.push(input);
      }
    }
    function selector(labelText,options){
      const label=doc.createElement('label'),select=doc.createElement('select'),blank=doc.createElement('option');
      label.textContent=labelText;blank.value='';blank.textContent='اختاري';select.append(blank);
      for(const o of options){const option=doc.createElement('option');option.value=o.id;option.textContent=o.label;select.append(option);}
      label.append(select);fieldset.append(label);controls.push(select);
    }
    if(activity.type==='choice'||activity.type==='multi-choice')optionList(c.options,activity.type==='choice'?'radio':'checkbox');
    else if(activity.type==='true-false')optionList([{id:'true',label:'صح'},{id:'false',label:'خطأ'}],'radio');
    else if(activity.type==='numeric'){
      const input=doc.createElement('input');input.type='number';input.step='1';input.setAttribute('aria-label','الإجابة الرقمية');fieldset.append(input);controls.push(input);
    }else if(activity.type==='sequence')c.items.forEach((_,i)=>selector('المكان '+(i+1),c.items));
    else if(activity.type==='match')c.left.forEach(o=>selector(o.label,c.right));
    else if(activity.type==='classify')c.items.forEach(o=>selector(o.label,c.groups));
    const feedback=doc.createElement('p');feedback.setAttribute('role','status');
    const submit=doc.createElement('button');submit.type='submit';submit.textContent='تحقق من الإجابة';form.append(submit,feedback);
    let finished=false;
    form.addEventListener('submit',e=>{
      e.preventDefault();if(finished)return;
      let response;
      if(activity.type==='choice'||activity.type==='true-false'){response=controls.find(x=>x.checked)?.value;if(activity.type==='true-false'&&response!==undefined)response=response==='true';}
      else if(activity.type==='multi-choice')response=controls.filter(x=>x.checked).map(x=>x.value);
      else if(activity.type==='numeric')response=controls[0].value.trim()===''?null:Number(controls[0].value);
      else if(activity.type==='sequence')response=controls.map(x=>x.value);
      else response=Object.fromEntries((activity.type==='match'?c.left:c.items).map((o,i)=>[o.id,controls[i].value]));
      const result=evaluate(activity,response);
      feedback.textContent=result.status==='correct'?'أحسنت! ⭐':result.status==='incorrect'?'محاولة جميلة، راجعي الإجابة.':'كمّلي الاختيارات الأول.';
      if(result.status!=='unresolved'){finished=true;fieldset.disabled=true;submit.disabled=true;onResult?.(result);}
    });
    container.append(form);return true;
  }
  const api=Object.freeze({types,planned,validate,evaluate,checkLessons,render});
  if(typeof window!=='undefined')window.LoloActivities=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
