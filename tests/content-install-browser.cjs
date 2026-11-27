const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();
    await page.route('http://127.0.0.1:4191/**',route=>{
      const name=new URL(route.request().url()).pathname;
      if(name==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><script src="/activity-engine.js"></script><script src="/content-schema.js"></script><script src="/content-package.js"></script><script src="/content-install.js"></script>'});
      if(!['/activity-engine.js','/content-schema.js','/content-package.js','/content-install.js'].includes(name))return route.fulfill({status:404,body:''});
      return route.fulfill({contentType:'application/javascript',path:path.join(__dirname,'..',name.slice(1))});
    });
    await page.goto('http://127.0.0.1:4191/');
    const results=await page.evaluate(async()=>{
      const key=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
      const trust={fixture:await crypto.subtle.exportKey('jwk',key.publicKey)};
      const draftId='11111111-1111-4111-8111-111111111111',releaseId='22222222-2222-4222-8222-222222222222';
      const content={schemaVersion:1,subjectId:'science',gradeId:'grade-1',title:'First',units:[{id:'u1',title:'Plants',lessons:[{id:'l1',title:'Water',goal:'Recognize water',activities:[{id:'a1',type:'true-false',version:1,prompt:'Plants need water',config:{answer:true}}]}]}]};
      const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
      async function signed(sequence,version,title){
        const bytes=new TextEncoder().encode(JSON.stringify({format:1,draftId,releaseId,sequence,version,content:{...content,title}}));
        return {keyId:'fixture',payload:b64(bytes),signature:b64(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key.privateKey,bytes))};
      }
      const first=await signed(1,1,'First'),second=await signed(2,2,'Second'),rollback=await signed(3,1,'First'),conflict=await signed(3,2,'Conflict');
      const db=LoloContentInstall.create({trustedKeys:trust});
      localStorage.setItem('lolo-mastered','["existing"]');
      const initial=await db.install(first,draftId);
      const duplicate=await db.install(first,draftId);
      const untrusted=await LoloContentInstall.create().install(second,draftId);
      const updated=await db.install(second,draftId);
      const stale=await db.install(first,draftId);
      const rolled=await db.install(rollback,draftId);
      const collision=await db.install(conflict,draftId);
      const reopened=await LoloContentInstall.create({trustedKeys:trust}).read(draftId);
      return {codes:[initial.code,duplicate.code,untrusted.code,updated.code,stale.code,rolled.code,collision.code],read:reopened.package,progress:localStorage.getItem('lolo-mastered')};
    });
    assert.deepEqual(results.codes,['INSTALLED','ALREADY_INSTALLED','UNKNOWN_KEY','INSTALLED','STALE_PACKAGE','INSTALLED','SEQUENCE_CONFLICT']);
    assert.equal(results.read.sequence,3);assert.equal(results.read.content.title,'First');assert.equal(results.progress,'["existing"]');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
