const {test}=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('../family-client.js');
const id='11111111-1111-4111-8111-111111111111';
const snapshot={schemaVersion:1,curriculumVersion:'2.1.0',completedLessonIds:['hello-1'],path:null};
function fixture(){
  let allowed=true,revision=0,remote=null,conflict=false;
  const calls=[];
  const client=create(async(path,options)=>{
    const body=JSON.parse(options.body);calls.push({body,headers:options.headers});
    let data={},status=200;
    if(body.action==='login')data={token:'a'.repeat(43),expiresAt:'2099-01-01T00:00:00Z',parentId:id};
    else if(body.action==='children')data={children:[{id,nickname:'Test',ageBand:'unspecified'}]};
    else if(body.action==='readProgress')data={revision,snapshot:remote};
    else if(body.action==='writeProgress'){if(conflict||revision!==0)status=409;else{revision=1;remote=body.snapshot;data={revision,snapshot:remote};}}
    return {ok:status===200,status,json:async()=>data};
  },{allowed:()=>allowed,randomId:()=>id});
  return {client,calls,disable:()=>allowed=false,conflict:()=>conflict=true};
}
test('no account requests without unlocked panel; token never exposed by state',async()=>{
  const {client,calls,disable}=fixture();
  await assert.rejects(client.list());
  await client.login('test@example.test','test-password');await client.list();
  assert.equal(client.state().signedIn,true);assert.equal(JSON.stringify(client.state()).includes('a'.repeat(43)),false);
  assert.equal(calls.at(-1).headers.Authorization,'Bearer '+'a'.repeat(43));
  disable();await assert.rejects(client.list());client.clear();assert.equal(client.state().signedIn,false);
});
test('explicit first backup only; changed profile or snapshot and remote overwrite rejected',async()=>{
  const {client,calls}=fixture();await client.login('test@example.test','password');await client.list();
  await assert.rejects(client.upload('default',snapshot));
  await client.compare(id,'default',snapshot);
  await assert.rejects(client.upload('other',snapshot));
  await assert.rejects(client.upload('default',{...snapshot,completedLessonIds:[]}));
  assert.equal(calls.filter(c=>c.body.action==='writeProgress').length,0);
  assert.equal((await client.upload('default',snapshot)).revision,1);
  await client.compare(id,'default',snapshot);
  await assert.rejects(client.upload('default',snapshot),e=>e.status===409);
  assert.equal(calls.filter(c=>c.body.action==='writeProgress').length,1);
  await client.logout();assert.equal(client.state().signedIn,false);
});
test('conflict invalidates preview and never retries automatically',async()=>{
  const {client,calls,conflict}=fixture();await client.login('test@example.test','password');await client.list();await client.compare(id,'default',snapshot);conflict();
  await assert.rejects(client.upload('default',snapshot),e=>e.status===409);assert.equal(client.state().preview,null);
  assert.equal(calls.filter(c=>c.body.action==='writeProgress').length,1);
});
test('late login response after clear cannot restore session',async()=>{
  let resolve;const c=create(()=>new Promise(r=>resolve=r),{allowed:()=>true});
  const p=c.login('test@example.test','password');c.clear();
  resolve({ok:true,status:200,json:async()=>({token:'a'.repeat(43),expiresAt:'2099-01-01T00:00:00Z',parentId:id})});
  await assert.rejects(p);assert.equal(c.state().signedIn,false);
});
