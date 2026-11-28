const {test}=require('node:test');
const assert=require('node:assert/strict');
const runtime=require('../content-runtime.js');
const trust=require('../content-trust.js');
const make=(id)=>({id,type:'true-false',version:1,prompt:'Plants need water',config:{answer:true}});
const lesson=(id)=>({id,title:id,goal:'Review',activities:[make(id+'-a'),make(id+'-b')]});
const p={content:{schemaVersion:1,subjectId:'science',gradeId:'grade-1',title:'Science',units:[{id:'u1',title:'One',lessons:[lesson('l1'),lesson('l2')]},{id:'u2',title:'Two',lessons:[lesson('l3')]}]}};
test('isolated scope plans and explicit boundaries',()=>{
  assert.deepEqual(runtime.plan(p,'lesson','u1','l2').map(s=>s.lessonId),['l2','l2']);
  assert.equal(runtime.plan(p,'unit','u1').length,4);
  assert.equal(runtime.plan(p,'curriculum').length,6);
  assert.equal(runtime.plan(p,'lesson','u2','l2'),null);
  const s=runtime.create(p,'lesson','u1','l2');
  assert.equal(s.advance(),false);assert.equal(s.record('l1-a',{status:'correct'}),false);
  assert.equal(s.record('l2-a',{status:'unresolved'}),false);
  assert.equal(s.record('l2-a',{status:'correct'}),true);
  assert.equal(s.record('l2-a',{status:'correct'}),false);
  assert.equal(s.advance(),true);
  assert.equal(s.record('l2-b',{status:'incorrect'}),true);
  assert.equal(s.advance(),true);
  assert.equal(s.current(),null);assert.equal(s.state().done,true);assert.equal(s.state().correct,1);
});
test('untrusted production default and invalid activity rejection',()=>{
  assert.deepEqual(Object.keys(trust),[]);
  const bad=JSON.parse(JSON.stringify(p));bad.content.units[0].lessons[0].activities[0].type='unknown';
  assert.equal(runtime.create(bad,'curriculum'),null);
  const s=runtime.create(p,'unit','u2');s.stop();assert.equal(s.current(),null);assert.equal(s.record('l3-a',{status:'correct'}),false);
});

test('completion-only result cannot inflate correctness',()=>{
 const p={content:{schemaVersion:1,subjectId:'art',gradeId:'grade-1',title:'Art',units:[{id:'u',title:'Art',lessons:[{id:'l',title:'Draw',goal:'Practice',activities:[{id:'draw',type:'free-drawing',version:1,prompt:'Draw',config:{}}]}]}]}};
 const s=runtime.create(p,'curriculum');assert.equal(s.record('draw',{status:'correct'}),false);assert.equal(s.record('draw',{status:'completed'}),true);assert.equal(s.state().correct,0);assert.equal(s.state().ungraded,1);
 assert.equal(runtime.create(p,'curriculum',null,null,s.results()).state().done,true);
});

test('speech repetition records participation but never correctness',()=>{
 const candidate=JSON.parse(JSON.stringify(p));candidate.content.units[0].lessons[0].activities=[{id:'repeat',type:'speech-repeat',version:1,prompt:'Repeat',config:{language:'en',spokenText:'hello'}}];
 const s=runtime.create(candidate,'lesson','u1','l1');assert.equal(s.record('repeat',{status:'correct'}),false);assert.equal(s.record('repeat',{status:'completed'}),true);assert.equal(s.state().correct,0);assert.equal(s.state().ungraded,1);
});

test('reading practice cannot inflate scores',()=>{
 const candidate=JSON.parse(JSON.stringify(p));candidate.content.units[0].lessons[0].activities=[{id:'reading',type:'reading-aloud',version:1,prompt:'Read',config:{language:'en',segments:['Hello','Good morning']}}];
 const s=runtime.create(candidate,'lesson','u1','l1');assert.equal(s.record('reading',{status:'correct'}),false);assert.equal(s.record('reading',{status:'completed'}),true);assert.equal(s.state().correct,0);assert.equal(s.state().ungraded,1);
});

test('review uses exact scope, resolved graded evidence and stable ordering only',()=>{
 const s=runtime.create(p,'unit','u1');
 for(const [id,status] of [['l1-a','incorrect'],['l1-b','correct'],['l2-a','incorrect'],['l2-b','incorrect']]){
   assert.equal(s.record(id,{status}),true);s.advance();
 }
 const results=s.results(),report=runtime.review(p,'unit','u1',null,results);
 assert.equal(report.graded,4);assert.equal(report.recommendation.lessonId,'l2');
 assert.equal(report.recommendation.unitId,'u1');
 assert.equal(runtime.review(p,'unit','u1',null,results.slice(0,1)).recommendation.kind,'resume');
 assert.equal(runtime.review(p,'lesson','u2','l3',results),null);
 assert.equal(runtime.review(p,'unit','u1',null,[]).status,'no-evidence');
 assert.equal(runtime.review(p,'unit','u1',null,[{activityId:'l1-a',status:'completed'}]),null);
 assert.equal(runtime.review(p,'unit','u1',null,[{activityId:'l1-a',status:'correct',score:100}]),null);
});
test('completion-only practice is not evidence of weakness or mastery',()=>{
 const q=JSON.parse(JSON.stringify(p));q.content.units[0].lessons[0].activities=[{id:'draw',type:'free-drawing',version:1,prompt:'Draw',config:{}}];
 const report=runtime.review(q,'lesson','u1','l1',[{activityId:'draw',status:'completed'}]);
 assert.equal(report.graded,0);assert.equal(report.ungraded,1);assert.equal(report.recommendation.kind,'practice-only');
});
