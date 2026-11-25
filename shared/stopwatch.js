// Compatible with the original per-problem timer records from Convenient BOJ 1.4.
const stopwatch = (() => {
  function empty() { return { elapsed: 0, since: null, solved: null }; }
  const ms = n => Number.isSafeInteger(n) && n >= 0;
  function valid(t) {
    return t && ms(t.elapsed) && (t.since === null || ms(t.since)) && (t.solved === null || ms(t.solved));
  }
  function elapsed(t, now = Date.now()) { return t.elapsed + (t.since === null ? 0 : Math.max(0, now - t.since)); }
  function format(value) {
    const seconds = Math.floor(value / 1000), hours = Math.floor(seconds / 3600);
    const pad = n => String(n).padStart(2, '0');
    return (hours ? hours + ':' : '') + pad(Math.floor(seconds / 60) % 60) + ':' + pad(seconds % 60);
  }
  async function change(pid, action) {
    return navigator.locks.request('cboj-timers', async () => {
      const key = 'timer:' + pid;
      const stored = (await chrome.storage.local.get(key))[key];
      const t = valid(stored) ? stored : empty(), now = Date.now();
      let next;
      if ((action === 'start' || action === 'auto' && !t.elapsed && t.solved === null) && t.since === null)
        next = { ...t, since: now, solved: null };
      if (action === 'pause' && t.since !== null) next = { ...t, elapsed: elapsed(t, now), since: null };
      if (action === 'reset') next = empty();
      if (action === 'solve' && t.solved === null && (t.since !== null || t.elapsed > 0)) {
        const duration = elapsed(t, now);
        next = { elapsed: duration, since: null, solved: duration };
      }
      if (next) await chrome.storage.local.set({ [key]: next });
      return next || t;
    });
  }
  return { empty, valid, elapsed, format, change };
})();
