const {test}=require('node:test'),assert=require('node:assert/strict'),{summarize}=require('../learning-analytics.js');
const now=Date.parse('2026-11-28T12:00:00Z'),lesson=(id)=>({id,title:id,version:'v1'});
const a=(id,correct,total,day=20,extra={})=>({assessmentId:id,correct,total,completedAt:'2026-11-'+day+'T00:00:00Z',curriculumVersion:'c1',lessonVersion:'v1',...extra});
test('latest current evidence only, no double-counting, no untested zero',()=>{
 const tests={a:{...a('new',3,10,25),history:[a('old',9,10),a('new',3,10,25),a('wrong-version',10,10,26,{lessonVersion:'old'})]},b:a('b',9,10),c:a('c',2,2),d:a('d',10,10,25,{curriculumVersion:'old'})};
 const input={lessons:['a','b','c','d','e'].map(lesson),tests,completedIds:['e'],curriculumVersion:'c1',now,visual:{d:[{bankVersion:'bank',correct:4,total:5,completedAt:'2026-11-25T00:00:00Z'}]},visualVersion:'bank',traces:{e:{percent:70,completedAt:'2026-11-25T00:00:00Z'}}};
 const before=JSON.stringify(input),r=summarize(input);assert.equal(JSON.stringify(input),before);assert.equal(r.summary.latestTotal,22);assert.equal(r.summary.latestCorrect,14);assert.equal(r.summary.latestPercent,64);assert.equal(r.summary.completed,1);assert.deepEqual(r.summary.priorities,['a']);assert.deepEqual(r.summary.strengths,['b']);assert.equal(r.rows[0].trend,-60);assert.equal(r.rows[2].status,'limited-evidence');assert.equal(r.rows[3].hasUncomparableTest,true);assert.equal(r.rows[3].visualPercent,80);assert.equal(r.rows[4].tracePercent,70);
});
test('invalid and future results excluded, unknown version not inferred',()=>{
 const r=summarize({lessons:[lesson('a'),lesson('b'),lesson('a')],tests:{a:a('a',9,2),b:a('b',2,2,29)},curriculumVersion:'c1',now});assert.equal(r.summary.lessonCount,2);assert.equal(r.summary.latestPercent,null);assert.equal(r.summary.unassessed,2);
 assert.equal(summarize({lessons:[lesson('a')],tests:{a:a('a',9,10)},now}).summary.latestPercent,null);
});
