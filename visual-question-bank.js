// Pilot learning-objective questions. Draft content; educator review is still required.
(() => {
  const make=(lessonId,rows)=>rows.map(([prompt,visual,options,answer],i)=>Object.freeze({
    id:lessonId+':visual:'+ (i+1),type:'choice',prompt,visual,
    options:Object.freeze(options.map((label,j)=>Object.freeze({id:'o'+(j+1),label}))),
    correctOptionId:'o'+(answer+1),
  }));
  const bank={
    'hello-1':make('hello-1',[
      ['لما تقابلي صاحبتك، تقولي إيه؟','👋',['Hello','Bye','No'],0],
      ['لما تمشي من عند صاحبتك، تقولي إيه؟','🚪 👋',['Yes','Hello','Bye'],2],
      ['اختاري الصورة اللي تناسب كلمة Hello.','Hello',['👋 مقابلة','🚪 مغادرة','😴 نوم'],0],
    ]),
    'hello-2':make('hello-2',[
      ['البنت فرحانة. تختار أنهي كلمة؟','😊',['sleepy','happy','bye'],1],
      ['لما حد يسألك How are you? وإنتِ كويسة، تقولي إيه؟','🙂',['Bye','I am fine','No'],1],
      ['أنهي صورة تعبّر عن I am happy؟','I am happy',['😴','😢','😄'],2],
    ]),
    'hello-3':make('hello-3',[
      ['عايزة تطلبي لعبة بأدب. تقولي إيه؟','🧸',['Please','Bye','No'],0],
      ['صاحبتك ادّتك هدية. تقولي إيه؟','🎁',['Hello','Thank you','No'],1],
      ['أنهي موقف يناسب Thank you؟','Thank you',['🙋 بداية مقابلة','💤 النوم','🎁 استلام هدية'],2],
    ]),
    'hello-4':make('hello-4',[
      ['هل التفاحة موجودة في الصورة؟ اختاري الرد بالإنجليزي.','🍎',['Yes','No',"I don't know"],0],
      ['هل في قطة في الصورة؟','🍌',['Hello','Yes','No'],2],
      ['لو مش عارفة الإجابة، تقدري تقولي إيه؟','🤔',['Bye',"I don't know",'Yes'],1],
    ]),
    'math-found-count-1':make('math-found-count-1',[
      ['عدّي التفاح. كام تفاحة؟','🍎 🍎 🍎',['2','3','4'],1],
      ['عدّي النجوم. كام نجمة؟','⭐ ⭐ ⭐ ⭐ ⭐',['5','3','4'],0],
      ['كام سمكة في الصورة؟','🐟 🐟',['1','3','2'],2],
    ]),
    'math-found-count-2':make('math-found-count-2',[
      ['كل طفل محتاج قلم واحد. نحتاج كام قلم؟','👧 👦 👧',['2','3','4'],1],
      ['كل أرنب هياخد جزرة واحدة. كام جزرة تكفي؟','🐇 🐇 🐇 🐇',['3','5','4'],2],
      ['كل كوب له طبق واحد. كام طبق نحتاج؟','🥛 🥛',['2','1','3'],0],
    ]),
    'math-found-count-3':make('math-found-count-3',[
      ['أنهي مجموعة فيها حاجات أكتر؟','أ: 🍎 🍎 | ب: 🍎 🍎 🍎 🍎',['أ','ب','قد بعض'],1],
      ['أنهي مجموعة فيها حاجات أقل؟','أ: ⭐ | ب: ⭐ ⭐ ⭐',['أ','ب','قد بعض'],0],
      ['هل المجموعتين قد بعض؟','أ: 🐟 🐟 | ب: 🐟 🐟',['أ أكتر','ب أكتر','قد بعض'],2],
    ]),
    'math-found-count-4':make('math-found-count-4',[
      ['السلة فاضية. فيها كام تفاحة؟','🧺',['1','0','2'],1],
      ['أنهي مجموعة فيها صفر نجوم؟','أ: ⭐ ⭐ | ب: صندوق فارغ',['أ','ب'],1],
      ['كان معاكي تفاحة واحدة وأكلتيها. فاضل كام؟','🍎 ← طبق فارغ',['0','1','2'],0],
    ]),
  };
  for(const rows of Object.values(bank))Object.freeze(rows);
  const api=Object.freeze({version:'pilot-1',reviewStatus:'draft',bank:Object.freeze(bank)});
  if(typeof window!=='undefined')window.LoloVisualBank=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
