import { editor, languages, Uri, MarkerSeverity } from '../vendor/monaco/editor.js';

import { snippetSuggestions } from './snippets.js';

const kinds = 'Text Method Function Constructor Field Variable Class Interface Module Property Unit Value Enum Keyword Snippet Color File Reference Folder EnumMember Constant Struct Event Operator TypeParameter'.split(' ');
const severity = [null, MarkerSeverity.Error, MarkerSeverity.Warning, MarkerSeverity.Info, MarkerSeverity.Hint];
const range = r => r && ({ startLineNumber: r.start.line + 1, startColumn: r.start.character + 1,
  endLineNumber: r.end.line + 1, endColumn: r.end.character + 1 });
const fallback = {
  'no-host': '기본 완성 · PC 도우미 연결 필요', 'old-host': '기본 완성 · PC 도우미 업데이트 필요',
  'no-server': '기본 완성 · clangd 설치 필요', 'no-headers': '기본 완성 · 호환되는 C++ 헤더 필요',
  size: '기본 완성 · clangd 분석 한도 512 KiB', lost: '기본 완성 · clangd 연결 종료',
};
let sequence = 0;

export class CppAnalysis {
  constructor(model, view, standard, notify) {
    Object.assign(this, { model, view, standard, notify });
    this.status = document.getElementById('analysis-status');
    this.dialog = document.getElementById('header-preview');
    this.dialog.querySelector('button').onclick = () => this.dialog.close();
    this.status.hidden = false;
    this.pending = new Map();
    this.providers = [];
    this.retries = this.lastId = 0;
    this.compositionEnd = view.onDidCompositionEnd(() => queueMicrotask(() => {
      if (this.disposed) return;
      this.flush();
      if (this.ready && !this.providers.length) this.register();
      if (this.deferredDiagnostics) this.receive(this.session, this.deferredDiagnostics);
      this.deferredDiagnostics = null;
    }));
    this.change = model.onDidChangeContent(() => {
      this.completion = null;
      this.clearRequests();
      this.setMarkers([]);
      clearTimeout(this.debounce);
      this.debounce = setTimeout(() => this.flush(), 55);
    });
    this.start();
  }

  send(type, data = {}) { this.notify({ type: 'analysis', session: this.session, message: { type, ...data } }); }

  start() {
    this.session = ++sequence;
    this.active = true;
    this.ready = false;
    this.sentVersion = 0;
    this.timeouts = 0;
    this.status.textContent = 'C++ · clangd 연결 중';
    this.watchdog = setTimeout(() => this.lost(), 60000);
    this.flush();
  }

  flush() {
    if (this.view.inComposition) return;
    const version = this.model.getVersionId();
    if (this.sentVersion === version || (!this.active && !this.oversize)) return;
    const code = this.model.getValue().toWellFormed();
    if (code.length > 524288 || new TextEncoder().encode(code).length > 524288) {
      this.stop();
      this.oversize = true;
      this.status.textContent = fallback.size;
      return;
    }
    if (this.oversize) { this.oversize = false; this.start(); return; }
    if (this.sentVersion) this.send('analysis-change', { version, code });
    else this.send('analysis-open', { version, code, standard: this.standard });
    this.sentVersion = version;
  }

  clearRequests() {
    for (const request of [...this.pending.values()]) request.cancel();
  }

  request(feature, position, token) {
    if (!this.ready || this.view.inComposition || token.isCancellationRequested) return Promise.resolve(null);
    this.flush();
    if (!this.ready) return Promise.resolve(null);
    const id = ++this.lastId, version = this.sentVersion;
    return new Promise(resolve => {
      const finish = value => {
        if (!this.pending.delete(id)) return;
        clearTimeout(timer);
        subscription.dispose();
        resolve(version === this.model.getVersionId() ? value : null);
      };
      const cancel = () => { this.send('analysis-cancel', { id }); finish(null); };
      const subscription = token.onCancellationRequested(cancel);
      const timer = setTimeout(() => {
        cancel();
        if (++this.timeouts >= 2) this.lost();
      }, 12000);
      this.pending.set(id, { finish, cancel });
      this.send('analysis-request', { id, feature, version, position: { line: position.lineNumber - 1, character: position.column - 1 } });
    });
  }

  receive(session, m) {
    if (!this.active || session !== this.session) return;
    if (m.type === 'analysis-ready') {
      clearTimeout(this.watchdog);
      this.ready = true;
      this.status.textContent = 'C++ 분석 · clangd · ' + m.family;
      if (!this.view.inComposition && !this.providers.length) this.register();
    } else if (m.type === 'analysis-result') {
      if (this.pending.has(m.id)) this.timeouts = 0;
      this.pending.get(m.id)?.finish(m.version === this.model.getVersionId() ? m.result : null);
    } else if (m.type === 'analysis-diagnostics' && m.version === this.model.getVersionId()) {
      if (this.view.inComposition) { this.deferredDiagnostics = m; return; }
      this.setMarkers(m.items.map(item => ({
        ...range(item.range), severity: severity[item.severity] || MarkerSeverity.Error, message: item.message, source: 'clangd',
      })));
    } else if (m.type === 'analysis-unavailable') {
      this.stop();
      this.status.textContent = fallback[m.reason] || fallback.lost;
    } else if (m.type === 'analysis-reconfigure') {
      this.stop();
      this.start();
    } else if (m.type === 'analysis-lost') this.lost();
  }

