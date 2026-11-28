/* Synthetic preview only. Never a live permission grant. */
(()=>{
 const fields=['onlineMaintenance','minimumAndroidVersionCode','recommendedAndroidVersionCode','message','voice','pronunciation','cloudSync','homework'];
 const features=['voice','pronunciation','cloudSync','homework'];
 const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.prototype.hasOwnProperty.call(v,k));
 const positive=v=>Number.isSafeInteger(v)&&v>0;
 const version=v=>positive(v)&&v<=2100000000;
 const invalid=code=>({valid:false,testOnly:true,code,localLearning:true,online:{voice:false,pronunciation:false,cloudSync:false,homework:false}});
 function decode(s,max){
  if(typeof s!=='string'||!s.length||s.length>Math.ceil(max*4/3)||!/^[A-Za-z0-9_-]+$/.test(s))throw Error('encoding');
  const raw=atob(s.replace(/-/g,'+').replace(/_/g,'/'));
  if(raw.length>max||btoa(raw).replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_')!==s)throw Error('encoding');
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
 }
 function policyValid(p){
  return exact(p,fields)&&['onlineMaintenance',...features].every(k=>typeof p[k]==='boolean')&&version(p.minimumAndroidVersionCode)&&version(p.recommendedAndroidVersionCode)&&p.minimumAndroidVersionCode<=p.recommendedAndroidVersionCode&&typeof p.message==='string'&&Array.from(p.message).length<=300&&!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(p.message);
 }
 async function verify(envelope,keys,{nonce,androidVersionCode,minRevision=0,now=Math.floor(Date.now()/1000),subtle=globalThis.crypto?.subtle}={}){
  if(!subtle||typeof nonce!=='string'||! /^[a-f0-9]{64}$/.test(nonce)||!version(androidVersionCode)||!Number.isSafeInteger(minRevision)||minRevision<0||!positive(now))return invalid('CONTEXT_REQUIRED');
  if(!exact(envelope,['keyId','payload','signature'])||typeof envelope.keyId!=='string'||!/^test-[A-Za-z0-9_-]{1,55}$/.test(envelope.keyId)||!keys||!Object.prototype.hasOwnProperty.call(keys,envelope.keyId))return invalid('UNKNOWN_KEY');
  try{
   const raw=decode(envelope.payload,8192),sig=decode(envelope.signature,64),jwk=keys[envelope.keyId];
   if(sig.length!==64||jwk?.kty!=='EC'||jwk.crv!=='P-256'||Object.prototype.hasOwnProperty.call(jwk,'d'))return invalid('INVALID_SIGNATURE');
   const key=await subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
   if(!await subtle.verify({name:'ECDSA',hash:'SHA-256'},key,sig,raw))return invalid('INVALID_SIGNATURE');
   const p=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
   if(!exact(p,['format','audience','testOnly','nonce','revision','policy','issuedAt','expiresAt'])||p.format!==1||p.audience!=='lolo-remote-config-test'||p.testOnly!==true||!policyValid(p.policy)||!positive(p.revision)||!positive(p.issuedAt)||!positive(p.expiresAt)||p.expiresAt-p.issuedAt!==300)return invalid('INVALID_POLICY');
   if(p.nonce!==nonce)return invalid('WRONG_NONCE');
   if(p.revision<minRevision)return invalid('STALE_REVISION');
   if(now+60<p.issuedAt||now>=p.expiresAt)return invalid('EXPIRED');
   const upgrade=androidVersionCode<p.policy.minimumAndroidVersionCode?'required-online':androidVersionCode<p.policy.recommendedAndroidVersionCode?'recommended':'none';
   const online=Object.fromEntries(features.map(k=>[k,p.policy[k]&&!p.policy.onlineMaintenance&&upgrade!=='required-online']));
   return {valid:true,testOnly:true,localLearning:true,online,upgrade,maintenance:p.policy.onlineMaintenance,message:p.policy.message,revision:p.revision,expiresAt:p.expiresAt};
  }catch{return invalid('INVALID_POLICY');}
 }
 const api=Object.freeze({verify,invalid});
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(typeof window!=='undefined')window.LoloRemoteConfig=api;
})();