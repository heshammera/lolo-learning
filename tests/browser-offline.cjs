const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const http=require('node:http');
const {chromium}=require('playwright');
const root='http://127.0.0.1:4173';
const local='http://127.0.0.1:4174';
const servers=[
  spawn('python3',['server.py'],{stdio:'ignore',env:{...process.env,HOST:'127.0.0.1',PORT:'4173'}}),
  spawn('python3',['-m','http.server','4174','--bind','127.0.0.1','--directory','android-apk/www-bundled'],{stdio:'ignore'}),
];
async function waitServer(url){
  const ready=()=>new Promise(resolve=>{
    const request=http.get(url,response=>{
      response.resume();
      response.on('end',()=>resolve(response.statusCode===200));
      response.on('error',()=>resolve(false));
    });
    request.setTimeout(1500,()=>{request.destroy();resolve(false);});
    request.on('error',()=>resolve(false));
  });
  for(let i=0;i<60;i++){if(await ready())return;await new Promise(r=>setTimeout(r,100));}
  throw Error('Server unavailable '+url);
}
async function seed(context){
  await context.addInitScript(()=>{
    if(!localStorage.getItem('lolo-selected-program')){
      localStorage.setItem('lolo-selected-program','foundation');
      localStorage.setItem('lolo-current-lesson','hello-1');
      localStorage.setItem('lolo-welcome-tour-v1-complete','true');
    }
  });
  await context.route('https://**/*',route=>route.abort());
}

async function verifyHub(page){
  const path=await page.evaluate(()=>window.LoloStorage.get('lolo-learning-path-v1'));
  const mastery=await page.evaluate(()=>window.LoloStorage.get('lolo-mastered'));
  await page.locator('#homeActivityHub').click();
  await page.locator('#activityHub[open]').waitFor();
  assert.equal(await page.locator('#hubCatalog [data-activity-id]').count(),27);
  await page.locator('#hubFilter').selectOption('games');
  assert.equal(await page.locator('#hubCatalog [data-activity-id]').count(),3);
  await page.locator('#hubCatalog [data-activity-id="game-maze"]').click();
  await page.locator('#hubBody .activity-maze-grid').waitFor();
  await page.locator('#hubBack').click();
  await page.locator('#hubFilter').selectOption('questions');
  await page.locator('#hubCatalog [data-activity-id="science-choice"]').click();
  await page.locator('#hubBody input[value="i1"]').check();
  await page.locator('#hubBody button[type="submit"]').click();
  assert.match(await page.locator('#hubBody [role="status"]').textContent(),/أحسنت/);
  await page.locator('#hubAgain').click();
  assert.equal(await page.locator('#hubBody input[value="i1"]').isChecked(),false);
  await page.locator('#hubClose').click();
  assert.equal(await page.locator('#activityHub').isVisible(),false);
  await page.waitForFunction(()=>document.getElementById('hubBody').childElementCount===0);
  assert.equal(await page.evaluate(()=>window.LoloStorage.get('lolo-learning-path-v1')),path);
  assert.equal(await page.evaluate(()=>window.LoloStorage.get('lolo-mastered')),mastery);
}

