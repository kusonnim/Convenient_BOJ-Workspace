// Only extension-internal messages reach this document. BOJ cannot post editor
// operations, keystrokes, or native commands to a window message listener.
const nonce = location.hash.slice(1);
if (parent !== window && /^[0-9a-f-]{36}$/.test(nonce)) start().catch(console.error);

async function start() {
  const tabId = await chrome.runtime.sendMessage({ type: 'cboj:editor-tab' });
  if (!Number.isInteger(tabId)) return;
  const port = chrome.tabs.connect(tabId, { frameId: 0, name: 'cboj-editor-' + nonce });
  let workspace, generation = 0, doc, closed = false, queue = Promise.resolve();
  const notify = msg => { if (!closed) port.postMessage({ ...msg, generation }); };
  async function receive(m) {
    if (closed || !Number.isSafeInteger(m?.generation)) return;
    let state;
    if (m.type === 'open') {
      if (typeof m.doc?.code !== 'string' || !/^\d+$/.test(m.doc.problem) || !['cpp', 'c', 'python'].includes(m.doc.language)) {
        throw Error('문제 번호와 편집 언어를 확인해 주세요.');
      }
      const { MonacoWorkspace } = await import('./monaco-adapter.js');
      if (closed) return;
      workspace ||= new MonacoWorkspace(document.getElementById('editor'), notify);
      generation = m.generation;
      doc = m.doc;
      state = workspace.open(doc, m.settings, m.resume);
    } else if (m.generation === generation && workspace) {
      if (m.type === 'analysis') workspace.analysis?.receive(m.session, m.message);
      if (m.type === 'suspend') state = workspace.suspend();
      if (m.type === 'read') state = workspace.snapshot();
      if (m.type === 'config') workspace.configure(m.settings);
      if (m.type === 'reveal' && workspace.view && Number.isSafeInteger(m.line) && Number.isSafeInteger(m.column)
          && m.line >= 1 && m.line <= workspace.model.getLineCount() && m.column >= 1) {
        const text = workspace.model.getLineContent(m.line);
        let column = 1;
        if (m.unit === 'utf8') {
          const encoder = new TextEncoder();
          let bytes = 1;
          for (const ch of text) {
            if (bytes >= m.column) break;
            bytes += encoder.encode(ch).length; column += ch.length;
          }
        } else if (/^[\x20-\x7e]*$/.test(text)) column = m.column;
        const pos = workspace.model.validatePosition({ lineNumber: m.line, column });
        workspace.view.setPosition(pos); workspace.view.revealPositionInCenterIfOutsideViewport(pos); workspace.view.focus();
      }
      if (m.type === 'focus') workspace.view?.focus();
      if (m.type === 'layout') workspace.view?.layout();
      if (m.type === 'lock') workspace.view?.updateOptions({ readOnly: true });
    }
    if (m.id) notify({ type: 'ack', id: m.id, state });
  }
  port.onMessage.addListener(m => {
    queue = queue.then(() => receive(m)).catch(error => {
      console.error(error);
      notify({ type: 'error', id: m.id });
    });
  });
  function dispose() {
    if (closed) return;
    closed = true;
    // Chrome can tear down the content port before the last edit is delivered.
    const state = workspace?.suspend();
    if (state && doc) {
      const family = doc.language === 'python' ? 'py' : doc.language;
      chrome.storage.local.set({ ['draft:' + doc.problem + ':' + family]: { ...state, at: Date.now() } }).catch(() => {});
    }
  }
  port.onDisconnect.addListener(() => { void chrome.runtime.lastError; dispose(); });
  addEventListener('pagehide', dispose, { once: true });
  addEventListener('keydown', e => {
    if (!e.isTrusted || e.isComposing || e.keyCode === 229 || !workspace?.view || workspace.view.inComposition) return;
    if (workspace.view.hasTextFocus() && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'KeyZ') {
      e.preventDefault(); e.stopImmediatePropagation();
      const wrap = !workspace.settings.editorWrap;
      workspace.settings.editorWrap = wrap;
      workspace.view.updateOptions({ wordWrap: wrap ? 'on' : 'off' });
      chrome.storage.sync.set({ editorWrap: wrap }).catch(console.error);
      return;
    }
    let action;
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'KeyC') action = 'toggle';
    if (!e.altKey && (e.ctrlKey || e.metaKey) && workspace.view.hasTextFocus()) {
      if (e.key === 'Enter') action = e.shiftKey ? 'submit' : 'run';
      if (!e.shiftKey && e.code === 'KeyS') action = 'save';
    }
    if (action) {
      e.preventDefault();
      e.stopImmediatePropagation();
      notify({ type: 'action', action, state: workspace.snapshot() });
    }
  }, true);
}
