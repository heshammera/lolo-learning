/* Offline synthetic license verification only; not wired to paid feature gates. */
(()=>{
 const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.prototype.hasOwnProperty.call(v,k));
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
 const isId=v=>typeof v==='string'&&uuid.test(v);
 const int=v=>Number.isSafeInteger(v)&&v>0;
 const features=['advanced-review','advanced-tests','full-curricula','local-progress'];
 const fields=['format','audience','testOnly','licenseId','parentId','deviceId','planId','childIds','features','issuedAt','expiresAt','subscriptionEndsAt','sequence'];
 const digestPattern=/^[a-f0-9]{64}$/;
 const fail=code=>({valid:false,code});
 function decode(s,max){if(typeof s!=='string'||!s.length||s.length>Math.ceil(max*4/3)||!/^[A-Za-z0-9_-]+$/.test(s))throw Error('encoding');const raw=atob(s.replace(/-/g,'+').replace(/_/g,'/'));if(raw.length>max||btoa(raw).replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_')!==s)throw Error('encoding');return Uint8Array.from(raw,c=>c.charCodeAt(0));}
 async function verify(envelope,keys,context,{subtle=globalThis.crypto?.subtle,now=Math.floor(Date.now()/1000)}={}){
   if(!subtle||!(exact(context,['parentId','deviceId','childId','minSequence','lastSeenAt'])||exact(context,['parentId','deviceId','childId','minSequence','lastSeenAt','deviceKeySha256'])&&typeof context.deviceKeySha256==='string'&&digestPattern.test(context.deviceKeySha256))||![context.parentId,context.deviceId,context.childId].every(isId)||!Number.isSafeInteger(context.minSequence)||context.minSequence<0||!Number.isSafeInteger(context.lastSeenAt)||context.lastSeenAt<0||!int(now))return fail('CONTEXT_REQUIRED');
   if(!exact(envelope,['keyId','payload','signature'])||typeof envelope.keyId!=='string'||!/^test-[A-Za-z0-9_-]{1,55}$/.test(envelope.keyId)||!keys||!Object.prototype.hasOwnProperty.call(keys,envelope.keyId))return fail('UNKNOWN_KEY');
   let raw;
   try{raw=decode(envelope.payload,4096);const sig=decode(envelope.signature,64),jwk=keys[envelope.keyId];if(sig.length!==64||jwk?.kty!=='EC'||jwk.crv!=='P-256'||Object.prototype.hasOwnProperty.call(jwk,'d'))return fail('INVALID_SIGNATURE');
    const key=await subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
    if(!await subtle.verify({name:'ECDSA',hash:'SHA-256'},key,sig,raw))return fail('INVALID_SIGNATURE');
   }catch{return fail('INVALID_SIGNATURE');}
   let p;try{p=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{return fail('INVALID_PAYLOAD');}
   if(!(p?.format===1&&exact(p,fields)&&context.deviceKeySha256===undefined||p?.format===2&&exact(p,[...fields,'deviceKeySha256'])&&typeof p.deviceKeySha256==='string'&&digestPattern.test(p.deviceKeySha256)&&p.deviceKeySha256===context.deviceKeySha256)||p.audience!=='lolo-offline-test'||p.testOnly!==true||![p.licenseId,p.parentId,p.deviceId].every(isId)||!['plus','family'].includes(p.planId)||!Array.isArray(p.childIds)||p.childIds.length<1||p.childIds.length>12||!p.childIds.every(isId)||new Set(p.childIds).size!==p.childIds.length||JSON.stringify(p.features)!==JSON.stringify(features)||![p.issuedAt,p.expiresAt,p.subscriptionEndsAt,p.sequence].every(int)||p.expiresAt<=p.issuedAt||p.expiresAt-p.issuedAt>30*86400||p.expiresAt>p.subscriptionEndsAt)return fail('INVALID_PAYLOAD');
   if(p.parentId!==context.parentId||p.deviceId!==context.deviceId||!p.childIds.includes(context.childId))return fail('WRONG_SCOPE');
   if(p.sequence<context.minSequence)return fail('STALE_LICENSE');
   // A backward clock beyond tolerance forces reconnect. This is only a detection heuristic.
   if(now+60<context.lastSeenAt||now+60<p.issuedAt)return fail('CLOCK_ROLLBACK');
   if(Math.max(now,context.lastSeenAt,p.issuedAt)>=p.expiresAt)return fail('EXPIRED');
   return {valid:true,testOnly:true,planId:p.planId,features:[...p.features],expiresAt:p.expiresAt,checkpoint:{minSequence:p.sequence,lastSeenAt:Math.max(now,context.lastSeenAt,p.issuedAt)}};
 }
 const api=Object.freeze({verify});
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(typeof window!=='undefined')window.LoloOfflineLicense=api;
})();