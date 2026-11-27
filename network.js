(() => {
  const API_ROOT='https://lolo-learning.vercel.app';
  const ROUTES=new Set(['/api/status','/api/provider-token','/api/challenge-audio','/api/onboarding-audio','/api/family']);
  function create({isOnline=()=>navigator.onLine!==false,fetchImpl=(...a)=>fetch(...a),nativeRequest=null,onState=()=>{},timeoutMs=20000}={}){
    let state=isOnline()?'online':'offline';
    function set(next){if(state!==next){state=next;onState(next);}return state;}
    const abortError=()=>Object.assign(new Error('تم إلغاء الطلب.'),{name:'AbortError'});
    async function request(path,options={}){
      if(!ROUTES.has(path))throw new Error('Unsupported API route');
      const method=(options.method||'GET').toUpperCase();
      if((path==='/api/status'&&method!=='GET')||(path!=='/api/status'&&method!=='POST'))throw new Error('Unsupported API method');
      if(options.signal?.aborted)throw abortError();
      if(!isOnline()){set('offline');throw new Error('مفيش اتصال بالإنترنت دلوقتي.');}
      const controller=new AbortController();
      let timeout, abortListener, timedOut=false;
      const cancel=new Promise((_,reject)=>{
        abortListener=()=>{controller.abort();reject(abortError());};
        options.signal?.addEventListener('abort',abortListener,{once:true});
        timeout=setTimeout(()=>{timedOut=true;controller.abort();reject(new Error('الاتصال بالخدمة تأخر.'));},timeoutMs);
      });
      try{
        const operation=nativeRequest
          ? Promise.resolve().then(()=>nativeRequest({url:API_ROOT+path,method,headers:options.headers||{},data:options.body===undefined?undefined:JSON.parse(options.body),connectTimeout:timeoutMs,readTimeout:timeoutMs,disableRedirects:true,responseType:'json'}))
            .then(r=>({ok:r.status>=200&&r.status<300,status:r.status,json:async()=>typeof r.data==='string'?JSON.parse(r.data):r.data}))
          : Promise.resolve().then(()=>fetchImpl(path,{...options,method,cache:'no-store',redirect:'error',signal:controller.signal}));
        const response=await Promise.race([operation,cancel]);
        if(options.signal?.aborted)throw abortError();
        set('online');
        return response;
      }catch(error){
        if(!options.signal?.aborted&&(timedOut||error.name!=='AbortError'))set(isOnline()?'unreachable':'offline');
        throw error;
      }finally{
        clearTimeout(timeout);
        options.signal?.removeEventListener('abort',abortListener);
      }
    }
    async function probe(){
      if(!isOnline()){set('offline');return false;}
      set('checking');
      try{const r=await request('/api/status');if(!r.ok){set('unreachable');return false;}return true;}
      catch{return false;}
    }
    return Object.freeze({request,probe,getState:()=>state,markOffline:()=>set('offline')});
  }
  const api=Object.freeze({create,API_ROOT});
  if(typeof window!=='undefined')window.LoloNetwork=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
