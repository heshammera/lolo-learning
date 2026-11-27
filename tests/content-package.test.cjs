const {test}=require('node:test');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const pkg=require('../content-package.js');
const content={schemaVersion:1,subjectId:'science',gradeId:'grade-1',title:'Draft',units:[{id:'unit1',title:'Plants',lessons:[{id:'lesson1',title:'Water',goal:'Recognize water',activities:[{id:'a1',type:'true-false',version:1,prompt:'Plants need water',config:{answer:true}}]}]}]};
const draftId='11111111-1111-4111-8111-111111111111',releaseId='22222222-2222-4222-8222-222222222222';
test('trusted signature, target capability, stale sequence and wrong curriculum',async()=>{
  const subtle=webcrypto.subtle;
  const keys=await subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const trusted={fixture:await subtle.exportKey('jwk',keys.publicKey)};
  const data={format:1,draftId,releaseId,version:1,sequence:3,content};
  async function sign(value){const payload=Buffer.from(JSON.stringify(value));const signature=await subtle.sign({name:'ECDSA',hash:'SHA-256'},keys.privateKey,payload);return {keyId:'fixture',payload:payload.toString('base64url'),signature:Buffer.from(signature).toString('base64url')};}
  const good=await sign(data);
  assert.equal((await pkg.verify(good,trusted,{subtle,minSequence:3,expectedDraftId:draftId})).valid,true);
  assert.equal((await pkg.verify(good,{}, {subtle})).code,'UNKNOWN_KEY');
  assert.equal((await pkg.verify(good,trusted,{subtle,minSequence:4})).code,'STALE_PACKAGE');
  assert.equal((await pkg.verify(good,trusted,{subtle,expectedDraftId:releaseId})).code,'WRONG_CURRICULUM');
  assert.equal((await pkg.verify(good,trusted,{subtle,target:{}})).code,'INCOMPATIBLE_CONTENT');
  assert.equal((await pkg.verify({...good,payload:Buffer.from(JSON.stringify({...data,version:2})).toString('base64url')},trusted,{subtle})).code,'INVALID_SIGNATURE');
  const wrong=JSON.parse(JSON.stringify(data));wrong.content.units[0].lessons[0].activities[0].version=99;
  assert.equal((await pkg.verify(await sign(wrong),trusted,{subtle})).code,'INCOMPATIBLE_CONTENT');
  assert.equal((await pkg.verify({...good,keyId:'__proto__'},trusted,{subtle})).code,'UNKNOWN_KEY');
});
