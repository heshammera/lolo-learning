/* Data-only editor: all authored text is assigned to DOM properties, never HTML. */
(() => {
  const clone=v=>JSON.parse(JSON.stringify(v));
  const uid=prefix=>prefix+'-'+crypto.randomUUID();
  function mount(root,{read,write,library,editable,preview}){
    root.replaceChildren();
    const data=read();if(!data)return;
    const doc=root.ownerDocument;
    const permitted=()=>editable();
    const sync=()=>write(data);
    const rebuild=()=>{sync();mount(root,{read,write,library,editable,preview});};
    const el=(tag,text)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
    function field(parent,label,value,change,{type='text',max=200}={}){
      const wrap=el('label',label),input=el('input');input.type=type;input.value=value??'';input.maxLength=max;
      input.readOnly=!permitted();input.addEventListener('input',()=>{if(!permitted())return;change(type==='number'?(input.value===''?null:Number(input.value)):input.value);sync();});
      wrap.append(input);parent.append(wrap);return input;
    }
    function select(parent,label,value,options,change,rerender=false){
      const wrap=el('label',label),input=el('select');
      input.append(new Option('اختر…',''));
      for(const o of options)input.append(new Option(o.label,o.id));
      input.value=value??'';input.disabled=!permitted();
      input.onchange=()=>{if(!permitted())return;change(input.value);if(rerender)rebuild();else sync();};
      wrap.append(input);parent.append(wrap);return input;
    }
    function button(parent,label,action,{mutates=true}={}){
      const b=el('button',label);b.type='button';b.hidden=mutates&&!permitted();
      b.onclick=()=>{if(!mutates||permitted())action();};parent.append(b);return b;
    }
    function move(parent,array,index){
      const up=button(parent,'↑ تقديم',()=>{[array[index-1],array[index]]=[array[index],array[index-1]];rebuild();});up.disabled=index===0;
      const down=button(parent,'↓ تأخير',()=>{[array[index+1],array[index]]=[array[index],array[index+1]];rebuild();});down.disabled=index===array.length-1;
    }
    function remove(parent,array,index,label){
      button(parent,label,()=>{if(confirm('حذف هذا العنصر من المسودة؟')){array.splice(index,1);rebuild();}});
    }
    const templates=library().filter(e=>e.status==='implemented'&&e.example);
    function list(parent,label,array,max=8){
      const box=el('div');box.className='cms-items';box.append(el('h5',label));parent.append(box);
      array.forEach((item,index)=>{
        const row=el('div');row.className='cms-row';box.append(row);
        const input=field(row,label+' '+(index+1),item.label,v=>item.label=v,{max:500});
        // Refresh answer labels only on blur; don't replace the active typing field.
        input.addEventListener('change',()=>{if(permitted())rebuild();});
        if(array.length>2)remove(row,array,index,'حذف');
      });
      const add=button(box,'إضافة عنصر',()=>{array.push({id:uid('item'),label:'عنصر جديد'});rebuild();});add.disabled=array.length>=max;
    }
    function activityEditor(parent,a,activities,index){
      const box=el('section');box.className='cms-activity';box.dataset.activityType=a.type;parent.append(box);
      const title=el('h4',templates.find(e=>e.id===a.type)?.label||a.type);box.append(title);
      const actions=el('div');actions.className='cms-actions';box.append(actions);
      move(actions,activities,index);remove(actions,activities,index,'حذف النشاط');
      button(actions,'معاينة النشاط',()=>preview(clone(a)),{mutates:false});
      field(box,'السؤال أو التعليمات',a.prompt,v=>a.prompt=v,{max:500});
      const c=a.config;
      if(a.type==='true-false')select(box,'الإجابة الصحيحة',String(c.answer),[{id:'true',label:'صح'},{id:'false',label:'خطأ'}],v=>c.answer=v===''?null:v==='true');
      else if(a.type==='numeric')field(box,'الإجابة الرقمية الصحيحة',c.answer,v=>c.answer=v,{type:'number'});
      else if(a.type==='choice'||a.type==='multi-choice'){
        list(box,'الاختيارات',c.options);
        if(a.type==='choice')select(box,'الإجابة الصحيحة',c.answer,c.options,v=>c.answer=v);
        else{
          const group=el('fieldset');group.append(el('legend','الإجابات الصحيحة (اثنتان أو أكثر)'));box.append(group);
          for(const o of c.options){const l=el('label'),i=el('input');i.type='checkbox';i.checked=c.answers.includes(o.id);i.disabled=!permitted();l.append(i,doc.createTextNode(o.label));group.append(l);i.onchange=()=>{if(!permitted())return;c.answers=c.options.filter(x=>x.id===o.id?i.checked:c.answers.includes(x.id)).map(x=>x.id);sync();};}
        }
      }else if(a.type==='sequence'){
        list(box,'العناصر',c.items);
        c.answer=c.items.map((_,i)=>c.answer[i]||'');
        c.items.forEach((_,i)=>select(box,'الترتيب الصحيح '+(i+1),c.answer[i],c.items,v=>c.answer[i]=v));
      }else if(a.type==='match'||a.type==='classify'){
        const left=a.type==='match'?c.left:c.items,right=a.type==='match'?c.right:c.groups;
        const key=a.type==='match'?'pairs':'assignments';
        list(box,a.type==='match'?'العناصر الأولى':'العناصر',left);
        list(box,a.type==='match'?'العناصر المقابلة':'المجموعات',right,a.type==='match'?8:6);
        c[key]=Object.fromEntries(left.map(x=>[x.id,c[key][x.id]||'']));
        left.forEach(o=>select(box,'الإجابة المقابلة: '+o.label,c[key][o.id],right,v=>c[key][o.id]=v));
      }else box.append(el('p','هذا النوع غير مدعوم في المحرر الحالي.'));
    }
    const basics=el('div');basics.className='cms-fields';root.append(basics);
    field(basics,'اسم المنهج',data.title,v=>data.title=v);
    field(basics,'معرّف المادة (مثال science)',data.subjectId,v=>data.subjectId=v,{max:64});
    field(basics,'معرّف الصف (مثال grade-1)',data.gradeId,v=>data.gradeId=v,{max:64});
    data.units.forEach((u,ui)=>{
      const unit=el('section');unit.className='cms-unit';root.append(unit);
      unit.append(el('h3','الوحدة '+(ui+1)));
      field(unit,'عنوان الوحدة',u.title,v=>u.title=v);
      move(unit,data.units,ui);remove(unit,data.units,ui,'حذف الوحدة');
      u.lessons.forEach((l,li)=>{
        const lesson=el('section');lesson.className='cms-lesson';unit.append(lesson);
        lesson.append(el('h4','الدرس '+(li+1)));
        field(lesson,'عنوان الدرس',l.title,v=>l.title=v);field(lesson,'الهدف التعليمي',l.goal,v=>l.goal=v);
        move(lesson,u.lessons,li);remove(lesson,u.lessons,li,'حذف الدرس');
        l.activities.forEach((a,ai)=>activityEditor(lesson,a,l.activities,ai));
        const row=el('div');row.className='cms-row';lesson.append(row);
        const picker=select(row,'إضافة نشاط من المكتبة','',templates.map(e=>({id:e.id,label:e.label})),()=>{});
        const add=button(row,'إضافة النشاط',()=>{const template=templates.find(e=>e.id===picker.value);if(!template||l.activities.length>=50)return;const a=clone(template.example);a.id=uid('activity');l.activities.push(a);rebuild();});
        add.disabled=l.activities.length>=50;
      });
      const addLesson=button(unit,'إضافة درس',()=>{u.lessons.push({id:uid('lesson'),title:'درس جديد',goal:'',activities:[]});rebuild();});addLesson.disabled=u.lessons.length>=50;
    });
    const addUnit=button(root,'إضافة وحدة',()=>{data.units.push({id:uid('unit'),title:'وحدة جديدة',lessons:[]});rebuild();});addUnit.disabled=data.units.length>=30;
    if(permitted())sync();
  }
  window.LoloCmsEditor=Object.freeze({mount});
})();
