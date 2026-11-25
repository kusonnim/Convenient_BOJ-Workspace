// Convenient BOJ — 문제 | 코드 작성 + 정/오답 확인 분할 화면
(() => {
  'use strict';
  const pathMatch = /^\/problem\/(\d+)\/?$/.exec(location.pathname);
  if (!pathMatch || globalThis.__cbojSplitLoaded) return;
  globalThis.__cbojSplitLoaded = true;

  const PID = pathMatch[1];
  const ext = globalThis.chrome;
  const DEFAULTS = globalThis.CBOJ_DEFAULTS;
  if (!ext?.storage || !DEFAULTS || !globalThis.CbojWorkspaceEditor) return;

  // ───────── 언어 ─────────
  const FALLBACK_LANGS = [
    { id: '84', name: 'C++17' }, { id: '95', name: 'C++20' }, { id: '88', name: 'C++14' },
    { id: '75', name: 'C11' }, { id: '0', name: 'C99' },
    { id: '28', name: 'Python 3' }, { id: '73', name: 'PyPy3' },
  ];
  const TEMPLATES = globalThis.CBOJ_TEMPLATES;
  const useTabs = () => settings.indent !== 'space'; // 기본: 탭 문자로 들여쓰기
  const expandTemplate = globalThis.cbojExpandTemplate;

  function langInfo(name) {
    if (/^(Python 3|PyPy3)/.test(name)) return { kind: 'python', family: 'py' };
    let m = /^C\+\+(\d+)?/.exec(name);
    if (m) {
      const v = { 98: '98', '03': '03', 11: '11', 14: '14', 17: '17', 20: '20', 23: '23', 26: '2c' }[m[1] || '17'] || '17';
      const clang = /Clang/i.test(name);
      return { kind: 'cpp', family: 'cpp', clang, std: (clang ? 'c++' : 'gnu++') + v };
    }
    m = /^C(\d+|2x)?(?=$| )/.exec(name);
    if (m) {
      const v = { 90: '90', 99: '99', 11: '11', 17: '17', '2x': '2x', 23: '2x' }[m[1] || '11'] || '11';
      const clang = /Clang/i.test(name);
      return { kind: 'c', family: 'c', clang, std: (clang ? 'c' : 'gnu') + v };
    }
    return null;
  }

  const FINAL = globalThis.CBOJ_FINAL || ['ac', 'pac', 'wa', 'pe', 'tle', 'mle', 'ole', 'rte', 'ce'];

  // ───────── 유틸 ─────────
  const $ = (sel, root = document) => root.querySelector(sel);
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const k in attrs) {
      if (k === 'class') el.className = attrs[k];
      else if (k === 'text') el.textContent = attrs[k];
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), attrs[k]);
      else el.setAttribute(k, attrs[k]);
    }
    for (const kid of kids) if (kid != null) el.append(kid);
    return el;
  };
  const normalize = (s) => {
    const lines = String(s).replace(/\r/g, '').split('\n').map((l) => l.replace(/[ \t]+$/, ''));
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines.join('\n');
  };

  const store = {
    get: (area, defaults) => new Promise((r) => { try { ext.storage[area].get(defaults, (v) => r(v || defaults)); } catch { r(defaults); } }),
    set: async (area, obj) => { try { await ext.storage[area].set(obj); } catch { /* 확장이 다시 로드됨 */ } },
  };

  const SPJ = !!document.querySelector('.problem-label-spj');
  function samples() {
    const list = [];
    document.querySelectorAll('pre[id^="sample-input-"]').forEach((pre) => {
      const n = pre.id.replace('sample-input-', '');
      const out = document.getElementById('sample-output-' + n);
      list.push({ n, input: pre.textContent, expected: out ? out.textContent : null });
    });
    return list;
  }

  // ───────── 상태 ─────────
  let settings = { ...DEFAULTS };
  let layout = { width: 50, bottom: 260 };
  let langs = FALLBACK_LANGS.filter((l) => langInfo(l.name));
  let langId = null;
  let me = ($('meta[name="username"]') || {}).content || '';
  let ui = null;
  let editor = null;
  let saveTimer = 0;
  let running = false;
  let draftReady = false;
  let runnerChoice = 'auto';
  let batchId = null;
  let runEpoch = 0;

  const currentLang = () => langs.find((l) => l.id === langId) || langs[0];
  const currentInfo = () => langInfo(currentLang().name);
  const draftKey = (family) => `draft:${PID}:${family}`;

  // ───────── 화면 만들기 ─────────
  function build() {
    const langSel = h('select', { class: 'cboj-lang', title: '제출 언어' });
    const btnReset = h('button', { class: 'cboj-btn', title: '기본 템플릿으로 되돌리기', text: '↺ 초기화' });
    const btnRun = h('button', { class: 'cboj-btn run', title: '예제로 실행 (Ctrl+Enter)', text: '▶ 실행' });
    const btnSubmit = h('button', { class: 'cboj-btn submit', title: '백준에 제출 (Ctrl+Shift+Enter)', text: '제출' });
    const btnClose = h('button', { class: 'cboj-icon', title: '분할 화면 닫기', text: '✕' });
    const editorSlot = h('div', { class: 'cboj-editor' });

    const tabResult = h('button', { class: 'cboj-tab active', 'data-tab': 'result', text: '정/오답 확인' });
    const tabTerm = h('button', { class: 'cboj-tab', 'data-tab': 'term', text: '터미널' });
    const status = h('span', { class: 'cboj-status' });

    const card = h('div', { class: 'cboj-card empty', text: '제출하면 이곳에서 채점 결과를 실시간으로 볼 수 있어요.' });
    const histWrap = h('div', { class: 'cboj-hist' },
      h('a', { class: 'cboj-link', target: '_blank', href: `/status?problem_id=${PID}&user_id=${encodeURIComponent(me)}`, text: '이 문제 내 제출 기록 보기 →' }));
    const paneResult = h('div', { class: 'cboj-pane result active' }, card, histWrap);

    const termOut = h('div', { class: 'cboj-term-out', role: 'log' });
    const termIn = h('textarea', { class: 'cboj-term-in', placeholder: '직접 입력할 stdin', spellcheck: 'false' });
    const btnCustom = h('button', { class: 'cboj-btn run small', text: '이 입력으로 실행' });
    const btnClear = h('button', { class: 'cboj-link', text: '지우기' });
    const where = h('button', { class: 'cboj-where', title: '코드를 실행하는 곳' });
    const paneTerm = h('div', { class: 'cboj-pane term' }, termOut,
      h('div', { class: 'cboj-term-bar' }, termIn, h('div', { class: 'cboj-term-actions' }, btnCustom, btnClear)));

    const resizerX = h('div', { class: 'cboj-resizer-x', title: '드래그해서 너비 조절' });
    const resizerY = h('div', { class: 'cboj-resizer-y', title: '드래그해서 높이 조절' });
    const bottom = h('div', { class: 'cboj-bottom' },
      h('div', { class: 'cboj-tabs' }, tabResult, tabTerm, status), paneResult, paneTerm);

    const panel = h('aside', { id: 'cboj-panel', class: 'cboj', 'aria-label': '코드 작성' },
      resizerX,
      h('div', { class: 'cboj-toolbar' },
        h('span', { class: 'cboj-title', text: PID + '번' }), langSel,
        h('span', { class: 'cboj-spacer' }), btnReset, btnRun, btnSubmit, btnClose),
      editorSlot, resizerY, bottom);
    document.body.appendChild(panel);

    status.before(where);
    ui = { panel, langSel, bottom, card, termOut, termIn, status, tabResult, tabTerm, paneResult, paneTerm, btnRun, btnSubmit, btnCustom, where };

    editor = new globalThis.CbojWorkspaceEditor(editorSlot, {
      changed() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => saveDraft(false), 600);
      },
      action(name) {
        if (name === 'toggle') close();
        if (name === 'run') runSamples();
        if (name === 'submit') submit();
        if (name === 'save') saveDraft(true);
      },
      error: message => setStatus(message, 'err'),
    });

    langSel.addEventListener('change', async () => {
      langSel.disabled = true;
      editor.lock();
      await editor.flush();
      const saved = saveDraft(false);
      draftReady = false;
      if (live) await stopLive();
      await saved;
      langId = langSel.value;
      store.set('sync', { lastLangId: langId, lastLangName: currentLang().name });
      await loadDraft();
      renderRunner();
    });
    btnReset.addEventListener('click', async (e) => {
      if (!e.isTrusted) return;
      if (!draftReady) return;
      await editor.flush();
      if (editor.doc.code.trim() && !confirm('작성한 코드를 지우고 기본 템플릿으로 되돌릴까요?')) return;
      await setTemplate();
      await saveDraft(false);
    });
    btnRun.addEventListener('click', e => { if (e.isTrusted) batchId !== null ? stopBatch() : runSamples(); });
    btnSubmit.addEventListener('click', e => { if (e.isTrusted) submit(); });
    btnClose.addEventListener('click', () => close());
    btnCustom.addEventListener('click', e => { if (e.isTrusted) runCustom(); });
    btnClear.addEventListener('click', () => { termOut.textContent = ''; });
    termIn.addEventListener('keydown', onTermKey);
    where.addEventListener('click', () => {
      if (localReady() || runnerChoice === 'wandbox') return;
      checkRunner(true).then(() => {
        if (runner.state !== 'on') window.open('https://github.com/gaudium1257/Convenient_BOJ#2단계-내-pc에서-실행-진짜-터미널-선택', '_blank');
      });
    });
    [tabResult, tabTerm].forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

    dragResize(resizerX, (e) => {
      const pct = ((innerWidth - e.clientX) / innerWidth) * 100;
      layout.width = Math.round(Math.min(75, Math.max(28, pct)));
      applyLayout();
    });
    dragResize(resizerY, (e) => {
      const rect = panel.getBoundingClientRect();
      layout.bottom = Math.round(Math.min(rect.height - 160, Math.max(110, rect.bottom - e.clientY)));
      applyLayout();
    });

    applySettings(settings);
    termOut.append(line('info', '▶ 실행: 문제의 예제 입력으로 돌려보고 정답과 비교해요. (Ctrl+Enter)'));
    termOut.append(line('info', '아래 칸: 프로그램을 터미널에서 실행하고, 실행 중에 입력을 바로 보낼 수 있어요.'));
    renderRunner();
    checkRunner();
  }

  function dragResize(handle, onMove) {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      document.documentElement.classList.add('cboj-dragging');
      const move = (ev) => onMove(ev);
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('lostpointercapture', up);
        handle.removeEventListener('pointercancel', up);
        document.documentElement.classList.remove('cboj-dragging');
        store.set('local', { cbojLayout: layout });
        editor?.layout();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('lostpointercapture', up);
      handle.addEventListener('pointercancel', up);
    });
  }

  function applyLayout() {
    document.documentElement.style.setProperty('--cboj-w', layout.width + 'vw');
    if (ui) ui.panel.style.setProperty('--cboj-bottom-h', layout.bottom + 'px');
  }

  function showTab(name) {
    for (const t of [ui.tabResult, ui.tabTerm]) t.classList.toggle('active', t.dataset.tab === name);
    ui.paneResult.classList.toggle('active', name === 'result');
    ui.paneTerm.classList.toggle('active', name === 'term');
  }

  function setStatus(text, kind = '') {
    ui.status.textContent = text;
    ui.status.className = 'cboj-status ' + kind;
  }

  function renderLangs() {
    ui.langSel.textContent = '';
    for (const l of langs) ui.langSel.append(h('option', { value: l.id, text: l.name }));
    ui.langSel.value = langId;
  }

  // ───────── 코드 저장 ─────────
  async function saveDraft(notify) {
    if (!editor?.doc || !draftReady) return;
    const key = draftKey(currentInfo().family);
    const generation = editor.generation;
    if (notify) await editor.flush();
    if (generation !== editor.generation) return;
    await store.set('local', { [key]: { ...editor.snapshot(), at: Date.now() } });
    if (notify) setStatus('저장했어요', 'ok');
  }
  async function loadDraft() {
    draftReady = false;
    clearTimeout(saveTimer);
    ui.langSel.disabled = true;
    const info = currentInfo();
    const key = draftKey(info.family);
    const saved = (await store.get('local', { [key]: null }))[key];
    if (saved && typeof saved.code === 'string') {
      await editor.setDocument({ problem: PID, language: info.kind, standard: info.std, code: saved.code, cursor: saved.cursor, scroll: saved.scroll });
    } else {
      if (info.family === 'cpp' && typeof settings.templates?.cpp !== 'string' && runnerChoice === 'auto') await checkRunner();
      await setTemplate();
    }
    draftReady = true;
    ui.langSel.disabled = false;
  }
  function templateFor(family) {
    // 팝업에서 바꾼 기본 코드가 있으면 그걸, 없으면 기본값을 쓴다.
    const custom = settings.templates && settings.templates[family];
    let text = typeof custom === 'string' ? custom : TEMPLATES[family];
    if (family === 'cpp' && typeof custom !== 'string') {
      text = globalThis.cbojCppTemplate(runnerChoice === 'msvc' || selectedCompiler() === 'msvc');
    }
    // 탭 모드면 줄 앞 공백 4칸을 탭 문자로 바꿔 둔다 (백스페이스 한 번에 지워지도록)
    if (useTabs()) text = text.replace(/^ +/gm, (m) => '\t'.repeat(Math.floor(m.length / 4)) + ' '.repeat(m.length % 4));
    return expandTemplate(text);
  }
  function setTemplate() {
    const t = templateFor(currentInfo().family);
    return editor.setDocument({ problem: PID, language: currentInfo().kind, standard: currentInfo().std, code: t.code,
      cursor: t.line == null ? null : { line: t.line, ch: t.ch } });
  }

  // ───────── 터미널 ─────────
  function line(kind, text) {
    return h('div', { class: 'tl ' + kind, text });
  }
  function diagnosticOrigin() {
    return { generation: editor.generation, revision: editor.revision, file: currentInfo().kind === 'cpp' ? 'main.cpp' : 'main.c' };
  }
  function block(title, body, kind = '', origin) {
    const pre = h('pre', { class: 'tb ' + kind, text: body === '' ? '(비어 있음)' : body });
    if (origin) globalThis.cbojCompilerDiagnostics(pre, body, origin, (source, location) => {
      if (editor.generation === source.generation && editor.revision === source.revision) editor.send('reveal', location);
      else setStatus('코드가 변경됐어요. 다시 실행해 주세요.', 'err');
    });
    return h('div', { class: 'tblock' }, h('div', { class: 'tbt', text: title }), pre);
  }
  function termAppend(...nodes) {
    ui.termOut.append(...nodes);
    ui.termOut.scrollTop = ui.termOut.scrollHeight;
  }

  async function execute(stdin, info, code) {
    try {
      return await ext.runtime.sendMessage({ type: 'cboj:run', lang: info, code, stdin, remoteConfirmed: true });
    } catch {
      return { ok: false, error: '확장 프로그램이 업데이트됐어요. 페이지를 새로고침 해주세요.' };
    }
  }

  function commandLine(res, info) {
    if (!res.compiler) return '$ run';
    if (info.kind === 'python') return `$ ${res.compiler} main.py`;
    return `$ ${res.compiler} ${(res.options || []).join(' ')} main.${info.kind === 'c' ? 'c' : 'cpp'}`;
  }

  function showRunFailure(res) {
    if (!res.ok) { termAppend(line('err', '✘ ' + res.error)); return true; }
    if (res.compileError && res.status !== '0' && /\berror\b/.test(res.compileError) && !res.stdout) {
      termAppend(line('err', '✘ 컴파일 에러'), block('컴파일러 메시지', res.compileError.trimEnd(), 'err'));
      return true;
    }
    return false;
  }

  function runtimeNote(res) {
    if (res.signal) return `프로그램이 신호(${res.signal})로 종료됐어요`;
    if (res.status && res.status !== '0') return `종료 코드 ${res.status}`;
    return '';
  }

  // ───────── 내 PC 실행 도우미 (host/cboj_host.py) ─────────
  // 로컬에서 실행할 수 없을 때에는 Wandbox 전송 여부를 사용자에게 묻는다.
  const runner = { port: null, state: 'unknown', info: null, error: '', seq: 0, handlers: new Map(), waiters: [] };

  function runnerPort() {
    if (runner.port) return runner.port;
    try {
      runner.port = ext.runtime.connect({ name: 'cboj-runner' });
    } catch {
      runner.state = 'off';
      return null;
    }
    runner.port.onMessage.addListener(onRunnerMessage);
    const connected = runner.port;
    runner.port.onDisconnect.addListener(() => {
      // 페이지가 뒤로 가기 캐시에 들어가거나 확장이 다시 시작되면 끊긴다. 다음에 쓸 때 새로 연결한다.
      try { void ext.runtime.lastError; } catch { /* 확장이 다시 로드됨 */ }
      if (connected !== runner.port) return;
      runner.port = null;
      runner.state = 'unknown';
      runner.info = null;
      settleRunnerWaiters();
      failRunnerJobs('확장 프로그램과 연결이 끊겼어요. 페이지를 새로고침 해주세요.');
    });
    return runner.port;
  }

  function onRunnerMessage(m) {
    if (!m) return;
    if (m.type === 'info') {
      runner.state = 'on';
      runner.info = m;
      settleRunnerWaiters();
      return;
    }
    if (m.type === 'nohost') {
      runner.state = 'off';
      runner.info = null;
      runner.error = m.error || '';
      settleRunnerWaiters();
      failRunnerJobs('내 PC 실행 도우미와 연결이 끊겼어요.');
      return;
    }
    const handler = runner.handlers.get(m.id);
    if (handler) handler(m);
  }

  function settleRunnerWaiters() {
    clearTimeout(runner.timer);
    const ws = runner.waiters.splice(0);
    ws.forEach((w) => w());
    renderRunner();
  }

  function failRunnerJobs(message) {
    for (const [id, handler] of [...runner.handlers]) handler({ id, type: 'lost', message });
    runner.handlers.clear();
  }

  // 도우미가 있는지 확인한다. force면 다시 확인한다(설치 직후 등).
  function checkRunner(force) {
    if (!force && runner.state !== 'unknown') return Promise.resolve(runner.state === 'on');
    runner.state = 'unknown';
    renderRunner();
    return new Promise((resolve) => {
      runner.waiters.push(() => resolve(runner.state === 'on'));
      if (runner.waiters.length > 1) return;
      const port = runnerPort();
      if (!port) { settleRunnerWaiters(); return; }
      try { port.postMessage({ type: 'info', protocol: 2, id: ++runner.seq }); }
      catch { runner.state = 'off'; settleRunnerWaiters(); return; }
      runner.timer = setTimeout(() => {
        if (runner.state === 'unknown') { runner.state = 'off'; runner.error = '응답 없음'; settleRunnerWaiters(); }
      }, 45000);
    });
  }

  // 지금 언어를 이 PC에서 실행할 수 있는지
  function selectedCompiler() {
    return globalThis.cbojLocalCompiler(runnerChoice, currentInfo(), runner.state === 'on' ? runner.info : null);
  }
  function localReady() { return Boolean(selectedCompiler()); }
  function nativeOptions() {
    if (runner.info?.protocol !== 2) return {};
    return { protocol: 2, compiler: selectedCompiler() === 'msvc' ? 'msvc' : 'gcc' };
  }
  async function executionPlace(epoch) {
    if (epoch !== runEpoch) return 'cancel';
    if (runnerChoice === 'wandbox') return 'remote';
    await checkRunner();
    if (epoch !== runEpoch) return 'cancel';
    if (localReady()) return 'local';
    const reason = runner.info && runner.info.protocol !== 2 && runnerChoice === 'msvc'
      ? 'MSVC를 사용하려면 host/install.bat로 도우미를 업데이트해 주세요.'
      : '선택한 로컬 실행 환경을 사용할 수 없어요. 설치 후 실행 위치를 눌러 다시 확인할 수 있어요.';
    return confirm(reason + '\n이번 실행의 소스 코드와 입력을 온라인 서비스 Wandbox(wandbox.org)에 보낼까요?') ? 'remote' : 'cancel';
  }
  function stopBatch() {
    if (batchId !== null) {
      try { runner.port?.postMessage({ type: 'kill', protocol: 2, id: batchId }); } catch { /* disconnected */ }
    }
  }

  function hostRequest(msg, endType) {
    return new Promise((resolve) => {
      const port = runnerPort();
      if (!port) { resolve({ type: 'lost', message: '도우미에 연결하지 못했어요.' }); return; }
      const id = ++runner.seq;
      if (msg.type === 'batch' && msg.protocol === 2) {
        batchId = id;
        ui.btnRun.disabled = false;
        ui.btnRun.textContent = '■ 중지';
        ui.btnRun.classList.add('stop');
      }
      runner.handlers.set(id, (m) => {
        if (m.type === endType || m.type === 'lost') { runner.handlers.delete(id); resolve(m); }
      });
      try { port.postMessage({ ...msg, id }); }
      catch { runner.handlers.delete(id); resolve({ type: 'lost', message: '도우미에 연결하지 못했어요.' }); }
    });
  }

  function renderRunner() {
    if (!ui) return;
    const w = ui.where;
    const kind = currentInfo().kind;
    let text, cls, title;
    if (runnerChoice === 'wandbox') {
      text = '● Wandbox'; cls = 'remote'; title = '선택한 온라인 서비스에 코드와 입력을 보내요.';
    } else if (runner.state === 'unknown') {
      text = '실행 위치 확인 중…'; cls = ''; title = '';
    } else if (localReady()) {
      const compiler = selectedCompiler();
      const tool = compiler === 'msvc' ? 'MSVC x64 ' + runner.info.msvc : (kind === 'python' ? 'Python ' + runner.info.python : runner.info[kind === 'c' ? 'gcc' : 'gpp']);
      text = '● 내 PC · ' + (compiler === 'msvc' ? 'MSVC' : compiler); cls = 'local';
      title = `내 PC에서 실행해요 (${tool}). 아래 칸에서 터미널처럼 입력을 주고받을 수 있어요.`;
      if (runner.info.protocol !== 2) title += ' 이전 도우미예요. MSVC, 캐시, 터미널 시간 제한은 host/install.bat로 업데이트해 주세요.';
    } else if (runner.state === 'on') {
      text = '● 컴파일러 없음'; cls = 'remote';
      title = '선택한 컴파일러를 사용할 수 없어요. 팝업에서 환경을 바꾸거나 host/install.bat로 도우미를 업데이트해 주세요.';
    } else {
      text = '● Wandbox'; cls = 'remote';
      title = '도우미를 찾지 못했어요. 실행할 때 Wandbox 전송 여부를 물어요. 누르면 다시 확인해요.';
    }
    w.textContent = text;
    w.className = 'cboj-where ' + cls;
    w.title = title;
    if (!live) {
      const local = localReady();
      ui.btnCustom.textContent = local ? '▶ 터미널에서 실행' : '이 입력으로 실행';
      ui.termIn.placeholder = local
        ? '실행 전에 미리 넣을 입력 (비워 두고 실행한 뒤 입력해도 돼요)'
        : '직접 입력할 stdin';
    }
  }

  // ───────── 예제 실행 (입력을 미리 정해 두고 한꺼번에) ─────────
  async function runInputs(inputs, epoch) {
    await editor.flush();
    const info = currentInfo();
    const code = editor.doc.code;
    const origin = diagnosticOrigin();
    const place = await executionPlace(epoch);
    if (place === 'cancel') return { cancelled: true };
    if (place === 'local') {
      const timeLimit = settings.sampleTimeLimit;
      const r = await hostRequest({ type: 'batch', ...nativeOptions(), lang: info, code, inputs, timeLimit }, 'batch-result');
      origin.unit = /\/diagnostics:column|-fdiagnostics-column-unit=byte/.test(r.cmd || '') ? 'utf8' : 'unknown';
      if (r.type === 'lost') return { fatal: r.message };
      if (r.error) {
        if (r.error.code === 'cancelled') return { cancelled: true };
        if (r.error.code === 'compile') return { where: '내 PC', cmd: r.cmd && '$ ' + r.cmd, compileError: r.error.message, origin };
        return { fatal: r.error.message };
      }
      const nl = (s) => String(s || '').replace(/\r\n/g, '\n');
      return {
        where: '내 PC', origin,
        cmd: '$ ' + r.cmd + cacheNote(r),
        warnings: r.warnings,
        results: r.results.map((x) => ({
          stdout: nl(x.stdout),
          stderr: nl(x.stderr),
          ms: x.ms,
          note: x.overLimit ? '출력 한도 초과' : x.timeout ? `시간 초과 (${timeLimit}초)` : (x.code ? `${x.note || '런타임 에러'} (종료 코드 ${x.code})` : ''),
        })),
      };
    }
    // Wandbox: 첫 입력으로 컴파일 에러를 확인하고 나머지는 동시에
    const first = await execute(inputs[0], info, code);
    if (!first.ok) return { fatal: first.error };
    if (first.compileError && first.status !== '0' && /\berror\b/.test(first.compileError) && !first.stdout) {
      return { where: 'Wandbox', cmd: commandLine(first, info), compileError: first.compileError };
    }
    const rest = await Promise.all(inputs.slice(1).map((s) => execute(s, info, code)));
    return {
      where: 'Wandbox',
      cmd: commandLine(first, info),
      warnings: /warning/i.test(first.compileError || '') ? first.compileError : '',
      results: [first, ...rest].map((r) => (r.ok
        ? { stdout: r.stdout, stderr: r.stderr, note: runtimeNote(r) }
        : { stdout: '', stderr: '', note: r.error })),
    };
  }

  async function runSamples() {
    if (running || !draftReady) return;
    running = true;
    const epoch = runEpoch;
    if (live) await stopLive();
    const list = samples();
    if (!list.length) {
      running = false;
      showTab('term');
      termAppend(line('warn', '이 문제에는 예제가 없어요. 아래 칸에서 직접 실행해 주세요.'));
      ui.termIn.focus();
      return;
    }
    ui.btnRun.disabled = true;
    ui.langSel.disabled = true;
    showTab('term');
    saveDraft(false);
    ui.termOut.textContent = '';
    termAppend(line('info', `${currentLang().name} · 예제 ${list.length}개 실행 중…`));
    setStatus('실행 중…', 'busy');

    const out = await runInputs(list.map((s) => s.input), epoch).catch(() => ({ fatal: '실행 결과를 읽지 못했어요. 다시 실행해 주세요.' }));
    if (out.cancelled) {
      termAppend(line('warn', '■ 실행을 취소했어요.'));
      setStatus('중지됨');
    } else if (out.fatal) {
      termAppend(line('err', '✘ ' + out.fatal));
      setStatus('실행 실패', 'err');
    } else if (out.compileError != null) {
      if (out.cmd) termAppend(line('cmd', `${out.cmd}   [${out.where}]`));
      termAppend(line('err', '✘ 컴파일 에러'), block('컴파일러 메시지', out.compileError.trimEnd(), 'err', out.origin));
      setStatus('컴파일 에러', 'err');
    } else {
      termAppend(line('cmd', `${out.cmd}   [${out.where}]`));
      if (out.warnings) termAppend(block('컴파일 경고', out.warnings.trimEnd(), 'dim', out.origin));
      let passed = 0, judged = 0;
      list.forEach((s, i) => {
        const res = out.results[i] || { stdout: '', stderr: '', note: '결과 없음' };
        let verdict, kind;
        if (s.expected == null) { verdict = '출력 확인 필요'; kind = 'warn'; }
        else {
          judged++;
          const ok = !res.note && normalize(res.stdout) === normalize(s.expected);
          if (ok) { passed++; verdict = SPJ ? '맞음 (스페셜 저지: 참고용)' : '맞음'; kind = 'ok'; }
          else { verdict = res.note || '틀림'; kind = 'err'; }
        }
        const time = res.ms != null ? `  (${(res.ms / 1000).toFixed(2)}초)` : '';
        termAppend(line(kind, `${kind === 'ok' ? '✔' : kind === 'err' ? '✘' : '•'} 예제 ${s.n} — ${verdict}${time}`));
        if (kind !== 'ok') {
          termAppend(h('div', { class: 'tgrid' },
            block('입력', s.input.replace(/\n$/, '')),
            s.expected != null ? block('기대 출력', s.expected.replace(/\n$/, '')) : null,
            block('내 출력', res.stdout.replace(/\n$/, ''), kind === 'err' ? 'err' : '')));
        }
        if (res.stderr) termAppend(block('stderr', res.stderr.trimEnd(), 'dim'));
      });
      if (judged) {
        const all = passed === judged;
        termAppend(line(all ? 'ok big' : 'err big', all
          ? `예제 ${judged}개 모두 맞았어요! 🎉`
          : `예제 ${judged}개 중 ${passed}개 맞음`));
        setStatus(all ? '예제 통과' : `예제 ${passed}/${judged}`, all ? 'ok' : 'err');
      } else {
        setStatus('실행 완료', '');
      }
    }
    running = false;
    batchId = null;
    ui.btnRun.disabled = false;
    ui.btnRun.textContent = '▶ 실행';
    ui.btnRun.classList.remove('stop');
    ui.langSel.disabled = false;
  }

  function cacheNote(reply) {
    if (reply.cache === 'hit') return ' · 캐시 재사용';
    return reply.cache === 'miss' ? ' · 새로 컴파일' : '';
  }

  // ───────── 직접 실행 ─────────
  // 내 PC: 진짜 터미널처럼 실행 중에 입력을 주고받는다.  Wandbox: 입력을 한꺼번에 넣고 결과만 받는다.
  let live = null; // { id, pre, pendingEcho }

  async function runCustom() {
    if (live) { stopLive(); return; }
    if (running || !draftReady) return;
    const epoch = runEpoch;
    running = true;
    ui.langSel.disabled = true;
    try {
      await editor.flush();
      const place = await executionPlace(epoch);
      if (place !== 'remote') {
        if (place === 'local') startLive();
        else setStatus('중지됨');
        return;
      }
      showTab('term');
      saveDraft(false);
      const info = currentInfo();
      const stdin = ui.termIn.value;
      termAppend(line('info', `${currentLang().name} · 직접 입력으로 실행 중… [Wandbox]`));
      setStatus('실행 중…', 'busy');
      const res = await execute(stdin, info, editor.doc.code);
      if (!showRunFailure(res)) {
        termAppend(line('cmd', commandLine(res, info)));
        termAppend(block('출력', res.stdout.replace(/\n$/, '')));
        if (res.stderr) termAppend(block('stderr', res.stderr.trimEnd(), 'dim'));
        const note = runtimeNote(res);
        termAppend(line(note ? 'err' : 'dim', note || '정상 종료'));
        setStatus(note ? '런타임 문제' : '실행 완료', note ? 'err' : '');
      } else {
        setStatus('컴파일 에러', 'err');
      }
    } catch (error) {
      setStatus(error.message || '실행 결과를 읽지 못했어요.', 'err');
    } finally {
      running = false;
      ui.langSel.disabled = false;
    }
  }

  function startLive() {
    const port = runnerPort();
    if (!port) return;
    showTab('term');
    saveDraft(false);
    const id = ++runner.seq;
    const initial = ui.termIn.value;
    ui.termIn.value = '';
    live = { id, origin: diagnosticOrigin(), pre: h('pre', { class: 'tlive' }), pendingEcho: initial ? withNewline(initial) : '' };
    live.finished = new Promise(resolve => { live.finish = resolve; });
    termAppend(line('info', `${currentLang().name} · 터미널에서 실행 [내 PC]`));
    setLiveUI(true);
    setStatus('컴파일 중…', 'busy');
    runner.handlers.set(id, onLive);
    try { port.postMessage({ type: 'run', id, ...nativeOptions(), lang: currentInfo(), code: editor.doc.code, stdin: live.pendingEcho, interactive: true, timeLimit: settings.terminalTimeLimit }); }
    catch { onLive({ type: 'lost', id, message: '도우미에 연결하지 못했어요.' }); }
  }

  function withNewline(s) { return s.endsWith('\n') ? s : s + '\n'; }

  function onLive(m) {
    if (!live || m.id !== live.id) return;
    if (m.type === 'compiled') {
      live.origin.unit = /\/diagnostics:column|-fdiagnostics-column-unit=byte/.test(m.cmd || '') ? 'utf8' : 'unknown';
      if (!m.ok) {
        if (m.cmd) termAppend(line('cmd', '$ ' + m.cmd));
        if (m.code === 'nocompiler') termAppend(line('err', `✘ ${m.message} 도우미 설치 스크립트(install.bat)를 다시 실행하면 설치할 수 있어요.`));
        else termAppend(line('err', '✘ 컴파일 에러'), block('컴파일러 메시지', String(m.message || '').trimEnd(), 'err', live.origin));
        return;
      }
      termAppend(line('cmd', '$ ' + m.cmd + cacheNote(m)));
      if (m.warnings) termAppend(block('컴파일 경고', m.warnings.trimEnd(), 'dim', live.origin));
      termAppend(live.pre);
    } else if (m.type === 'start') {
      setStatus('● 실행 중', 'busy');
      if (live.pendingEcho) appendLive(live.pendingEcho, 'in');
      ui.termIn.focus();
    } else if (m.type === 'out') {
      appendLive(String(m.data).replace(/\r\n/g, '\n'), m.stream === 'stderr' ? 'err' : '');
    } else if (m.type === 'error') {
      termAppend(line('err', '✘ ' + m.message));
    } else if (m.type === 'exit' || m.type === 'lost') {
      runner.handlers.delete(m.id);
      if (m.type === 'lost') { termAppend(line('err', '✘ ' + m.message)); setStatus('실행 실패', 'err'); }
      else if (m.compileFailed) setStatus('컴파일 에러', 'err');
      else if (m.timeout) { termAppend(line('err', '■ 실행 시간 제한을 넘었어요.')); setStatus('시간 초과', 'err'); }
      else if (m.overLimit) { termAppend(line('err', '■ 출력이 너무 많아서 중지했어요.')); setStatus('중지됨', 'err'); }
      else if (m.killed) { termAppend(line('warn', '■ 중지했어요.')); setStatus('중지됨', ''); }
      else if (m.code === 0) { termAppend(line('dim', `정상 종료 (${(m.ms / 1000).toFixed(2)}초)`)); setStatus('실행 완료', 'ok'); }
      else { termAppend(line('err', `✘ ${m.note || '런타임 에러'} (종료 코드 ${m.code})`)); setStatus('런타임 에러', 'err'); }
      live.finish();
      live = null;
      setLiveUI(false);
    }
  }

  function appendLive(text, cls) {
    if (!live || !text) return;
    const span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = text;
    live.pre.append(span);
    ui.termOut.scrollTop = ui.termOut.scrollHeight;
  }

  function sendLive(text) {
    if (!live || !runner.port) return;
    liveControl('stdin', { data: text });
    appendLive(text, 'in');
  }

  function liveControl(type, fields = {}) {
    if (!live) return;
    const message = { type, id: live.id, ...fields };
    if (runner.info?.protocol === 2) message.protocol = 2;
    try { runner.port.postMessage(message); }
    catch { onLive({ type: 'lost', id: live.id, message: '도우미 연결이 끊겼어요.' }); }
  }
  function stopLive() {
    const finished = live?.finished;
    liveControl('kill');
    return finished;
  }

  function setLiveUI(on) {
    ui.btnCustom.classList.toggle('stop', on);
    ui.termIn.classList.toggle('live', on);
    if (on) {
      ui.btnCustom.textContent = '■ 중지';
      ui.termIn.placeholder = '입력하고 Enter  ·  Shift+Enter 줄바꿈  ·  Ctrl+C 중지  ·  Ctrl+D 입력 끝';
    } else {
      renderRunner();
    }
  }

  function onTermKey(e) {
    if (!e.isTrusted || e.isComposing || e.keyCode === 229) return;
    if (live) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        const v = ui.termIn.value;
        ui.termIn.value = '';
        sendLive(v + '\n');
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C') && ui.termIn.selectionStart === ui.termIn.selectionEnd) {
        e.preventDefault();
        stopLive();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        if (ui.termIn.value) sendLive(ui.termIn.value);
        ui.termIn.value = '';
        liveControl('eof');
        appendLive('^D\n', 'dim');
      }
      return;
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runCustom(); }
  }

  // ───────── 백준 제출 ─────────
  // 백준은 스크립트 요청(fetch)에 빈 응답을 주고 제출에 reCAPTCHA를 쓰므로,
  // 진짜 제출 페이지를 작은 창으로 열어 코드·언어를 채워 두고 [제출]은 사용자가 직접 누른다.
  // 결과는 그 창의 채점 현황 페이지(content/status.js)가 storage로 알려 준다.
  let submitToken = null;

  function setCard(kind, title, sub, extra) {
    const c = ui.card;
    c.className = 'cboj-card ' + kind;
    c.textContent = '';
    c.append(h('div', { class: 'cboj-card-title', text: title }));
    if (sub) c.append(h('div', { class: 'cboj-card-sub', text: sub }));
    if (extra) c.append(extra);
  }

  function badge(row) {
    return h('span', { class: 'cboj-res ' + (FINAL.includes(row.key) ? row.key : 'pending'), text: row.text || '기다리는 중' });
  }

  async function submit() {
    if (!draftReady) return;
    const generation = editor.generation;
    try { await editor.flush(); }
    catch (error) { setStatus(error.message, 'err'); return; }
    if (!isOpen || !draftReady || generation !== editor.generation) return;
    const code = editor.doc.code;
    showTab('result');
    if (!code.trim()) { setCard('err', '코드가 비어 있어요'); return; }
    if (!me) {
      setCard('err', '로그인이 필요해요', '백준에 로그인한 뒤 다시 제출해주세요.',
        h('a', { class: 'cboj-link', href: `/login?next=${encodeURIComponent(location.pathname)}`, text: '로그인하러 가기 →' }));
      return;
    }
    saveDraft(false);
    const token = Math.random().toString(36).slice(2);
    submitToken = token;
    setCard('pending', '제출 탭을 여는 중…', `${PID}번 · ${currentLang().name}`);
    setStatus('제출 대기', 'busy');
    // 코드를 먼저 저장한 뒤, 백그라운드에 제출 탭(B)을 열어 달라고 한다.
    const pending = { pid: PID, langId: currentLang().id, langName: currentLang().name, code, codeOpen: settings.codeOpen, token, at: Date.now() };
    Promise.resolve(ext.storage.local.set({ cbojPending: pending, cbojJudge: null }))
      .then(() => ext.runtime.sendMessage({ type: 'cboj:open-submit', pid: PID, token, origin: location.origin }))
      .then((res) => {
        if (!res || !res.ok) throw new Error(res && res.error);
      })
      .catch(() => {
        if (submitToken !== token) return;
        setCard('err', '제출 탭을 열지 못했어요', '확장 프로그램이 업데이트됐다면 이 페이지를 새로고침 해주세요.',
          h('a', { class: 'cboj-link', href: `/submit/${PID}`, target: '_blank', text: '제출 페이지 직접 열기 →' }));
        setStatus('제출 실패', 'err');
      });
  }

  function onJudge(j) {
    if (!ui || !j || j.token !== submitToken) return;
    if (j.stage === 'closed' || j.stage === 'cancelled') {
      const statusUrl = `/status?problem_id=${PID}&user_id=${encodeURIComponent(me)}`;
      setCard(j.stage === 'closed' ? 'pending' : 'empty',
        j.stage === 'closed' ? '채점이 끝나기 전에 제출 탭이 닫혔어요' : '제출 탭을 닫았어요',
        j.stage === 'closed' ? '결과는 제출 기록에서 확인할 수 있어요.' : '제출하지 않았어요.',
        j.stage === 'closed' ? h('a', { class: 'cboj-link', href: statusUrl, target: '_blank', text: '제출 기록 열기 →' }) : null);
      setStatus(j.stage === 'closed' ? '결과 확인 필요' : '', j.stage === 'closed' ? 'busy' : '');
      return;
    }
    if (j.stage === 'filled') {
      const warn = j.langOk ? null
        : h('div', { class: 'cboj-card-sub warn', text: `⚠ 제출 페이지 언어 목록에 ${j.langName || '선택한 언어'}가 없어요. 제출 탭에서 언어를 직접 골라주세요.` });
      setCard('pending', '제출 탭에서 [제출]을 눌러주세요',
        '코드와 언어를 채워 두었어요. 백준의 보안 확인(reCAPTCHA) 때문에 마지막 제출 버튼은 직접 눌러야 해요.', warn);
      setStatus('제출 대기', 'busy');
      return;
    }
    const done = j.stage === 'done';
    setCard(done ? j.key : 'pending', '', '');
    ui.card.firstChild.replaceWith(h('div', { class: 'cboj-card-title' }, badge(j)));
    ui.card.append(h('div', { class: 'cboj-card-meta' },
      j.id ? h('span', { text: `#${j.id}` }) : null,
      j.memory ? h('span', { text: `메모리 ${j.memory}` }) : null,
      j.time ? h('span', { text: `시간 ${j.time}` }) : null,
      j.id ? h('a', { href: `/source/${j.id}`, target: '_blank', text: '코드 보기' }) : null));
    setStatus(done ? j.text : '채점 중…', done ? (j.key === 'ac' ? 'ok' : 'err') : 'busy');
  }

  try {
    ext.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.cbojJudge) onJudge(changes.cbojJudge.newValue);
      if (area === 'local' && changes.cbojLangs && ui) adoptLanguages(changes.cbojLangs.newValue);
    });
  } catch { /* 무시 */ }

  // 제출 페이지에서 본 언어 목록(사용자가 백준에서 고른 언어들)을 쓴다.
  function adoptLanguages(list) {
    const found = (list || []).filter((l) => l && l.id !== '' && langInfo(l.name));
    if (!found.length) return;
    const prevName = langs.length ? currentLang().name : null;
    const order = (l) => ['cpp', 'c', 'py'].indexOf(langInfo(l.name).family);
    langs = found.sort((a, b) => order(a) - order(b));
    const same = langs.find((l) => l.name === prevName) || langs.find((l) => l.id === langId) || langs[0];
    langId = same.id;
    if (ui) renderLangs();
  }

  // ───────── 열고 닫기 ─────────
  let isOpen = false;
  let initializing;
  async function initializePanel() {
    const saved = await store.get('local', { cbojLayout: layout, runnerChoice: 'auto', cbojLangs: null });
    runnerChoice = saved.runnerChoice;
    layout = { ...layout, ...saved.cbojLayout };
    build();
    ui.panel.hidden = !isOpen;
    applyLayout();
    if (saved.cbojLangs) adoptLanguages(saved.cbojLangs);
    const last = await store.get('sync', { lastLangId: null, lastLangName: null });
    langId = (langs.find((l) => l.id === last.lastLangId) || langs.find((l) => l.name === last.lastLangName) || langs[0]).id;
    renderLangs();
    await loadDraft();
  }
  async function open() {
    if (isOpen) return;
    isOpen = true;
    document.documentElement.classList.add('cboj-open');
    if (!initializing) initializing = initializePanel();
    await initializing;
    if (!isOpen) return;
    ui.panel.hidden = false;
    applyLayout();
    toggleBtn.classList.add('active');
    try { await editor.resume(); }
    catch (error) { setStatus(error.message, 'err'); }
  }
  function close() {
    if (!isOpen) return;
    isOpen = false;
    runEpoch++;
    if (editor) editor.suspend().then(() => saveDraft(false)).catch(() => {});
    if (live) stopLive();
    if (batchId !== null) stopBatch();
    document.documentElement.classList.remove('cboj-open');
    if (ui) ui.panel.hidden = true;
    toggleBtn.classList.remove('active');
  }
  const toggle = () => (isOpen ? close() : open());

  // 문제 제목 옆 버튼 + 오른쪽 가장자리 손잡이
  const toggleBtn = h('button', { type: 'button', class: 'btn btn-primary cboj-toggle', title: '코드 작성 화면 열기/닫기 (Alt+C)', text: '⇆ 코드 작성' });
  toggleBtn.addEventListener('click', toggle);
  const group = $('.problem-button');
  if (group) group.prepend(toggleBtn);
  else {
    toggleBtn.classList.add('floating');
    document.body.appendChild(toggleBtn);
  }

  document.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'c' || e.key === 'C' || e.code === 'KeyC')) {
      e.preventDefault();
      toggle();
    }
  });
  addEventListener('resize', () => { if (isOpen) applyLayout(); });
  addEventListener('pagehide', () => {
    clearTimeout(saveTimer);
    // The frame owns the last keystroke and saves it during its own pagehide.
    // Let Chrome unload it along with the tab.
  });
  addEventListener('pageshow', async e => {
    if (!e.persisted || !editor) return;
    editor.detach();
    if (isOpen) {
      try { await loadDraft(); if (isOpen) await editor.resume(); }
      catch (error) { setStatus(error.message, 'err'); }
    }
  });

  ext.runtime.onMessage.addListener((msg, sender, reply) => {
    if (msg?.type !== 'cboj:backup-draft' || !['keys', 'snapshot'].includes(msg.mode)
        || sender.id !== ext.runtime.id || sender.url !== ext.runtime.getURL('popup/popup.html')) return;
    if (!initializing) { reply(null); return; }
    if (!editor?.doc || !draftReady) { reply({ busy: true }); return; }
    const generation = editor.generation, key = draftKey(currentInfo().family);
    if (msg.mode === 'keys') { reply({ key }); return; }
    editor.flush().then(() => reply(generation === editor.generation && draftReady
      ? { key, value: { ...editor.snapshot(), at: Date.now() } } : { busy: true }), () => reply({ busy: true }));
    return true;
  });

  // ───────── 설정 ─────────
  function applySettings(s) {
    settings = { ...DEFAULTS, ...s, ...CBOJ_POLISH.read(s) };
    editor?.configure({ ...CBOJ_POLISH.read(settings), theme: settings.editorTheme, spaces: !useTabs(), minimap: !!settings.editorMinimap });
    if (ui) CBOJ_POLISH.paint(ui.panel, settings.editorTheme);
  }
  store.get('sync', DEFAULTS).then((s) => {
    applySettings(s);
    if (settings.splitAutoOpen) open().then(() => applySettings(settings));
  });
  try {
    ext.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.runnerChoice) {
        runEpoch++;
        runnerChoice = changes.runnerChoice.newValue || 'auto';
        renderRunner();
      }
      if (area !== 'sync') return;
      const s = { ...settings };
      for (const k in changes) s[k] = changes[k].newValue;
      applySettings(s);
    });
  } catch { /* 무시 */ }
})();
