/* Data-only, versioned activity contracts. No executable content or external requests. */
(() => {
  const types=Object.freeze(Object.fromEntries([
    ['choice','اختيار من متعدد'],['true-false','صح أو خطأ'],['multi-choice','اختيار عدة إجابات'],
    ['sequence','ترتيب العناصر'],['match','توصيل العناصر'],['numeric','إجابة رقمية'],['classify','تصنيف العناصر'],
    ['fill-blank','أكمل الفراغ'],['free-text','إجابة نصية قصيرة'],['number-line','خط الأعداد'],['fractions','الكسور المكافئة'],
    ['drag-drop','السحب والإفلات'],['geometry','الأشكال الهندسية'],['equations','المعادلات الخطية'],
  ].map(([id,label])=>[id,Object.freeze({id,label,version:1,offline:true,evaluator:'deterministic',renderer:'generic-v1'})])));
  const planned=Object.freeze(['image-hotspot','speech-repeat','phoneme-score','dictation','conversation','trace','free-drawing','coloring','science-simulation','interactive-story','reading-aloud','memory-game','puzzle','maze','homework-upload']);
  const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
  const exact=(o,keys)=>plain(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
  const id=v=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(v);
  const text=v=>typeof v==='string'&&v.trim().length>0&&v.length<=500;
  const unique=a=>new Set(a).size===a.length;
  const entries=(a,min=2,max=8)=>Array.isArray(a)&&a.length>=min&&a.length<=max&&a.every(v=>exact(v,['id','label'])&&id(v.id)&&text(v.label))&&unique(a.map(v=>v.id))&&unique(a.map(v=>v.label.trim()));
  const sameSet=(a,b)=>Array.isArray(a)&&a.length===b.length&&unique(a)&&a.every(v=>b.includes(v));
  const integer=v=>Number.isSafeInteger(v)&&Math.abs(v)<=1000000;
  // Conservative normalization: canonical Unicode, case and whitespace only.
  // Arabic letter variants, punctuation and diacritics are not silently equated.
  const normalize=v=>v.normalize('NFC').trim().replace(/\s+/gu,' ').toLowerCase();
  const answerText=v=>typeof v==='string'&&v.length<=200&&normalize(v).length>0&&!/[\p{C}]/u.test(v);
  const alternatives=a=>Array.isArray(a)&&a.length>=1&&a.length<=8&&a.every(answerText)&&unique(a.map(normalize));
  const fraction=v=>exact(v,['numerator','denominator'])&&integer(v.numerator)&&integer(v.denominator)&&v.numerator>=0&&v.denominator>0&&v.numerator<=v.denominator&&v.denominator<=1000;
  const onLine=(c,v)=>integer(v)&&v>=c.min&&v<=c.max&&(v-c.min)%c.step===0;
  const shapes=Object.freeze({circle:'دائرة: شكل مستدير بلا أضلاع',triangle:'مثلث: ثلاثة أضلاع',square:'مربع: أربعة أضلاع متساوية وأربع زوايا قائمة',rectangle:'مستطيل: ضلعان طويلان وضلعان قصيران وأربع زوايا قائمة',pentagon:'خماسي: خمسة أضلاع'});
  const shapeId=v=>typeof v==='string'&&Object.hasOwn(shapes,v);
  const equation=c=>exact(c,['coefficient','constant','result'])&&integer(c.coefficient)&&c.coefficient>=1&&c.coefficient<=100&&integer(c.constant)&&integer(c.result)&&(c.result-c.constant)%c.coefficient===0&&integer((c.result-c.constant)/c.coefficient);
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
      case 'fill-blank':
      case 'free-text':valid=exact(c,['answers'])&&alternatives(c.answers);break;
      case 'number-line':valid=exact(c,['min','max','step','answer'])&&integer(c.min)&&integer(c.max)&&integer(c.step)&&c.step>0&&c.max>c.min&&(c.max-c.min)%c.step===0&&(c.max-c.min)/c.step<=20&&onLine(c,c.answer);break;
      case 'fractions':valid=exact(c,['numerator','denominator'])&&fraction(c);break;
      case 'geometry':valid=exact(c,['answer'])&&shapeId(c.answer);break;
      case 'equations':valid=equation(c);break;
      case 'drag-drop':
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
      case 'drag-drop':
      case 'classify':{
        const expected=activity.type==='match'?c.pairs:c.assignments;
        const allowed=activity.type==='match'?c.right:c.groups;
        resolved=plain(response)&&sameSet(Object.keys(response),Object.keys(expected))&&Object.values(response).every(x=>allowed.some(o=>o.id===x))&&(activity.type!=='match'||unique(Object.values(response)));
        correct=resolved&&Object.keys(expected).every(k=>response[k]===expected[k]);break;
      }
      case 'numeric':resolved=integer(response);correct=response===c.answer;break;
      case 'fill-blank':
      case 'free-text':resolved=answerText(response);correct=resolved&&c.answers.some(a=>normalize(a)===normalize(response));break;
      case 'number-line':resolved=onLine(c,response);correct=resolved&&response===c.answer;break;
      case 'geometry':resolved=shapeId(response);correct=response===c.answer;break;
      case 'equations':resolved=integer(response);correct=resolved&&c.coefficient*response+c.constant===c.result;break;
      case 'fractions':resolved=fraction(response);correct=resolved&&response.numerator*c.denominator===c.numerator*response.denominator;break;
    }
    return {status:resolved?(correct?'correct':'incorrect'):'unresolved'};
  }
  function checkLessons(lessons,clientVersions=Object.fromEntries(Object.keys(types).map(k=>[k,[1]]))){
    const issues=[],seen=new Set(),lessonIds=new Set();
    if(!plain(clientVersions))return {compatible:false,issues:[{code:'INVALID_CLIENT_CAPABILITIES'}]};
    if(!Array.isArray(lessons)||!lessons.length)return {compatible:false,issues:[{code:'NO_LESSONS'}]};
    for(const lesson of lessons){
      if(!id(lesson?.id)||!Array.isArray(lesson.activities)||lesson.activities.length<1||lesson.activities.length>50){issues.push({lessonId:lesson?.id,code:'ACTIVITIES_REQUIRED'});continue;}
      if(lessonIds.has(lesson.id))issues.push({lessonId:lesson.id,code:'DUPLICATE_LESSON_ID'});
      lessonIds.add(lesson.id);
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
    let dragAssignments=null;
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
    // Fixed shapes, never authored SVG or external URLs.
    function shapeGraphic(shape){
      const ns='http://www.w3.org/2000/svg',svg=doc.createElementNS(ns,'svg');
      svg.setAttribute('viewBox','0 0 80 80');svg.setAttribute('width','72');svg.setAttribute('height','72');svg.setAttribute('aria-hidden','true');
      const attrs={circle:['circle',{cx:40,cy:40,r:30}],triangle:['polygon',{points:'40,8 73,70 7,70'}],square:['rect',{x:12,y:12,width:56,height:56}],rectangle:['rect',{x:6,y:23,width:68,height:34}],pentagon:['polygon',{points:'40,6 73,30 60,69 20,69 7,30'}]};
      const [tag,values]=attrs[shape],node=doc.createElementNS(ns,tag);
      for(const [key,value] of Object.entries(values))node.setAttribute(key,String(value));
      node.setAttribute('fill','#e0d4fa');node.setAttribute('stroke','#7351b0');node.setAttribute('stroke-width','3');svg.append(node);return svg;
    }
    function dragBoard(){
      const board=doc.createElement('div');board.className='activity-drag-board';
      const pool=doc.createElement('div'),targets=doc.createElement('div'),fallback=doc.createElement('div');
      pool.className='activity-drag-pool';targets.className='activity-drag-targets';fallback.className='activity-drag-fallback';
      const notice=doc.createElement('p');notice.setAttribute('role','status');notice.textContent='اسحبي العنصر إلى المجموعة، أو اختاري العنصر ثم المجموعة.';
      const assigned=new Map(),chips=new Map(),groups=new Map(),selects=new Map();let selected=null;
      dragAssignments=assigned;
      function refresh(){
        for(const [itemId,chip] of chips){
          const group=assigned.get(itemId);
          (groups.get(group)?.area||pool).append(chip);
          chip.setAttribute('aria-pressed',String(selected===itemId));
          if(selects.has(itemId))selects.get(itemId).value=group||'';
        }
      }
      function place(itemId,groupId){
        if(fieldset.disabled||!chips.has(itemId)||!groups.has(groupId))return;
        assigned.set(itemId,groupId);selected=null;refresh();
        notice.textContent='تم وضع '+c.items.find(o=>o.id===itemId).label+' في '+c.groups.find(o=>o.id===groupId).label;
      }
      for(const g of c.groups){
        const section=doc.createElement('section'),button=doc.createElement('button'),area=doc.createElement('div');
        section.dataset.dropGroup=g.id;section.className='activity-drag-zone';button.type='button';button.textContent=g.label;button.setAttribute('aria-label','وضع في '+g.label);
        button.onclick=()=>{if(selected)place(selected,g.id);};
        section.append(button,area);targets.append(section);groups.set(g.id,{area});
      }
      for(const item of c.items){
        const chip=doc.createElement('button');chip.type='button';chip.textContent=item.label;chip.className='activity-drag-chip';chip.dataset.dragItem=item.id;
        let start=null,moved=false;
        chip.addEventListener('pointerdown',event=>{if(fieldset.disabled||event.button!==0)return;start={x:event.clientX,y:event.clientY,id:event.pointerId};moved=false;chip.setPointerCapture?.(event.pointerId);});
        chip.addEventListener('pointermove',event=>{if(start&&event.pointerId===start.id&&Math.hypot(event.clientX-start.x,event.clientY-start.y)>8)moved=true;});
        chip.addEventListener('pointercancel',()=>{start=null;moved=false;});
        chip.addEventListener('pointerup',event=>{
          if(!start||event.pointerId!==start.id)return;
          if(moved){const zone=doc.elementFromPoint(event.clientX,event.clientY)?.closest('[data-drop-group]');if(zone&&targets.contains(zone))place(item.id,zone.dataset.dropGroup);}
          start=null;
        });
        chip.onclick=()=>{if(moved){moved=false;return;}selected=selected===item.id?null:item.id;refresh();notice.textContent=selected?'اختاري المجموعة للعنصر '+item.label:'اختاري عنصرًا.';};
        chips.set(item.id,chip);pool.append(chip);
        const label=doc.createElement('label'),select=doc.createElement('select');label.textContent='مجموعة '+item.label;select.setAttribute('aria-label','مجموعة '+item.label);
        select.append(new Option('اختاري',''));for(const g of c.groups)select.append(new Option(g.label,g.id));
        select.onchange=()=>{if(select.value)place(item.id,select.value);else{assigned.delete(item.id);selected=null;refresh();}};
        selects.set(item.id,select);label.append(select);fallback.append(label);
      }
      const heading=doc.createElement('p');heading.textContent='بديل السحب باستخدام قوائم الاختيار:';
      board.append(notice,pool,targets,heading,fallback);fieldset.append(board);refresh();
    }
    if(activity.type==='choice'||activity.type==='multi-choice')optionList(c.options,activity.type==='choice'?'radio':'checkbox');
    else if(activity.type==='true-false')optionList([{id:'true',label:'صح'},{id:'false',label:'خطأ'}],'radio');
    else if(activity.type==='numeric'){
      const input=doc.createElement('input');input.type='number';input.step='1';input.setAttribute('aria-label','الإجابة الرقمية');fieldset.append(input);controls.push(input);
    }else if(activity.type==='fill-blank'||activity.type==='free-text'){
      const input=doc.createElement('input');input.type='text';input.maxLength=200;input.autocomplete='off';input.setAttribute('aria-label','الإجابة النصية');fieldset.append(input);controls.push(input);
    }else if(activity.type==='number-line'){
      const line=doc.createElement('div');line.className='activity-number-line';line.setAttribute('dir','ltr');
      for(let value=c.min;value<=c.max;value+=c.step){
        const label=doc.createElement('label'),input=doc.createElement('input');input.type='radio';input.name='activity-answer';input.value=String(value);label.append(input,doc.createTextNode(String(value)));line.append(label);controls.push(input);
      }
      fieldset.append(line);
    }else if(activity.type==='fractions'){
      // The question is authored text; the answer is not exposed in the visual.
      for(const labelText of ['البسط','المقام']){
        const label=doc.createElement('label'),input=doc.createElement('input');label.textContent=labelText;input.type='number';input.step='1';input.min=labelText==='البسط'?'0':'1';input.max='1000';label.append(input);fieldset.append(label);controls.push(input);
      }
    }else if(activity.type==='geometry'){
      const grid=doc.createElement('div');grid.className='activity-shapes';
      for(const shape of Object.keys(shapes)){
        const label=doc.createElement('label'),input=doc.createElement('input');input.type='radio';input.name='activity-answer';input.value=shape;input.setAttribute('aria-label',shapes[shape]);label.append(input,shapeGraphic(shape));grid.append(label);controls.push(input);
      }
      fieldset.append(grid);
    }else if(activity.type==='equations'){
      const equationText=doc.createElement('p');equationText.dir='ltr';equationText.className='activity-equation';equationText.textContent=c.coefficient+' × x '+(c.constant<0?'− '+Math.abs(c.constant):'+ '+c.constant)+' = '+c.result;fieldset.append(equationText);
      const input=doc.createElement('input');input.type='number';input.step='1';input.setAttribute('aria-label','قيمة س');fieldset.append(input);controls.push(input);
    }else if(activity.type==='drag-drop')dragBoard();
    else if(activity.type==='sequence')c.items.forEach((_,i)=>selector('المكان '+(i+1),c.items));
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
      else if(activity.type==='fill-blank'||activity.type==='free-text')response=controls[0].value;
      else if(activity.type==='number-line'){const selected=controls.find(x=>x.checked);response=selected?Number(selected.value):null;}
      else if(activity.type==='fractions')response={numerator:controls[0].value.trim()===''?null:Number(controls[0].value),denominator:controls[1].value.trim()===''?null:Number(controls[1].value)};
      else if(activity.type==='geometry')response=controls.find(x=>x.checked)?.value;
      else if(activity.type==='equations')response=controls[0].value.trim()===''?null:Number(controls[0].value);
      else if(activity.type==='drag-drop')response=Object.fromEntries(dragAssignments);
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
