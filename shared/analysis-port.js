// A separate native connection keeps analysis independent of runner selection,
// compilation, stdin, and job cancellation.
(() => {
  const fields = {
    'analysis-open': ['code', 'version', 'standard'], 'analysis-change': ['code', 'version'],
    'analysis-request': ['id', 'feature', 'position', 'version'], 'analysis-cancel': ['id'],
  };
  const integer = (n, min) => Number.isInteger(n) && n >= min && n < 0x80000000;
  function valid(m) {
    if (!m || !Object.hasOwn(fields, m.type)) return false;
    const keys = m.type === 'analysis-request' && m.feature === 'documentSymbol' ? ['id', 'feature', 'version'] : fields[m.type];
    if (Object.keys(m).length !== keys.length + 1 || !keys.every(k => Object.hasOwn(m, k))) return false;
    if ('id' in m && !integer(m.id, 1) || 'version' in m && !integer(m.version, 1)) return false;
    if ('code' in m && bytes(m.code) > runnerLimit) return false;
    if ('standard' in m && (typeof m.standard !== 'string' || !/^(gnu|c)\+\+(98|03|11|14|17|20|23|2c)$/.test(m.standard))) return false;
    return !('feature' in m) || m.feature === 'documentSymbol' || ['completion', 'signatureHelp', 'hover', 'definition', 'documentHighlight'].includes(m.feature)
      && m.position && Object.keys(m.position).length === 2 && integer(m.position.line, 0) && integer(m.position.character, 0);
  }
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'cboj-analysis') return;
    if (!problemSender(port.sender)) { port.disconnect(); return; }
    let native, first, handshake = false, closed = false, timer;
    function reply(m) {
      if (!closed) { try { port.postMessage(m); } catch {} }
    }
    function close() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      if (!native) return;
      if (handshake) {
        try {
          native.postMessage({ type: 'analysis-close' });
          timer = setTimeout(() => native?.disconnect(), 35000);
          return;
        } catch {}
      }
      native.disconnect();
    }
    port.onDisconnect.addListener(() => { void chrome.runtime.lastError; close(); });
    port.onMessage.addListener(m => {
      if (closed) return;
      if (!valid(m) || (native ? m.type === 'analysis-open' : m.type !== 'analysis-open')) {
        reply({ type: 'analysis-unavailable', reason: 'invalid' });
        close();
        return;
      }
      try {
        if (native) {
          if (handshake) native.postMessage(m);
          else if (first && m.type === 'analysis-change' && m.version > first.version) {
            first = { ...first, code: m.code, version: m.version };
          }
          return;
        }
        first = m;
        native = chrome.runtime.connectNative(HOST_NAME);
        native.onDisconnect.addListener(() => {
          void chrome.runtime.lastError;
          clearTimeout(timer);
          native = null;
          reply(handshake ? { type: 'analysis-lost' } : { type: 'analysis-unavailable', reason: 'no-host' });
          closed = true;
        });
        native.onMessage.addListener(msg => {
          if (msg.type === 'analysis-closed') { clearTimeout(timer); native?.disconnect(); return; }
          if (closed) return;
          if (!handshake) {
            clearTimeout(timer);
            if (msg.type !== 'analysis-info' || msg.version !== 1) {
              reply({ type: 'analysis-unavailable', reason: 'old-host' });
              close();
              return;
            }
            handshake = true;
            native.postMessage(first);
            first = null;
          } else if (['analysis-ready', 'analysis-result', 'analysis-diagnostics', 'analysis-lost', 'analysis-reconfigure', 'analysis-unavailable'].includes(msg.type)) {
            reply(msg);
          }
        });
        timer = setTimeout(() => { reply({ type: 'analysis-unavailable', reason: 'old-host' }); close(); }, 7000);
        native.postMessage({ type: 'analysis-info' });
      } catch {
        reply({ type: 'analysis-unavailable', reason: 'no-host' });
        close();
      }
    });
  });
})();
