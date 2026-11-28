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

test('durable approved backup retries the same operation after lost response and fresh login',async()=>{
  let saved=null,lose=true,requests=[],parent=id;
  const store={read:()=>saved,write:q=>{saved=JSON.parse(JSON.stringify(q));return true;},remove:()=>{saved=null;return true;}};
  const client=create(async(path,o)=>{
    const b=JSON.parse(o.body);
    if(b.action==='writeProgress'){requests.push(b);if(lose){lose=false;throw Error('response lost');}}
    const data=b.action==='login'?{token:'a'.repeat(43),expiresAt:'2099-01-01T00:00:00Z',parentId:parent}:b.action==='children'?{children:[{id,nickname:'Test',ageBand:'unspecified'}]}:b.action==='readProgress'?{revision:0,snapshot:null}:{revision:1};
    return {ok:true,status:200,json:async()=>data};
  },{allowed:()=>true,randomId:()=>id,queueStore:store});
  await client.login('test@example.test','password');await client.list();await client.compare(id,'default',snapshot);
  await assert.rejects(client.upload('default',snapshot));
  assert.equal(saved.operationId,id);assert.equal(JSON.stringify(saved).includes('a'.repeat(43)),false);
  client.clear();assert.equal(client.pending().authorized,false);
  await assert.rejects(client.resume('default',snapshot));
  parent='22222222-2222-4222-8222-222222222222';
  await client.login('other@example.test','password');await client.list();
  await assert.rejects(client.resume('default',snapshot));
  parent=id;await client.login('test@example.test','password');await client.list();
  await assert.rejects(client.resume('other',snapshot));
  await assert.rejects(client.resume('default',{...snapshot,completedLessonIds:[]}));
  assert.equal(requests.length,1);
  assert.equal((await client.resume('default',snapshot)).revision,1);
  assert.deepEqual(requests[0],requests[1]);assert.equal(saved,null);
});
test('queue write failure blocks upload before any request',async()=>{
  let writes=0;
  const c=create(async(path,o)=>{
    const b=JSON.parse(o.body);if(b.action==='writeProgress')writes++;
    const data=b.action==='login'?{token:'a'.repeat(43),expiresAt:'2099-01-01T00:00:00Z',parentId:id}:b.action==='children'?{children:[{id,nickname:'Test',ageBand:'unspecified'}]}:{revision:0,snapshot:null};
    return {ok:true,status:200,json:async()=>data};
  },{allowed:()=>true,randomId:()=>id,queueStore:{read:()=>null,write:()=>false,remove:()=>true}});
  await c.login('test@example.test','password');await c.list();await c.compare(id,'default',snapshot);
  await assert.rejects(c.upload('default',snapshot));assert.equal(writes,0);
});

test('existing progress merges completed IDs with remote path and exact revision, retry is idempotent',async()=>{
 const {mergeSnapshots}=require('../family-client.js');
 const remote={...snapshot,completedLessonIds:['remote-only'],path:{marker:'remote'}};
 const local={...snapshot,completedLessonIds:['hello-1'],path:{marker:'local'}};
 assert.deepEqual(mergeSnapshots(local,remote),{...remote,completedLessonIds:['hello-1','remote-only']});
 assert.equal(mergeSnapshots(local,{...remote,curriculumVersion:'different'}),null);
 let saved=null,requests=[],lose=true,revision=2,serverSnapshot=remote,last=null;
 const store={read:()=>saved,write:q=>{saved=JSON.parse(JSON.stringify(q));return true;},remove:()=>{saved=null;return true;}};
 const client=create(async(path,o)=>{
  const b=JSON.parse(o.body);let data,status=200;
  if(b.action==='login')data={token:'a'.repeat(43),expiresAt:'2099-01-01T00:00:00Z',parentId:id};
  else if(b.action==='children')data={children:[{id,nickname:'Test',ageBand:'unspecified'}]};
  else if(b.action==='readProgress')data={revision,snapshot:serverSnapshot};
  else if(b.action==='writeProgress'){requests.push(b);if(last===b.operationId)data={revision,snapshot:serverSnapshot};else if(b.baseRevision!==revision)status=409;else{revision++;serverSnapshot=b.snapshot;last=b.operationId;data={revision,snapshot:serverSnapshot};if(lose){lose=false;throw Error('lost');}}}
  return {ok:status===200,status,json:async()=>data};
 },{allowed:()=>true,randomId:()=>id,queueStore:store});
 await client.login('test@example.test','password');await client.list();await client.compare(id,'default',local);
 await assert.rejects(client.merge('other',local));await assert.rejects(client.merge('default',{...local,completedLessonIds:[]}));
 await assert.rejects(client.merge('default',local));
 assert.equal(saved.version,2);assert.equal(saved.baseRevision,2);assert.equal(client.pending().kind,'merge');assert.equal(saved.snapshot.path.marker,'remote');
 assert.deepEqual(saved.snapshot.completedLessonIds,['hello-1','remote-only']);assert.equal(saved.localSnapshot.path.marker,'local');
 client.clear();await client.login('test@example.test','password');await client.list();
 await assert.rejects(client.resume('default',{...local,completedLessonIds:[]}));
 assert.equal((await client.resume('default',local)).revision,3);assert.deepEqual(requests[0],requests[1]);assert.equal(saved,null);
});
test('merge rejects stale server revision without automatic retry',async()=>{
 let saved=null,writes=0;
 const client=create(async(path,o)=>{const b=JSON.parse(o.body);if(b.action==='writeProgress'){writes++;return {ok:false,status:409};}
 const data=b.action==='login'?{token:'a'.repeat(43),expiresAt:'2099-01-01T00:00:00Z',parentId:id}:b.action==='children'?{children:[{id,nickname:'Test',ageBand:'unspecified'}]}:{revision:3,snapshot};
 return {ok:true,status:200,json:async()=>data};
 },{allowed:()=>true,randomId:()=>id,queueStore:{read:()=>saved,write:q=>{saved=q;return true;},remove:()=>{saved=null;return true;}}});
 await client.login('test@example.test','password');await client.list();await client.compare(id,'default',snapshot);
 await assert.rejects(client.merge('default',snapshot),e=>e.status===409);assert.equal(saved.status,'conflict');assert.equal(client.state().preview,null);
 await assert.rejects(client.resume('default',snapshot));assert.equal(writes,1);
});

