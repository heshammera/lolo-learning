const {test}=require('node:test');
const assert=require('node:assert/strict');
const engine=require('../activity-engine.js'),pilot=require('../activity-pilot.js');
const activities=pilot.lessons.flatMap(l=>l.activities);
test('all seven contracts validate and grade without provider calls',()=>{
  assert.equal(engine.checkLessons(pilot.lessons).compatible,true);
  const answers=['i1',true,['i2','i1'],['i2','i1','i3'],{i1:'i2',i2:'i1'},3,{i1:'i1',i2:'i2',i3:'i1'}];
  const wrong=['i2',false,['i1'],['i1','i2','i3'],{i1:'i1',i2:'i2'},4,{i1:'i2',i2:'i2',i3:'i1'}];
  activities.forEach((a,i)=>{assert.equal(engine.evaluate(a,answers[i]).status,'correct');assert.equal(engine.evaluate(a,wrong[i]).status,'incorrect');assert.equal(engine.evaluate(a,null).status,'unresolved');});
});
test('unknown activities, versions, duplicate IDs and incompatible targets block publication',()=>{
  const a=activities[0];
  for(const invalid of [{...a,type:'__proto__'},{...a,type:'science-simulation'},{...a,version:2},{...a,config:{...a.config,answer:'missing'}},{...a,script:'alert(1)'}])assert.equal(engine.validate(invalid).valid,false);
  assert.equal(engine.checkLessons([{id:'l1',activities:[a,a]}]).issues[0].code,'DUPLICATE_ACTIVITY_ID');
  assert.equal(engine.checkLessons([{id:'l1',activities:[a]}],{}).issues[0].code,'CLIENT_VERSION_UNSUPPORTED');
  assert.equal(engine.checkLessons([{id:'l1',activities:[]}]).compatible,false);
  assert.equal(engine.evaluate(activities[5],'3').status,'unresolved');
  assert.equal(engine.evaluate(activities[3],['i2','i2','i3']).status,'unresolved');
  assert.equal(engine.evaluate(activities[4],{i1:'i2',i2:'i2'}).status,'unresolved');
});
