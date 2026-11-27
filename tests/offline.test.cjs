const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {create,API_ROOT}=require('../network.js');
const {paths}=require('../offline-assets.js');
const root=path.resolve(__dirname,'..');
test('offline requests fail locally without reaching paid APIs',async()=>{
  let calls=0;const net=create({isOnline:()=>false,fetchImpl:()=>{calls++;}});
  await assert.rejects(net.request('/api/provider-token',{method:'POST',body:'{}'}));
  assert.equal(calls,0);assert.equal(net.getState(),'offline');
  assert.equal(await net.probe(),false);
});
test('network failure and recovery only probe status; HTTP errors remain service errors',async()=>{
  let fail=true;const calls=[],states=[];
  const net=create({isOnline:()=>true,onState:s=>states.push(s),fetchImpl:async(url)=>{
    calls.push(url);if(fail)throw new TypeError('network');return {ok:true,status:200};
  }});
  await assert.rejects(net.request('/api/status'));
  assert.equal(net.getState(),'unreachable');fail=false;
  assert.equal(await net.probe(),true);assert.equal(net.getState(),'online');
  assert.deepEqual(calls,['/api/status','/api/status']);
});
test('native requests use only configured HTTPS endpoints and support JSON',async()=>{
  const calls=[];const net=create({isOnline:()=>true,nativeRequest:async opts=>{calls.push(opts);return {status:200,data:{providers:['openai']}};}});
  const response=await net.request('/api/provider-token',{method:'POST',body:'{"lessonId":"x"}'});
  assert.equal(response.ok,true);assert.deepEqual(await response.json(),{providers:['openai']});
  assert.equal(calls[0].url,API_ROOT+'/api/provider-token');assert.equal(calls[0].data.lessonId,'x');
  await assert.rejects(net.request('https://example.org/'));
  assert.equal(calls.length,1);
});
test('aborted request does not trigger a false disconnect',async()=>{
  const controller=new AbortController();
  const net=create({isOnline:()=>true,fetchImpl:()=>new Promise(()=>{}),timeoutMs:1000});
  const result=net.request('/api/status',{signal:controller.signal});controller.abort();
  await assert.rejects(result,e=>e.name==='AbortError');assert.equal(net.getState(),'online');
});
test('timeout is bounded and does not retry paid request',async()=>{
  let calls=0;const net=create({isOnline:()=>true,fetchImpl:()=>{calls++;return new Promise(()=>{});},timeoutMs:5});
  await assert.rejects(net.request('/api/challenge-audio',{method:'POST',body:'{}'}));
  assert.equal(net.getState(),'unreachable');assert.equal(calls,1);
});
test('all precached public assets exist; no API or secret paths',()=>{
  assert.equal(new Set(paths).size,paths.length);
  for(const p of paths){assert.ok(!p.startsWith('/api/')&&!p.includes('..')&&!p.startsWith('/.'));assert.ok(fs.existsSync(path.join(root,p.slice(1))),p);}
  assert.ok(paths.includes('/index.html')&&paths.includes('/curriculum.json')&&paths.includes('/network.js'));
});
test('native package starts from bundled HTML and keeps the previous HTTPS origin',()=>{
  const config=require('../android-apk/capacitor.config.json');
  assert.equal(config.server.url,undefined);assert.equal(config.server.hostname,'lolo-learning.vercel.app');assert.equal(config.server.androidScheme,'https');
  assert.equal(config.appId,'com.heshammera.lolo');assert.equal(config.webDir,'www-bundled');
  execFileSync(process.execPath,[path.join(root,'scripts/prepare_android_web.js')]);
  const bundle=path.join(root,'android-apk',config.webDir);
  const html=fs.readFileSync(path.join(bundle,'index.html'),'utf8');
  assert.match(html,/LoloNativeBundled=true/);assert.match(html,/id="offlinePractice"/);
  assert.ok(fs.existsSync(path.join(bundle,'curriculum.json')));
  assert.ok(!fs.existsSync(path.join(bundle,'.env'))&&!fs.existsSync(path.join(bundle,'server.py'))&&!fs.existsSync(path.join(bundle,'api')));
});
