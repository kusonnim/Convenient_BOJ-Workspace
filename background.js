// Convenient BOJ — 서비스 워커
// 작성 중인 코드를 Wandbox(https://wandbox.org)에서 컴파일·실행해 준다.
// 콘텐츠 스크립트에서 바로 부르면 CORS·권한 문제가 생길 수 있어 여기서 대신 요청한다.

function httpError(status) {
  if (status === 429) return '실행 서버(Wandbox)가 지금 너무 바빠요. 잠시 후 다시 실행해 주세요.';
  if (status >= 500) return `실행 서버(Wandbox)에 일시적인 문제가 있어요 (HTTP ${status}). 잠시 후 다시 실행해 주세요.`;
  return `실행 서버 응답 오류 (HTTP ${status})`;
}

const WANDBOX = 'https://wandbox.org/api';
const FALLBACK = {
  c: 'gcc-13.2.0-c',
  cpp: 'gcc-13.2.0',
  clangc: 'clang-17.0.1-c',
  clangcpp: 'clang-17.0.1',
  python: 'cpython-3.13.18',
};
const DAY = 24 * 60 * 60 * 1000;

let compilerCache = null;

function versionKey(name) {
  return (name.match(/\d+/g) || []).map(Number);
}
function newest(names) {
  return names.sort((a, b) => {
    const x = versionKey(a), y = versionKey(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const d = (y[i] || 0) - (x[i] || 0);
      if (d) return d;
    }
    return 0;
  })[0];
}

async function compilers() {
  if (compilerCache) return compilerCache;
  const saved = (await chrome.storage.local.get('wandboxCompilers')).wandboxCompilers;
  if (saved && Date.now() - saved.at < DAY) return (compilerCache = saved.map);
  try {
    const list = await (await fetch(WANDBOX + '/list.json')).json();
    const names = list.map((c) => c.name);
    const pick = (re) => newest(names.filter((n) => re.test(n)));
    const map = {
      c: pick(/^gcc-\d+\.\d+\.\d+-c$/),
      cpp: pick(/^gcc-\d+\.\d+\.\d+$/),
      clangc: pick(/^clang-\d+\.\d+\.\d+-c$/),
      clangcpp: pick(/^clang-\d+\.\d+\.\d+$/),
      python: pick(/^cpython-3\.\d+\.\d+$/),
    };
    for (const k in FALLBACK) map[k] = map[k] || FALLBACK[k];
    await chrome.storage.local.set({ wandboxCompilers: { at: Date.now(), map } });
    return (compilerCache = map);
  } catch {
    return FALLBACK;
  }
}

async function run({ lang, code, stdin }) {
  const map = await compilers();
  let compiler, options = [];
  if (lang.kind === 'python') {
    compiler = map.python;
  } else if (lang.kind === 'c') {
    compiler = lang.clang ? map.clangc : map.c;
    options = ['-O2', '-std=' + (lang.std || 'gnu11'), '-DONLINE_JUDGE', '-DBOJ', '-lm'];
  } else {
    compiler = lang.clang ? map.clangcpp : map.cpp;
    options = ['-O2', '-std=' + (lang.std || 'gnu++17'), '-DONLINE_JUDGE', '-DBOJ'];
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 40000);
  const started = Date.now();
  try {
    const res = await fetch(WANDBOX + '/compile.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ compiler, code, stdin: stdin || '', 'compiler-option-raw': options.join('\n'), save: false }),
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false, error: httpError(res.status), compiler };
    const j = await res.json();
    return {
      ok: true,
      compiler,
      options,
      status: j.status,
      signal: j.signal || '',
      compileError: j.compiler_error || '',
      stdout: j.program_output || '',
      stderr: j.program_error || '',
      ms: Date.now() - started,
    };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? '실행 시간이 너무 오래 걸려 중단했어요 (40초).' : '실행 서버에 연결하지 못했어요.', compiler };
  } finally {
    clearTimeout(timer);
  }
}

// ───────── 제출 탭 관리 ─────────
// A(문제 + 분할 화면)에서 [제출] → 같은 창의 A 바로 옆에 제출 탭 B를 연다.
// B에서 제출하면(채점 현황으로 넘어가면) A 탭으로 돌아오고,
// B는 뒤에서 채점 결과를 읽어 A에 전달한 뒤 채점이 끝나면 닫는다.
importScripts('shared/submission-sessions.js', 'shared/case-storage.js');

// ───────── 내 PC 실행 도우미 연결 ─────────
// 분할 화면(콘텐츠 스크립트)과 PC 도우미(host/cboj_host.py) 사이에서 메시지를 그대로 전달한다.
// 도우미가 없으면 'nohost'를 보내고, 분할 화면에서 Wandbox 전송 여부를 묻는다.
const HOST_NAME = 'com.convenient_boj.runner';

