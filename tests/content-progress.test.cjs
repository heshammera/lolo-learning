const {test}=require('node:test');
const assert=require('node:assert/strict');
const progress=require('../content-progress.js'),runtime=require('../content-runtime.js');
const p={draftId:'11111111-1111-4111-8111-111111111111',releaseId:'22222222-2222-4222-8222-222222222222',sequence:1,content:{schemaVersion:1,subjectId:'science',gradeId:'grade-1',title:'Science',units:[{id:'u',title:'Plants',lessons:[{id:'l',title:'Water',goal:'Recognize water',activities:['a','b'].map(id=>({id,type:'true-false',version:1,prompt:'Plants need water',config:{answer:true}}))}]}]}};
test('checkpoint resumes only the exact release and scope; failed save retains prior',()=>{
 let raw=null,selected='default',fail=false;
 const storage={profiles:{activeId:'default',selectedId:()=>selected},get:()=>raw,set:(_,v)=>{if(fail)return false;raw=v;return true;}};
 const tracker=progress.create(storage);
 assert.deepEqual(tracker.load(p,'lesson','u','l'),{valid:true,results:[],completed:false});
 const s=runtime.create(p,'lesson','u','l');s.record('a',{status:'correct'});
 assert.equal(tracker.save(p,'lesson','u','l',s.results()),true);
 const saved=tracker.load(p,'lesson','u','l');
 assert.equal(saved.results.length,1);assert.equal(saved.completed,false);
 const resumed=runtime.create(p,'lesson','u','l',saved.results);
 assert.equal(resumed.current().activity.id,'b');
 assert.equal(resumed.record('b',{status:'incorrect'}),true);
 fail=true;assert.equal(tracker.save(p,'lesson','u','l',resumed.results()),false);
 assert.equal(tracker.load(p,'lesson','u','l').results.length,1);
 fail=false;assert.equal(tracker.save(p,'lesson','u','l',resumed.results()),true);
 assert.equal(tracker.load(p,'lesson','u','l').completed,true);
 assert.equal(tracker.load({...p,sequence:2},'lesson','u','l').results.length,0);
 assert.equal(tracker.load(p,'curriculum').results.length,0);
 assert.equal(tracker.save(p,'lesson','u','l',[{activityId:'b',status:'correct'}]),false);
 selected='other';assert.equal(tracker.save(p,'lesson','u','l',[]),false);
 selected='default';raw='{broken';assert.equal(tracker.load(p,'lesson','u','l').valid,false);assert.equal(tracker.save(p,'lesson','u','l',[]),false);
});

test('spaced review grows only after due successful attempts and resets after errors',()=>{
 let raw=null,selected='default',time=Date.UTC(2026,10,28),fail=false;
 const day=86400000;
 const tracker=progress.create({profiles:{activeId:'default',selectedId:()=>selected},get:()=>raw,set:(_,v)=>{if(fail)return false;raw=v;return true;}},{now:()=>time});
 const scope=['lesson','u','l'],correct=[{activityId:'a',status:'correct'},{activityId:'b',status:'correct'}];
 const read=()=>tracker.load(p,...scope).reviewSchedule;
 const save=results=>tracker.save(p,...scope,results);
 assert.equal(save(correct),true);assert.equal(read().intervalDays,1);const first=read();
 time+=day*2;assert.equal(save(correct),true);assert.deepEqual(read(),first);
 time=first.completedAt+day/2;assert.equal(save([]),true);assert.equal(save(correct),true);assert.deepEqual(read(),first);
 time=first.dueAt;assert.equal(save([]),true);assert.deepEqual(read(),first);assert.equal(save(correct),true);assert.equal(read().intervalDays,3);
 for(const interval of [7,14,30,30]){time=read().dueAt;save([]);save(correct);assert.equal(read().intervalDays,interval);}
 time+=day;save([]);save([correct[0],{activityId:'b',status:'incorrect'}]);assert.equal(read().intervalDays,1);
 assert.equal(tracker.load({...p,sequence:2},...scope).reviewSchedule,undefined);
 const latest=read();fail=true;assert.equal(save([]),false);assert.deepEqual(read(),latest);
 selected='other';assert.equal(tracker.load(p,...scope).valid,false);
});
test('ungraded-only completion and legacy checkpoint do not manufacture review dates',()=>{
 let raw=null;const tracker=progress.create({profiles:{activeId:'default',selectedId:()=> 'default'},get:()=>raw,set:(_,v)=>{raw=v;return true;}},{now:()=>Date.UTC(2026,10,28)});
 const q=JSON.parse(JSON.stringify(p));q.content.units[0].lessons[0].activities=[{id:'draw',type:'free-drawing',version:1,prompt:'Draw',config:{}}];
 assert.equal(tracker.save(q,'lesson','u','l',[{activityId:'draw',status:'completed'}]),true);
 assert.equal(tracker.load(q,'lesson','u','l').reviewSchedule,undefined);
 const data=JSON.parse(raw);data.entries[0].reviewSchedule={completedAt:1,dueAt:2,intervalDays:30};raw=JSON.stringify(data);
 assert.equal(tracker.load(q,'lesson','u','l').valid,false);
});
