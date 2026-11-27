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
  console.log('Storage resilience checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
