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
    {id:'science-blank',type:'fill-blank',version:1,prompt:'النبات يحتاج إلى ___ لينمو.',config:{answers:['الماء','ماء']}},
    {id:'science-text',type:'free-text',version:1,prompt:'اكتبي اسم كائن حي من الأمثلة: قطة أو وردة.',config:{answers:['قطة','وردة']}},
    {id:'math-line',type:'number-line',version:1,prompt:'اختاري العدد الذي يأتي بعد ٣.',config:{min:0,max:10,step:1,answer:4}},
    {id:'math-fraction',type:'fractions',version:1,prompt:'اكتبي كسرًا مكافئًا للنصف (١/٢).',config:{numerator:1,denominator:2}},
    {id:'science-drag',type:'drag-drop',version:1,prompt:'ضعي كل كائن في مجموعته.',config:{items:items('قطة','وردة','سمكة'),groups:items('حيوان','نبات'),assignments:{i1:'i1',i2:'i2',i3:'i1'}}},
    {id:'math-shape',type:'geometry',version:1,prompt:'اختاري الشكل الذي له ثلاثة أضلاع.',config:{answer:'triangle'}},
    {id:'math-equation',type:'equations',version:1,prompt:'أوجدي قيمة س.',config:{coefficient:2,constant:3,result:11}},
    {id:'game-memory',type:'memory-game',version:1,prompt:'اعثري على البطاقات المتطابقة.',config:{items:items('🍎','🍌','🍇'),maxTurns:12}},
    {id:'game-puzzle',type:'puzzle',version:1,prompt:'رتبي الأعداد من الأصغر إلى الأكبر.',config:{items:items('٣','١','٢'),answer:['i2','i3','i1']}},
    {id:'game-maze',type:'maze',version:1,prompt:'ساعدي لولو في الوصول إلى النجمة.',config:{grid:['S..#','##.#','...G']}},
    {id:'science-hotspot',type:'image-hotspot',version:1,prompt:'أشيري إلى الجزء الذي يمتص الماء من التربة.',config:{diagram:'plant',answer:'root'}},
    {id:'science-balance',type:'science-simulation',version:1,prompt:'أضيفي أثقالًا حتى تتوازن كفتا الميزان.',config:{leftMass:6,unitMass:2,maxCount:5}},
    {id:'reading-story',type:'interactive-story',version:1,prompt:'اقرئي القصة واختاري التصرف المناسب.',config:{scenes:[
      {id:'s1',text:'وجدت لولو نبتة صغيرة جافة في الحديقة.',question:'ماذا تحتاج النبتة؟',options:[{id:'o1',label:'الماء',next:'s2'},{id:'o2',label:'اللعب',next:null}],answer:'o1'},
      {id:'s2',text:'سقت لولو النبتة ووضعتها قرب النافذة.',question:'لماذا وضعتها قرب النافذة؟',options:[{id:'o1',label:'لتحصل على الضوء',next:null},{id:'o2',label:'لتحصل على الحجارة',next:null}],answer:'o1'}
    ]}},
    {id:'writing-trace',type:'trace',version:1,prompt:'تتبعي الحرف L من النقطة الخضراء.',config:{glyph:'L'}},
    {id:'writing-draw',type:'free-drawing',version:1,prompt:'ارسمي شيئًا تحبينه.',config:{}},
    {id:'writing-color',type:'coloring',version:1,prompt:'لوني الدائرة بالأحمر والمثلث بالأزرق والمربع بالأخضر.',config:{answers:{circle:'red',triangle:'blue',square:'green'}}},
    {id:'language-dictation',type:'dictation',version:1,prompt:'استمعي ثم اكتبي الكلمة.',config:{language:'en',spokenText:'water',answers:['water']}},
  ];
  const api={status:'draft',lessons:[{id:'science-draft-plants',activities:activities.slice(0,4)},{id:'science-draft-animals',activities:activities.slice(4)}]};
  if(typeof window!=='undefined')window.LoloActivityPilot=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
