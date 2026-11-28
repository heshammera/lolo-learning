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
  // Explicitly authored pilot practice only: two items per level; not official curriculum.
  const adaptiveRows={
    'hello-1':[
      [1,'اختاري التحية بالإنجليزي.','👋',['Hello','Bye','No'],0],
      [1,'اختاري كلمة الوداع.','🚪',['Hello','Bye','Yes'],1],
      [2,'قابلتِ صديقتك عند المدرسة. ماذا تقولين؟','🏫',['Bye','Hello','No'],1],
      [2,'أنتِ تغادرين بعد اللعب. ماذا تقولين؟','🧸 ← 🚪',['Yes','Hello','Bye'],2],
      [3,'اختاري ترتيب الكلام عند المقابلة ثم المغادرة.','👋 → 🚪',['Hello ثم Bye','Bye ثم Hello','No ثم Yes'],0],
      [3,'قالت صديقتك Hello عند وصولها. ما الرد المناسب؟','👧 👋',['Bye','Hello','No'],1]],
    'hello-2':[
      [1,'أي كلمة تعني فرحانة؟','😊',['happy','sleepy','bye'],0],
      [1,'اختاري الصورة المناسبة لكلمة happy.','happy',['😢','😄','😴'],1],
      [2,'كيف تردين وأنتِ بخير؟','How are you? 🙂',['I am fine','Bye','No'],0],
      [2,'اختاري الجملة التي تعبّر عن الفرح.','🎉',['I am sleepy','I am happy','Bye'],1],
      [3,'صديقتك تسأل How are you? وأنتِ سعيدة. اختاري الرد.','👧 🙂',['Bye','I am happy','No'],1],
      [3,'أي ترتيب مناسب لمحادثة قصيرة؟','💬',['How are you? → I am fine','Bye → How are you?','I am fine → Bye → No'],0]],
    'math-found-count-1':[
      [1,'كام تفاحة؟','🍎',['1','2','3'],0],
      [1,'عدّي النجوم.','⭐ ⭐',['1','2','3'],1],
      [2,'كام سمكة؟','🐟 🐟 🐟 🐟',['3','4','5'],1],
      [2,'عدّي الكرات.','⚽ ⚽ ⚽ ⚽ ⚽',['4','5','6'],1],
      [3,'أي رقم يطابق عدد الزهور في المجموعتين معًا؟','🌷 🌷 | 🌷 🌷 🌷',['4','5','6'],1],
      [3,'اختاري عدد النجوم كلها.','⭐ ⭐ ⭐ | ⭐ ⭐ ⭐',['5','6','7'],1]],
    'math-found-count-2':[
      [1,'لكل طفل قلم واحد. كام قلم؟','👧',['1','2','3'],0],
      [1,'لكل أرنب جزرة. كام جزرة؟','🐇 🐇',['1','2','3'],1],
      [2,'لكل كوب طبق. كام طبق؟','🥛 🥛 🥛',['2','3','4'],1],
      [2,'لكل قطة طبق أكل. كام طبق؟','🐈 🐈 🐈 🐈',['3','4','5'],1],
      [3,'لكل طفل قلم. لدينا 3 أطفال وقلمان. نحتاج كام قلم إضافي؟','👧 👧 👧 | ✏️ ✏️',['1','2','3'],0],
      [3,'لكل أرنب جزرة. لدينا 4 أرانب و3 جزرات. كام جزرة ناقصة؟','🐇 🐇 🐇 🐇 | 🥕 🥕 🥕',['2','1','3'],1]]
  };
  const adaptiveBank=Object.freeze(Object.fromEntries(Object.entries(adaptiveRows).map(([id,rows])=>[id,Object.freeze(make(id+':adaptive',rows.map(r=>r.slice(1))).map((q,i)=>Object.freeze({...q,level:rows[i][0]})))])));
  const api=Object.freeze({version:'pilot-1',adaptiveVersion:'adaptive-pilot-1',adaptiveBank,reviewStatus:'draft',bank:Object.freeze(bank)});
  if(typeof window!=='undefined')window.LoloVisualBank=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
