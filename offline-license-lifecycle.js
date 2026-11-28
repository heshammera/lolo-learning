/* Injected authenticated test transport only; never a live authorization path. */
(()=>{
 const verifier=typeof module!=='undefined'&&module.exports?require('./offline-license.js'):window.LoloOfflineLicense;
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
 const digest=/^[a-f0-9]{64}$/;
 const fail=code=>({valid:false,testOnly:true,code});
 function create({request,device,vault,keys,allowed=()=>false,subtle=globalThis.crypto?.subtle}={}){
  let busy=false,generation=0;
  function clear(){generation++;}
  async function renew(scope,{register=false}={}){
   if(busy)return fail('BUSY');
   if(!allowed()||!scope||![scope.parentId,scope.deviceId,scope.childId].every(v=>typeof v==='string'&&uuid.test(v)))return fail('PARENT_REQUIRED');
   busy=true;const g=generation;const current=()=>g===generation&&allowed();
   try{
    const id=await device.publicKey();
    if(!current()||id?.testOnly!==true||typeof id.publicSpki!=='string'||!digest.test(id.deviceKeySha256))return fail('DEVICE_UNAVAILABLE');
    if(!register){
     const status=await request({action:'licenseStatus',deviceId:scope.deviceId,deviceKeySha256:id.deviceKeySha256});
     if(!current())return fail('SESSION_CHANGED');
     const checked=await verifier.verifyStatus(status,keys,{...scope,deviceKeySha256:id.deviceKeySha256},{subtle});
     if(!current()||!checked.valid)return fail('INVALID_STATUS');
     if(checked.status==='denied')return await vault.deny(scope,status);
    }
    const c=await request({action:'licenseBegin',deviceId:scope.deviceId,publicSpki:id.publicSpki});
    if(!current()||c?.testOnly!==true||!uuid.test(c.challengeId)||typeof c.message!=='string')return fail('INVALID_CHALLENGE');
    const parts=c.message.split('\n');
    if(parts.length!==6||parts[0]!=='LOLO-OFFLINE-TEST-V1'||parts[1]!==scope.parentId||parts[2]!==scope.deviceId||parts[3]!==c.challengeId||!/^[A-Za-z0-9_-]{43}$/.test(parts[4])||parts[5]!==id.deviceKeySha256)return fail('INVALID_CHALLENGE');
    const proof=await device.signChallenge({message:c.message});
    if(!current()||proof?.testOnly!==true||typeof proof.signature!=='string')return fail('PROOF_UNAVAILABLE');
    const envelope=await request({action:'licenseComplete',challengeId:c.challengeId,signature:proof.signature});
    if(!current())return fail('SESSION_CHANGED');
    return await vault.install(scope,envelope);
   }catch{return fail('RECONNECT_FAILED');}finally{busy=false;}
  }
  return Object.freeze({renew,clear});
 }
 const api=Object.freeze({create});
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(typeof window!=='undefined')window.LoloOfflineLifecycle=api;
})();