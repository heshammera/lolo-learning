const {test}=require('node:test');
const assert=require('node:assert/strict');
const engine=require('../visual-assessment-engine.js');
const content=require('../visual-question-bank.js');
const data=require('../curriculum.json');
const lessons=new Set([...(data.units||[]),...data.programs.flatMap(p=>p.units)].flatMap(u=>u.lessons.map(l=>l.id)));
test('pilot bank references existing lessons and unique valid questions',()=>{
  assert.deepEqual(engine.validateBank(content.bank,lessons),{valid:true,errors:[]});
  assert.equal(Object.keys(content.bank).length,8);
  assert.equal(Object.values(content.bank).flat().length,24);
  assert.equal(content.reviewStatus,'draft');
});
test('only valid current question and option may be answered',()=>{
  const s=engine.create(content.bank,'hello-1','x',content.version,()=>0);
  const q=engine.current(s);
  assert.equal(engine.submit(s,'other','o1'),null);
  assert.equal(engine.submit(s,q.id,'fake'),null);
  const r=engine.submit(s,q.id,q.correctOptionId);
  assert.equal(r.result.correct,true);
  assert.equal(engine.submit(r.state,q.id,q.correctOptionId),null);
  assert.equal(engine.summarize(r.state,content.bank,content.version,new Date().toISOString()),null);
});
test('score recalculates against bank, saves completed attempts once, keeps limited history',()=>{
  let s=engine.create(content.bank,'math-found-count-1','a',content.version,()=>0.5);
  for(let i=0;i<3;i++){
    const q=engine.current(s);
    const choice=i===0?q.options.find(o=>o.id!==q.correctOptionId).id:q.correctOptionId;
    s=engine.submit(s,q.id,choice).state;
  }
  s.answers[0].correct=true;
  const result=engine.summarize(s,content.bank,content.version,new Date().toISOString());
  assert.equal(result.correct,2);assert.equal(result.total,3);
  const saved=engine.save({},result);
  assert.equal(saved.recorded,true);
  assert.equal(engine.save(saved.history,result).recorded,false);
  assert.equal(engine.summarize(s,content.bank,'different',new Date().toISOString()),null);
  let h=saved.history;for(let i=0;i<15;i++)h=engine.save(h,{...result,assessmentId:'x'+i}).history;
  assert.equal(h[result.lessonId].length,10);
});
test('bad bank with duplicate choices and unknown lesson is rejected',()=>{
  const q=content.bank['hello-1'][0];
  assert.equal(engine.validateBank({unknown:[q,q]},lessons).valid,false);
  assert.equal(engine.create(content.bank,'no-lesson','x',content.version),null);
});
