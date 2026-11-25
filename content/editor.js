// Problem-tab side of the editor adapter. Draft positions stay zero-based UTF-16.
(() => {
  const frameUrl = chrome.runtime.getURL('editor/frame.html');
  class WorkspaceEditor {
    constructor(container, { changed, action, error }) {
      this.root = container.attachShadow({ mode: 'closed' });
      this.changed = changed;
      this.action = action;
      this.error = error;
      this.generation = this.sequence = 0;
      this.requests = new Map();
      this.settings = {};
      this.accept = port => {
        if (port.name !== 'cboj-editor-' + this.nonce) return;
        if (this.port || port.sender?.id !== chrome.runtime.id || port.sender.url !== frameUrl + '#' + this.nonce) {
          port.disconnect();
          return;
        }
        this.port = port;
        port.onMessage.addListener(m => this.receive(m));
        port.onDisconnect.addListener(() => {
          void chrome.runtime.lastError;
          if (this.port === port) this.disconnect();
        });
        this.connected?.();
      };
      chrome.runtime.onConnect.addListener(this.accept);
    }

    connect() {
      if (this.connection) return this.connection;
      this.nonce = crypto.randomUUID();
      const frame = this.frame = document.createElement('iframe');
      frame.title = '코드 편집기';
      frame.src = frameUrl + '#' + this.nonce;
      frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;display:block;color-scheme:normal';
      this.connection = new Promise((resolve, reject) => {
        this.connected = resolve;
        this.connectionFailed = reject;
      });
      this.timer = setTimeout(() => { if (!this.port) this.disconnect(); }, 20000);
      this.root.replaceChildren(frame);
      return this.connection;
    }

    disconnect() {
      this.closeAnalysis();
      clearTimeout(this.timer);
      const error = Error('코드 편집기에 연결하지 못했어요. 분할 화면을 다시 열어 주세요.');
      this.connectionFailed?.(error);
      for (const request of this.requests.values()) request.reject(error);
      this.requests.clear();
      this.port = this.connection = this.connected = this.connectionFailed = this.frame = null;
      this.root.replaceChildren();
      if (this.visible) this.error(error.message);
      this.visible = false;
    }

    receive(m) {
      if (!Number.isSafeInteger(m?.generation)) return;
      if (m.generation === this.generation && this.doc) {
        if (m.type === 'analysis') {
          this.analysisMessage(m);
          return;
        }
        if (typeof m.state?.code === 'string') {
          const { code, cursor, scroll } = m.state;
          Object.assign(this.doc, { code, cursor, scroll });
        }
        if (m.type === 'edit' && Array.isArray(m.changes)) {
          let code = this.doc.code;
          for (const c of m.changes) {
            if (!Number.isSafeInteger(c?.at) || !Number.isSafeInteger(c.count) || c.at < 0 || c.count < 0
              || c.at + c.count > code.length || typeof c.text !== 'string') {
              this.flush().catch(error => this.error(error.message));
              return;
            }
            code = code.slice(0, c.at) + c.text + code.slice(c.at + c.count);
          }
          this.doc.code = code;
        }
        if (m.type === 'view') Object.assign(this.doc, { cursor: m.cursor, scroll: m.scroll });
        if (['edit', 'view', 'snapshot'].includes(m.type)) this.changed();
        if (m.type === 'action' && this.visible) this.action(m.action);
      }
      if (m.id && this.requests.has(m.id)) {
        const { resolve, reject } = this.requests.get(m.id);
        this.requests.delete(m.id);
        if (m.type === 'error') reject(Error('코드 편집기를 열지 못했어요.'));
        else resolve();
      }
    }

    closeAnalysis() {
      this.analysisPort?.disconnect();
      this.analysisPort = null;
    }

    analysisMessage({ session, message }) {
      if (!Number.isSafeInteger(session) || this.doc.language !== 'cpp') return;
      if (message?.type === 'analysis-close') {
        if (session === this.analysisSession) this.closeAnalysis();
        return;
      }
      if (!this.visible) return;
      if (message?.type === 'analysis-open') {
        this.closeAnalysis();
        this.analysisSession = session;
        const port = this.analysisPort = chrome.runtime.connect({ name: 'cboj-analysis' });
        port.onMessage.addListener(message => {
          if (this.analysisPort === port) this.send('analysis', { session, message });
        });
        port.onDisconnect.addListener(() => {
          void chrome.runtime.lastError;
          if (this.analysisPort !== port) return;
          this.analysisPort = null;
          this.send('analysis', { session, message: { type: 'analysis-lost' } });
        });
      }
      if (session === this.analysisSession && this.analysisPort) this.analysisPort.postMessage(message);
    }

    send(type, extra = {}) { this.port?.postMessage({ type, generation: this.generation, ...extra }); }
    request(type, extra) {
      const id = ++this.sequence;
      return new Promise((resolve, reject) => {
        this.requests.set(id, { resolve, reject });
        try { this.send(type, { ...extra, id }); }
        catch (error) { this.requests.delete(id); reject(error); }
      });
    }

    snapshot() {
      const { code, cursor, scroll } = this.doc;
      return { code, cursor, scroll };
    }
    async flush() { if (this.port && this.visible) await this.request('read'); }
    configure(settings) { this.settings = settings; this.send('config', { settings }); }
    lock() { this.send('lock'); }
    focus() { this.send('focus'); }
    layout() { this.send('layout'); }

    async setDocument(doc) {
      this.closeAnalysis();
      this.generation++;
      this.doc = { ...doc };
      this.canResume = false;
      if (this.visible) await this.showDocument();
    }
    async showDocument() {
      await this.connect();
      if (!this.visible || !this.doc) return;
      this.frame.focus({ preventScroll: true });
      await this.request('open', { doc: this.doc, settings: this.settings, resume: this.canResume });
      this.canResume = true;
    }
    async resume() {
      if (this.visible) return;
      this.visible = true;
      await this.showDocument();
    }
    async suspend() {
      this.visible = false;
      if (this.port) await this.request('suspend');
    }
    detach() {
      this.visible = false;
      this.canResume = false;
      this.port?.disconnect();
      this.disconnect();
    }
  }
  globalThis.CbojWorkspaceEditor = WorkspaceEditor;
})();
