(() => {
  function create(clock = globalThis) {
    let generation = 0;
    const timers = new Set();

    function invalidate() {
      generation += 1;
      for (const timer of timers) clock.clearTimeout(timer);
      timers.clear();
      return generation;
    }

    return Object.freeze({
      begin() { invalidate(); return generation; },
      isCurrent(id) { return id === generation; },
      schedule(id, delay, callback) {
        if (id !== generation) return null;
        const timer = clock.setTimeout(() => {
          timers.delete(timer);
          if (id === generation) callback();
        }, Math.max(0, delay));
        timers.add(timer);
        return timer;
      },
      invalidate,
    });
  }

  function shouldTryNextProvider({status,stopFallback,online=true,aborted=false,now=Date.now(),deadline=Infinity}={}) {
    return online && !aborted && !stopFallback && ![401,403,429].includes(status) && now<deadline;
  }
  const api = Object.freeze({create,shouldTryNextProvider});
  if (typeof window !== 'undefined') window.LoloSessionTimers = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
