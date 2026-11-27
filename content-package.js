/* Signed content package verification. No network, no automatic trust, no dynamic code. */
(() => {
  const engine=typeof module!=='undefined'&&module.exports?require('./activity-engine.js'):window.LoloActivities;
  const schema=typeof module!=='undefined'&&module.exports?require('./content-schema.js'):window.LoloContentSchema;
  const max=262144, uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  const id=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
  const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
  function capabilities(){
    return Object.fromEntries(Object.entries(engine.types).map(([name,type])=>[name,[type.version]]));
  }
  function decode(s,limit){
    if(typeof s!=='string'||s.length===0||s.length>Math.ceil(limit*4/3)||!/^[A-Za-z0-9_-]+$/.test(s))throw Error('encoding');
    const raw=atob(s.replace(/-/g,'+').replace(/_/g,'/'));
    if(raw.length>limit)throw Error('size');
    const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
    // Require canonical base64url; reject alternate encodings of same bytes.
    if(btoa(raw).replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_')!==s)throw Error('encoding');
    return bytes;
  }
  async function verify(envelope,trustedKeys,{subtle=globalThis.crypto?.subtle,target=capabilities(),minSequence=0,expectedDraftId=null}={}){
    const fail=code=>({valid:false,code});
    if(!subtle||!trustedKeys||typeof trustedKeys!=='object')return fail('TRUST_UNAVAILABLE');
    if(!exact(envelope,['keyId','payload','signature'])||typeof envelope.keyId!=='string'||!id.test(envelope.keyId)||!Object.hasOwn(trustedKeys,envelope.keyId))return fail('UNKNOWN_KEY');
    if(!Number.isSafeInteger(minSequence)||minSequence<0)return fail('INVALID_SEQUENCE');
    let payload,signature,publicKey;
    try{
      payload=decode(envelope.payload,max);signature=decode(envelope.signature,64);
      if(signature.length!==64)return fail('INVALID_SIGNATURE');
      const jwk=trustedKeys[envelope.keyId];
      if(!jwk||jwk.kty!=='EC'||jwk.crv!=='P-256'||Object.hasOwn(jwk,'d'))return fail('INVALID_KEY');
      publicKey=await subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
      if(!await subtle.verify({name:'ECDSA',hash:'SHA-256'},publicKey,signature,payload))return fail('INVALID_SIGNATURE');
    }catch{return fail('INVALID_SIGNATURE');}
    try{
      const p=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(payload));
      if(!exact(p,['format','draftId','releaseId','version','sequence','content'])||p.format!==1||typeof p.draftId!=='string'||!uuid.test(p.draftId)||typeof p.releaseId!=='string'||!uuid.test(p.releaseId)||!Number.isSafeInteger(p.version)||p.version<1||!Number.isSafeInteger(p.sequence)||p.sequence<1)return fail('INVALID_PACKAGE');
      if(expectedDraftId!==null&&p.draftId!==expectedDraftId)return fail('WRONG_CURRICULUM');
      if(p.sequence<minSequence)return fail('STALE_PACKAGE');
      const result=schema.validate(p.content,target);
      if(!result.valid)return {valid:false,code:'INCOMPATIBLE_CONTENT',issues:result.issues};
      return {valid:true,package:p};
    }catch{return fail('INVALID_PACKAGE');}
  }
  const api=Object.freeze({capabilities,verify});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(typeof window!=='undefined')window.LoloContentPackage=api;
})();