  setMarkers(markers) {
    if (markers.length || this.hasMarkers) {
      editor.setModelMarkers(this.model, 'clangd', markers);
      this.notify({ type: 'diagnostics', items: markers });
    }
    this.hasMarkers = markers.length > 0;
  }

  lost() {
    this.stop();
    this.status.textContent = fallback.lost;
    if (this.retries < 2) {
      this.retry = setTimeout(() => this.start(), 300 * ++this.retries);
      this.status.textContent = 'C++ · clangd 다시 연결 중';
    }
  }

  register() {
    // Match this draft only. Read-only header excerpts and other models never
    // participate in this connection.
    const selector = { language: 'cpp', scheme: this.model.uri.scheme, pattern: this.model.uri.path };
    // Prefer the semantic provider without reconfiguring a focused editor or
    // its native IME. Disposing this provider restores P2 word/keyword results.
    this.providers.push(languages.registerCompletionItemProvider({ ...selector, exclusive: true }, {
      triggerCharacters: ['.', ':', '>', '<', '"', '/'],
      provideCompletionItems: async (model, position, context, token) => {
        const key = [model.getVersionId(), position.lineNumber, position.column].join('/');
        const result = this.completion?.key === key ? this.completion.result : await this.request('completion', position, token);
        if (token.isCancellationRequested) return;
        if (!result) return { suggestions: snippetSuggestions(model, position) };
        if (!result.incomplete && this.active) this.completion = { key, result };
        const word = model.getWordUntilPosition(position);
        const current = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
          startColumn: word.startColumn, endColumn: position.column };
        return { incomplete: result.incomplete, suggestions: snippetSuggestions(model, position).concat(result.items.map(i => ({
          label: i.label, detail: i.detail, kind: languages.CompletionItemKind[kinds[i.kind - 1]] ?? languages.CompletionItemKind.Text,
          insertText: i.insert, filterText: i.filter || i.label, sortText: i.sort || i.label, range: range(i.range) || current,
          insertTextRules: i.snippet ? languages.CompletionItemInsertTextRule.InsertAsSnippet : 0,
        }))) };
      },
    }), languages.registerSignatureHelpProvider(selector, {
      signatureHelpTriggerCharacters: ['(', ','], signatureHelpRetriggerCharacters: [','],
      provideSignatureHelp: async (_model, pos, token) => {
        const r = await this.request('signatureHelp', pos, token);
        if (!r?.signatures.length) return;
        return { value: { ...r, signatures: r.signatures.map(s => ({ label: s.label, parameters: s.parameters.map(label => ({ label })) })) }, dispose() {} };
      },
    }), languages.registerHoverProvider(selector, {
      provideHover: async (_model, pos, token) => {
        const r = await this.request('hover', pos, token);
        if (!r?.text) return;
        // A fenced plaintext block cannot turn source comments into links, images or commands.
        const fence = '~'.repeat(Math.max(3, ...Array.from(r.text.matchAll(/~+/g), m => m[0].length + 1)));
        return { range: range(r.range), contents: [{ value: fence + '\n' + r.text + '\n' + fence, isTrusted: false }] };
      },
    }), languages.registerDefinitionProvider(selector, {
      provideDefinition: async (_model, pos, token) => {
        const r = await this.request('definition', pos, token);
        if (r?.range) return { uri: this.model.uri, range: range(r.range) };
        if (!r?.header) return;
        const uri = Uri.from({ scheme: 'cboj-header', path: '/' + r.header, fragment: String(r.line + 1) });
        this.header = { ...r, uri };
        return { uri, range: { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 1 } };
      },
    }), editor.registerEditorOpener({ openCodeEditor: (source, uri) => {
      if (source !== this.view || this.header?.uri.toString() !== uri.toString()) return false;
      const h = this.header;
      this.dialog.querySelector('strong').textContent = h.header + ' · ' + (h.line + 1) + '행';
      this.dialog.querySelector('pre').textContent = h.text.split('\n').map((s, i) =>
        (h.first + i === h.line ? '› ' : '  ') + String(h.first + i + 1).padStart(4) + '  ' + s).join('\n');
      this.dialog.showModal();
      return true;
    } }));
  }

  stop() {
    this.completion = null;
    clearTimeout(this.watchdog);
    clearTimeout(this.retry);
    this.clearRequests();
    if (this.active) this.send('analysis-close');
    this.active = this.ready = false;
    for (const item of this.providers.splice(0)) item.dispose();
    this.deferredDiagnostics = null;
    this.setMarkers([]);
    if (this.dialog.open) this.dialog.close();
    this.header = null;
  }

  dispose() {
    this.disposed = true;
    this.stop();
    clearTimeout(this.debounce);
    this.change.dispose();
    this.compositionEnd.dispose();
    this.status.hidden = true;
    this.dialog.querySelector('button').onclick = null;
  }
}