async function verifyPractice(page){
  await page.locator('#homePractice').click();
  await page.locator('#offlinePractice[open]').waitFor();
  assert.ok(await page.locator('#practiceCards button').count()>0);
  await page.locator('#practiceCards button').first().click();
  assert.ok((await page.locator('#practiceFeedback').textContent()).trim().length>0);
  await page.locator('#practiceQuiz').click();
  await page.locator('#visualQuiz[open]').waitFor();
  for(let i=0;i<3;i++){
    await page.locator('#visualQuizOptions button').first().click();
    await page.locator('#visualQuizNext').click();
  }
  assert.match(await page.locator('#visualQuizPrompt').textContent(),/من 3/);
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('lolo-visual-assessment-v1')));
  assert.equal(saved['hello-1'].length,1);
  assert.equal(saved['hello-1'][0].total,3);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('lolo-mastered')||'[]').length),0);
  await page.locator('#visualQuizDone').click();
  await page.locator('#homePractice').click();
  await page.locator('#practiceAdaptive').click();
  await page.locator('#visualQuiz[open]').waitFor();
  for(let i=0;i<5;i++){
    assert.match(await page.locator('#visualQuizProgress').textContent(),new RegExp('من 5'));
    await page.locator('#visualQuizOptions button').first().click();
    await page.locator('#visualQuizNext').click();
  }
  const adaptive=await page.evaluate(()=>JSON.parse(localStorage.getItem('lolo-visual-assessment-v1'))['hello-1']);
  assert.equal(adaptive.length,2);assert.equal(adaptive[1].mode,'adaptive');assert.equal(adaptive[1].total,5);
  assert.equal(new Set(adaptive[1].answers.map(a=>a.questionId)).size,5);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('lolo-mastered')||'[]').length),0);
  await page.locator('#visualQuizDone').click();
  await page.locator('#homePractice').click();
  await page.locator('#practiceTrace').click();
  await page.locator('#traceSheet.open').waitFor();
  assert.equal(await page.locator('#traceCanvas').isVisible(),true);
  await page.locator('#traceClose').click();
}
(async()=>{
  let browser;
  try{
    await Promise.all([waitServer(root),waitServer(local)]);
    browser=await chromium.launch({headless:true});
    const context=await browser.newContext();
    await seed(context);
    const page=await context.newPage();
    const errors=[];let paid=0;
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{if(request.method()==='POST'&&request.url().includes('/api/'))paid++;});
    await page.goto(root,{waitUntil:'domcontentloaded'});
    assert.equal((await context.request.get(root+'/assets/branding/lolo-splash.webp')).status(),200);
    await page.locator('#loloBoot').waitFor({state:'hidden'});
    assert.equal(await page.locator('#bootProgress').getAttribute('value'),'100');
    assert.equal(await page.evaluate(()=>document.getElementById('app').hasAttribute('inert')),false);
    assert.equal(await page.locator('#parentReport').evaluate(el=>el.childElementCount),0);
    assert.equal((await context.request.get(root+'/learning-analytics.js')).status(),200);
    assert.equal((await context.request.get(root+'/learning-reminders.js')).status(),200);
    await page.waitForFunction(()=>!!navigator.serviceWorker.controller,{},{timeout:30000});
    await page.waitForFunction(()=>document.querySelector('#mic')&&!document.querySelector('#mic').disabled);
    const saved=await page.evaluate(()=>localStorage.getItem('lolo-learning-path-v1'));
    assert.ok(saved);
    await context.setOffline(true);
    await page.locator('#networkNotice[data-state="offline"]').waitFor();
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('#loloBoot').waitFor({state:'hidden'});
    assert.ok(await page.evaluate(()=>document.getElementById('loloBootArt').naturalWidth>0));
    await page.locator('#networkNotice[data-state="offline"]').waitFor();
    await page.waitForFunction(()=>document.querySelector('#mic')&&!document.querySelector('#mic').disabled);
    assert.equal(await page.evaluate(()=>localStorage.getItem('lolo-learning-path-v1')),saved);
    for(const width of [320,390,768]){
      await page.setViewportSize({width,height:800});
      await page.locator('#childDashboard').waitFor({state:'visible'});
      assert.equal(await page.locator('#lessonSessionPanel').isVisible(),false);
      assert.equal(await page.locator('#sessionBack').isVisible(),false);
      const layout=await page.evaluate(()=>{
        const ids=['homeStart','homePractice','homeChoose'];
        const buttons=ids.map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {w:r.width,h:r.height,left:r.left,right:r.right};});
        return {buttons,width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth};
      });
      assert.ok(layout.scroll<=layout.width+1,'no horizontal document overflow at '+width);
      for(const b of layout.buttons){assert.ok(b.w>=44&&b.h>=44);assert.ok(b.left>=-1&&b.right<=layout.width+1);}
    }
    await page.setViewportSize({width:390,height:800});
    await verifyHub(page);
    await page.locator('#homeStart').click();
    await verifyPractice(page);
    await page.locator('#homeChoose').click();
    await page.locator('#parentGate:not([hidden])').waitFor();
    await page.locator('#parentGateSetupPin').fill('638294');
    await page.locator('#parentGateSetupConfirm').fill('638294');
    await page.locator('#parentGateSetup button[type="submit"]').click();
    await page.locator('#parentGateRecoveryDone').click();
    await page.locator('#parentSettingsTab').click();
    await page.locator('#parentQuickNav [data-parent-jump="parentProgressGroup"]').click();
    assert.equal(await page.evaluate(()=>document.activeElement.closest('section')?.id),'parentProgressGroup');
    assert.equal(await page.locator('#parentProgressGroup').isVisible(),true);
    await page.locator('#parentSettingsTab').click();
    assert.equal(await page.evaluate(()=>typeof window.LoloLearningAnalytics?.recommend),'function');
    await page.locator('#adaptiveRecommendations').waitFor({state:'visible'});
    assert.equal(await page.evaluate(()=>typeof window.LoloLearningReminders?.derive),'function');
    await page.locator('#learningReminders').waitFor({state:'visible'});
    assert.match(await page.locator('#learningReminders').textContent(),/متوقفة/);
    assert.equal(await page.locator('#extraImport').isDisabled(),true);
    assert.equal(await page.locator('#extraStart').isDisabled(),true);
    const activity=page.locator('#activityPreviewContent');
    await page.locator('#activityPreviewSelect').selectOption('science-choice');
    await activity.locator('input[value="i1"]').check();
    await activity.locator('button[type="submit"]').click();
    assert.match(await activity.locator('[role="status"]').textContent(),/أحسنت/);
    await page.locator('#activityPreviewSelect').selectOption('science-count');
    await activity.locator('input[type="number"]').fill('3');
    await activity.locator('button[type="submit"]').click();
    assert.match(await activity.locator('[role="status"]').textContent(),/أحسنت/);
    await page.locator('#activityPreviewSelect').selectOption('science-match');
    await activity.locator('select').nth(0).selectOption('i2');
    await activity.locator('select').nth(1).selectOption('i1');
    await activity.locator('button[type="submit"]').click();
    assert.match(await activity.locator('[role="status"]').textContent(),/أحسنت/);
    await page.locator('#activityPreviewSelect').selectOption('science-drag');
    const chip=activity.locator('[data-drag-item="i1"]'),zone=activity.locator('[data-drop-group="i1"]');
    await chip.scrollIntoViewIfNeeded();await zone.scrollIntoViewIfNeeded();
    const from=await chip.boundingBox(),to=await zone.boundingBox();
    assert.ok(from&&to);
    await page.mouse.move(from.x+from.width/2,from.y+from.height/2);
    await page.mouse.down();await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:12});await page.mouse.up();
    assert.equal(await activity.getByLabel('مجموعة قطة',{exact:true}).inputValue(),'i1');
    await activity.getByLabel('مجموعة وردة',{exact:true}).selectOption('i2');
    await activity.getByLabel('مجموعة سمكة',{exact:true}).selectOption('i1');
    await activity.locator('button[type="submit"]').click();
    assert.match(await activity.locator('form > p[role="status"]').textContent(),/أحسنت/);
    await page.locator('#activityPreviewSelect').selectOption('game-memory');
    const cards=activity.locator('.activity-memory-grid button');
    const observed=new Map();
    // Discover cards via actual clicks; solve from observed labels, no hidden-answer DOM.
    for(let i=0;i<6;i+=2){
      await cards.nth(i).click();const a=await cards.nth(i).textContent();observed.set(i,a);
      await cards.nth(i+1).click();const b=await cards.nth(i+1).textContent();observed.set(i+1,b);
    }
    const pairs=new Map();for(const [i,label] of observed){if(!pairs.has(label))pairs.set(label,[]);pairs.get(label).push(i);}
    for(const indices of pairs.values()){assert.equal(indices.length,2);if(!(await cards.nth(indices[0]).isDisabled())){await cards.nth(indices[0]).click();await cards.nth(indices[1]).click();}}
    await activity.locator('button[type="submit"]').click();
    assert.match(await activity.locator('form > p[role="status"]').textContent(),/أحسنت/);
    await page.locator('#activityPreviewSelect').selectOption('science-hotspot');
    const diagram=await activity.locator('.activity-hotspot-svg').boundingBox();assert.ok(diagram);
    await page.mouse.click(diagram.x+diagram.width*120/240,diagram.y+diagram.height*212/240);
    assert.equal(await activity.locator('input[value="root"]').isChecked(),true);
    await activity.locator('button[type="submit"]').click();
    assert.match(await activity.locator('form > p[role="status"]').textContent(),/أحسنت/);
    await page.locator('#activityPreviewSelect').selectOption('science-balance');
    for(let i=0;i<3;i++)await activity.getByRole('button',{name:'+ إضافة ثقل',exact:true}).click();
    await activity.locator('button[type="submit"]').click();
    assert.match(await activity.locator('form > p[role="status"]').textContent(),/أحسنت/);
    await page.locator('#activityPreviewSelect').selectOption('reading-story');
    await activity.getByRole('button',{name:'الماء',exact:true}).click();
    await activity.getByRole('button',{name:'لتحصل على الضوء',exact:true}).click();
    await activity.locator('button[type="submit"]').click();
    assert.match(await activity.locator('form > p[role="status"]').textContent(),/أحسنت/);
    assert.equal(await page.evaluate(()=>window.LoloStorage.getJSON('lolo-mastered',[]).length),0);
    await page.locator('#localProfileName').fill('Second learner');
    await page.locator('#localProfileForm button[type="submit"]').click();
    const profileButton=page.locator('#localProfilesList button[data-profile-id]').first();
    const childId=await profileButton.getAttribute('data-profile-id');
    assert.ok(childId);
    await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),profileButton.click()]);
    await page.waitForFunction(()=>document.querySelector('#mic')&&!document.querySelector('#mic').disabled);
    assert.equal(await page.evaluate(()=>window.LoloStorage.profiles.activeId),childId);
    assert.equal(await page.evaluate(()=>window.LoloStorage.get('lolo-visual-assessment-v1')),null);
    assert.equal(await page.evaluate(()=>window.LoloStorage.get('lolo-learning-path-v1')),null);
    await page.locator('#parentOpenWelcome').click();
    await page.locator('#parentGatePin').fill('638294');
    await page.locator('#parentGateVerify button[type="submit"]').click();
    await page.locator('#parentSettingsTab').click();
    const original=page.locator('#localProfilesList button[data-profile-id="default"]');
    await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),original.click()]);
    await page.waitForFunction(()=>document.querySelector('#mic')&&!document.querySelector('#mic').disabled);
    assert.equal(await page.evaluate(()=>window.LoloStorage.profiles.activeId),'default');
    const restoredVisual=await page.evaluate(()=>window.LoloStorage.getJSON('lolo-visual-assessment-v1',{})['hello-1']);
    assert.equal(restoredVisual.filter(r=>r.mode!=='adaptive').length,1);
    assert.equal(restoredVisual.filter(r=>r.mode==='adaptive').length,1);
    assert.equal(restoredVisual.find(r=>r.mode==='adaptive').total,5);
    assert.equal(await page.evaluate(()=>window.LoloStorage.get('lolo-learning-path-v1')),saved);
    // Parent-gated manual migration, entirely offline. Preserve the source profile.
    await page.locator('#parentOpen').click();
    await page.locator('#parentGatePin').fill('638294');
    await page.locator('#parentGateVerify button[type="submit"]').click();
    await page.locator('#parentSettingsTab').click();
    await page.locator('#localBackupExport').click();
    const rawBackup=await page.locator('#localBackupText').inputValue();
    const backup=JSON.parse(rawBackup);
    assert.deepEqual(Object.keys(backup).sort(),['completedLessonIds','curriculumVersion','path','schemaVersion']);
    assert.deepEqual(backup.path,JSON.parse(saved));
    await page.locator('#localBackupName').fill('Recovered learner');
    await page.locator('#localBackupRestore').click();
    assert.equal(await page.evaluate(()=>window.LoloStorage.profiles.list().length),2);
    await page.locator('#localBackupText').fill('{"invalid":true}');
    await page.locator('#localBackupConfirm').check();
    await page.locator('#localBackupRestore').click();
    assert.equal(await page.evaluate(()=>window.LoloStorage.profiles.list().length),2);
    await page.locator('#localBackupText').fill(rawBackup);
    await page.locator('#localBackupConfirm').check();
    await page.locator('#localBackupRestore').click();
    const recovered=await page.evaluate(()=>window.LoloStorage.profiles.list().find(p=>p.name==='Recovered learner')?.id);
    assert.ok(recovered);
    assert.deepEqual(await page.evaluate(id=>JSON.parse(localStorage.getItem('lolo-profile:'+id+':lolo-learning-path-v1')),recovered),backup.path);
    assert.equal(await page.evaluate(()=>window.LoloStorage.get('lolo-learning-path-v1')),saved);
    assert.equal(await page.locator('#localBackupText').inputValue(),'');
    await page.locator('#localBackupExport').click();
    await page.locator('#parentClose').click();
    assert.equal(await page.locator('#localBackupText').inputValue(),'');
    await page.locator('#localBackupExport').evaluate(el=>el.click());
    assert.equal(await page.locator('#localBackupText').inputValue(),'');
    assert.equal(paid,0);
    assert.deepEqual(errors,[]);
    assert.equal(await page.locator('#cloudFamilyPanel').isVisible(),false);
    await context.close();
    // Staging account UI with synthetic responses only; do not contact a real service.
    const staging=await browser.newContext({serviceWorkers:'block'});
    await seed(staging);
    const remoteChild='11111111-1111-4111-8111-111111111111', token='a'.repeat(43);
    let revision=0,remote=null,writes=0,firstOperation=null;
    const actions=[];
    await staging.route('**/api/status',route=>route.fulfill({json:{providers:[],familyUiEnabled:true,progressSyncEnabled:true,familyCredentialsPilotEnabled:true}}));
    await staging.route('**/api/family',async route=>{
      const body=route.request().postDataJSON();actions.push(body.action);
      if(['registerWithCode','resetWithCode'].includes(body.action)){assert.equal(route.request().headers()['authorization'],undefined);assert.equal(body.email,'synthetic@example.test');assert.equal(body.code,'b'.repeat(43));assert.equal(body.password,'synthetic-long-password');await route.fulfill({status:body.action==='registerWithCode'?201:200,json:{ok:true}});return;}
      if(body.action!=='login')assert.equal(route.request().headers()['authorization'],'Bearer '+token);
      let data={};
      if(body.action==='login')data={token,expiresAt:'2099-01-01T00:00:00Z',parentId:remoteChild};
      else if(body.action==='children')data={children:[{id:remoteChild,nickname:'Synthetic child',ageBand:'unspecified'}]};
      else if(body.action==='readProgress')data={revision,snapshot:remote};
      else if(body.action==='writeProgress'){
        writes++;assert.equal(body.childId,remoteChild);assert.equal(body.baseRevision,writes<=2?0:revision);
        assert.deepEqual(Object.keys(body.snapshot).sort(),['completedLessonIds','curriculumVersion','path','schemaVersion']);
        if(writes===1){firstOperation=body.operationId;revision=1;remote=body.snapshot;await route.abort();return;}
        if(writes===2){assert.equal(body.operationId,firstOperation);assert.deepEqual(body.snapshot,remote);}
        else{assert.notEqual(body.operationId,firstOperation);assert.deepEqual(body.snapshot.path,remote.path);assert.ok(remote.completedLessonIds.every(id=>body.snapshot.completedLessonIds.includes(id)));remote=body.snapshot;revision++;}
        data={revision,snapshot:remote};
      }
      await route.fulfill({json:data});
    });
    const sp=await staging.newPage();const stagingErrors=[];
    sp.on('pageerror',e=>stagingErrors.push(e.message));
    await sp.goto(root,{waitUntil:'domcontentloaded'});
    await sp.waitForFunction(()=>!document.querySelector('#mic').disabled);
    assert.equal(await sp.locator('#cloudFamilyPanel').isVisible(),false);
    await sp.locator('#parentOpen').click();
    await sp.locator('#parentGateSetupPin').fill('638294');
    await sp.locator('#parentGateSetupConfirm').fill('638294');
    await sp.locator('#parentGateSetup button[type="submit"]').click();
    await sp.locator('#parentGateRecoveryDone').click();
    await sp.locator('#cloudFamilyPanel:not([hidden])').waitFor();
    for(const selector of ['#cloudRegisterOpen','#cloudResetOpen']){
      await sp.locator(selector).click();
      await sp.locator('#cloudCredentialEmail').fill('synthetic@example.test');
      await sp.locator('#cloudCredentialCode').fill('b'.repeat(43));
      await sp.locator('#cloudCredentialPassword').fill('synthetic-long-password');
      await sp.locator('#cloudCredentialConfirm').fill('synthetic-long-password');
      await sp.locator('#cloudCredentialSubmit').click();
      await sp.locator('#cloudLogin:not([hidden])').waitFor();
      assert.equal(await sp.locator('#cloudCredentialCode').inputValue(),'');
      assert.equal(await sp.locator('#cloudCredentialPassword').inputValue(),'');
      assert.equal(await sp.evaluate(()=>JSON.stringify(localStorage).includes('synthetic-long-password')||JSON.stringify(sessionStorage).includes('synthetic-long-password')),false);
    }
    await sp.locator('#cloudEmail').fill('synthetic@example.test');
    await sp.locator('#cloudPassword').fill('synthetic-password');
    await sp.locator('#cloudLogin button[type="submit"]').click();
    await sp.locator('#cloudChildren button').first().waitFor();
    assert.equal(await sp.locator('#cloudPassword').inputValue(),'');
    await sp.locator('#cloudChildren button').first().click();
    await sp.locator('#cloudPreview:not([hidden])').waitFor();
    assert.equal(await sp.locator('#cloudUpload').isDisabled(),true);
    assert.equal(writes,0);
    await sp.locator('#cloudConfirm').check();
    await sp.locator('#cloudUpload').click();
    await sp.locator('#cloudPendingBox:not([hidden])').waitFor();
    await sp.waitForFunction(()=>!document.querySelector('#cloudResume').disabled);
    assert.equal(writes,1);
    await sp.locator('#parentClose').click();
    await sp.reload({waitUntil:'domcontentloaded'});
    await sp.waitForFunction(()=>!document.querySelector('#mic').disabled);
    await sp.locator('#parentOpen').click();
    await sp.locator('#parentGatePin').fill('638294');
    await sp.locator('#parentGateVerify button[type="submit"]').click();
    await sp.locator('#cloudFamilyPanel:not([hidden])').waitFor();
    await sp.locator('#cloudEmail').fill('synthetic@example.test');
    await sp.locator('#cloudPassword').fill('synthetic-password');
    await sp.locator('#cloudLogin button[type="submit"]').click();
    await sp.locator('#cloudChildren button').first().waitFor();
    await sp.locator('#cloudResume').click();
    await sp.waitForFunction(()=>document.querySelector('#cloudStatus').textContent.includes('تم حفظ'));
    assert.equal(writes,2);
    await sp.locator('#cloudChildren button').first().click();
    await sp.locator('#cloudPreview:not([hidden])').waitFor();
    assert.equal(await sp.locator('#cloudUpload').isVisible(),false);
    assert.equal(await sp.locator('#cloudRestore').isDisabled(),true);
    const oldPath=await sp.evaluate(()=>window.LoloStorage.get('lolo-learning-path-v1'));
    await sp.locator('#cloudRestoreConfirm').check();
    await sp.locator('#cloudRestore').click();
    await sp.waitForFunction(()=>document.querySelector('#cloudStatus').textContent.includes('تمت استعادة'));
    assert.equal(await sp.evaluate(()=>window.LoloStorage.profiles.list().length),2);
    assert.equal(await sp.evaluate(()=>window.LoloStorage.profiles.activeId),'default');
    assert.equal(await sp.evaluate(()=>window.LoloStorage.get('lolo-learning-path-v1')),oldPath);
    const copyId=await sp.evaluate(()=>window.LoloStorage.profiles.list()[1].id);
    assert.deepEqual(await sp.evaluate(id=>JSON.parse(localStorage.getItem('lolo-profile:'+id+':lolo-learning-path-v1')),copyId),remote.path);
    assert.equal(writes,2);
    assert.equal(await sp.locator('#cloudMerge').isDisabled(),true);
    await sp.locator('#cloudMergeConfirm').check();await sp.locator('#cloudMerge').click();
    await sp.waitForFunction(()=>document.querySelector('#cloudStatus').textContent.includes('تم دمج'));
    assert.equal(writes,3);assert.equal(revision,2);
    assert.equal(await sp.evaluate(()=>window.LoloStorage.get('lolo-learning-path-v1')),oldPath);
    assert.equal(await sp.evaluate(t=>JSON.stringify(localStorage).includes(t)||JSON.stringify(sessionStorage).includes(t),token),false);
    await sp.locator('#parentClose').click();
    await sp.locator('#parentOpen').click();
    await sp.locator('#parentGatePin').fill('638294');
    await sp.locator('#parentGateVerify button[type="submit"]').click();
    await sp.locator('#cloudLogin:not([hidden])').waitFor();
    assert.equal(await sp.locator('#cloudAccount').isVisible(),false);
    assert.equal(writes,3);
    assert.deepEqual(actions,['registerWithCode','resetWithCode','login','children','readProgress','writeProgress','login','children','writeProgress','readProgress','writeProgress']);
    assert.deepEqual(stagingErrors,[]);
    await staging.close();
    // Simulate native offline connectivity while serving the bundled files locally.
    // This checks bundle boot and API gating, not the Android WebView itself.
    const native=await browser.newContext();
    await seed(native);
    await native.addInitScript(()=>{
      Object.defineProperty(navigator,'onLine',{get:()=>false});
      window.__bootObserved=[];window.__nativeSplashHandoffs=0;
      window.Capacitor={Plugins:{StartupSplash:{painted:async()=>{window.__nativeSplashHandoffs++;}}}};
      let last=null;
      const observer=new MutationObserver(()=>{
        const root=document.getElementById('loloBoot'),bar=document.getElementById('bootProgress');
        if(!root||!bar||root.dataset.painted!=='true'||root.hidden)return;
        const value=bar.value;if(value===last)return;last=value;
        window.__bootObserved.push({value,at:performance.now(),art:document.getElementById('loloBootArt').naturalWidth>0});
      });
      observer.observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['value','data-painted','hidden']});
    });
    const np=await native.newPage();const nativeErrors=[];
    np.on('pageerror',error=>nativeErrors.push(error.message));
    await np.goto(local,{waitUntil:'domcontentloaded'});
    await np.locator('#loloBoot[data-painted="true"]:not([hidden])').waitFor();
    assert.equal(await np.locator('#app').evaluate(el=>el.hasAttribute('inert')),true);
    await np.locator('#loloBoot').waitFor({state:'hidden'});
    const stages=await np.evaluate(()=>window.__bootObserved);
    assert.deepEqual(stages.map(s=>s.value),[10,20,45,70,100]);
    assert.equal(await np.evaluate(()=>window.__nativeSplashHandoffs),1);
    assert.ok(stages.every(s=>s.art),'approved splash image loaded during every visible stage');
    assert.ok(stages.at(-1).at-stages[0].at>=1700,'startup stages are actually visible over time');
    assert.equal(await np.locator('#app').evaluate(el=>el.hasAttribute('inert')),false);
    await np.locator('#networkNotice[data-state="offline"]').waitFor();
    await np.waitForFunction(()=>document.querySelector('#mic')&&!document.querySelector('#mic').disabled);
    assert.equal(await np.evaluate(()=>window.LoloNativeBundled),true);
    await verifyHub(np);
    await verifyPractice(np);
    assert.deepEqual(nativeErrors,[]);
    await native.close();
    // Failed startup shows retry; never unlock an unvalidated curriculum.
    const failed=await browser.newContext({serviceWorkers:'block'});
    await failed.route('**/curriculum.json',route=>route.fulfill({status:503,body:'unavailable'}));
    const fp=await failed.newPage();await fp.goto(local,{waitUntil:'domcontentloaded'});
    await fp.locator('#loloBoot[data-phase="error"]').waitFor();
    assert.equal(await fp.locator('#bootRetry').isVisible(),true);
    assert.equal(await fp.locator('#app').evaluate(el=>el.hasAttribute('inert')),true);
    await failed.unroute('**/curriculum.json');await fp.locator('#bootRetry').click();
    await fp.locator('#loloBoot').waitFor({state:'hidden'});
    await failed.close();
    console.log('Browser: offline reload, saved plan, local review, writing canvas, PIN gate and bundled-shell offline simulation passed.');
  }finally{
    if(browser)await browser.close();
    for(const s of servers)s.kill();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
