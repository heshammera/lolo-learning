const assert=require('node:assert/strict');
const {test}=require('node:test');
const catalog=require('../subject-catalog.js');
const pathEngine=require('../learning-path-engine.js');
const curriculum=require('../curriculum.json');
test('existing program and lesson IDs remain unchanged',()=>{
  assert.deepEqual(catalog.programs(curriculum).map(p=>p.id),['foundation','connect-plus-1','math-grade-1']);
  assert.equal(catalog.lessons(curriculum).length,140);
  assert.equal(catalog.forProgram(catalog.programs(curriculum)[0],curriculum).writing,'english');
  assert.equal(catalog.forProgram(catalog.programs(curriculum)[2],curriculum).scene,'math');
});
test('new subject works in catalog and learning path without a new renderer',()=>{
  const data=structuredClone(curriculum);
  data.subjects.push({id:'science',title:'Science',titleAr:'علوم'});
  data.programs.push({id:'science-pilot',subjectId:'science',title:'علوم تجريبية',gradeId:'grade-1',units:[{id:'science-u1',title:'النباتات',lessons:[{id:'s1',subjectId:'science'},{id:'s2',subjectId:'science'},{id:'s3',subjectId:'science'}]}]});
  const all=catalog.lessons(data);
  const p=catalog.programs(data).at(-1);
  const profile=catalog.forProgram(p,data);
  assert.equal(profile.label,'علوم');assert.equal(profile.scene,'cards');assert.equal(profile.writing,null);assert.equal(profile.live,false);
  const plan=pathEngine.build(all,{scope:'unit',programId:p.id,unitId:'science-u1'},new Set(),data.curriculumVersion);
  assert.deepEqual(plan.lessonIds,['s1','s2','s3']);
  assert.equal(pathEngine.validate(plan,all,data.curriculumVersion),true);
  data.programs.at(-1).status='draft';
  assert.equal(catalog.lessons(data).length,140);
});
test('unknown subject IDs cannot activate voice or writing via metadata',()=>{
  const data={subjects:[{id:'x',title:'New',live:true,writing:'math'}]};
  assert.equal(catalog.profile('x',data).live,false);
  assert.equal(catalog.profile('x',data).writing,null);
  assert.equal(catalog.profile('__proto__',data).live,false);
});