function problemSender(sender) {
  return sender?.id === chrome.runtime.id && sender.frameId === 0 && Boolean(sender.tab)
    && /^https:\/\/(?:www\.)?acmicpc\.net\/problem\/\d+\/?(?:[?#].*)?$/.test(sender.url || '');
}

const runnerLimit = 512 * 1024;
function bytes(value) {
  return typeof value === 'string' && value.length <= runnerLimit
    ? new TextEncoder().encode(value).length : Infinity;
}
function validProgram(m) {
  const kind = m.lang?.kind;
  if (bytes(m.code) > runnerLimit || !['c', 'cpp', 'python'].includes(kind)) return false;
  if (m.lang.std === undefined) return true;
  if (kind === 'python' || typeof m.lang.std !== 'string') return false;
  const standards = kind === 'c' ? /^(gnu|c)(90|99|11|17|2x|23)$/ : /^(gnu|c)\+\+(98|03|11|14|17|20|23|2c)$/;
  return standards.test(m.lang.std);
}
function validNative(m) {
  if (!m || (m.protocol !== undefined && m.protocol !== 2)) return false;
  if (m.type === 'info') return m.id === undefined || Number.isSafeInteger(m.id);
  if (!Number.isSafeInteger(m.id) || m.id < 1) return false;
  if (m.type === 'kill' || m.type === 'eof') return true;
  if (m.type === 'stdin') return bytes(m.data) <= runnerLimit;
  if (!['run', 'batch'].includes(m.type) || !validProgram(m)) return false;
  if (m.compiler !== undefined && !['msvc', 'gcc', 'auto'].includes(m.compiler)) return false;
  if (m.timeLimit !== undefined && !(Number.isFinite(m.timeLimit) && m.timeLimit >= 0.05 && m.timeLimit <= 300)) return false;
  if (m.type === 'run') return bytes(m.stdin ?? '') <= runnerLimit;
  return Array.isArray(m.inputs) && m.inputs.length > 0 && m.inputs.length <= 64
    && m.inputs.reduce((sum, input) => sum + bytes(input), 0) <= runnerLimit;
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'cboj-runner') return;
  if (!problemSender(port.sender)) { port.disconnect(); return; }
  let native = null;
  let closed = false;
  let protocol = null;
  let shutdownTimer;

  const open = () => {
    if (native) return native;
    try {
      native = chrome.runtime.connectNative(HOST_NAME);
    } catch (e) {
      port.postMessage({ type: 'nohost', error: String(e && e.message || e) });
      return null;
    }
    native.onMessage.addListener((m) => {
      if (m.type === 'info') protocol = m.protocol || 1;
      if (!closed) { try { port.postMessage(m); } catch { /* 탭이 닫힘 */ } }
    });
    native.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
      clearTimeout(shutdownTimer);
      native = null;
      protocol = null;
      if (!closed) { try { port.postMessage({ type: 'nohost', error: err || '도우미 연결이 끊겼어요.' }); } catch { /* 탭이 닫힘 */ } }
    });
    return native;
  };

  port.onMessage.addListener((m) => {
    if (!validNative(m)) {
      port.postMessage({ type: 'lost', id: m?.id, message: '실행 요청 형식 또는 입력 한도를 확인해 주세요.' });
      return;
    }
    const n = open();
    if (n) {
      try { n.postMessage(m); } catch { port.postMessage({ type: 'nohost', error: '도우미 연결이 끊겼어요.' }); }
    }
  });
  port.onDisconnect.addListener(() => {
    // 탭이 닫히거나 뒤로 가기 캐시(bfcache)로 들어가면 크롬이 연결을 닫는다.
    // 이유(lastError)를 읽어 두지 않으면 'Unchecked runtime.lastError'로 오류 목록에 쌓인다.
    void chrome.runtime.lastError;
    closed = true;
    if (native) {
      const n = native;
      try {
        if (protocol === 1) n.disconnect();
        else {
          // Chrome may terminate a native process immediately on disconnect. Let
          // the host stop its tree and delete its work directory before closing.
          n.postMessage({ type: 'shutdown', protocol: 2 });
          shutdownTimer = setTimeout(() => { try { n.disconnect(); } catch {} }, 45000);
        }
      } catch { /* already disconnected */ }
    }
  });
});

importScripts('shared/analysis-port.js');

const HANDLERS = {
  'cboj:case-edit': caseStorage,
  'cboj:editor-tab': (_msg, sender) => sender.id === chrome.runtime.id && sender.frameId > 0
    && sender.url?.split('#')[0] === chrome.runtime.getURL('editor/frame.html') ? sender.tab?.id : null,
  'cboj:run': (msg, sender) => problemSender(sender) && msg.remoteConfirmed === true && validProgram(msg) && bytes(msg.stdin) <= runnerLimit
    ? run(msg) : { ok: false, error: 'Wandbox 전송 동의와 실행 요청을 확인해 주세요.' },
  'cboj:open-submit': submissionSessions.open,
  'cboj:claim-submit': submissionSessions.form,
  'cboj:filled': submissionSessions.form,
  'cboj:submitted': submissionSessions.form,
  'cboj:judge-row': submissionSessions.form,
  'cboj:restore-submit': submissionSessions.restore,
};

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  const fn = msg && Object.hasOwn(HANDLERS, msg.type) && HANDLERS[msg.type];
  if (!fn) return undefined;
  Promise.resolve(fn(msg, sender))
    .then(respond)
    .catch((e) => respond({ ok: false, error: String(e && e.message || e) }));
  return true; // 비동기 응답
});
