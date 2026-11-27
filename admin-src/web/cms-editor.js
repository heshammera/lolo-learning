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
      input.setAttribute('aria-label',label);
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
        input.addEventListener('change',()=>{if(permitted()){sync();/* refreshed labels on structural rebuild */}});
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
      else if(a.type==='fill-blank'||a.type==='free-text'){
        box.append(el('p','أضيفي البدائل المقبولة. لا يُستخدم هذا النشاط لتقييم المقالات أو الفهم المفتوح.'));
        c.answers.forEach((answer,i)=>{
          const row=el('div');row.className='cms-row';box.append(row);
          field(row,'إجابة مقبولة '+(i+1),answer,v=>c.answers[i]=v,{max:200});
          if(c.answers.length>1)remove(row,c.answers,i,'حذف البديل');
        });
        const add=button(box,'إضافة بديل',()=>{c.answers.push('');rebuild();});add.disabled=c.answers.length>=8;
      }else if(a.type==='number-line'){
        for(const [key,label] of [['min','بداية الخط'],['max','نهاية الخط'],['step','المسافة بين العلامات'],['answer','العدد الصحيح']])field(box,label,c[key],v=>c[key]=v,{type:'number'});
        box.append(el('p','حد أقصى ٢١ علامة. يجب أن تكون الإجابة على إحدى العلامات.'));
      }else if(a.type==='fractions'){
        field(box,'البسط الصحيح',c.numerator,v=>c.numerator=v,{type:'number'});
        field(box,'المقام الصحيح',c.denominator,v=>c.denominator=v,{type:'number'});
        box.append(el('p','تُقبل الكسور المكافئة ضمن النطاق ٠ إلى ١. الحد الأقصى للمقام ١٠٠٠.'));
      }else if(a.type==='geometry'){
        select(box,'الشكل الصحيح',c.answer,[{id:'circle',label:'دائرة'},{id:'triangle',label:'مثلث'},{id:'square',label:'مربع'},{id:'rectangle',label:'مستطيل'},{id:'pentagon',label:'خماسي'}],v=>c.answer=v);
      }else if(a.type==='equations'){
        for(const [key,label] of [['coefficient','معامل س'],['constant','الثابت'],['result','الطرف الآخر']])field(box,label,c[key],v=>c[key]=v,{type:'number'});
        box.append(el('p','المعادلة من الصورة أ × س + ب = ج، بمعامل موجب وحل صحيح.'));
      }else if(a.type==='choice'||a.type==='multi-choice'){
        list(box,'الاختيارات',c.options);
        if(a.type==='choice')select(box,'الإجابة الصحيحة',c.answer,c.options,v=>c.answer=v);
        else{
          const group=el('fieldset');group.append(el('legend','الإجابات الصحيحة (اثنتان أو أكثر)'));box.append(group);
          for(const o of c.options){const l=el('label'),i=el('input');i.type='checkbox';i.checked=c.answers.includes(o.id);i.disabled=!permitted();l.append(i,doc.createTextNode(o.label));group.append(l);i.onchange=()=>{if(!permitted())return;c.answers=c.options.filter(x=>x.id===o.id?i.checked:c.answers.includes(x.id)).map(x=>x.id);sync();};}
        }
      }else if(a.type==='image-hotspot'){
        const regions={plant:[['flower','الزهرة'],['leaf','الورقة'],['stem','الساق'],['root','الجذور']],face:[['eyes','العينان'],['nose','الأنف'],['mouth','الفم'],['ears','الأذنان']]};
        select(box,'الرسم المدمج',c.diagram,[{id:'plant',label:'نبات'},{id:'face',label:'وجه'}],v=>{if(!regions[v])return;c.diagram=v;c.answer=regions[v][0][0];},true);
        select(box,'الجزء الصحيح',c.answer,regions[c.diagram].map(([id,label])=>({id,label})),v=>c.answer=v);
      }else if(a.type==='science-simulation'){
        for(const [key,label] of [['leftMass','كتلة الكفة اليسرى (جم)'],['unitMass','كتلة الثقل الواحد (جم)'],['maxCount','أقصى عدد للأثقال']])field(box,label,c[key],v=>c[key]=v,{type:'number'});
        box.append(el('p','يجب أن يمكن الوصول إلى التوازن بعدد صحيح من الأثقال (حتى ١٢).'));
      }else if(a.type==='interactive-story'){
        box.append(el('p','من صفحتين إلى ثماني صفحات. يمكن لكل اختيار الانتقال إلى صفحة لاحقة أو إنهاء القصة. يجب أن تكون جميع الصفحات قابلة للوصول.'));
        c.scenes.forEach((scene,i)=>{
          const pane=el('div');pane.className='cms-story-page';box.append(pane);pane.append(el('h5','صفحة '+(i+1)));
          field(pane,'نص الصفحة',scene.text,v=>scene.text=v,{max:500});
          field(pane,'سؤال الصفحة',scene.question,v=>scene.question=v,{max:500});
          scene.options.forEach((o,j)=>{
            const row=el('div');row.className='cms-row';pane.append(row);
            field(row,'اختيار '+(j+1),o.label,v=>o.label=v,{max:500});
            select(row,'انتقال الاختيار '+(j+1),o.next||'end',[{id:'end',label:'نهاية القصة'},...c.scenes.slice(i+1).map((n,k)=>({id:n.id,label:'صفحة '+(i+k+2)}))],v=>o.next=v==='end'||!v?null:v);
            if(scene.options.length>2)remove(row,scene.options,j,'حذف الاختيار');
          });
          const add=button(pane,'إضافة اختيار',()=>{scene.options.push({id:uid('option'),label:'اختيار جديد',next:null});rebuild();});add.disabled=scene.options.length>=4;
          select(pane,'الإجابة الصحيحة للصفحة',scene.answer,scene.options,v=>scene.answer=v);
          if(c.scenes.length>2&&i>0)button(pane,'حذف الصفحة',()=>{if(confirm('حذف الصفحة؟')){c.scenes.splice(i,1);for(const s of c.scenes)for(const o of s.options)if(o.next===scene.id)o.next=null;rebuild();}});
        });
        const add=button(box,'إضافة صفحة',()=>{const newId=uid('scene'),first=uid('option');c.scenes.push({id:newId,text:'صفحة جديدة',question:'سؤال جديد',options:[{id:first,label:'اختيار أول',next:null},{id:uid('option'),label:'اختيار ثانٍ',next:null}],answer:first});rebuild();});add.disabled=c.scenes.length>=8;
      }else if(a.type==='memory-game'){
        list(box,'البطاقات',c.items,6);field(box,'أقصى عدد للمحاولات',c.maxTurns,v=>c.maxTurns=v,{type:'number'});
        box.append(el('p','كل بطاقة تظهر مرتين؛ من ٢ إلى ٦ أزواج، وبحد أقصى ٤٠ محاولة.'));
      }else if(a.type==='maze'){
        box.append(el('p','اختاري نوع كل خلية. يجب وجود بداية واحدة وهدف واحد وطريق مفتوح بينهما.'));
        const kinds=[{id:'.',label:'ممر'},{id:'#',label:'جدار'},{id:'S',label:'بداية'},{id:'G',label:'هدف'}];
        c.grid.forEach((row,y)=>{
          const cells=el('div');cells.className='cms-row';box.append(cells);
          Array.from(row).forEach((ch,x)=>select(cells,'صف '+(y+1)+' عمود '+(x+1),ch,kinds,v=>{c.grid[y]=c.grid[y].slice(0,x)+(v||'.')+c.grid[y].slice(x+1);}));
        });
        const addRow=button(box,'إضافة صف',()=>{c.grid.push('.'.repeat(c.grid[0].length));rebuild();});addRow.disabled=c.grid.length>=8;
        const delRow=button(box,'حذف آخر صف',()=>{c.grid.pop();rebuild();});delRow.disabled=c.grid.length<=3;
        const addCol=button(box,'إضافة عمود',()=>{c.grid=c.grid.map(row=>row+'.');rebuild();});addCol.disabled=c.grid[0].length>=8;
        const delCol=button(box,'حذف آخر عمود',()=>{c.grid=c.grid.map(row=>row.slice(0,-1));rebuild();});delCol.disabled=c.grid[0].length<=3;
      }else if(a.type==='sequence'||a.type==='puzzle'){
        list(box,'العناصر',c.items);
        c.answer=c.items.map((_,i)=>c.answer[i]||'');
        c.items.forEach((_,i)=>select(box,'الترتيب الصحيح '+(i+1),c.answer[i],c.items,v=>c.answer[i]=v));
      }else if(a.type==='match'||a.type==='classify'||a.type==='drag-drop'){
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
