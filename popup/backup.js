(() => {
  const FORMAT = 'convenient-boj/drafts-settings';
  const sizeLimit = 32 * 1024 * 1024;
  const localKeys = ['runnerChoice', 'cbojLayout', 'workspaceSnippets'];
  const syncKeys = [...Object.keys(CBOJ_POLISH.defaults), 'splitAutoOpen', 'editorTheme', 'editorMinimap',
    'indent', 'codeOpen', 'templates', 'lastLangId', 'lastLangName', 'powerMode', 'powerPreset', 'powerIntensity', 'powerShake', 'shortcutProfile'];
  const draftKey = /^draft:\d{1,12}:(?:cpp|c|py)$/;
  const caseKey = /^cases:\d{1,12}$/;
  const selectionKey = /^selectedCase:\d{1,12}$/;
  const tabKey = /^panelTab:\d{1,12}$/;
  const recordId = v => typeof v === 'string' && /^[a-z0-9-]{1,80}$/i.test(v);
  const obj = value => value && typeof value === 'object' && !Array.isArray(value);
  const exact = (value, keys) => obj(value) && Object.keys(value).every(k => keys.includes(k));
  const integer = n => Number.isSafeInteger(n) && n >= 0;
  function same(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && same(a[k], b[k]));
  }
  const status = document.getElementById('backup-status');
  function validSync(key, v) {
    if (Object.hasOwn(CBOJ_POLISH.defaults, key)) return CBOJ_POLISH.valid(key, v);
    if (key === 'editorTheme') return typeof v === 'string' && Object.hasOwn(CBOJ_PALETTES, v);
    if (key === 'templates') return exact(v, ['cpp', 'c', 'py']) && Object.values(v).every(t => typeof t === 'string');
    if (key === 'indent') return ['tab', 'space'].includes(v);
    if (key === 'codeOpen') return ['default', 'open', 'close', 'onlyaccepted'].includes(v);
    if (key === 'lastLangId') return typeof v === 'string' && /^\d{1,8}$/.test(v);
    if (key === 'lastLangName') return typeof v === 'string' && v.length <= 120;
    if (key === 'powerPreset') return ['spark', 'aurora', 'pixel'].includes(v);
    if (key === 'powerIntensity') return ['low', 'medium', 'high'].includes(v);
    if (key === 'shortcutProfile') return ['classic', 'tests'].includes(v);
    return ['splitAutoOpen', 'editorMinimap', 'powerMode', 'powerShake'].includes(key) && typeof v === 'boolean';
  }
  function validRecords(value, fields, valid) {
    return Array.isArray(value) && value.every(valid)
      && fields.every(field => new Set(value.map(entry => entry[field])).size === value.length);
  }
  function validCase(c) {
    return exact(c, ['id', 'input', 'expected', 'name', 'on', 'compare']) && recordId(c.id)
      && typeof c.input === 'string' && (c.expected == null || typeof c.expected === 'string')
      && (c.name === undefined || typeof c.name === 'string' && c.name.length <= 64)
      && ['on', 'compare'].every(k => c[k] === undefined || typeof c[k] === 'boolean');
  }
  function validSnippet(s) {
    return exact(s, ['id', 'prefix', 'body']) && recordId(s.id) && typeof s.prefix === 'string'
      && /^[A-Za-z_]\w{0,47}$/.test(s.prefix) && typeof s.body === 'string' && s.body.length > 0 && s.body.length <= 16384;
  }
  function validLocal(key, v) {
    if (caseKey.test(key)) return validRecords(v, ['id'], validCase);
    if (selectionKey.test(key)) return recordId(v) || typeof v === 'string' && /^sample:\d{1,12}$/.test(v);
    if (tabKey.test(key)) return ['result', 'term', 'cases', 'problems'].includes(v);
    if (key === 'workspaceSnippets') return exact(v, ['cpp', 'c', 'py'])
      && Object.values(v).every(rows => validRecords(rows, ['id', 'prefix'], validSnippet) && rows.length <= 100);
    if (key === 'runnerChoice') return ['auto', 'msvc', 'gcc', 'wandbox'].includes(v);
    if (key === 'cbojLayout') return exact(v, ['width', 'bottom', 'collapsed', 'maximized'])
      && ['collapsed', 'maximized'].every(k => v[k] === undefined || typeof v[k] === 'boolean') && typeof v.width === 'number' && v.width >= 28
      && v.width <= 75 && Number.isFinite(v.bottom) && v.bottom >= 0 && v.bottom <= 100000;
    return draftKey.test(key) && exact(v, ['code', 'at', 'cursor', 'scroll']) && typeof v.code === 'string'
      && (v.at == null || integer(v.at)) && (v.cursor == null || exact(v.cursor, ['line', 'ch']) && integer(v.cursor.line) && integer(v.cursor.ch))
      && (v.scroll == null || exact(v.scroll, ['top', 'left']) && [v.scroll.top, v.scroll.left].every(n => Number.isFinite(n) && n >= 0));
  }
  function validate(data) {
    if (!exact(data, ['format', 'version', 'sync', 'local']) || data.format !== FORMAT || data.version !== 1
        || !obj(data.local) || !obj(data.sync)) throw Error('지원하는 백업 파일이 아니에요.');
    for (const [k, v] of Object.entries(data.sync)) {
      if (!syncKeys.includes(k) || !validSync(k, v) || new TextEncoder().encode(k + JSON.stringify(v)).length > 8192)
        throw Error('설정 값 또는 크기가 올바르지 않아요.');
    }
    if (Object.entries(data.local).some(([k, v]) => !validLocal(k, v))) throw Error('초안 또는 로컬 설정 형식이 올바르지 않아요.');
  }
  async function activeDrafts(mode) {
    const tabs = await chrome.tabs.query({});
    const replies = await Promise.all(tabs.map(tab => chrome.tabs.sendMessage(tab.id, { type: 'cboj:backup-draft', mode }, { frameId: 0 }).catch(() => null)));
    const active = new Map();
    for (const r of replies) {
      if (!r) continue;
      if (r.busy) throw Error('편집기나 언어 전환이 끝난 뒤 다시 시도해 주세요.');
      if (!draftKey.test(r.key) || mode === 'snapshot' && !validLocal(r.key, r.value)) throw Error('열린 초안을 읽을 수 없어요.');
      if (mode === 'snapshot' && active.has(r.key) && active.get(r.key).code !== r.value.code)
        throw Error('같은 문제의 두 탭에 서로 다른 코드가 있어요. 각 초안을 따로 보관한 뒤 다시 내보내 주세요.');
      active.set(r.key, r.value);
    }
    return active;
  }
  async function snapshot() {
    const area = chrome.storage.local;
    const keys = area.getKeys ? await area.getKeys() : Object.keys(await area.get(null));
    const [local, sync] = await Promise.all([area.get(keys.filter(k => localKeys.includes(k) || [draftKey, caseKey, selectionKey, tabKey].some(pattern => pattern.test(k)))), chrome.storage.sync.get(syncKeys)]);
    return { format: FORMAT, version: 1, local, sync };
  }
  async function download() {
    const data = await snapshot();
    for (const [key, value] of await activeDrafts('snapshot')) data.local[key] = value;
    validate(data);
    const file = new Blob([JSON.stringify(data)], { type: 'application/json' });
    if (file.size > sizeLimit) throw Error('백업 파일은 32 MiB 이하여야 해요.');
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url; a.download = 'convenient-boj-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = '백업 파일을 내보냈어요.';
  }

  // Resolve conflicts per draft, setting and template language. An absent entry
  // in a backup never deletes an existing value. Re-read after confirmation.
  function plan(data, current, active, replace) {
    const patch = { sync: {}, local: {} };
    let conflicts = 0, skipped = 0;
    function add(target, k, incoming, existing) {
      if (same(incoming, existing)) return;
      if (existing !== undefined) { conflicts++; if (!replace) return; }
      target[k] = incoming;
    }
    function mergeRecords(incoming, existing = [], snippets = false) {
      const merged = [...existing];
      for (const row of incoming) {
        const byId = merged.findIndex(old => old.id === row.id);
        const byPrefix = snippets ? merged.findIndex(old => old.prefix === row.prefix) : -1;
        if (byId >= 0 && byPrefix >= 0 && byId !== byPrefix) {
          conflicts++;
          if (replace) throw Error('스니펫 ID와 접두어가 서로 다른 항목과 충돌해요. 이름을 확인해 주세요.');
          continue;
        }
        const i = byId >= 0 ? byId : byPrefix;
        if (i < 0) merged.push(row);
        else {
          const updated = { ...row, id: merged[i].id };
          if (!same(updated, merged[i])) { conflicts++; if (replace) merged[i] = updated; }
        }
      }
      return merged;
    }
    for (const [k, v] of Object.entries(data.local)) {
      if (active.has(k)) { skipped++; continue; }
      const old = current.local[k];
      if (caseKey.test(k)) {
        const merged = mergeRecords(v, old);
        if (!same(old, merged)) patch.local[k] = merged;
      } else if (k === 'workspaceSnippets') {
        const merged = { ...old };
        for (const [lang, rows] of Object.entries(v)) merged[lang] = mergeRecords(rows, old?.[lang], true);
        if (!same(old, merged)) patch.local[k] = merged;
      } else add(patch.local, k, v, old);
    }
    for (const [k, v] of Object.entries(data.sync)) {
      if (k === 'templates') {
        const merged = { ...current.sync.templates };
        for (const [lang, value] of Object.entries(v)) add(merged, lang, value, current.sync.templates?.[lang]);
        if (Object.keys(merged).length && !same(merged, current.sync.templates)) patch.sync.templates = merged;
      } else add(patch.sync, k, v, current.sync[k]);
    }
    return { patch, conflicts, skipped };
  }
  async function restore(file) {
    if (file.size > sizeLimit) throw Error('백업 파일은 32 MiB 이하여야 해요.');
    let data;
    try { data = JSON.parse(await file.text()); } catch { throw Error('JSON 파일을 읽을 수 없어요.'); }
    validate(data);
    await navigator.locks.request('cboj-backup-restore', async () => {
      const active = await activeDrafts('keys'), current = await snapshot();
      const replace = document.getElementById('backup-policy').value === 'replace';
      const { patch, conflicts, skipped } = plan(data, current, active, replace);
      if (replace && conflicts && !confirm('기존 값 ' + conflicts + '개를 백업 내용으로 교체할까요?')) { status.textContent = '복원을 취소했어요.'; return; }
      if (patch.local.runnerChoice === 'wandbox' && !confirm('Wandbox를 복원하면 실행 시 코드와 입력을 외부 서비스로 전송해요. 적용할까요?')) delete patch.local.runnerChoice;
      await navigator.locks.request('cboj-cases', () => navigator.locks.request('cboj-snippets', async () => {
        await apply(current, patch, replace, conflicts, skipped);
      }));
    });
  }
  async function apply(current, patch, replace, conflicts, skipped) {
    const busy = await activeDrafts('keys'), latest = await snapshot();
    for (const area of ['local', 'sync']) {
      for (const k of Object.keys(patch[area])) {
        if (!same(latest[area][k], current[area][k]) || busy.has(k)) throw Error('복원 중 값이 바뀌었어요. 다시 시도해 주세요.');
      }
    }
    validate({ format: FORMAT, version: 1, ...patch });
    const counts = {};
    for (const area of ['sync', 'local']) {
      counts[area] = Object.keys(patch[area]).length;
      if (!counts[area]) continue;
      try { await chrome.storage[area].set(patch[area]); }
      catch { throw Error((area === 'local' && counts.sync ? '설정을 복원했어요. ' : '') + '저장 공간이나 쓰기 한도를 확인한 뒤 다시 시도해 주세요.'); }
    }
    status.textContent = '복원 ' + (counts.local + counts.sync) + '개 · 기존 값 유지 ' + (replace ? 0 : conflicts) + '개 · 열린 초안 제외 ' + skipped + '개';
    if (counts.sync || counts.local) document.dispatchEvent(new Event('cboj-restored'));
  }
  const picker = document.getElementById('backup-file');
  const report = err => { status.textContent = err.message || '백업 작업에 실패했어요.'; };
  document.getElementById('backup-export').onclick = () => download().catch(report);
  document.getElementById('backup-import').onclick = () => picker.click();
  picker.onchange = async () => {
    const file = picker.files[0]; picker.value = '';
    if (file) await restore(file).catch(report);
  };
})();
