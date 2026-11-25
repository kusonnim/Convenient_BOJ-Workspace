// The service worker is the only writer. Records in session storage survive a
// worker restart and disappear with the browser session. Draft payloads are
// consumed once by the managed form and never broadcast to other tabs.
const submissionSessions = (() => {
  const storage = chrome.storage.session;
  const formKey = id => 'cbojForm:' + id;
  const originKey = id => 'cbojOrigin:' + id;
  const get = async key => (await storage.get(key))[key];
  let queue = Promise.resolve();
  function serial(fn) {
    const next = queue.then(fn);
    queue = next.catch(() => {});
    return next;
  }
  const validToken = token => typeof token === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(token);
  function route(sender, pattern) {
    if (!sender?.tab || sender.id !== chrome.runtime.id || sender.frameId !== 0) return null;
    const url = new URL(sender.url);
    return ['https://www.acmicpc.net', 'https://acmicpc.net'].includes(url.origin) && pattern.exec(url.pathname);
  }
  async function publish(s, event) {
    const key = originKey(s.originTabId);
    const owner = await get(key);
    if (owner?.token !== s.token) return;
    const judge = { ...event, token: s.token };
    if (event.stage === 'done' && event.key === 'ac') {
      // A full local storage area must not prevent delivering the judge result.
      const timer = await stopwatch.change(s.pid, 'solve').catch(() => null);
      if (timer?.solved != null) judge.solvedTime = timer.solved;
    }
    await storage.set({ [key]: { ...owner, judge } });
    await chrome.tabs.sendMessage(s.originTabId, { type: 'cboj:judge', judge }, { frameId: 0 }).catch(() => {});
  }
  async function open(m, sender) {
    const match = route(sender, /^\/problem\/(\d+)\/?$/);
    if (!match || match[1] !== m.pid || !validToken(m.token) || typeof m.code !== 'string'
      || typeof m.user !== 'string' || !m.user || m.user.length > 64
      || !/^\d{1,8}$/.test(m.langId) || typeof m.langName !== 'string' || m.langName.length > 128
      || !['default','open','close','onlyaccepted'].includes(m.codeOpen)) return { ok: false };
    const originTabId = sender.tab.id, key = originKey(originTabId), previous = await get(key);
    const tab = await chrome.tabs.create({ url: 'about:blank', windowId: sender.tab.windowId,
      index: sender.tab.index + 1, openerTabId: originTabId, active: true });
    const s = { pid: m.pid, token: m.token, at: Date.now(), tabId: tab.id, originTabId,
      user: String(m.user || '').slice(0, 64), langName: m.langName, submitted: false,
      pending: { code: m.code, langId: m.langId, langName: m.langName, codeOpen: m.codeOpen } };
    try {
      const overlaps = {};
      for (const [recordKey, record] of Object.entries(await storage.get(null))) {
        if (recordKey.startsWith('cbojForm:') && record.originTabId !== originTabId && record.pid === s.pid && record.user === s.user) {
          s.overlaps = true;
          overlaps[recordKey] = { ...record, overlaps: true };
        }
      }
      await storage.set({ ...overlaps, [formKey(tab.id)]: s, [key]: { pid: s.pid, token: s.token, tabId: tab.id } });
      await chrome.tabs.update(tab.id, { url: new URL('/submit/' + m.pid, sender.url).href });
    } catch (error) {
      await storage.remove(formKey(tab.id));
      if (previous) await storage.set({ [key]: previous }); else await storage.remove(key);
      await chrome.tabs.remove(tab.id).catch(() => {});
      throw error;
    }
    if (previous?.tabId && (await get(formKey(previous.tabId)))?.token === previous.token) {
      await storage.remove(formKey(previous.tabId));
      await chrome.tabs.remove(previous.tabId).catch(() => {});
    }
    return { ok: true };
  }
  async function form(m, sender) {
    const submitPath = route(sender, /^\/submit\/(\d+)\/?$/);
    const statusPath = route(sender, /^\/status\/?$/);
    if (!submitPath && !statusPath) return {};
    const key = formKey(sender.tab.id);
    let s = await get(key);
    if (!s) {
      // Pick up an in-flight pre-P4 form only when its tab, problem and token match.
      const old = await get('cbojSubmitTab');
      if (old?.tabId !== sender.tab.id || !validToken(old.token) || (submitPath && old.pid !== submitPath[1])) return {};
      const { cbojPending, cbojWatch } = await chrome.storage.local.get(['cbojPending','cbojWatch']);
      const pending = cbojPending?.token === old.token && cbojPending.pid === old.pid ? cbojPending : null;
      const watch = cbojWatch?.token === old.token && cbojWatch.pid === old.pid ? cbojWatch : null;
      if (!pending && !watch) return {};
      s = { ...old, pending, at: (pending || watch).at, user: (pending || watch).user || '', langName: pending?.langName || '' };
      await storage.set({ [key]: s, [originKey(s.originTabId)]: { pid:s.pid, token:s.token, tabId:s.tabId } });
      await storage.remove('cbojSubmitTab');
      await chrome.storage.local.remove([...(pending ? ['cbojPending'] : []), ...(watch ? ['cbojWatch'] : [])]);
    }
    if (submitPath && submitPath[1] !== s.pid) return {};
    if (m.type === 'cboj:claim-submit' && submitPath && s.pending && Date.now() - s.at < 120000) {
      const pending = s.pending;
      delete s.pending;
      await storage.set({ [key]: s });
      return { pending };
    }
    if (m.type === 'cboj:filled' && submitPath) {
      await publish(s, { stage: 'filled', langOk: m.langOk === true, langName: s.langName });
    }
    if (!statusPath || Date.now() - s.at > 15 * 60000) return {};
    if (m.type === 'cboj:submitted') {
      if (!s.submitted) {
        s.submitted = true;
        await storage.set({ [key]: s });
        const origin = await chrome.tabs.get(s.originTabId).catch(() => null);
        if (origin) {
          await chrome.tabs.update(origin.id, { active: true }).catch(() => {});
          await chrome.windows.update(origin.windowId, { focused: true }).catch(() => {});
        }
      }
      const explicit = new URL(sender.url).searchParams.get('solution_id');
      if (s.overlaps && !s.solution && !/^\d{1,20}$/.test(explicit || '')) {
        await publish(s, { stage: 'unidentified' });
        return {};
      }
      return { pid: s.pid, token: s.token, user: s.user, solution: s.solution, expires: s.at + 15 * 60000 };
    }
    if (m.type !== 'cboj:judge-row' || !s.submitted || !/^\d{1,20}$/.test(m.row?.id)) return {};
    const row = m.row;
    const explicit = new URL(sender.url).searchParams.get('solution_id');
    if ((explicit || (s.overlaps && !s.solution)) && explicit !== row.id) return {};
    if (s.solution && s.solution !== row.id) return {};
    if (!s.solution) {
      const records = await storage.get(null);
      if (Object.entries(records).some(([k, v]) => k.startsWith('cbojOrigin:') && v.token !== s.token && v.judge?.id === row.id)) return { occupied: true };
      s.solution = row.id;
      await storage.set({ [key]: s });
    }
    const clean = {};
    for (const field of ['id','key','text','memory','time','lang']) clean[field] = String(row[field] || '').slice(0,256);
    const done = ['ac','pac','wa','pe','tle','mle','ole','rte','ce'].includes(clean.key);
    await publish(s, { ...clean, stage: done ? 'done' : 'judging' });
    if (done) {
      await storage.remove(key);
      await chrome.tabs.remove(s.tabId).catch(() => {});
    }
    return { accepted: true, done };
  }
  async function removed(id) {
    const s = await get(formKey(id)), owner = await get(originKey(id));
    if (s) {
      await publish(s, { stage: s.submitted ? 'closed' : 'cancelled' });
      await storage.remove(formKey(id));
    }
    if (owner) {
      await storage.remove(originKey(id));
      if ((await get(formKey(owner.tabId)))?.token === owner.token) {
        await storage.remove(formKey(owner.tabId));
        await chrome.tabs.remove(owner.tabId).catch(() => {});
      }
    }
  }
  chrome.tabs.onRemoved.addListener(id => { serial(() => removed(id)).catch(() => {}); });
  return {
    open: (m,s) => serial(() => open(m,s)),
    form: (m,s) => serial(() => form(m,s)),
    restore: (m,s) => serial(async () => {
      const match = route(s, /^\/problem\/(\d+)\/?$/);
      const owner = match && await get(originKey(s.tab.id));
      return owner?.pid === match?.[1] ? owner : null;
    }),
  };
})();
