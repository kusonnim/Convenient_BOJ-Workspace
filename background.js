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
  java: 'openjdk-jdk-21+35',
};
const DAY = 24 * 60 * 60 * 1000;
const CACHE_KEY = 'wandboxCompilers2';
let compilerCache = null;
let loadingCompilers;

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

async function discoverCompilers() {
  const saved = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY];
  if (saved && Date.now() - saved.at < DAY) return { at: saved.at, map: { ...FALLBACK, ...saved.map } };
  try {
    const res = await fetch(WANDBOX + '/list.json', { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw Error();
    const list = await res.json();
    const names = list.map((c) => c.name);
    const pick = (re) => newest(names.filter((n) => re.test(n)));
    const map = {
      c: pick(/^gcc-\d+\.\d+\.\d+-c$/),
      cpp: pick(/^gcc-\d+\.\d+\.\d+$/),
      clangc: pick(/^clang-\d+\.\d+\.\d+-c$/),
      clangcpp: pick(/^clang-\d+\.\d+\.\d+$/),
      python: pick(/^cpython-3\.\d+\.\d+$/),
      java: pick(/^openjdk-jdk-\d+[\w.+-]*$/),
    };
    for (const k in FALLBACK) map[k] = map[k] || FALLBACK[k];
    const entry = { at: Date.now(), map };
    await chrome.storage.local.set({ [CACHE_KEY]: entry });
    return entry;
  } catch {
    return { at: Date.now() - DAY + 60000, map: FALLBACK };
  }
}

async function compilers() {
  if (!compilerCache || Date.now() - compilerCache.at >= DAY) {
    loadingCompilers ||= discoverCompilers().finally(() => { loadingCompilers = null; });
    compilerCache = await loadingCompilers;
  }
  return compilerCache.map;
}

const retryStatus = new Set([429, 500, 502, 503, 504]);
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function run({ lang, code, stdin }, signal) {
  const map = await compilers();
  let compiler, options = [];
  const payload = { code, stdin, save: false };
  if (lang.kind === 'python') {
    compiler = map.python;
  } else if (lang.kind === 'java') {
    compiler = map.java;
    // Wandbox invokes javac prog.java. Supply the BOJ file as a named source
    // so public classes, comments, text blocks and diagnostic lines stay intact.
    payload.code = '// Main.java\n';
    payload.codes = [{ file: 'Main.java', code }];
    options = [...(lang.release ? ['--release', String(lang.release)] : []), 'Main.java'];
  } else if (lang.kind === 'c') {
    compiler = lang.clang ? map.clangc : map.c;
    options = ['-O2', '-std=' + (lang.std || 'gnu11'), '-DONLINE_JUDGE', '-DBOJ', '-lm'];
  } else {
    compiler = lang.clang ? map.clangcpp : map.cpp;
    options = ['-O2', '-std=' + (lang.std || 'gnu++17'), '-DONLINE_JUDGE', '-DBOJ'];
  }

  const body = JSON.stringify({ ...payload, compiler, 'compiler-option-raw': options.join('\n') });
  const started = Date.now();
  let error, retryAfter = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await delay(Math.max(800 * attempt, retryAfter), signal);
    signal.throwIfAborted();
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 40000);
    try {
      const res = await fetch(WANDBOX + '/compile.json', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', redirect: 'error',
        body, signal: AbortSignal.any([signal, timeout.signal]),
      });
      if (!res.ok) {
        error = httpError(res.status);
        if (!retryStatus.has(res.status)) return { ok: false, error, compiler };
        const after = res.headers.get('Retry-After');
        retryAfter = /^\d+$/.test(after) ? Number(after) * 1000 : Math.max(0, Date.parse(after) - Date.now()) || 0;
        if (retryAfter > 10000) break;
        continue;
      }
      const j = await res.json();
      if (j == null || (j.status == null && !j.signal)) throw new SyntaxError();
      const file = { c: 'main.c', cpp: 'main.cpp', python: 'main.py', java: 'Main.java' }[lang.kind];
      return { ok: true, compiler, options, status: String(j.status ?? ''), signal: j.signal || '',
        compileError: String(j.compiler_error || '').replace(/\bprog\.(?:cc|c|cpp|java|py)\b/g, file),
        stdout: j.program_output || '', stderr: j.program_error || '', ms: Date.now() - started };
    } catch (e) {
      signal.throwIfAborted();
      if (timeout.signal.aborted || e.name === 'AbortError') return { ok: false, error: '실행 시간이 너무 오래 걸려 중단했어요 (40초).', compiler };
      if (e instanceof SyntaxError) return { ok: false, error: 'Wandbox 실행 결과를 읽지 못했어요.', compiler };
      error = '실행 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.';
    } finally { clearTimeout(timer); }
  }
  return { ok: false, error: error + ' (내 PC 실행 도우미로 오프라인 실행 가능)', compiler };
}

