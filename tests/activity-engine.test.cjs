const {test}=require('node:test');
const assert=require('node:assert/strict');
const engine=require('../activity-engine.js'),pilot=require('../activity-pilot.js');
const activities=pilot.lessons.flatMap(l=>l.activities);
test('all twenty scored contracts validate and grade without provider calls',()=>{
  assert.equal(engine.checkLessons(pilot.lessons).compatible,true);
  const answers=['i1',true,['i2','i1'],['i2','i1','i3'],{i1:'i2',i2:'i1'},3,{i1:'i1',i2:'i2',i3:'i1'},'الماء','قطة',4,{numerator:2,denominator:4},{i1:'i1',i2:'i2',i3:'i1'},'triangle',4,[['i1:a','i1:b'],['i2:a','i2:b'],['i3:a','i3:b']],['i2','i3','i1'],['right','right','down','down','right'],'root',3,[{sceneId:'s1',optionId:'o1'},{sceneId:'s2',optionId:'o1'}]];
  const wrong=['i2',false,['i1'],['i1','i2','i3'],{i1:'i1',i2:'i2'},4,{i1:'i2',i2:'i2',i3:'i1'},'الحجارة','ماء',5,{numerator:1,denominator:3},{i1:'i2',i2:'i2',i3:'i1'},'circle',3,Array.from({length:12},()=>['i1:a','i2:b']),['i1','i2','i3'],Array.from({length:100},(_,i)=>i%2?'left':'right'),'leaf',2,[{sceneId:'s1',optionId:'o2'}]];
  activities.slice(0,20).forEach((a,i)=>{assert.equal(engine.evaluate(a,answers[i]).status,'correct');assert.equal(engine.evaluate(a,wrong[i]).status,'incorrect');assert.equal(engine.evaluate(a,null).status,'unresolved');});
});
test('unknown activities, versions, duplicate IDs and incompatible targets block publication',()=>{
  const a=activities[0];
  for(const invalid of [{...a,type:'__proto__'},{...a,type:'phoneme-score'},{...a,version:2},{...a,config:{...a.config,answer:'missing'}},{...a,script:'alert(1)'}])assert.equal(engine.validate(invalid).valid,false);
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

test('visual contracts enforce fixed regions, attainable balance and terminating story paths',()=>{
 const [hot,balance,story]=activities.slice(17);
 assert.equal(engine.validate({...hot,config:{diagram:'https://example.com/image',answer:'root'}}).valid,false);
 assert.equal(engine.evaluate(hot,'nose').status,'unresolved');
 assert.equal(engine.validate({...balance,config:{leftMass:7,unitMass:2,maxCount:5}}).valid,false);
 assert.equal(engine.evaluate(balance,0).status,'incorrect');
 assert.equal(engine.evaluate(balance,6).status,'unresolved');
 assert.equal(engine.evaluate(story,[{sceneId:'s1',optionId:'o1'}]).status,'unresolved');
 assert.equal(engine.evaluate(story,[{sceneId:'s2',optionId:'o1'}]).status,'unresolved');
 const cyclic=JSON.parse(JSON.stringify(story));cyclic.config.scenes[1].options[0].next='s1';
 assert.equal(engine.validate(cyclic).valid,false);
 const unreachable=JSON.parse(JSON.stringify(story));unreachable.config.scenes[0].options[0].next=null;
 assert.equal(engine.validate(unreachable).valid,false);
});

test('drawing participation ungraded, geometric trace and color assignment',()=>{
 const [trace,draw,color]=activities.slice(20);assert.equal(engine.checkLessons(pilot.lessons).compatible,true);
 const line=[];for(let y=15;y<=85;y+=5)line.push([25,y]);for(let x=30;x<=80;x+=5)line.push([x,85]);
 assert.equal(engine.evaluate(trace,line).status,'correct');assert.equal(engine.evaluate(trace,[[25,15],[80,85]]).status,'incorrect');assert.equal(engine.evaluate(trace,null).status,'unresolved');
 assert.equal(engine.evaluate(draw,[[[10,10],[30,30]]]).status,'completed');assert.equal(engine.evaluate(draw,[]).status,'unresolved');
 assert.equal(engine.evaluate(color,{circle:'red',triangle:'blue',square:'green'}).status,'correct');assert.equal(engine.evaluate(color,{circle:'red'}).status,'unresolved');
});
