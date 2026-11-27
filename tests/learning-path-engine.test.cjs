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

test('transition waits for audio and reward; deadline and stale completion cannot advance',()=>{
  const s={active:true,sameCompletion:true,hidden:false,now:3000,deadline:60000,armedAt:1000,lastOutputAt:1000,modelSpeaking:false,audioPlaying:false,queuedAudio:0,rewardActive:false,nextLessonId:'b'};
  assert.equal(engine.transition(s),'advance');
  assert.equal(engine.transition({...s,nextLessonId:null}),'complete');
  for(const field of ['modelSpeaking','audioPlaying','rewardActive','queuedAudio'])assert.equal(engine.transition({...s,[field]:true}),'wait');
  assert.equal(engine.transition({...s,lastOutputAt:2700}),'wait');
  assert.equal(engine.transition({...s,now:14000,modelSpeaking:true}),'pause');
  assert.equal(engine.transition({...s,deadline:3000}),'pause');
  assert.equal(engine.transition({...s,hidden:true}),'pause');
  assert.equal(engine.transition({...s,sameCompletion:false}),'ignore');
  assert.equal(engine.transition({...s,active:false}),'ignore');
});
test('one model grade is permitted per observed speech turn',()=>{
  assert.equal(engine.mayRecordTurn(0,0),false);
  assert.equal(engine.mayRecordTurn(1,0),true);
  assert.equal(engine.mayRecordTurn(1,1),false);
  assert.equal(engine.mayRecordTurn(2,1),true);
});
test('actual curriculum supports every unit and program without crossing scope',()=>{
  const data=require('../curriculum.json');
  const programs=[{id:'foundation',units:data.units},...data.programs];
  const all=programs.flatMap(p=>p.units.flatMap(u=>u.lessons.map(l=>({id:l.id,unitId:u.id,programId:p.id}))));
  for(const p of programs){
    const plan=engine.build(all,{scope:'curriculum',programId:p.id},new Set(),data.curriculumVersion);
    assert.deepEqual(plan.lessonIds,p.units.flatMap(u=>u.lessons.map(l=>l.id)));
    assert.equal(engine.validate(plan,all,data.curriculumVersion),true);
    for(const u of p.units){
      const unit=engine.build(all,{scope:'unit',programId:p.id,unitId:u.id},new Set(),data.curriculumVersion);
      assert.deepEqual(unit.lessonIds,u.lessons.map(l=>l.id));
    }
  }
});
