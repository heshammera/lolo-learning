importScripts('/offline-assets.js');
const {version, paths} = self.LoloOfflineAssets;
const PREFIX = 'lolo-public-shell-';
const CACHE = PREFIX + version;
const STATIC = new Set(paths);
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Install a complete snapshot; never activate a partial download.
    try { await cache.addAll(paths.map(path => new Request(path,{cache:'reload'}))); }
    catch (error) { await caches.delete(CACHE); throw error; }
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request=event.request, url=new URL(request.url);
  // No AI/API requests, POSTs, personal data or external resources enter this cache.
  if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname==='/api'||url.pathname.startsWith('/api/'))return;
  const shell=request.mode==='navigate'&&(url.pathname==='/'||url.pathname==='/index.html');
  if(shell||STATIC.has(url.pathname)){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE);
      return await cache.match(shell?'/index.html':url.pathname)||await fetch(request);
    })());
  } else if(request.mode==='navigate'){
    event.respondWith(fetch(request).catch(async()=> {
      const cache=await caches.open(CACHE);
      return await cache.match('/offline.html')||new Response('LOLO — offline',{status:503});
    }));
  }
});
