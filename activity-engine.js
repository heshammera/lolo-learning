/* Data-only, versioned activity contracts. No executable content or external requests. */
(() => {
  const types=Object.freeze(Object.fromEntries([
    ['choice','اختيار من متعدد'],['true-false','صح أو خطأ'],['multi-choice','اختيار عدة إجابات'],
    ['sequence','ترتيب العناصر'],['match','توصيل العناصر'],['numeric','إجابة رقمية'],['classify','تصنيف العناصر'],
    ['fill-blank','أكمل الفراغ'],['free-text','إجابة نصية قصيرة'],['number-line','خط الأعداد'],['fractions','الكسور المكافئة'],
    ['drag-drop','السحب والإفلات'],['geometry','الأشكال الهندسية'],['equations','المعادلات الخطية'],
    ['memory-game','لعبة الذاكرة'],['puzzle','بازل الترتيب'],['maze','المتاهة'],
  ].map(([id,label])=>[id,Object.freeze({id,label,version:1,offline:true,evaluator:'deterministic',renderer:'generic-v1'})])));
  const planned=Object.freeze(['image-hotspot','speech-repeat','phoneme-score','dictation','conversation','trace','free-drawing','coloring','science-simulation','interactive-story','reading-aloud','homework-upload']);
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
      case 'memory-game':valid=exact(c,['items','maxTurns'])&&entries(c.items,2,6)&&integer(c.maxTurns)&&c.maxTurns>=c.items.length&&c.maxTurns<=40;break;
      case 'puzzle':valid=exact(c,['items','answer'])&&entries(c.items,3,8)&&sameSet(c.answer,c.items.map(o=>o.id))&&!c.answer.every((x,i)=>x===c.items[i].id);break;
      case 'maze':valid=validMaze(c);break;
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
    else if(activity.type==='memory-game')memoryBoard();
    else if(activity.type==='puzzle')puzzleBoard();
    else if(activity.type==='maze')mazeBoard();
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
      else if(gameResponse)response=gameResponse();
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
