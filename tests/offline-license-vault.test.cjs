const assert=require('node:assert/strict');
const {test}=require('node:test'),{webcrypto,randomUUID}=require('node:crypto');
const {create}=require('../offline-license-vault.js');
test('verified format 2 lease, high water, scope, expiry and failed writes',async()=>{
 const {subtle}=webcrypto,key=await subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const pub=await subtle.exportKey('jwk',key.publicKey),keys={'test-ci':pub},scope={parentId:randomUUID(),deviceId:randomUUID(),childId:randomUUID()},hash='a'.repeat(64);
 let now=1700000000,state=null,revision=0,broken=false;
 const vault={readState:async()=>({testOnly:true,state:structuredClone(state),revision,now}),compareAndSet:async({expectedRevision,state:next})=>{if(broken||expectedRevision!==revision)throw Error('write');state=structuredClone(next);return {testOnly:true,revision:++revision};}};
 const device={publicKey:async()=>({testOnly:true,deviceKeySha256:hash})};
 const client=create({vault,device,keys,subtle});
 async function envelope(sequence,changes={}){const p={format:2,audience:'lolo-offline-test',testOnly:true,licenseId:randomUUID(),parentId:scope.parentId,deviceId:scope.deviceId,childIds:[scope.childId],deviceKeySha256:hash,planId:'plus',features:['advanced-review','advanced-tests','full-curricula','local-progress'],issuedAt:1700000000,expiresAt:1700001000,subscriptionEndsAt:1700001000,sequence,...changes};const raw=Buffer.from(JSON.stringify(p));return {keyId:'test-ci',payload:raw.toString('base64url'),signature:Buffer.from(await subtle.sign({name:'ECDSA',hash:'SHA-256'},key.privateKey,raw)).toString('base64url')};}
 assert.equal((await client.check(scope)).code,'NO_LICENSE');
 const first=await envelope(1);assert.equal((await client.install(scope,first)).valid,true);assert.equal(revision,1);
 const second=await envelope(2);assert.equal((await client.install(scope,second)).valid,true);assert.equal(revision,2);
 assert.equal((await client.install(scope,first)).code,'STALE_LICENSE');
 assert.equal((await client.install(scope,await envelope(2))).code,'SEQUENCE_CONFLICT');
 assert.equal((await client.check({...scope,parentId:randomUUID()})).code,'WRONG_VAULT_SCOPE');
 assert.equal((await client.check({...scope,childId:randomUUID()})).code,'WRONG_SCOPE');
 now+=100;assert.equal((await client.check(scope)).valid,true);assert.equal(state.lastSeenAt,now);
 now-=70;assert.equal((await client.check(scope)).code,'CLOCK_ROLLBACK');
 now=1700001001;assert.equal((await client.check(scope)).code,'EXPIRED');assert.equal(state.lastSeenAt,now);
 now=1700000900;assert.equal((await client.check(scope)).code,'CLOCK_ROLLBACK');
 now=1700001002;broken=true;assert.equal((await client.check(scope)).code,'VAULT_UNAVAILABLE');
});
