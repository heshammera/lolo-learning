const {test}=require('node:test'),assert=require('node:assert/strict'),{derive,day}=require('../learning-reminders.js');
const now=new Date(2026,10,28,18,0,0).getTime(),due=[{lessonId:'a',title:'A',dueAt:now-1000},{lessonId:'b',title:'B',dueAt:now+1000},{lessonId:'a',title:'A',dueAt:now-1000}];
test('opt-in, dated due review, daily reminder and deduplication',()=>{
 assert.deepEqual(derive({now,due,daily:true}),[]);
 const base={enabled:true,daily:true,hour:17,now,due};
 assert.deepEqual(derive(base).map(n=>n.kind),['review','daily']);
 assert.deepEqual(derive({...base,dismissedDay:day(now)}).map(n=>n.kind),['review']);
 assert.deepEqual(derive({...base,practiceTimes:[now-1000]}).map(n=>n.kind),['review']);
 assert.deepEqual(derive({...base,practiceTimes:[now+1000]}).map(n=>n.kind),['review','daily']);
 assert.deepEqual(derive({...base,hour:19}).map(n=>n.kind),['review']);
});
