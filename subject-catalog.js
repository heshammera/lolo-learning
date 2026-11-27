(() => {
  // Registered implementation capabilities, not permissions granted by curriculum data.
  const profiles=Object.freeze({
    english:Object.freeze({id:'english',label:'إنجليزي',icon:'🔤',writing:'english',scene:'cards',live:true,spokenRepeat:true}),
    mathematics:Object.freeze({id:'mathematics',label:'ماث',icon:'🔢',writing:'math',scene:'math',live:true,spokenRepeat:true}),
  });
  function profile(subjectId,course){
    if(Object.hasOwn(profiles,subjectId))return profiles[subjectId];
    const meta=course?.subjects?.find(s=>s?.id===subjectId);
    return Object.freeze({id:subjectId||'',label:meta?.titleAr||meta?.title||'مادة تعليمية',icon:'📚',writing:null,scene:'cards',live:false,spokenRepeat:false});
  }
  function programs(course){
    const list=[{id:'foundation',title:'تأسيس من الصفر',curriculumLabel:'تأسيس من الصفر',gradeId:'foundation',gradeLabel:'مرحلة التأسيس',subjectId:'english',units:course?.units||[]},...(course?.programs||[])];
    return list.filter(p=>p.status!=='draft'&&p.status!=='archived').map(p=>({...p,subjectId:p.subjectId||(p.subject==='math'?'mathematics':'english')}));
  }
  function lessons(course){
    if(!course)return [];
    return programs(course).flatMap(p=>p.units.flatMap(u=>u.lessons.map(l=>({...l,programId:p.id,programTitle:p.title,unitTitle:u.title,unitId:u.id}))));
  }
  function forProgram(p,course){return profile(p?.subjectId||(p?.subject==='math'?'mathematics':null),course);}
  const api=Object.freeze({profile,programs,lessons,forProgram});
  if(typeof window!=='undefined')window.LoloSubjectCatalog=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
