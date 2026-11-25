const files = { cpp: ['C++', 'main.cpp'], c: ['C', 'main.c'], java: ['Java', 'Main.java'], python: ['Python', 'main.py'] };
const icons = { 3: 'namespace', 4: 'namespace', 5: 'class', 6: 'method', 7: 'property', 8: 'field',
  9: 'constructor', 10: 'enum', 11: 'interface', 12: 'method', 13: 'variable', 14: 'constant', 22: 'enum-member', 23: 'struct' };
function icon(name) {
  const el = document.createElement('span');
  el.className = 'codicon codicon-' + name;
  el.setAttribute('aria-hidden', 'true');
  return el;
}
function label(item) {
  return [6, 9, 12].includes(item.kind) && !item.name.includes('(') ? item.name + '()' : item.name;
}
function contains(range, pos) {
  const l = pos.lineNumber - 1, c = pos.column - 1;
  return (l > range.start.line || l === range.start.line && c >= range.start.character)
    && (l < range.end.line || l === range.end.line && c < range.end.character);
}

export class Breadcrumbs {
  constructor(view, language, analysis) {
    this.view = view;
    this.analysis = analysis;
    this.nav = document.getElementById('breadcrumbs');
    this.list = document.getElementById('symbol-list');
    this.file = files[language];
    this.items = [];
    this.nav.hidden = false;
    this.listeners = [view.onDidChangeCursorPosition(() => this.render()),
      view.onDidChangeModelContent(() => this.refresh()), view.onDidCompositionEnd(() => this.refresh())];
    this.outside = e => { if (!this.list.contains(e.target) && !this.nav.contains(e.target)) this.close(); };
    document.addEventListener('pointerdown', this.outside, true);
    this.list.onfocusout = e => { if (!this.list.contains(e.relatedTarget) && !this.nav.contains(e.relatedTarget)) this.close(); };
    this.list.onkeydown = e => {
      const buttons = [...this.list.children], index = buttons.indexOf(document.activeElement);
      if (e.key === 'Escape') { this.close(); this.opener?.focus(); }
      else if (e.key === 'ArrowDown') buttons[(index + 1) % buttons.length]?.focus();
      else if (e.key === 'ArrowUp') buttons[(index - 1 + buttons.length) % buttons.length]?.focus();
      else if (e.key === 'Home') buttons[0]?.focus();
      else if (e.key === 'End') buttons.at(-1)?.focus();
      else return;
      e.preventDefault();
    };
    this.refresh();
  }

  refresh() {
    clearTimeout(this.timer);
    this.cancel?.abort();
    this.items = [];
    this.close();
    this.pathKey = null;
    this.render();
    const a = this.analysis();
    if (!a?.ready || !a.features.includes('documentSymbol') || this.view.inComposition) return;
    const controller = this.cancel = new AbortController();
    const signal = controller.signal;
    this.timer = setTimeout(async () => {
      const token = { get isCancellationRequested() { return signal.aborted; },
        onCancellationRequested(fn) {
          signal.addEventListener('abort', fn);
          return { dispose: () => signal.removeEventListener('abort', fn) };
        } };
      const result = await a.request('documentSymbol', null, token);
      if (signal.aborted || !Array.isArray(result)) return;
      this.items = result;
      this.pathKey = null;
      this.render();
    }, 170);
  }

  render() {
    const pos = this.view.getPosition();
    const path = [];
    // clangd emits parents before their children. Follow the deepest containing symbol.
    for (let i = 0; i < this.items.length; i++) {
      if (!contains(this.items[i].range, pos)) continue;
      const chain = [i];
      let parent = this.items[i].parent;
      while (parent >= 0 && parent < chain[0]) { chain.unshift(parent); parent = this.items[parent].parent; }
      if (chain.length >= path.length) path.splice(0, path.length, ...chain);
    }
    const key = path.join('/');
    if (key === this.pathKey) return;
    this.pathKey = key;
    this.close();
    this.nav.replaceChildren();
    const language = document.createElement('span');
    language.className = 'crumb-language';
    language.textContent = this.file[0];
    this.nav.append(language);
    for (const index of [-1, ...path]) {
      const item = this.items[index], button = document.createElement('button');
      button.type = 'button';
      if (item) this.nav.append(icon('chevron-right'));
      const text = item ? label(item) : this.file[1];
      button.append(icon(item ? 'symbol-' + (icons[item.kind] || 'misc') : 'file-code'), document.createTextNode(text));
      button.title = this.items.length ? text + ' · 기호로 이동' : text;
      button.disabled = this.items.length === 0;
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-controls', 'symbol-list');
      button.onclick = () => this.open(button, index);
      this.nav.append(button);
    }
  }

  open(button, index) {
    const toggle = this.opener === button && !this.list.hidden;
    this.close();
    if (toggle) return;
    this.opener = button;
    button.setAttribute('aria-expanded', 'true');
    for (const [i, item] of this.items.entries()) {
      if (index >= 0 && item.parent !== this.items[index].parent) continue;
      const entry = document.createElement('button');
      entry.type = 'button';
      entry.append(icon('symbol-' + (icons[item.kind] || 'misc')), document.createTextNode(label(item)));
      if (index < 0) {
        let depth = 0, p = item.parent;
        while (p >= 0 && depth < 12) { depth++; p = this.items[p].parent; }
        entry.style.paddingInlineStart = (8 + depth * 12) + 'px';
      }
      entry.onclick = () => {
        this.close();
        const { line, character } = item.selectionRange.start;
        const pos = { lineNumber: line + 1, column: character + 1 };
        this.view.setPosition(pos); this.view.revealPositionInCenterIfOutsideViewport(pos); this.view.focus();
      };
      this.list.append(entry);
      if (i === index) entry.setAttribute('aria-current', 'location');
    }
    this.list.hidden = false;
    this.list.style.left = Math.max(0, Math.min(button.offsetLeft, innerWidth - this.list.offsetWidth)) + 'px';
    (this.list.querySelector('[aria-current]') || this.list.firstElementChild)?.focus();
  }

  close() {
    this.list.hidden = true;
    this.list.replaceChildren();
    this.opener?.setAttribute('aria-expanded', 'false');
  }

  dispose() {
    clearTimeout(this.timer);
    this.cancel?.abort();
    for (const listener of this.listeners) listener.dispose();
    document.removeEventListener('pointerdown', this.outside, true);
    this.close();
    this.list.onkeydown = this.list.onfocusout = null;
    this.nav.replaceChildren();
    this.nav.hidden = true;
  }
}
