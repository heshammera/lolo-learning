const {test}=require('node:test');
const assert=require('node:assert/strict');
const engine=require('../activity-engine.js'),pilot=require('../activity-pilot.js');
const activities=pilot.lessons.flatMap(l=>l.activities);
test('all seventeen contracts validate and grade without provider calls',()=>{
  assert.equal(engine.checkLessons(pilot.lessons).compatible,true);
  const answers=['i1',true,['i2','i1'],['i2','i1','i3'],{i1:'i2',i2:'i1'},3,{i1:'i1',i2:'i2',i3:'i1'},'الماء','قطة',4,{numerator:2,denominator:4},{i1:'i1',i2:'i2',i3:'i1'},'triangle',4,[['i1:a','i1:b'],['i2:a','i2:b'],['i3:a','i3:b']],['i2','i3','i1'],['right','right','down','down','right']];
  const wrong=['i2',false,['i1'],['i1','i2','i3'],{i1:'i1',i2:'i2'},4,{i1:'i2',i2:'i2',i3:'i1'},'الحجارة','ماء',5,{numerator:1,denominator:3},{i1:'i2',i2:'i2',i3:'i1'},'circle',3,Array.from({length:12},()=>['i1:a','i2:b']),['i1','i2','i3'],Array.from({length:100},(_,i)=>i%2?'left':'right')];
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

test('new contracts reject ambiguity, invalid ranges and older client capabilities',()=>{
  const [blank,short,line,frac]=activities.slice(7);
  assert.equal(engine.evaluate(blank,'  الماء  ').status,'correct');
  assert.equal(engine.evaluate(short,'').status,'unresolved');
  assert.equal(engine.validate({...blank,config:{answers:['Water',' water ']}}).valid,false);
  assert.equal(engine.validate({...line,config:{min:0,max:100,step:1,answer:4}}).valid,false);
  assert.equal(engine.evaluate(line,4.5).status,'unresolved');
  assert.equal(engine.evaluate(frac,{numerator:1,denominator:0}).status,'unresolved');
  assert.equal(engine.evaluate(frac,{numerator:500,denominator:1000}).status,'correct');
  assert.equal(engine.validate({...frac,config:{numerator:2,denominator:1}}).valid,false);
  assert.equal(engine.checkLessons([{id:'l1',activities:[blank]}],{choice:[1]}).compatible,false);
  assert.equal(engine.checkLessons([{id:'l1',activities:[blank]}],null).issues[0].code,'INVALID_CLIENT_CAPABILITIES');
  assert.equal(engine.checkLessons([{id:'l1',activities:[blank]},{id:'l1',activities:[short]}]).issues[0].code,'DUPLICATE_LESSON_ID');
});

test('interaction contracts fail closed on malformed assignments, shapes and equations',()=>{
  const [drag,shape,eq]=activities.slice(11);
  assert.equal(engine.evaluate(drag,{i1:'i1'}).status,'unresolved');
  assert.equal(engine.evaluate(drag,{i1:'i1',i2:'i2',i3:'missing'}).status,'unresolved');
  assert.equal(engine.validate({...shape,config:{answer:'<svg>'}}).valid,false);
  assert.equal(engine.validate({...eq,config:{coefficient:0,constant:3,result:11}}).valid,false);
  assert.equal(engine.validate({...eq,config:{coefficient:2,constant:3,result:10}}).valid,false);
  assert.equal(engine.evaluate(eq,'4').status,'unresolved');
  assert.equal(engine.evaluate(eq,4).status,'correct');
  assert.equal(engine.evaluate({...eq,config:{coefficient:2,constant:-3,result:-11}},-4).status,'correct');
});

test('game contracts validate replay, bounded turns, solvability and order',()=>{
 const [memory,puzzle,maze]=activities.slice(14);
 assert.equal(engine.evaluate(memory,[['i1:a','i1:b']]).status,'unresolved');
 assert.equal(engine.evaluate(memory,[['i1:a','i1:b'],['i1:a','i1:b']]).status,'unresolved');
 assert.equal(engine.evaluate(memory,[['i1:a','i1:a']]).status,'unresolved');
 assert.equal(engine.validate({...memory,config:{...memory.config,maxTurns:1}}).valid,false);
 assert.equal(engine.validate({...puzzle,config:{...puzzle.config,answer:['i1','i2','i3']}}).valid,false);
 assert.equal(engine.evaluate(puzzle,['i1','i1','i3']).status,'unresolved');
 assert.equal(engine.validate({...maze,config:{grid:['S##','###','##G']}}).valid,false);
 assert.equal(engine.validate({...maze,config:{grid:['S.G','S..','...']}}).valid,false);
 assert.equal(engine.evaluate(maze,['down']).status,'unresolved');
 assert.equal(engine.evaluate(maze,['right','right','down','down','right','left']).status,'unresolved');
});
