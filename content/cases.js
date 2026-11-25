// BOJ samples are read-only. Custom records use upstream's per-problem storage format.
globalThis.CbojCases = class {
  constructor(pid, h, run, error) {
    this.pid = pid;
    this.key = 'cases:' + pid;
    this.selectionKey = 'selectedCase:' + pid;
    this.custom = [];
    this.pending = new Set();
    this.revision = 0;
    this.h = h;
    this.error = error;
    this.tabs = h('div', { class: 'case-tabs', role: 'tablist', 'aria-label': '테스트 목록' });
    const add = h('button', { class: 'cboj-icon', title: '테스트 추가', 'aria-label': '테스트 추가', text: '+' });
    const del = this.del = h('button', { class: 'cboj-link', title: '선택한 테스트 삭제', text: '삭제' });
    const play = h('button', { class: 'cboj-btn small', text: '▶ 선택 실행', title: '선택 실행 (Ctrl+Alt+Enter)' });
    const all = h('button', { class: 'cboj-link', text: '전체 실행', title: '전체 실행 (Ctrl+Enter)' });
    const textArea = label => h('textarea', { 'aria-label': label, spellcheck: 'false', placeholder: label });
    this.input = textArea('입력');
    this.expected = textArea('기대 출력');
    this.name = h('input', { 'aria-label': '테스트 이름', maxlength: '64', placeholder: '테스트 이름' });
    this.on = h('input', { type: 'checkbox' });
    this.compare = h('input', { type: 'checkbox' });
    this.fields = h('div', { class: 'case-fields', role: 'tabpanel' },
      h('div', { class: 'case-meta' }, this.name, h('label', {}, this.on, ' 전체에 포함'), del),
      h('div', { class: 'case-io' }, h('label', {}, '입력', this.input),
        h('div', {}, h('label', {}, this.compare, ' 기대 출력'), this.expected)));
    this.pane = h('div', { class: 'cboj-pane cases' },
      h('div', { class: 'case-head' }, this.tabs, add), this.fields, h('div', { class: 'case-actions' }, play, all));
    this.tabs.addEventListener('keydown', e => {
      const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!dir) return;
      const items = this.items(), current = items.findIndex(c => c.id === this.active);
      const next = items[current + dir];
      if (!next) return;
      e.preventDefault();
      if (e.altKey && !next.sample && !items[current].sample) this.mutate({ op: 'move', before: next.id });
      else this.select(next.id);
      this.tabs.querySelector('[aria-selected="true"]')?.focus();
    });
    add.onclick = async e => {
      if (!e.isTrusted || add.disabled) return;
      const id = crypto.randomUUID();
      add.disabled = true;
      this.fields.inert = true;
      const fields = [this.name, this.input, this.expected, this.compare, this.on, this.del];
      for (const field of fields) field.disabled = true;
      try {
        if (await this.mutate({ op: 'add', id })) {
          await this.load();
          this.select(id);
        }
      } finally {
        for (const field of fields) field.disabled = false;
        this.fields.inert = false;
        add.disabled = false;
        this.render();
        if (this.active === id) this.input.focus();
      }
    };
    del.onclick = e => { if (e.isTrusted && confirm('이 테스트를 삭제할까요?')) this.mutate({ op: 'remove' }); };
    play.onclick = e => { if (e.isTrusted) run(true); };
    all.onclick = e => { if (e.isTrusted) run(false); };
    for (const field of ['input','expected','name','compare','on']) {
      const node = this[field];
      const checkbox = node.type === 'checkbox';
      node.addEventListener(checkbox ? 'change' : 'input', () => {
        const record = this.custom.find(c => c.id === this.active);
        if (!record) return;
        const value = checkbox ? node.checked : node.value;
        record[field] = value;
        const mutation = this.mutate({ op: 'edit', field, value });
        this.pending.add(mutation);
        mutation.finally(() => this.pending.delete(mutation));
        if (field === 'name' || checkbox) this.render();
      });
      if (!checkbox) node.addEventListener('blur', () => { Promise.all([...this.pending]).then(() => this.load()); });
    }
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[this.key]) this.update(changes[this.key].newValue);
    });
    this.ready = this.load(true);
  }

  items() {
    const samples = globalThis.cbojBoj.samples().map(s => ({ ...s, sample: true, id: 'sample:' + s.n, name: '예제 ' + s.n, compare: s.expected != null }));
    return samples.concat(this.custom.map((c,i) => ({ ...c, name: c.name || '테스트 ' + (i + 1),
      compare: c.compare ?? (typeof c.expected === 'string' && c.expected.length > 0) })));
  }
  async load(selection = false) {
    const revision = this.revision;
    const v = await chrome.storage.local.get([this.key, this.selectionKey]);
    if (this.revision !== revision) return;
    if (selection && !this.active) this.active = v[this.selectionKey];
    this.update(v[this.key]);
  }
  update(value) {
    this.revision++;
    this.custom = Array.isArray(value) ? value.filter(c => c && typeof c.id === 'string') : [];
    this.render();
  }
  select(id) {
    this.active = id;
    this.render();
    chrome.storage.local.set({ [this.selectionKey]: id }).catch(e => this.error(e.message));
  }
  async mutate(patch) {
    try {
      const result = await chrome.runtime.sendMessage({ type: 'cboj:case-edit', id: this.active, pid: this.pid, ...patch });
      if (!result?.ok) throw Error(result?.error || '테스트를 저장할 수 없어요.');
      return true;
    } catch (e) { this.error(e.message); return false; }
  }
  async runs(selected) {
    await this.ready;
    await Promise.all([...this.pending]);
    await this.load();
    return this.items().filter(c => selected ? c.id === this.active : c.on !== false)
      .map(c => ({ ...c, expected: c.compare ? c.expected ?? '' : null }));
  }
  render() {
    const items = this.items();
    const current = items.find(c => c.id === this.active) || items[0];
    this.active = current?.id;
    const focusedTab = this.tabs.contains(document.activeElement);
    const tabKey = JSON.stringify(items.map(c => [c.id, c.name, c.on]));
    if (this.tabKey !== tabKey) {
      this.tabKey = tabKey;
      this.tabs.replaceChildren(...items.map(c => {
        const tab = this.h('button', { class: 'case-tab', role: 'tab', 'data-case': c.id, text: c.name });
        tab.onclick = () => this.select(c.id);
        if (!c.sample) {
          tab.draggable = true;
          tab.title = '드래그 또는 Alt+←/→로 순서 변경';
          tab.ondragstart = e => { this.drag = c.id; e.dataTransfer.setData('text/plain', c.id); };
          tab.ondragover = e => { if (this.drag) e.preventDefault(); };
          tab.ondrop = e => { if (this.drag) { e.preventDefault(); this.mutate({ op: 'move', id: this.drag, before: c.id }); } this.drag = null; };
          tab.ondragend = () => { this.drag = null; };
        }
        return tab;
      }));
    }
    for (const tab of this.tabs.children) {
      const selected = tab.dataset.case === this.active;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    if (focusedTab && !this.tabs.contains(document.activeElement)) this.tabs.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true });
    this.fields.hidden = !current;
    if (!current) return;
    const changed = this.shown !== this.active;
    this.shown = this.active;
    for (const field of ['name','input','expected']) {
      const node = this[field];
      const value = field === 'name' ? (this.custom.find(c => c.id === this.active)?.name || '') : (current[field] || '');
      if ((changed || document.activeElement !== node) && node.value !== value) node.value = value;
      node.readOnly = !!current.sample;
    }
    this.del.hidden = this.name.hidden = this.on.parentElement.hidden = !!current.sample;
    this.on.checked = current.on !== false;
    this.compare.checked = current.compare;
    this.compare.disabled = !!current.sample;
  }
};
