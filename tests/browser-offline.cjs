const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const root='http://127.0.0.1:4173';
const local='http://127.0.0.1:4174';
const servers=[
  spawn('python3',['server.py'],{stdio:'ignore',env:{...process.env,HOST:'127.0.0.1',PORT:'4173'}}),
  spawn('python3',['-m','http.server','4174','--bind','127.0.0.1','--directory','android-apk/www-bundled'],{stdio:'ignore'}),
];
async function waitServer(url){
  for(let i=0;i<60;i++){try{if((await fetch(url)).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}
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
async function verifyPractice(page){
  await page.locator('#homePractice').click();
  await page.locator('#offlinePractice[open]').waitFor();
  assert.ok(await page.locator('#practiceCards button').count()>0);
  await page.locator('#practiceCards button').first().click();
  assert.ok((await page.locator('#practiceFeedback').textContent()).trim().length>0);
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
    await page.waitForFunction(()=>!!navigator.serviceWorker.controller,{},{timeout:30000});
    await page.waitForFunction(()=>document.querySelector('#mic')&&!document.querySelector('#mic').disabled);
    const saved=await page.evaluate(()=>localStorage.getItem('lolo-learning-path-v1'));
    assert.ok(saved);
    await context.setOffline(true);
    await page.locator('#networkNotice[data-state="offline"]').waitFor();
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('#networkNotice[data-state="offline"]').waitFor();
    await page.waitForFunction(()=>document.querySelector('#mic')&&!document.querySelector('#mic').disabled);
    assert.equal(await page.evaluate(()=>localStorage.getItem('lolo-learning-path-v1')),saved);
    await page.locator('#homeStart').click();
    await verifyPractice(page);
    await page.locator('#homeChoose').click();
    await page.locator('#parentGate:not([hidden])').waitFor();
    assert.equal(paid,0);
    assert.deepEqual(errors,[]);
    await context.close();
    // Simulate native offline connectivity while serving the bundled files locally.
    // This checks bundle boot and API gating, not the Android WebView itself.
    const native=await browser.newContext();
    await seed(native);
    await native.addInitScript(()=>{Object.defineProperty(navigator,'onLine',{get:()=>false});});
    const np=await native.newPage();const nativeErrors=[];
    np.on('pageerror',error=>nativeErrors.push(error.message));
    await np.goto(local,{waitUntil:'domcontentloaded'});
    await np.locator('#networkNotice[data-state="offline"]').waitFor();
    await np.waitForFunction(()=>document.querySelector('#mic')&&!document.querySelector('#mic').disabled);
    assert.equal(await np.evaluate(()=>window.LoloNativeBundled),true);
    await verifyPractice(np);
    assert.deepEqual(nativeErrors,[]);
    await native.close();
    console.log('Browser: offline reload, saved plan, local review, writing canvas, PIN gate and bundled-shell offline simulation passed.');
  }finally{
    if(browser)await browser.close();
    for(const s of servers)s.kill();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
