/* Data-only, versioned activity contracts. No executable content or external requests. */
(() => {
  const types=Object.freeze(Object.fromEntries([
    ['choice','اختيار من متعدد'],['true-false','صح أو خطأ'],['multi-choice','اختيار عدة إجابات'],
    ['sequence','ترتيب العناصر'],['match','توصيل العناصر'],['numeric','إجابة رقمية'],['classify','تصنيف العناصر'],
    ['fill-blank','أكمل الفراغ'],['free-text','إجابة نصية قصيرة'],['number-line','خط الأعداد'],['fractions','الكسور المكافئة'],
    ['drag-drop','السحب والإفلات'],['geometry','الأشكال الهندسية'],['equations','المعادلات الخطية'],
    ['memory-game','لعبة الذاكرة'],['puzzle','بازل الترتيب'],['maze','المتاهة'],
    ['image-hotspot','تحديد أجزاء الرسم'],['science-simulation','محاكاة الميزان'],['interactive-story','قصة تفاعلية'],
    ['trace','تتبع الحروف والأرقام'],['free-drawing','الرسم الحر'],['coloring','التلوين'],['dictation','الإملاء الصوتي'],['speech-repeat','الاستماع والتكرار'],['reading-aloud','القراءة الجهرية'],
  ].map(([id,label])=>[id,Object.freeze({id,label,version:1,offline:!['dictation','speech-repeat'].includes(id),evaluator:['free-drawing','speech-repeat','reading-aloud'].includes(id)?'completion-only':'deterministic',renderer:'generic-v1'})])));
  const planned=Object.freeze(['phoneme-score','conversation','homework-upload']);
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
  const directions=Object.freeze({up:[-1,0],down:[1,0],left:[0,-1],right:[0,1]});
  function mazeLayout(c){
    if(!exact(c,['grid'])||!Array.isArray(c.grid)||c.grid.length<3||c.grid.length>8||!c.grid.every(r=>typeof r==='string'&&/^[.#SG]{3,8}$/.test(r)&&r.length===c.grid[0].length))return null;
    const cells=c.grid.join('');if(cells.split('S').length!==2||cells.split('G').length!==2)return null;
    const width=c.grid[0].length,at=ch=>[Math.floor(cells.indexOf(ch)/width),cells.indexOf(ch)%width];
    return {start:at('S'),goal:at('G')};
  }
  function mazeStep(c,pos,dir){
    if(typeof dir!=='string'||!Object.hasOwn(directions,dir))return null;
    const delta=directions[dir],next=[pos[0]+delta[0],pos[1]+delta[1]];
    const cell=c.grid[next[0]]?.[next[1]];
    return cell&&cell!=='#'?next:null;
  }
  const samePos=(a,b)=>a[0]===b[0]&&a[1]===b[1];
  function validMaze(c){
    const layout=mazeLayout(c);if(!layout)return false;
    const queue=[layout.start],seen=new Set([layout.start.join(',')]);
    for(let i=0;i<queue.length;i++){
      if(samePos(queue[i],layout.goal))return true;
      for(const dir of Object.keys(directions)){const next=mazeStep(c,queue[i],dir);if(next&&!seen.has(next.join(','))){seen.add(next.join(','));queue.push(next);}}
    }
    return false;
  }
  function memoryResult(c,turns){
    if(!Array.isArray(turns)||turns.length>c.maxTurns)return null;
    const cards=new Map(c.items.flatMap(o=>[[o.id+':a',o.id],[o.id+':b',o.id]])),matched=new Set();
    for(const turn of turns){
      if(matched.size===cards.size||!Array.isArray(turn)||turn.length!==2||turn[0]===turn[1]||!turn.every(x=>cards.has(x)&&!matched.has(x)))return null;
      if(cards.get(turn[0])===cards.get(turn[1]))turn.forEach(x=>matched.add(x));
    }
    return {matched,done:matched.size===cards.size||turns.length===c.maxTurns,correct:matched.size===cards.size};
  }
  const diagrams=Object.freeze({
    plant:Object.freeze({flower:'الزهرة',leaf:'الورقة',stem:'الساق',root:'الجذور'}),
    face:Object.freeze({eyes:'العينان',nose:'الأنف',mouth:'الفم',ears:'الأذنان'})
  });
  const diagramId=v=>typeof v==='string'&&Object.hasOwn(diagrams,v);
  const regionId=(diagram,v)=>diagramId(diagram)&&typeof v==='string'&&Object.hasOwn(diagrams[diagram],v);
  const balance=c=>exact(c,['leftMass','unitMass','maxCount'])&&integer(c.leftMass)&&c.leftMass>=1&&c.leftMass<=1000&&integer(c.unitMass)&&c.unitMass>=1&&c.unitMass<=100&&integer(c.maxCount)&&c.maxCount>=2&&c.maxCount<=12&&c.leftMass%c.unitMass===0&&c.leftMass/c.unitMass<=c.maxCount;
  function validStory(c){
    if(!exact(c,['scenes'])||!Array.isArray(c.scenes)||c.scenes.length<2||c.scenes.length>8)return false;
    const scenes=c.scenes;
    if(!scenes.every(s=>exact(s,['id','text','question','options','answer'])&&id(s.id)&&text(s.text)&&text(s.question)&&Array.isArray(s.options)&&s.options.length>=2&&s.options.length<=4&&s.options.every(o=>exact(o,['id','label','next'])&&id(o.id)&&text(o.label)&&(o.next===null||id(o.next)))&&unique(s.options.map(o=>o.id))&&unique(s.options.map(o=>o.label.trim()))&&s.options.some(o=>o.id===s.answer))||!unique(scenes.map(s=>s.id)))return false;
    // Only forward edges; every scene must be reachable, and every route terminates.
    const reached=new Set([scenes[0].id]);
    for(const [i,s] of scenes.entries()){
      for(const o of s.options){
        if(o.next!==null){if(!scenes.slice(i+1).some(n=>n.id===o.next))return false;if(reached.has(s.id))reached.add(o.next);}
      }
    }
    return reached.size===scenes.length;
  }
  function storyResult(c,choices){
    if(!Array.isArray(choices)||!choices.length||choices.length>c.scenes.length)return null;
    let current=c.scenes[0],correct=true;
    for(const choice of choices){
      if(!current||!exact(choice,['sceneId','optionId'])||choice.sceneId!==current.id)return null;
      const option=current.options.find(o=>o.id===choice.optionId);if(!option)return null;
      correct=correct&&choice.optionId===current.answer;
      current=option.next===null?null:c.scenes.find(s=>s.id===option.next);
    }
    return {done:current===null,correct};
  }
  const guides=Object.freeze({I:[[50,15],[50,85]],L:[[25,15],[25,85],[80,85]],V:[[15,15],[50,85],[85,15]],'1':[[30,35],[50,15],[50,85]],'7':[[15,15],[85,15],[40,85]],'١':[[50,15],[50,85]]});
  const glyph=v=>typeof v==='string'&&Object.hasOwn(guides,v);
  const colors=Object.freeze({red:'#e85a62',blue:'#4889dd',green:'#62a65b',yellow:'#f5c94c',purple:'#9868cf'});
  const color=v=>typeof v==='string'&&Object.hasOwn(colors,v);
  const regions=Object.freeze({circle:'دائرة',triangle:'مثلث',square:'مربع'});
  const dense=a=>Array.isArray(a)&&Array.from({length:a.length},(_,i)=>Object.hasOwn(a,i)).every(Boolean);
  const point=p=>Array.isArray(p)&&p.length===2&&dense(p)&&p.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=100);
  const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  const stroke=s=>Array.isArray(s)&&s.length>=2&&s.length<=512&&dense(s)&&s.every(point);
  const pathLength=s=>s.slice(1).reduce((n,p,i)=>n+dist(p,s[i]),0);
  function traceGrade(g,s){
    if(!stroke(s)||pathLength(s)<10)return 'unresolved';
    const guide=guides[g],samples=[guide[0]];
    for(let i=1;i<guide.length;i++){const a=guide[i-1],b=guide[i],n=Math.ceil(dist(a,b)/5);for(let j=1;j<=n;j++)samples.push([a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n]);}
    if(dist(s[0],samples[0])>12||dist(s.at(-1),samples.at(-1))>12||s.slice(1).some((p,i)=>dist(p,s[i])>18))return 'incorrect';
    let cursor=0;for(const p of s){if(!samples.some(q=>dist(p,q)<=12))return 'incorrect';while(cursor<samples.length&&dist(p,samples[cursor])<=10)cursor++;}
    return cursor===samples.length&&pathLength(s)<=pathLength(samples)*2?'correct':'incorrect';
  }
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
      case 'reading-aloud':valid=exact(c,['language','segments'])&&['ar','en'].includes(c.language)&&Array.isArray(c.segments)&&c.segments.length>=1&&c.segments.length<=8&&dense(c.segments)&&c.segments.every(answerText);break;
      case 'speech-repeat':valid=exact(c,['language','spokenText'])&&['ar','en'].includes(c.language)&&answerText(c.spokenText);break;
      case 'dictation':valid=exact(c,['language','spokenText','answers'])&&['ar','en'].includes(c.language)&&answerText(c.spokenText)&&alternatives(c.answers)&&dense(c.answers)&&c.answers.some(a=>normalize(a)===normalize(c.spokenText));break;
      case 'number-line':valid=exact(c,['min','max','step','answer'])&&integer(c.min)&&integer(c.max)&&integer(c.step)&&c.step>0&&c.max>c.min&&(c.max-c.min)%c.step===0&&(c.max-c.min)/c.step<=20&&onLine(c,c.answer);break;
      case 'fractions':valid=exact(c,['numerator','denominator'])&&fraction(c);break;
      case 'geometry':valid=exact(c,['answer'])&&shapeId(c.answer);break;
      case 'equations':valid=equation(c);break;
      case 'memory-game':valid=exact(c,['items','maxTurns'])&&entries(c.items,2,6)&&integer(c.maxTurns)&&c.maxTurns>=c.items.length&&c.maxTurns<=40;break;
      case 'puzzle':valid=exact(c,['items','answer'])&&entries(c.items,3,8)&&sameSet(c.answer,c.items.map(o=>o.id))&&!c.answer.every((x,i)=>x===c.items[i].id);break;
      case 'maze':valid=validMaze(c);break;
      case 'image-hotspot':valid=exact(c,['diagram','answer'])&&regionId(c.diagram,c.answer);break;
      case 'science-simulation':valid=balance(c);break;
      case 'interactive-story':valid=validStory(c);break;
      case 'trace':valid=exact(c,['glyph'])&&glyph(c.glyph);break;
      case 'free-drawing':valid=exact(c,[]);break;
      case 'coloring':valid=exact(c,['answers'])&&exact(c.answers,Object.keys(regions))&&Object.values(c.answers).every(color);break;
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
      case 'reading-aloud':return exact(response,['readSegments'])&&Array.isArray(response.readSegments)&&response.readSegments.length===c.segments.length&&dense(response.readSegments)&&response.readSegments.every((value,index)=>value===index)?{status:'completed'}:{status:'unresolved'};
      case 'speech-repeat':return exact(response,['heard','repeated'])&&response.heard===true&&response.repeated===true?{status:'completed'}:{status:'unresolved'};
      case 'dictation':resolved=exact(response,['heard','answer'])&&response.heard===true&&answerText(response.answer);correct=resolved&&c.answers.some(a=>normalize(a)===normalize(response.answer));break;
      case 'number-line':resolved=onLine(c,response);correct=resolved&&response===c.answer;break;
      case 'trace':return {status:traceGrade(c.glyph,response)};
      case 'free-drawing':return {status:Array.isArray(response)&&response.length>=1&&response.length<=16&&dense(response)&&response.every(stroke)&&response.reduce((n,s)=>n+pathLength(s),0)>=10?'completed':'unresolved'};
      case 'coloring':resolved=exact(response,Object.keys(regions))&&Object.values(response).every(color);correct=resolved&&Object.keys(regions).every(k=>response[k]===c.answers[k]);break;
      case 'image-hotspot':resolved=regionId(c.diagram,response);correct=response===c.answer;break;
      case 'science-simulation':resolved=integer(response)&&response>=0&&response<=c.maxCount;correct=resolved&&response*c.unitMass===c.leftMass;break;
      case 'interactive-story':{const r=storyResult(c,response);resolved=!!r?.done;correct=resolved&&r.correct;break;}
      case 'memory-game':{const r=memoryResult(c,response);resolved=!!r?.done;correct=!!r?.correct;break;}
      case 'puzzle':resolved=sameSet(response,c.items.map(o=>o.id));correct=resolved&&response.every((x,i)=>x===c.answer[i]);break;
      case 'maze':{
        if(!Array.isArray(response)||response.length>100)break;
        const layout=mazeLayout(c);let pos=layout.start,legal=true;
        for(const dir of response){if(samePos(pos,layout.goal)){legal=false;break;}const next=mazeStep(c,pos,dir);if(!next){legal=false;break;}pos=next;}
        resolved=legal&&(samePos(pos,layout.goal)||response.length===100);correct=resolved&&samePos(pos,layout.goal);break;
      }
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
    let dragAssignments=null,gameResponse=null;
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
    function gameNotice(board,message){const n=doc.createElement('p');n.setAttribute('aria-live','polite');n.textContent=message;board.append(n);return n;}
    function gameButton(parent,label,handler){const b=doc.createElement('button');b.type='button';b.textContent=label;b.onclick=handler;parent.append(b);return b;}
    function memoryBoard(){
      const board=doc.createElement('div'),grid=doc.createElement('div');grid.className='activity-memory-grid';
      const cards=c.items.flatMap(o=>[{id:o.id+':a',label:o.label},{id:o.id+':b',label:o.label}]);
      // Shuffle positions each time; correct result is validated from actual pair history.
      for(let i=cards.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[cards[i],cards[j]]=[cards[j],cards[i]];}
      const notice=gameNotice(board,'اكشفي بطاقتين متطابقتين.'),turns=[],buttons=[];
      let open=[],matched=new Set(),done=false;gameResponse=()=>turns.map(t=>t.slice());
      function draw(){
        for(const [i,b] of buttons.entries()){
          const card=cards[i],visible=matched.has(card.id)||open.includes(card.id);
          b.textContent=visible?card.label:'؟';b.setAttribute('aria-label','بطاقة '+(i+1)+(visible?': '+card.label:' مخفية'));
          b.disabled=done||matched.has(card.id);b.setAttribute('aria-pressed',String(visible));b.dataset.matched=String(matched.has(card.id));
        }
      }
      cards.forEach((card,i)=>{
        const b=gameButton(grid,'؟',()=>{
          if(done||fieldset.disabled||matched.has(card.id))return;
          if(open.length===2)open=[];
          if(open.includes(card.id))return;
          open.push(card.id);
          if(open.length===2){
            turns.push(open.slice());const result=memoryResult(c,turns);matched=result.matched;done=result.done;
            notice.textContent=done?(result.correct?'اكتملت الأزواج! تحققي من النتيجة.':'انتهت المحاولات. تحققي من النتيجة.'):'أزواج مكتملة '+matched.size/2+' من '+c.items.length+' · المحاولات '+turns.length+' من '+c.maxTurns;
          }
          draw();
        });b.dataset.cardIndex=String(i);buttons.push(b);
      });
      board.append(grid);fieldset.append(board);draw();
    }
    function puzzleBoard(){
      const board=doc.createElement('div'),grid=doc.createElement('div');grid.className='activity-puzzle-grid';
      const order=c.items.map(o=>o.id);let selected=-1;
      const notice=gameNotice(board,'اختاري قطعتين لتبديل مكانهما، ثم تحققي من الترتيب.');
      gameResponse=()=>order.slice();
      const buttons=order.map((_,i)=>gameButton(grid,'',()=>{
        if(fieldset.disabled)return;
        if(selected===i)selected=-1;
        else if(selected<0)selected=i;
        else{[order[selected],order[i]]=[order[i],order[selected]];selected=-1;}
        draw();
      }));
      function draw(){buttons.forEach((b,i)=>{b.textContent=c.items.find(o=>o.id===order[i]).label;b.setAttribute('aria-label','القطعة '+(i+1)+': '+b.textContent);b.setAttribute('aria-pressed',String(selected===i));});notice.textContent=selected<0?'اختاري قطعتين لتبديل مكانهما.':'اختاري موضع القطعة الأخرى.';}
      board.append(grid);fieldset.append(board);draw();
    }
    function mazeBoard(){
      const board=doc.createElement('div'),grid=doc.createElement('div');grid.className='activity-maze-grid';grid.dir='ltr';
      const layout=mazeLayout(c),moves=[],cells=[],buttons=[];let pos=layout.start.slice(),done=false;
      gameResponse=()=>moves.slice();
      const notice=gameNotice(board,'حرّكي لولو إلى النجمة عبر الممرات.');
      for(const [y,row] of c.grid.entries()){
        const line=doc.createElement('div');line.className='activity-maze-row';
        for(const [x,ch] of Array.from(row).entries()){const cell=doc.createElement('span');cell.className='activity-maze-cell';cell.dataset.wall=String(ch==='#');line.append(cell);cells.push({cell,y,x,ch});}
        grid.append(line);
      }
      function move(dir){
        if(done||fieldset.disabled)return;const next=mazeStep(c,pos,dir);
        if(!next){notice.textContent='هذا الطريق مغلق. جربي اتجاهًا آخر.';return;}
        pos=next;moves.push(dir);done=samePos(pos,layout.goal)||moves.length===100;draw();
      }
      const arrows=doc.createElement('div');arrows.className='activity-maze-arrows';
      for(const [dir,label] of [['up','↑ أعلى'],['left','← يسار'],['down','↓ أسفل'],['right','→ يمين']]){const b=gameButton(arrows,label,()=>move(dir));b.dataset.direction=dir;buttons.push(b);}
      function draw(){
        for(const {cell,y,x,ch} of cells){const here=y===pos[0]&&x===pos[1];cell.textContent=here?'🦉':ch==='G'?'⭐':ch==='#'?'■':'';cell.dataset.player=String(here);cell.setAttribute('aria-hidden','true');}
        buttons.forEach(b=>b.disabled=done);
        notice.textContent=done?(samePos(pos,layout.goal)?'وصلتِ! تحققي من النتيجة.':'انتهت الحركات. تحققي من النتيجة.'):'الصف '+(pos[0]+1)+'، العمود '+(pos[1]+1)+' · الحركات '+moves.length+' من 100';
      }
      board.append(grid,arrows);fieldset.append(board);draw();
    }
    // All geometry is fixed trusted code. Curriculum selects only diagram and region IDs.
    function hotspotBoard(){
      const ns='http://www.w3.org/2000/svg',svg=doc.createElementNS(ns,'svg');
      svg.setAttribute('viewBox','0 0 240 240');svg.setAttribute('class','activity-hotspot-svg');svg.setAttribute('aria-hidden','true');
      const regions=new Map();
      function draw(parent,tag,attributes){const node=doc.createElementNS(ns,tag);for(const [k,v] of Object.entries(attributes))node.setAttribute(k,String(v));parent.append(node);return node;}
      function group(id){const g=draw(svg,'g',{'data-region':id,class:'activity-hotspot-region'});regions.set(id,g);return g;}
      if(c.diagram==='plant'){
        draw(svg,'rect',{x:0,y:182,width:240,height:58,fill:'#f0dfc5'});
        const root=group('root');
        draw(root,'path',{d:'M120 178 L120 225 M120 191 L91 214 M120 198 L150 224 M120 208 L102 230',stroke:'#93683b','stroke-width':11,'stroke-linecap':'round',fill:'none'});
        const stem=group('stem');draw(stem,'rect',{x:111,y:77,width:18,height:103,rx:8,fill:'#41864a'});
        const leaf=group('leaf');draw(leaf,'path',{d:'M111 134 Q55 78 27 120 Q65 173 111 134 M129 151 Q180 97 211 133 Q176 185 129 151',fill:'#75b85c',stroke:'#35763c','stroke-width':3});
        const flower=group('flower');
        for(const [x,y] of [[120,33],[94,50],[146,50],[103,76],[137,76]])draw(flower,'circle',{cx:x,cy:y,r:20,fill:'#f49bbd',stroke:'#b45479','stroke-width':2});
        draw(flower,'circle',{cx:120,cy:58,r:17,fill:'#ffc75e'});
      }else{
        draw(svg,'ellipse',{cx:120,cy:119,rx:77,ry:100,fill:'#ffdfb8',stroke:'#c98e59','stroke-width':3});
        const ears=group('ears');for(const x of [38,202])draw(ears,'ellipse',{cx:x,cy:115,rx:17,ry:24,fill:'#ffcdab',stroke:'#c98e59','stroke-width':3});
        const eyes=group('eyes');for(const x of [87,153]){draw(eyes,'ellipse',{cx:x,cy:89,rx:19,ry:14,fill:'white',stroke:'#7f634a','stroke-width':2});draw(eyes,'circle',{cx:x,cy:89,r:8,fill:'#35415b'});}
        const nose=group('nose');draw(nose,'path',{d:'M120 105 L105 143 Q120 151 135 143 Z',fill:'#e5a77c',stroke:'#a86c48','stroke-width':3});
        const mouth=group('mouth');draw(mouth,'path',{d:'M91 169 Q120 203 149 169 Q120 179 91 169 Z',fill:'#be5b67',stroke:'#9c3f50','stroke-width':3});
      }
      fieldset.append(svg);
      function highlight(){for(const [id,g] of regions)g.classList.toggle('is-selected',controls.some(i=>i.value===id&&i.checked));}
      optionList(Object.entries(diagrams[c.diagram]).map(([id,label])=>({id,label})),'radio');
      controls.forEach(input=>input.addEventListener('change',highlight));
      for(const [id,g] of regions)g.addEventListener('click',()=>{if(fieldset.disabled)return;const input=controls.find(i=>i.value===id);input.checked=true;highlight();});
    }
    function balanceBoard(){
      const board=doc.createElement('div');board.className='activity-balance';let count=0;
      const ns='http://www.w3.org/2000/svg',svg=doc.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 280 180');svg.setAttribute('aria-hidden','true');
      function part(parent,tag,attrs){const n=doc.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));parent.append(n);return n;}
      part(svg,'path',{d:'M140 72 L109 160 L171 160 Z',fill:'#c6b5e6'});
      const beam=part(svg,'g',{});
      part(beam,'line',{x1:35,y1:72,x2:245,y2:72,stroke:'#7951ba','stroke-width':8,'stroke-linecap':'round'});
      for(const x of [55,225]){part(beam,'path',{d:'M'+x+' 72 L'+(x-26)+' 120 L'+(x+26)+' 120 Z',fill:'#e7d9fa',stroke:'#7951ba','stroke-width':2});}
      const notice=gameNotice(board,'');
      const controlsBox=doc.createElement('div');controlsBox.className='activity-balance-controls';
      const minus=gameButton(controlsBox,'− إزالة ثقل',()=>{if(!fieldset.disabled&&count>0){count--;draw();}});
      const plus=gameButton(controlsBox,'+ إضافة ثقل',()=>{if(!fieldset.disabled&&count<c.maxCount){count++;draw();}});
      function draw(){
        const difference=count*c.unitMass-c.leftMass;
        beam.setAttribute('transform','rotate('+(difference===0?0:difference>0?12:-12)+' 140 72)');
        notice.textContent='اليسار: '+c.leftMass+' جم · اليمين: '+count+' × '+c.unitMass+' جم = '+count*c.unitMass+' جم. '+(difference===0?'الكفتان متوازنتان.':difference>0?'الكفة اليمنى أثقل.':'الكفة اليسرى أثقل.');
        minus.disabled=count===0;plus.disabled=count===c.maxCount;
      }
      board.prepend(svg);board.append(controlsBox);fieldset.append(board);gameResponse=()=>count;draw();
    }
    function storyBoard(){
      const board=doc.createElement('div');board.className='activity-story';
      const body=doc.createElement('p'),question=doc.createElement('h4'),options=doc.createElement('div');
      const notice=gameNotice(board,'');let scene=c.scenes[0];const choices=[];
      board.append(body,question,options);fieldset.append(board);gameResponse=()=>choices.map(x=>({...x}));
      function draw(){
        options.replaceChildren();
        if(!scene){body.textContent='انتهت القصة.';question.textContent='تحققي من الإجابات.';notice.textContent='اكتمل مسار القصة.';return;}
        notice.textContent='صفحة '+(c.scenes.indexOf(scene)+1)+' من '+c.scenes.length;
        body.textContent=scene.text;question.textContent=scene.question;
        for(const option of scene.options)gameButton(options,option.label,()=>{
          if(fieldset.disabled||!scene)return;
          choices.push({sceneId:scene.id,optionId:option.id});
          scene=option.next===null?null:c.scenes.find(s=>s.id===option.next);draw();
        });
      }
      draw();
    }
    function drawingBoard(){
      const board=doc.createElement('div'),canvas=doc.createElement('canvas');canvas.width=320;canvas.height=320;canvas.className='activity-drawing-canvas';canvas.setAttribute('aria-label',activity.type==='trace'?'مسار التتبع':'لوحة الرسم الحر');
      const ctx=canvas.getContext('2d'),strokes=[];let active=null,pointer=null;
      if(!ctx){board.textContent='الرسم غير متاح على هذا الجهاز.';fieldset.append(board);gameResponse=()=>null;return;}
      function path(points,color,width){if(!points.length)return;ctx.beginPath();ctx.moveTo(points[0][0]*3.2,points[0][1]*3.2);for(const p of points.slice(1))ctx.lineTo(p[0]*3.2,p[1]*3.2);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke();}
      function draw(){ctx.fillStyle='#fff';ctx.fillRect(0,0,320,320);if(activity.type==='trace'){const guide=guides[c.glyph];path(guide,'#e2d6f4',28);path(guide,'#ae97d0',2);ctx.fillStyle='#428b56';ctx.beginPath();ctx.arc(guide[0][0]*3.2,guide[0][1]*3.2,7,0,Math.PI*2);ctx.fill();}for(const s of strokes)path(s,'#6341a3',5);if(active)path(active,'#6341a3',5);}
      function sample(ev){const b=canvas.getBoundingClientRect();return b.width&&b.height?[Math.max(0,Math.min(100,(ev.clientX-b.left)/b.width*100)),Math.max(0,Math.min(100,(ev.clientY-b.top)/b.height*100))]:null;}
      canvas.addEventListener('pointerdown',ev=>{if(fieldset.disabled||pointer!==null||ev.button!==0||strokes.length>=(activity.type==='trace'?1:16))return;const p=sample(ev);if(!p)return;pointer=ev.pointerId;active=[p];canvas.setPointerCapture?.(pointer);draw();});
      function appendSample(ev){const p=sample(ev);if(p&&active&&active.length<512&&dist(p,active.at(-1))>=.7)active.push(p);}
      canvas.addEventListener('pointermove',ev=>{if(pointer!==ev.pointerId||!active||fieldset.disabled)return;for(const event of (ev.getCoalescedEvents?.()||[]))appendSample(event);appendSample(ev);draw();});
      function end(ev,keep){if(pointer!==ev.pointerId)return;if(keep&&!fieldset.disabled&&active){appendSample(ev);if(active.length>=2)strokes.push(active);}pointer=null;active=null;draw();}
      canvas.addEventListener('pointerup',ev=>end(ev,true));canvas.addEventListener('pointercancel',ev=>end(ev,false));canvas.addEventListener('lostpointercapture',ev=>end(ev,false));
      gameNotice(board,activity.type==='trace'?'ابدئي من النقطة الخضراء وتتبعي المسار بحركة واحدة.':'ارسمي ما تحبين. لا توجد درجة لجمال الرسم.');
      board.append(canvas);gameButton(board,'مسح وإعادة الرسم',()=>{if(fieldset.disabled)return;strokes.length=0;active=null;pointer=null;draw();});
      gameResponse=()=>active?null:activity.type==='trace'?strokes[0]||null:strokes;fieldset.append(board);draw();
    }
    function coloringBoard(){
      const ns='http://www.w3.org/2000/svg',svg=doc.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 240 100');svg.setAttribute('class','activity-coloring-svg');svg.setAttribute('aria-hidden','true');
      const chosen={},nodes=new Map(),selects=new Map();let selected='red';
      const palette=doc.createElement('div');palette.className='activity-color-palette';const names={red:'أحمر',blue:'أزرق',green:'أخضر',yellow:'أصفر',purple:'بنفسجي'},buttons=[];
      function refresh(){for(const [k,n] of nodes){n.setAttribute('fill',chosen[k]?colors[chosen[k]]:'#fff');selects.get(k).value=chosen[k]||'';}for(const [k,b] of buttons)b.setAttribute('aria-pressed',String(k===selected));}
      for(const k of Object.keys(colors)){const b=gameButton(palette,names[k],()=>{if(!fieldset.disabled){selected=k;refresh();}});buttons.push([k,b]);}
      fieldset.append(palette,svg);
      for(const [k,tag,attrs] of [['circle','circle',{cx:40,cy:50,r:28}],['triangle','polygon',{points:'120,19 150,80 90,80'}],['square','rect',{x:173,y:22,width:56,height:56}]]){
        const n=doc.createElementNS(ns,tag);for(const [a,v] of Object.entries(attrs))n.setAttribute(a,String(v));n.setAttribute('stroke','#7951ba');n.setAttribute('stroke-width','3');n.dataset.region=k;svg.append(n);nodes.set(k,n);
        n.onclick=()=>{if(!fieldset.disabled){chosen[k]=selected;refresh();}};
        const label=doc.createElement('label'),select=doc.createElement('select');label.textContent='لون '+regions[k];select.setAttribute('aria-label','لون '+regions[k]);select.append(new Option('اختاري',''));for(const id of Object.keys(colors))select.append(new Option(names[id],id));select.onchange=()=>{if(fieldset.disabled)return;if(select.value)chosen[k]=select.value;else delete chosen[k];refresh();};label.append(select);fieldset.append(label);selects.set(k,select);
      }
      gameResponse=()=>({...chosen});refresh();
    }
    function readingBoard(){
      const line=doc.createElement('p');line.lang=c.language;line.dir=c.language==='ar'?'rtl':'ltr';line.style.fontSize='1.35em';line.style.lineHeight='1.8';
      const status=doc.createElement('p');status.setAttribute('aria-live','polite');
      const note=doc.createElement('p');note.textContent='اقرئي كل جزء بصوتك ثم أكدي الانتهاء. لا نستخدم الميكروفون ولا نقيس سرعة أو دقة القراءة.';
      fieldset.append(note,status,line);
      const read=[];let position=0;
      const next=gameButton(fieldset,'قرأت هذا الجزء',()=>{if(fieldset.disabled||position>=c.segments.length)return;read.push(position++);refresh();});
      const reset=gameButton(fieldset,'ابدئي من جديد',()=>{if(fieldset.disabled)return;read.length=0;position=0;refresh();});
      function refresh(){
        const done=position===c.segments.length;
        status.textContent=done?'اكتملت جميع الأجزاء. اضغطي إنهاء التدريب.':String(position+1)+' / '+String(c.segments.length);
        line.textContent=done?'':c.segments[position];next.disabled=done;reset.disabled=position===0;
      }
      gameResponse=()=>({readSegments:[...read]});refresh();
    }
    function localSpeechBoard(){
      const repeat=activity.type==='speech-repeat';
      const view=doc.defaultView,synth=view?.speechSynthesis;
      const notice=doc.createElement('p');notice.setAttribute('aria-live','polite');
      const input=doc.createElement('input');input.type=repeat?'checkbox':'text';input.maxLength=200;input.autocomplete='off';input.spellcheck=false;input.setAttribute('aria-label',repeat?'كررت العبارة بصوتي':'إجابة الإملاء');input.disabled=true;
      let heard=false,active=null,timer=null,observer=null;
      const available=()=>{try{return Array.from(synth?.getVoices()||[]).find(v=>v.localService===true&&String(v.lang).toLowerCase().split(/[-_]/)[0]===c.language);}catch{return null;}};
      function finish(ok){
        if(!active)return;
        active=null;view.clearTimeout(timer);observer?.disconnect();doc.removeEventListener('visibilitychange',visibility);
        heard=ok;input.disabled=!ok;
        play.disabled=false;notice.textContent=ok?(repeat?'كرري العبارة بصوتك ثم أكدي أنك تدربتِ. لا يتم تسجيل صوتك أو تقييم نطقك.':'اكتبي ما سمعتيه.'):'الصوت لم يكتمل. جربي الاستماع مرة أخرى.';
      }
      function cancel(){if(!active)return;finish(false);try{synth.cancel();}catch{}}
      function visibility(){if(doc.visibilityState==='hidden')cancel();}
      const play=gameButton(fieldset,repeat?'استمعي للعبارة':'استمعي للإملاء',()=>{
        if(fieldset.disabled||active)return;
        heard=false;input.disabled=true;if(repeat)input.checked=false;
        const voice=available();
        if(!voice||!view?.SpeechSynthesisUtterance){notice.textContent='الصوت المحلي المناسب غير متاح على الجهاز. لم تُسجل درجة؛ أضيفي صوت اللغة من إعدادات الجهاز ثم جربي.';return;}
        if(synth.speaking||synth.pending){notice.textContent='انتظري انتهاء الصوت الحالي ثم جربي.';return;}
        try{
          const utterance=new view.SpeechSynthesisUtterance(c.spokenText);utterance.voice=voice;utterance.lang=voice.lang;utterance.rate=.85;
          active=utterance;play.disabled=true;notice.textContent='استمعي أولًا…';
          utterance.onend=()=>{if(active===utterance)finish(form.isConnected&&!form.closest('[hidden],[aria-hidden="true"]')&&doc.visibilityState!=='hidden');};
          utterance.onerror=()=>{if(active===utterance)finish(false);};
          observer=new view.MutationObserver(()=>{if(!form.isConnected||form.closest('[hidden],[aria-hidden="true"]'))cancel();});
          observer.observe(doc.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','aria-hidden']});
          doc.addEventListener('visibilitychange',visibility);
          timer=view.setTimeout(cancel,30000);
          synth.speak(utterance);
        }catch{if(active)cancel();else notice.textContent='تعذر تشغيل الصوت المحلي.';}
      });
      notice.textContent=repeat?'استمعي للعبارة ثم كرريها بصوتك. لا نستخدم الميكروفون ولا نقيم النطق.':'استمعي للصوت المحلي قبل كتابة الإجابة.';
      fieldset.append(notice);
      if(repeat){const label=doc.createElement('label');label.append(input,doc.createTextNode(' كررت العبارة بصوتي'));fieldset.append(label);}else fieldset.append(input);
      gameResponse=()=>heard&&!active?(repeat?{heard:true,repeated:input.checked}:{heard:true,answer:input.value}):null;
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
    else if(activity.type==='reading-aloud')readingBoard();
    else if(activity.type==='dictation'||activity.type==='speech-repeat')localSpeechBoard();
    else if(activity.type==='memory-game')memoryBoard();
    else if(activity.type==='puzzle')puzzleBoard();
    else if(activity.type==='maze')mazeBoard();
    else if(activity.type==='image-hotspot')hotspotBoard();
    else if(activity.type==='science-simulation')balanceBoard();
    else if(activity.type==='interactive-story')storyBoard();
    else if(activity.type==='trace'||activity.type==='free-drawing')drawingBoard();
    else if(activity.type==='coloring')coloringBoard();
    else if(activity.type==='sequence')c.items.forEach((_,i)=>selector('المكان '+(i+1),c.items));
    else if(activity.type==='match')c.left.forEach(o=>selector(o.label,c.right));
    else if(activity.type==='classify')c.items.forEach(o=>selector(o.label,c.groups));
    const feedback=doc.createElement('p');feedback.setAttribute('role','status');
    const submit=doc.createElement('button');submit.type='submit';submit.textContent=activity.type==='free-drawing'?'إنهاء الرسم':activity.type==='speech-repeat'?'إنهاء تدريب التكرار':activity.type==='reading-aloud'?'إنهاء تدريب القراءة':'تحقق من الإجابة';form.append(submit,feedback);
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
      else if(activity.type==='geometry'||activity.type==='image-hotspot')response=controls.find(x=>x.checked)?.value;
      else if(activity.type==='equations')response=controls[0].value.trim()===''?null:Number(controls[0].value);
      else if(activity.type==='drag-drop')response=Object.fromEntries(dragAssignments);
      else if(gameResponse)response=gameResponse();
      else if(activity.type==='sequence')response=controls.map(x=>x.value);
      else response=Object.fromEntries((activity.type==='match'?c.left:c.items).map((o,i)=>[o.id,controls[i].value]));
      const result=evaluate(activity,response);
      feedback.textContent=result.status==='completed'?(activity.type==='speech-repeat'?'تم إكمال تدريب التكرار دون تقييم النطق.':activity.type==='reading-aloud'?'تم إكمال تدريب القراءة دون تقييم الدقة أو السرعة.':'تم إكمال النشاط الفني!'):result.status==='correct'?'أحسنت! ⭐':result.status==='incorrect'?'محاولة جميلة، راجعي الإجابة.':'كمّلي الاختيارات الأول.';
      if(result.status!=='unresolved'){finished=true;fieldset.disabled=true;submit.disabled=true;onResult?.(result);}
    });
    container.append(form);return true;
  }
  const api=Object.freeze({types,planned,validate,evaluate,checkLessons,render});
  if(typeof window!=='undefined')window.LoloActivities=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
