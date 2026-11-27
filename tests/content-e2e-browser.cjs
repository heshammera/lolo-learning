/* Real application shell, actual SW/cache, IndexedDB and WebCrypto; test-only key served on loopback. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {webcrypto}=require('node:crypto');
const {chromium}=require('playwright');
const assets=require('../offline-assets.js');
const root=path.resolve(__dirname,'..');
const draftId='11111111-1111-4111-8111-111111111111';
const releaseId='22222222-2222-4222-8222-222222222222';
const activity=(id,prompt)=>({id,type:'true-false',version:1,prompt,config:{answer:true}});
const content={schemaVersion:1,subjectId:'science',gradeId:'grade-1',title:'علوم اختبارية',units:[
  {id:'plants',title:'النباتات',lessons:[
    {id:'water',title:'الماء',goal:'احتياجات النبات',activities:[activity('a1','النبات يحتاج الماء.'),activity('a2','النبات يحتاج الضوء.')]},
    {id:'roots',title:'الجذور',goal:'وظيفة الجذور',activities:[activity('a3','الجذور تمتص الماء.')]}
  ]},
  {id:'animals',title:'الحيوانات',lessons:[{id:'food',title:'الغذاء',goal:'احتياجات الحيوان',activities:[activity('a4','الحيوانات تحتاج الغذاء.')]}]}
]};
(async()=>{
  // No test key, private key, or override is written to the repository or bundled APK.
  const key=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const jwk=await webcrypto.subtle.exportKey('jwk',key.publicKey);
  async function signed(sequence,version,title){
    const payload=Buffer.from(JSON.stringify({format:1,draftId,releaseId,version,sequence,content:{...content,title}}));
    const signature=await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key.privateKey,payload);
    return {keyId:'fixture',payload:payload.toString('base64url'),signature:Buffer.from(signature).toString('base64url')};
  }
  const first=await signed(1,1,content.title);
  const second=await signed(2,2,'علوم اختبارية جديدة');
  const tampered={...first,payload:Buffer.from(JSON.stringify({format:1,draftId,releaseId,version:1,sequence:1,content:{...content,title:'Modified'}})).toString('base64url')};
  const allow=new Set([...assets.paths,'/offline-assets.js','/sw.js']);
  const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.webp':'image/webp','.ico':'image/x-icon'};
  let apiPosts=0;
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    if(req.method!=='GET'){apiPosts++;res.writeHead(405);return res.end();}
    if(url.pathname==='/api/status'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify({providers:[],familyUiEnabled:false,progressSyncEnabled:false}));}
    const name=url.pathname==='/'?'/index.html':url.pathname;
    if(!allow.has(name)){res.writeHead(404);return res.end();}
    if(name==='/content-trust.js'){
      res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8'});
      return res.end('window.LoloContentTrust=Object.freeze('+JSON.stringify({fixture:jwk})+');');
    }
    try{const data=fs.readFileSync(path.join(root,name.slice(1)));res.writeHead(200,{'Content-Type':mime[path.extname(name)]||'application/octet-stream'});res.end(data);}
    catch{res.writeHead(404);res.end();}
  });
  let browser,context;
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({headless:true});
    context=await browser.newContext();
    await context.addInitScript(()=>{
      if(!localStorage.getItem('lolo-selected-program')){
        localStorage.setItem('lolo-selected-program','foundation');
        localStorage.setItem('lolo-current-lesson','hello-1');
        localStorage.setItem('lolo-welcome-tour-v1-complete','true');
      }
    });
    await context.route('https://**/*',route=>route.abort());
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('dialog',d=>d.accept());
    const ready=()=>page.waitForFunction(()=>document.querySelector('#mic')&&!document.querySelector('#mic').disabled);
    async function parent(setup=false){
      await page.locator('#homeChoose').click();
      await page.locator('#parentGate:not([hidden])').waitFor();
      if(setup){
        await page.locator('#parentGateSetupPin').fill('638294');
        await page.locator('#parentGateSetupConfirm').fill('638294');
        await page.locator('#parentGateSetup button[type="submit"]').click();
        await page.locator('#parentGateRecoveryDone').click();
      }else{
        await page.locator('#parentGatePin').fill('638294');
        await page.locator('#parentGateVerify button[type="submit"]').click();
      }
      await page.locator('#parentSettingsTab').click();
      await page.locator('#extraContentPanel').waitFor();
      await page.waitForFunction(()=>!document.querySelector('#extraImport').disabled&&document.querySelector('#extraContentSelect').options.length>0);
    }
    async function importFile(envelope){
      await page.locator('#extraContentFile').setInputFiles({name:'fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(envelope))});
      await page.locator('#extraImport').click();
    }
    async function choose(scope,unit,lesson){
      await page.locator('#extraContentSelect').selectOption(draftId);
      await page.waitForFunction(()=>Array.from(document.querySelector('#extraUnit').options).some(o=>o.value==='plants'));
      await page.locator('#extraScope').selectOption(scope);
      if(unit)await page.locator('#extraUnit').selectOption(unit);
      if(lesson)await page.locator('#extraLesson').selectOption(lesson);
      await page.waitForFunction(()=>!document.querySelector('#extraStart').disabled);
      await page.locator('#extraStart').click();
      await page.locator('#extraPractice[open]').waitFor();
    }
    async function answer(correct){
      await page.locator('#extraPracticeBody input[value="'+(correct?'true':'false')+'"]').check();
      await page.locator('#extraPracticeBody button[type="submit"]').click();
      await page.waitForFunction(()=>document.querySelector('#extraPracticeSaved').textContent.includes('تم حفظ'));
    }
    await page.goto(origin,{waitUntil:'domcontentloaded'});await ready();
    await page.waitForFunction(()=>!!navigator.serviceWorker.controller,{},{timeout:30000});
    const original=await page.evaluate(()=>({path:localStorage.getItem('lolo-learning-path-v1'),mastered:localStorage.getItem('lolo-mastered')}));
    await parent(true);
    await importFile(tampered);
    await page.waitForFunction(()=>document.querySelector('#extraContentStatus').textContent.includes('INVALID_SIGNATURE'));
    assert.equal(await page.locator('#extraContentSelect option').count(),1);
    await importFile(first);
    await page.waitForFunction(id=>Array.from(document.querySelector('#extraContentSelect').options).some(o=>o.value===id),draftId);
    await choose('lesson','plants','water');
    assert.match(await page.locator('#extraPracticeProgress').textContent(),/1 من 2/);
    await answer(true);
    await page.locator('#extraPracticeClose').click();
    await context.setOffline(true);
    await page.reload({waitUntil:'domcontentloaded'});await ready();
    await page.locator('#networkNotice[data-state="offline"]').waitFor();
    await parent();
    await choose('lesson','plants','water');
    assert.match(await page.locator('#extraPracticeProgress').textContent(),/2 من 2/);
    await answer(false);await page.locator('#extraPracticeNext').click();
    assert.match(await page.locator('#extraPracticeGoal').textContent(),/1 من 2/);
    assert.equal(await page.locator('#extraPracticeNext').isVisible(),false);
    await page.locator('#extraPracticeClose').click();
    const checkpoint=await page.evaluate(()=>JSON.parse(localStorage.getItem('lolo-extra-practice-v1')));
    assert.deepEqual(checkpoint.entries[0].results,[{activityId:'a1',status:'correct'},{activityId:'a2',status:'incorrect'}]);
    assert.deepEqual(await page.evaluate(()=>({path:localStorage.getItem('lolo-learning-path-v1'),mastered:localStorage.getItem('lolo-mastered')})),original);
    // Signed update imported from local file even offline; old checkpoint remains separate.
    await parent();await importFile(second);
    await page.waitForFunction(()=>document.querySelector('#extraContentSelect').textContent.includes('v2'));
    await choose('lesson','plants','water');
    assert.match(await page.locator('#extraPracticeProgress').textContent(),/1 من 2/);
    await page.locator('#extraPracticeClose').click();
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('lolo-extra-practice-v1')).entries.find(e=>e.sequence===1).results.length),2);
    // Ensure the other supported scope boundaries work in the actual UI.
    await parent();await choose('unit','plants');
    assert.match(await page.locator('#extraPracticeProgress').textContent(),/1 من 3/);
    await page.locator('#extraPracticeClose').click();
    await parent();await choose('curriculum');
    assert.match(await page.locator('#extraPracticeProgress').textContent(),/1 من 4/);
    await page.locator('#extraPracticeClose').click();
    assert.equal(apiPosts,0);assert.deepEqual(errors,[]);
    console.log('Signed curriculum UI: tamper rejection, import, real SW offline reload, resume, update isolation and all scope boundaries passed.');
  }finally{
    if(context)await context.close();
    if(browser)await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
