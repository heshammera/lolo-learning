// Synthetic draft science examples; not published curriculum or mastery evidence.
(() => {
  const items=(...labels)=>labels.map((label,i)=>({id:'i'+(i+1),label}));
  const activities=[
    {id:'science-choice',type:'choice',version:1,prompt:'أي شيء يحتاجه النبات لينمو؟',config:{options:items('الماء','الحجارة','البلاستيك'),answer:'i1'}},
    {id:'science-bool',type:'true-false',version:1,prompt:'النبات يحتاج الضوء لينمو.',config:{answer:true}},
    {id:'science-multi',type:'multi-choice',version:1,prompt:'اختاري شيئين يحتاجهما النبات.',config:{options:items('الماء','الضوء','اللعبة'),answers:['i1','i2']}},
    {id:'science-order',type:'sequence',version:1,prompt:'رتبي مراحل نمو النبات.',config:{items:items('نبات صغير','بذرة','نبات أكبر'),answer:['i2','i1','i3']}},
    {id:'science-match',type:'match',version:1,prompt:'وصلي كل كائن بالصورة.',config:{left:items('قطة','سمكة'),right:items('🐟','🐈'),pairs:{i1:'i2',i2:'i1'}}},
    {id:'science-count',type:'numeric',version:1,prompt:'عدي الأوراق: 🍃 🍃 🍃',config:{answer:3}},
    {id:'science-groups',type:'classify',version:1,prompt:'صنفي الكائنات.',config:{items:items('قطة','وردة','سمكة'),groups:items('حيوان','نبات'),assignments:{i1:'i1',i2:'i2',i3:'i1'}}},
  ];
  const api={status:'draft',lessons:[{id:'science-draft-plants',activities:activities.slice(0,4)},{id:'science-draft-animals',activities:activities.slice(4)}]};
  if(typeof window!=='undefined')window.LoloActivityPilot=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
