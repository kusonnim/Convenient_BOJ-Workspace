(() => {
  const el = id => document.getElementById('snippet-' + id);
  const lang = el('lang'), list = el('list'), prefix = el('prefix'), body = el('body'), state = el('state');
  let snippets = {};
  function show() {
    const entry = (snippets[lang.value] || []).find(s => s.id === list.value);
    prefix.value = entry?.prefix || ''; body.value = entry?.body || '';
    el('delete').disabled = !entry;
  }
  function render(id = '') {
    list.replaceChildren(new Option('새 스니펫', ''), ...(snippets[lang.value] || []).map(s => new Option(s.prefix, s.id)));
    list.value = id; show();
  }
  lang.onchange = () => { render(); state.textContent = ''; };
  list.onchange = () => { show(); state.textContent = ''; };
  let busy = false;
  async function save(remove) {
    if (busy) return;
    busy = true;
    try {
      const language = lang.value, id = list.value || crypto.randomUUID(), name = prefix.value.trim(), text = body.value;
      // Serialize popup windows as well as writes from this form.
      await navigator.locks.request('cboj-snippets', async () => {
        const current = (await chrome.storage.local.get('workspaceSnippets')).workspaceSnippets || {};
        const items = (current[language] || []).filter(s => s.id !== id);
        if (!remove) {
          if (!/^[A-Za-z_]\w{0,47}$/.test(name) || !text || text.length > 16384) throw Error('영문 접두어와 본문(16,384자 이하)을 입력하세요.');
          if (items.some(s => s.prefix === name)) throw Error('같은 접두어가 있어요.');
          if (items.length >= 100) throw Error('언어별 최대 100개예요.');
          items.push({ id, prefix: name, body: text });
        }
        const next = { ...current, [language]: items };
        await chrome.storage.local.set({ workspaceSnippets: next });
        snippets = next;
      });
      render(remove ? '' : id); state.textContent = remove ? '삭제됨' : '저장됨';
    } catch (error) { state.textContent = error.message; }
    finally { busy = false; }
  }
  el('save').onclick = () => save(false);
  el('delete').onclick = () => { if (list.value && confirm('스니펫을 삭제할까요?')) save(true); };
  chrome.storage.local.get('workspaceSnippets').then(v => { snippets = v.workspaceSnippets || {}; render(); });
})();
