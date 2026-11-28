/* Test-only coordinator. Native vault is an encrypted transport, not a trust authority. */
(()=>{
 const verifier=typeof module!=='undefined'&&module.exports?require('./offline-license.js'):window.LoloOfflineLicense;
 const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.prototype.hasOwnProperty.call(v,k));
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
 const digest=/^[a-f0-9]{64}$/;
 const nonnegative=v=>Number.isSafeInteger(v)&&v>=0;
 const fail=code=>({valid:false,code,testOnly:true});
 const sameEnvelope=(a,b)=>a?.keyId===b?.keyId&&a?.payload===b?.payload&&a?.signature===b?.signature;
 function create({vault,device,keys=Object.freeze({}),subtle=globalThis.crypto?.subtle}={}){
  let busy=false;
  async function run(scope,envelope,install,deny=false){
   if(busy)return fail('BUSY');
   busy=true;
   try{
    if(!vault||!device||!subtle||!exact(scope,['parentId','deviceId','childId'])||!Object.values(scope).every(v=>typeof v==='string'&&uuid.test(v)))return fail('CONTEXT_REQUIRED');
    const identity=await device.publicKey();
    if(identity?.testOnly!==true||typeof identity.deviceKeySha256!=='string'||!digest.test(identity.deviceKeySha256))return fail('DEVICE_UNAVAILABLE');
    const read=await vault.readState();
    if(read?.testOnly!==true||!nonnegative(read.revision)||!Number.isSafeInteger(read.now)||read.now<=0)return fail('VAULT_UNAVAILABLE');
    const old=read.state;
    if(old===null&&read.revision!==0||old!==null&&read.revision===0)return fail('VAULT_CORRUPT');
    if(old!==null){
     if(!(exact(old,['parentId','deviceId','deviceKeySha256','envelope','minSequence','lastSeenAt'])||exact(old,['parentId','deviceId','deviceKeySha256','envelope','minSequence','lastSeenAt','blockedThrough'])&&nonnegative(old.blockedThrough))||!nonnegative(old.minSequence)||old.minSequence<1||!nonnegative(old.lastSeenAt)||old.lastSeenAt<1||!exact(old.envelope,['keyId','payload','signature']))return fail('VAULT_CORRUPT');
     if(old.parentId!==scope.parentId||old.deviceId!==scope.deviceId||old.deviceKeySha256!==identity.deviceKeySha256)return fail('WRONG_VAULT_SCOPE');
    }
    if(deny){
     const checked=await verifier.verifyStatus(envelope,keys,{...scope,deviceKeySha256:identity.deviceKeySha256},{subtle});
     if(!checked.valid||checked.status!=='denied')return fail('INVALID_DENIAL');
     if(!old)return fail('NO_LICENSE');
     if(checked.sequence<old.minSequence)return fail('STALE_STATUS');
     const next={...old,blockedThrough:Math.max(old.blockedThrough||0,checked.sequence),lastSeenAt:Math.max(old.lastSeenAt,checked.issuedAt)};
     const saved=await vault.compareAndSet({expectedRevision:read.revision,state:next});
     return saved?.testOnly===true&&saved.revision===read.revision+1?fail('REVOKED'):fail('VAULT_UNAVAILABLE');
    }
    if(!install&&old?.blockedThrough>=old?.minSequence)return fail('REVOKED');
    const candidate=install?envelope:old?.envelope;
    if(!candidate)return fail('NO_LICENSE');
    const ctx={...scope,deviceKeySha256:identity.deviceKeySha256,minSequence:old?.minSequence||0,lastSeenAt:old?.lastSeenAt||0};
    const checked=await verifier.verify(candidate,keys,ctx,{subtle,now:read.now});
    async function save(next){
     const result=await vault.compareAndSet({expectedRevision:read.revision,state:next});
     return result?.testOnly===true&&result.revision===read.revision+1;
    }
    if(!checked.valid){
     // Persist an observed expiry for the already stored signed lease, so setting the
     // clock back after expiry does not revive it while this checkpoint survives.
     if(checked.code==='EXPIRED'&&old&&sameEnvelope(candidate,old.envelope)&&read.now>old.lastSeenAt){
      if(!await save({...old,lastSeenAt:read.now}))return fail('VAULT_UNAVAILABLE');
     }
     return {...checked,testOnly:true};
    }
    if(old?.blockedThrough>=checked.checkpoint.minSequence)return fail('REVOKED');
    if(old&&checked.checkpoint.minSequence===old.minSequence&&!sameEnvelope(candidate,old.envelope))return fail('SEQUENCE_CONFLICT');
    const next={parentId:scope.parentId,deviceId:scope.deviceId,deviceKeySha256:identity.deviceKeySha256,
      envelope:candidate,minSequence:checked.checkpoint.minSequence,lastSeenAt:checked.checkpoint.lastSeenAt};
    if(!old||!sameEnvelope(old.envelope,candidate)||next.lastSeenAt!==old.lastSeenAt){
     if(!await save(next))return fail('VAULT_UNAVAILABLE');
    }
    // Result is test-only. Do not use it as real feature authorization.
    return {...checked,testOnly:true};
   }catch{return fail('VAULT_UNAVAILABLE');}finally{busy=false;}
  }
  return Object.freeze({install:(scope,envelope)=>run(scope,envelope,true),check:scope=>run(scope,null,false),deny:(scope,status)=>run(scope,status,false,true)});
 }
 const api=Object.freeze({create});
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(typeof window!=='undefined')window.LoloOfflineLicenseVault=api;
})();