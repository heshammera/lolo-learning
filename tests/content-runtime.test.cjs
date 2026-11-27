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
