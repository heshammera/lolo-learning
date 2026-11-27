/* Server-side validation uses the exact student activity implementation. */
const engine=require('../activity-engine.js');
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(v);
const text=v=>typeof v==='string'&&v.trim().length>0&&v.length<=200;
const exact=(o,keys)=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
function validate(d){
  const issues=[],lessons=[],unitIds=new Set(),lessonIds=new Set();
  const issue=(code,path)=>issues.push({code,path});
  if(!exact(d,['schemaVersion','subjectId','gradeId','title','units'])||d.schemaVersion!==1||!id(d.subjectId)||!id(d.gradeId)||!text(d.title)||!Array.isArray(d.units)||d.units.length<1||d.units.length>30)return {valid:false,issues:[{code:'INVALID_CURRICULUM',path:'$'}]};
  d.units.forEach((u,i)=>{
    const path='units.'+i;
    if(!exact(u,['id','title','lessons'])||!id(u.id)||!text(u.title)||!Array.isArray(u.lessons)||u.lessons.length<1||u.lessons.length>50){issue('INVALID_UNIT',path);return;}
    if(unitIds.has(u.id))issue('DUPLICATE_UNIT',path);unitIds.add(u.id);
    u.lessons.forEach((l,j)=>{
      const lp=path+'.lessons.'+j;
      if(!exact(l,['id','title','goal','activities'])||!id(l.id)||!text(l.title)||!text(l.goal)||!Array.isArray(l.activities)||l.activities.length<1||l.activities.length>50){issue('INVALID_LESSON',lp);return;}
      if(lessonIds.has(l.id))issue('DUPLICATE_LESSON',lp);lessonIds.add(l.id);lessons.push(l);
    });
  });
  if(lessons.length>150)issue('TOO_MANY_LESSONS','$');
  const result=engine.checkLessons(lessons);
  for(const i of result.issues)issues.push({code:i.code,path:i.lessonId||'$',activityId:i.activityId});
  return {valid:issues.length===0,issues};
}
if(require.main===module){
  try{const raw=require('node:fs').readFileSync(0,'utf8');if(Buffer.byteLength(raw)>262144)throw Error('size');process.stdout.write(JSON.stringify(validate(JSON.parse(raw))));}
  catch{process.stdout.write(JSON.stringify({valid:false,issues:[{code:'INVALID_JSON',path:'$'}]}));}
}
module.exports={validate};
