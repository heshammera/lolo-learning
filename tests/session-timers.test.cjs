const assert = require('node:assert/strict');
const {create} = require('../session-timers.js');

class FakeClock {
  now = 0;
  nextId = 1;
  pending = new Map();
  setTimeout(callback, delay) {
    const id = this.nextId++;
    this.pending.set(id, {callback, due: this.now + delay});
    return id;
  }
  clearTimeout(id) { this.pending.delete(id); }
  advance(ms) {
    const target = this.now + ms;
    while (true) {
      const next = [...this.pending.entries()].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      this.now = next[1].due;
      this.pending.delete(next[0]);
      next[1].callback();
    }
    this.now = target;
  }
}

const clock = new FakeClock();
const sessions = create(clock);
let endings = 0;
let warnings = 0;
const first = sessions.begin();
sessions.schedule(first, 10, () => { warnings += 1; sessions.schedule(first, 12, () => { endings += 1; }); });
clock.advance(5);
sessions.invalidate();
const second = sessions.begin();
sessions.schedule(second, 10, () => { warnings += 1; sessions.schedule(second, 12, () => { endings += 1; }); });
clock.advance(10);
assert.equal(warnings, 1);
clock.advance(11);
assert.equal(endings, 0);
clock.advance(1);
assert.equal(endings, 1);
assert.equal(sessions.isCurrent(first), false);
assert.equal(sessions.isCurrent(second), true);
console.log('Session timer generation checks passed.');
