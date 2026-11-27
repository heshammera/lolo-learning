/* Atomic, device-wide signed package staging. Never touches learner progress. */
(() => {
  const pkg=typeof module!=='undefined'&&module.exports?require('./content-package.js'):window.LoloContentPackage;
  const DB='lolo-content-packages-v1', STORE='packages';
  const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  const validId=id=>typeof id==='string'&&uuid.test(id);
  function open(indexedDB){
    return new Promise((resolve,reject)=>{
      if(!indexedDB)return reject(Error('storage unavailable'));
      const request=indexedDB.open(DB,1);
      request.onupgradeneeded=()=>request.result.createObjectStore(STORE,{keyPath:'draftId'});
      request.onerror=()=>reject(Error('storage unavailable'));
      request.onblocked=()=>reject(Error('storage blocked'));
      request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();resolve(db);};
    });
  }
  function transaction(db,mode,operation){
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,mode);
      let result;
      tx.oncomplete=()=>resolve(result);
      tx.onabort=()=>reject(Error('storage aborted'));
      tx.onerror=()=>reject(Error('storage failed'));
      try{operation(tx.objectStore(STORE),v=>{result=v;},()=>tx.abort());}
      catch{tx.abort();}
    });
  }
  function validRecord(record,id){
    return record&&record.draftId===id&&Number.isSafeInteger(record.sequence)&&record.sequence>=1&&record.envelope&&typeof record.envelope.payload==='string';
  }
  function create({indexedDB=globalThis.indexedDB,trustedKeys={},subtle=globalThis.crypto?.subtle}={}){
    // Trust comes from caller/build configuration; never from downloaded package or local DB.
    const trust=JSON.parse(JSON.stringify(trustedKeys));
    async function read(draftId){
      if(!validId(draftId))return {valid:false,code:'INVALID_ID'};
      let db;
      try{
        db=await open(indexedDB);
        const row=await transaction(db,'readonly',(store,done)=>{const req=store.get(draftId);req.onsuccess=()=>done(req.result);});
        if(!row)return {valid:false,code:'NOT_INSTALLED'};
        if(!validRecord(row,draftId))return {valid:false,code:'CORRUPT_STORAGE'};
        const verified=await pkg.verify(row.envelope,trust,{subtle,expectedDraftId:draftId,minSequence:row.sequence});
        if(!verified.valid||verified.package.sequence!==row.sequence)return {valid:false,code:'CORRUPT_OR_UNTRUSTED'};
        return verified;
      }catch{return {valid:false,code:'STORAGE_UNAVAILABLE'};}
      finally{db?.close();}
    }
    async function install(envelope,expectedDraftId){
      if(!validId(expectedDraftId))return {valid:false,code:'INVALID_ID'};
      // Freeze the supplied data before asynchronous verification.
      let candidate;
      try{candidate=JSON.parse(JSON.stringify(envelope));}catch{return {valid:false,code:'INVALID_PACKAGE'};}
      const checked=await pkg.verify(candidate,trust,{subtle,expectedDraftId});
      if(!checked.valid)return checked;
      const p=checked.package;
      let db;
      try{
        db=await open(indexedDB);
        // Serialize concurrent installs in a single read/write transaction across tabs.
        return await transaction(db,'readwrite',(store,done)=>{
          const req=store.get(expectedDraftId);
          req.onsuccess=()=>{
            const prior=req.result;
            if(prior!==undefined&&!validRecord(prior,expectedDraftId)){done({valid:false,code:'CORRUPT_STORAGE'});return;}
            if(prior&&p.sequence<prior.sequence){done({valid:false,code:'STALE_PACKAGE'});return;}
            if(prior&&p.sequence===prior.sequence){
              done(prior.envelope.payload===candidate.payload&&prior.envelope.keyId===candidate.keyId?{valid:true,code:'ALREADY_INSTALLED',package:p}:{valid:false,code:'SEQUENCE_CONFLICT'});return;
            }
            store.put({draftId:expectedDraftId,sequence:p.sequence,envelope:candidate});
            done({valid:true,code:'INSTALLED',package:p});
          };
        });
      }catch{return {valid:false,code:'STORAGE_UNAVAILABLE'};}
      finally{db?.close();}
    }
    return Object.freeze({read,install});
  }
  const api=Object.freeze({create});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(typeof window!=='undefined')window.LoloContentInstall=api;
})();
