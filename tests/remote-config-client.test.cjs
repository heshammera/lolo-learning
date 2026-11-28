const {test}=require('node:test'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto'),{verify}=require('../remote-config-client.js');
test('nonce, expiry, revision, online-only maintenance and update',async()=>{
 const {subtle}=webcrypto,k=await subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),keys={'test-ci':await subtle.exportKey('jwk',k.publicKey)},nonce='a'.repeat(64),now=1700000000;
 const policy={onlineMaintenance:false,minimumAndroidVersionCode:2,recommendedAndroidVersionCode:3,message:'test',voice:true,pronunciation:true,cloudSync:true,homework:false};
 async function sign(changes={}){const p={format:1,audience:'lolo-remote-config-test',testOnly:true,nonce,revision:3,policy,issuedAt:now,expiresAt:now+300,...changes};const raw=Buffer.from(JSON.stringify(p));return {keyId:'test-ci',payload:raw.toString('base64url'),signature:Buffer.from(await subtle.sign({name:'ECDSA',hash:'SHA-256'},k.privateKey,raw)).toString('base64url')};}
 const env=await sign(),ctx={nonce,androidVersionCode:2,now,subtle};
 assert.equal((await verify(env,keys,ctx)).online.voice,true);
 assert.equal((await verify(env,keys,ctx)).upgrade,'recommended');
 const old=await verify(env,keys,{...ctx,androidVersionCode:1});assert.equal(old.online.voice,false);assert.equal(old.localLearning,true);
 const paused=await verify(await sign({policy:{...policy,onlineMaintenance:true}}),keys,ctx);assert.equal(paused.online.voice,false);assert.equal(paused.localLearning,true);
 for(const [change,code] of [[{nonce:'b'.repeat(64)},'WRONG_NONCE'],[{now:now+300},'EXPIRED'],[{minRevision:4},'STALE_REVISION']]){const r=await verify(env,keys,{...ctx,...change});assert.equal(r.code,code);assert.equal(r.localLearning,true);assert.equal(r.online.voice,false);}
 assert.equal((await verify({...env,signature:'a'.repeat(86)},keys,ctx)).valid,false);
 assert.equal((await verify(env,{},ctx)).code,'UNKNOWN_KEY');
 assert.equal((await verify(await sign({policy:{...policy,disableLocalLearning:true}}),keys,ctx)).code,'INVALID_POLICY');
});