const remoteJobs = new Map();
let remoteLane = 0;
async function remoteRun(msg, tabId) {
  const ctrl = new AbortController(), jobs = remoteJobs.get(tabId) || new Set();
  remoteJobs.set(tabId, jobs);
  jobs.add(ctrl);
  try {
    const lane = remoteLane;
    remoteLane = (remoteLane + 1) % 3;
    return await navigator.locks.request('cboj-wandbox-' + lane, { signal: ctrl.signal }, () => run(msg, ctrl.signal));
  } catch (e) {
    if (!ctrl.signal.aborted) throw e;
    return { ok: false, error: '실행을 중지했어요.' };
  } finally {
    jobs.delete(ctrl);
    if (!jobs.size) remoteJobs.delete(tabId);
  }
}
function cancelRemote(tabId) {
  for (const ctrl of remoteJobs.get(tabId) || []) ctrl.abort();
}
chrome.tabs.onRemoved.addListener(cancelRemote);
chrome.tabs.onUpdated.addListener((tabId, change) => { if (change.status === 'loading') cancelRemote(tabId); });

// ───────── 제출 탭 관리 ─────────
// A(문제 + 분할 화면)에서 [제출] → 같은 창의 A 바로 옆에 제출 탭 B를 연다.
// B에서 제출하면(채점 현황으로 넘어가면) A 탭으로 돌아오고,
// B는 뒤에서 채점 결과를 읽어 A에 전달한 뒤 채점이 끝나면 닫는다.
importScripts('/shared/stopwatch.js', '/shared/submission-sessions.js', '/shared/case-storage.js');

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
  if (bytes(m.code) > runnerLimit || !['c', 'cpp', 'java', 'python'].includes(kind)) return false;
  if (m.lang.release !== undefined && !(kind === 'java' && Number.isInteger(m.lang.release) && m.lang.release >= 8 && m.lang.release <= 99)) return false;
  if (m.lang.std === undefined) return true;
  if (!['c', 'cpp'].includes(kind) || typeof m.lang.std !== 'string') return false;
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
  if (m.stackSizeMiB !== undefined && !(['c', 'cpp'].includes(m.lang.kind) && Number.isInteger(m.stackSizeMiB)
      && m.stackSizeMiB >= 1 && m.stackSizeMiB <= 512)) return false;
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

importScripts('/shared/analysis-port.js');

const HANDLERS = {
  'cboj:timer': (msg, sender) => problemSender(sender) && ['read', 'auto', 'start', 'pause', 'reset'].includes(msg.action)
    ? stopwatch.change(new URL(sender.url).pathname.split('/')[2], msg.action) : null,
  'cboj:case-edit': caseStorage,
  'cboj:editor-tab': (_msg, sender) => sender.id === chrome.runtime.id && sender.frameId > 0
    && sender.url?.split('#')[0] === chrome.runtime.getURL('editor/frame.html') ? sender.tab?.id : null,
  'cboj:run': (msg, sender) => problemSender(sender) && msg.remoteConfirmed === true && validProgram(msg) && bytes(msg.stdin) <= runnerLimit
    ? remoteRun(msg, sender.tab.id) : { ok: false, error: 'Wandbox 전송 동의와 실행 요청을 확인해 주세요.' },
  'cboj:cancel-remote': (_msg, sender) => { if (problemSender(sender)) cancelRemote(sender.tab.id); },
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
