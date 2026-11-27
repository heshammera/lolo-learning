const assert = require('node:assert/strict');
const {test} = require('node:test');
const engine = require('../learning-path-engine.js');
const lessons = [
  {id:'a',programId:'p',unitId:'u1'}, {id:'b',programId:'p',unitId:'u1'},
  {id:'c',programId:'p',unitId:'u2'}, {id:'d',programId:'other',unitId:'u1'},
];
const make = (scope, options={}, mastered=new Set()) => engine.build(lessons,
  {scope,programId:'p',unitId:'u1',lessonId:'a',...options},mastered,'1');
test('single lesson cannot escape scope or advance twice',()=>{
  let p=make('lesson'); assert.equal(engine.current(p),'a');
  assert.equal(engine.advance(p,'b'),null);
  p=engine.advance(p,'a'); assert.equal(p.status,'completed');
  assert.equal(engine.current(p),null); assert.equal(engine.advance(p,'a'),null);
});
test('unit order stops before next unit',()=>{
  let p=make('unit'); assert.deepEqual(p.lessonIds,['a','b']);
  p=engine.advance(p,'a'); assert.equal(engine.current(p),'b');
  assert.equal(engine.advance(p,'a'),null); p=engine.advance(p,'b');
  assert.equal(p.status,'completed');
});
test('curriculum crosses units but not programs',()=>{
  let p=make('curriculum'); assert.deepEqual(p.lessonIds,['a','b','c']);
  for(const id of ['a','b','c'])p=engine.advance(p,id);
  assert.equal(p.status,'completed'); assert.equal(engine.advance(p,'d'),null);
});
test('skip is opt-in and single lesson is always selectable',()=>{
  const mastered=new Set(['a','c']);
  assert.deepEqual(make('curriculum',{},mastered).lessonIds,['a','b','c']);
  const p=make('curriculum',{skipPreviouslyCompleted:true},mastered);
  assert.deepEqual(p.lessonIds,['b']); assert.deepEqual(p.skippedLessonIds,['a','c']);
  assert.equal(engine.validate(p,lessons,'1'),true);
  assert.deepEqual(make('lesson',{skipPreviouslyCompleted:true},mastered).lessonIds,['a']);
});
test('resume validates identity, bounds, order and curriculum version',()=>{
  const p=engine.advance(make('curriculum'),'a');
  const restored=JSON.parse(JSON.stringify(p));
  assert.equal(engine.validate(restored,lessons,'1'),true);
  assert.equal(engine.current(restored),'b');
  assert.equal(engine.validate(restored,lessons,'2'),false);
  assert.equal(engine.validate({...p,currentIndex:99},lessons,'1'),false);
  assert.equal(engine.validate({...p,lessonIds:['a','d','c']},lessons,'1'),false);
  assert.equal(engine.validate({...p,lessonIds:['b','a','c']},lessons,'1'),false);
  assert.equal(engine.validate({...p,status:'completed'},lessons,'1'),false);
  assert.equal(make('unit',{unitId:'missing'}),null);
});