test('linked profile prevents a different parent or child, retries approved request only',async()=>{
 const other='22222222-2222-4222-8222-222222222222';let parent=id,linked=null,queued=null,writes=0,lose=true;
 const c=create(async(path,o)=>{const b=JSON.parse(o.body);
  if(b.action==='writeProgress'){writes++;if(lose){lose=false;throw Error('lost');}}
  const data=b.action==='login'?{token:'a'.repeat(43),expiresAt:'2099-01-01T00:00:00Z',parentId:parent}:b.action==='children'?{children:[{id,nickname:'Test',ageBand:'unspecified'},{id:other,nickname:'Other',ageBand:'unspecified'}]}:b.action==='readProgress'?{revision:0,snapshot:null}:{revision:1};
  return {ok:true,status:200,json:async()=>data};
 },{allowed:()=>true,randomId:()=>id,linkStore:{read:()=>linked,write:v=>{linked=v;return true;},remove:()=>{linked=null;return true;}},queueStore:{read:()=>queued,write:v=>{queued=v;return true;},remove:()=>{queued=null;return true;}}});
 await c.login('a@example.test','password');await c.list();assert.equal(c.link(id,'default',true),true);
 assert.equal(c.link(other,'default',true),false);await assert.rejects(c.compare(other,'default',snapshot));
 assert.equal(await c.retryLinked('default',snapshot),false);assert.equal(writes,0);
 await c.compare(id,'default',snapshot);await assert.rejects(c.upload('default',snapshot));assert.equal(c.unlink('default'),false);
 c.clear();parent=other;await c.login('b@example.test','password');await c.list();assert.equal(c.linkState('default').authorized,false);
 await assert.rejects(c.compare(id,'default',snapshot));assert.equal(await c.retryLinked('default',snapshot),false);
 c.clear();parent=id;await c.login('a@example.test','password');await c.list();
 assert.equal(await c.retryLinked('default',{...snapshot,completedLessonIds:[]}),false);
 assert.equal(await c.retryLinked('default',snapshot),true);assert.equal(writes,2);assert.equal(queued,null);assert.equal(c.unlink('default'),true);
});

test('synthetic registration and reset are explicit, no session or persisted credentials',async()=>{
  const calls=[];let unlocked=true;const client=create(async(path,o)=>{calls.push({body:JSON.parse(o.body),headers:o.headers});return {ok:true,status:201,json:async()=>({ok:true})};},{allowed:()=>unlocked});
  const code='a'.repeat(43),password='synthetic-long-password';
  await assert.rejects(client.redeem('register','real@example.invalid',code,password));
  await assert.rejects(client.redeem('reset','test@example.test','short',password));
  assert.equal(calls.length,0);
  await client.redeem('register','test@example.test',code,password);
  await client.redeem('reset','test@example.test',code,password);
  assert.deepEqual(calls.map(x=>x.body.action),['registerWithCode','resetWithCode']);
  assert.ok(calls.every(x=>!x.headers.Authorization));
  assert.equal(client.state().signedIn,false);
  assert.ok(!JSON.stringify(client.state()).includes(password));
  unlocked=false;await assert.rejects(client.redeem('reset','test@example.test',code,password));assert.equal(calls.length,2);
});
test('closing parent panel invalidates late credential redemption response',async()=>{
  let resolve;const client=create(()=>new Promise(r=>resolve=r),{allowed:()=>true});
  const p=client.redeem('register','test@example.test','a'.repeat(43),'synthetic-long-password');
  client.clear();resolve({ok:true,status:201,json:async()=>({ok:true})});await assert.rejects(p);assert.equal(client.state().signedIn,false);
});
