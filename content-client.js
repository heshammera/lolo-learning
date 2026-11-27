/* Catalog discovery is not trusted until the downloaded envelope is verified. */
(() => {
  const pkg=typeof module!=='undefined'&&module.exports?require('./content-package.js'):window.LoloContentPackage;
  const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
  const version=v=>Number.isSafeInteger(v)&&v>0;
  const validMeta=m=>exact(m,['draftId','releaseId','version','sequence','title','keyId'])&&typeof m.draftId==='string'&&uuid.test(m.draftId)&&typeof m.releaseId==='string'&&uuid.test(m.releaseId)&&version(m.version)&&version(m.sequence)&&typeof m.title==='string'&&m.title.trim().length>0&&m.title.length<=200&&typeof m.keyId==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(m.keyId);
  function create({request,trustedKeys={},subtle=globalThis.crypto?.subtle}){
    const keys=JSON.parse(JSON.stringify(trustedKeys));
    async function call(body,signal){
      const r=await request('/api/content',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
      if(!r.ok)throw Object.assign(Error('delivery failed'),{status:r.status});
      return r.json();
    }
    async function list(signal){
      try{
        const r=await call({action:'list'},signal);
        if(!exact(r,['packages'])||!Array.isArray(r.packages)||r.packages.length>12||!r.packages.every(validMeta)||new Set(r.packages.map(m=>m.draftId)).size!==r.packages.length)return {valid:false,code:'INVALID_CATALOG'};
        return {valid:true,items:r.packages.filter(m=>Object.hasOwn(keys,m.keyId))};
      }catch{return {valid:false,code:'UNAVAILABLE'};}
    }
    async function download(meta,signal){
      if(!validMeta(meta)||!Object.hasOwn(keys,meta.keyId))return {valid:false,code:'INVALID_SELECTION'};
      const selected={...meta};
      try{
        const r=await call({action:'download',draftId:selected.draftId,sequence:selected.sequence},signal);
        if(!exact(r,['envelope']))return {valid:false,code:'INVALID_RESPONSE'};
        const checked=await pkg.verify(r.envelope,keys,{subtle,expectedDraftId:selected.draftId,minSequence:selected.sequence});
        if(!checked.valid)return checked;
        const p=checked.package;
        if(p.sequence!==selected.sequence||p.releaseId!==selected.releaseId||p.version!==selected.version||p.content.title!==selected.title||r.envelope.keyId!==selected.keyId)return {valid:false,code:'CATALOG_CHANGED'};
        if(signal?.aborted)return {valid:false,code:'CANCELLED'};
        return {valid:true,envelope:r.envelope,package:p};
      }catch(e){return {valid:false,code:e.status===409?'CATALOG_CHANGED':'UNAVAILABLE'};}
    }
    return Object.freeze({list,download});
  }
  const api=Object.freeze({create});
  if(typeof window!=='undefined')window.LoloContentClient=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
