// Only the managed form can obtain its watch. Every status GET in the development
// suites is intercepted locally, and the form's final button belongs to the user.
(() => {
  if (globalThis.__cbojStatusLoaded) return;
  globalThis.__cbojStatusLoaded = true;
  const send = msg => chrome.runtime.sendMessage(msg).catch(() => null);
  send({ type: 'cboj:submitted' }).then(w => {
    if (!w?.token) return;
    const S = globalThis.CBOJ_SEL.status;
    const explicit = new URLSearchParams(location.search).get('solution_id');
    let pinned = w.solution || (/^\d+$/.test(explicit || '') && explicit) || null;
    const pollKey = 'cbojPoll:' + w.token;
    let poll = {};
    try { poll = JSON.parse(sessionStorage.getItem(pollKey) || '{}'); } catch { /* old fixture or page data */ }
    let interval = Math.min(60000, Math.max(8000, Number(poll.interval) || 8000));
    let last = '', changed = Date.now(), busy = false, again = false;
    async function tick() {
      if (busy) { again = true; return; }
      busy = true;
      try {
        const rows = pinned ? [document.getElementById(S.rowIdPrefix + pinned)] : document.querySelectorAll(S.rows);
        for (const tr of rows) {
          if (!tr?.querySelector('a[href="/problem/' + w.pid + '"]')) continue;
          if (w.user && tr.cells[1]?.textContent.trim() !== w.user) continue;
          const row = globalThis.cbojParseRow(tr);
          const sig = JSON.stringify(row);
          if (sig === last) break;
          const reply = await send({ type: 'cboj:judge-row', row });
          if (reply?.occupied) continue;
          if (reply?.accepted) {
            pinned = row.id;
            sessionStorage.setItem('cbojSolId', pinned);
            last = sig;
            if (poll.signature !== sig) {
              interval = 8000;
              poll.signature = sig;
              sessionStorage.setItem(pollKey, JSON.stringify({ signature: sig, interval }));
            }
            changed = Date.now();
            if (reply.done) stop();
          }
          break;
        }
      } finally {
        busy = false;
        if (again) { again = false; queueMicrotask(tick); }
      }
    }
    const observer = new MutationObserver(tick);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    const fallback = setInterval(() => {
      if (Date.now() >= w.expires) { stop(); return; }
      if (Date.now() - changed < interval) return;
      sessionStorage.setItem(pollKey, JSON.stringify({ signature: poll.signature, interval: Math.min(60000, interval * 2) }));
      location.reload();
    }, 2000);
    function stop() { observer.disconnect(); clearInterval(fallback); }
    addEventListener('pagehide', stop, { once: true });
    tick();
  });
})();
