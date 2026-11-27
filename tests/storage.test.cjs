const assert = require('node:assert/strict');
const path = require('node:path');
const storagePath = path.resolve(__dirname, '../storage.js');

function loadStorage(map = new Map(), setThrows = false) {
  const warnings = [];
  global.CustomEvent = class CustomEvent { constructor(type, options) { this.type = type; this.detail = options.detail; } };
  global.window = {
    localStorage: {
      getItem: key => map.has(key) ? map.get(key) : null,
      setItem: (key, value) => { if (setThrows) throw new Error('quota'); map.set(key, value); },
      removeItem: key => map.delete(key),
    },
    crypto: require('node:crypto').webcrypto,
    dispatchEvent: event => warnings.push(event.detail),
  };
  delete require.cache[storagePath];
  require(storagePath);
  return {storage: window.LoloStorage, warnings, map};
}

(async () => {
  {
    const {storage, map, warnings} = loadStorage(new Map([['lolo-test-results', '{broken']]));
    assert.deepEqual(storage.getJSON('lolo-test-results', {}), {});
    assert.equal(map.get('lolo-test-results'), '{broken', 'corrupt value stays available for recovery');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(warnings.length, 1);
  }
  {
    const {storage, warnings} = loadStorage(new Map(), true);
    assert.equal(storage.set('lolo-mastered', '[]'), false);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(warnings.length, 1);
  }
  {
    const {storage} = loadStorage(new Map([['lolo-mastered', '{}']]));
    assert.deepEqual(storage.getJSON('lolo-mastered', []), []);
    assert.equal(storage.set('lolo-selected-program', 'connect-plus-1'), true);
    assert.equal(storage.get('lolo-selected-program'), 'connect-plus-1');
    assert.equal(storage.remove('lolo-selected-program'), true);
  }
  {
    const {storage,map}=loadStorage(new Map([['lolo-mastered','["hello-1"]'],['lolo-parent-gate-v1','shared-pin']]));
    assert.equal(storage.profiles.activeId,'default');
    assert.equal(storage.profiles.create('Second learner'),true);
    const child=storage.profiles.list()[1];
    assert.equal(storage.profiles.select(child.id),true);
    // The old document is still pinned to the first profile until reload.
    assert.deepEqual(storage.getJSON('lolo-mastered',[]),['hello-1']);
    const second=loadStorage(map).storage;
    assert.equal(second.profiles.activeId,child.id);
    assert.deepEqual(second.getJSON('lolo-mastered',[]),[]);
    assert.equal(second.get('lolo-parent-gate-v1'),'shared-pin');
    second.set('lolo-extra-practice-v1','{"version":1,"entries":[]}');
    second.set('lolo-mastered','["hello-2"]');
    second.set('lolo-parent-settings','{"sessionMinutes":5}');
    assert.equal(second.profiles.rename(child.id,'Second'),true);
    assert.equal(second.profiles.select('default'),true);
    const first=loadStorage(map).storage;
    assert.deepEqual(first.getJSON('lolo-mastered',[]),['hello-1']);
    assert.deepEqual(first.getJSON('lolo-parent-settings',{}),{});
    assert.equal(first.get('lolo-extra-practice-v1'),null);
    assert.equal(first.profiles.select(child.id),true);
    const restored=loadStorage(map).storage;
    assert.deepEqual(restored.getJSON('lolo-mastered',[]),['hello-2']);
    assert.equal(restored.getJSON('lolo-parent-settings',{}).sessionMinutes,5);
    assert.equal(restored.get('lolo-extra-practice-v1'),'{"version":1,"entries":[]}');
  }
  {
    const {storage,map}=loadStorage(new Map([['lolo-local-profiles-v1','{broken'],['lolo-mastered','["hello-1"]']]));
    assert.equal(storage.profiles.activeId,null);
    assert.equal(storage.get('lolo-mastered'),null);
    assert.equal(storage.set('lolo-mastered','[]'),false);
    assert.equal(map.get('lolo-mastered'),'["hello-1"]');
    assert.equal(storage.profiles.create('new'),false);
  }
  {
    const {storage,map}=loadStorage(new Map([['lolo-mastered','["hello-1"]']]));
    const copy=storage.profiles.importCopy('Restored',{'lolo-mastered':'["hello-2"]','lolo-selected-program':'foundation'});
    assert.ok(copy);assert.equal(storage.profiles.activeId,'default');
    assert.deepEqual(storage.getJSON('lolo-mastered',[]),['hello-1']);
    assert.equal(storage.profiles.importCopy('Bad',{'lolo-parent-gate-v1':'not allowed'}),false);
    assert.equal(storage.profiles.select(copy),true);
    assert.deepEqual(loadStorage(map).storage.getJSON('lolo-mastered',[]),['hello-2']);
  }
  {
    const {storage,map}=loadStorage(new Map([['lolo-mastered','["hello-1"]']]));
    const set=window.localStorage.setItem;
    window.localStorage.setItem=(key,value)=>{if(key===storage.profiles.key)throw Error('quota');set(key,value);};
    assert.equal(storage.profiles.importCopy('Failed',{'lolo-mastered':'["hello-2"]'}),false);
    assert.deepEqual([...map.keys()],['lolo-mastered']);
    assert.deepEqual(storage.getJSON('lolo-mastered',[]),['hello-1']);
    assert.equal(storage.profiles.list().length,1);
  }
  console.log('Storage resilience, local profile isolation and restore-copy checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
