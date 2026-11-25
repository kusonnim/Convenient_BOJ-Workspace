// Convenient BOJ — 팝업 설정 화면
(() => {
  'use strict';
  const ext = globalThis.chrome;
  const DEFAULTS = globalThis.CBOJ_DEFAULTS;
  const TEMPLATES = globalThis.CBOJ_TEMPLATES;
  let s = { ...DEFAULTS };
  let hostInfo = null;
  const runnerChoice = document.getElementById('runnerChoice');
  ext.storage.local.get({ runnerChoice: 'auto' }, (v) => { runnerChoice.value = v.runnerChoice; refreshDefault(); });
  runnerChoice.addEventListener('change', () => {
    ext.storage.local.set({ runnerChoice: runnerChoice.value });
    refreshDefault();
  });

  function save(patch) {
    Object.assign(s, patch);
    ext.storage.sync.set(patch);
    render();
  }

  function render() {
    document.querySelectorAll('.seg[data-key]').forEach((seg) => {
      seg.querySelectorAll('button').forEach((b) => {
        b.setAttribute('aria-pressed', String(b.dataset.v === String(s[seg.dataset.key])));
      });
    });
    document.querySelectorAll('.toggle input').forEach((inp) => { inp.checked = !!s[inp.dataset.key]; });
    document.querySelectorAll('select.pick[data-key]').forEach((sel) => { sel.value = s[sel.dataset.key]; });
  }

  document.querySelectorAll('.seg[data-key]').forEach((seg) => {
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) save({ [seg.dataset.key]: b.dataset.v });
    });
  });
  document.querySelectorAll('.toggle input').forEach((inp) => {
    inp.addEventListener('change', () => save({ [inp.dataset.key]: inp.checked }));
  });
  document.querySelectorAll('select.pick[data-key]').forEach((sel) => {
    sel.addEventListener('change', () => save({ [sel.dataset.key]: sel.value }));
  });

  // ───────── 기본 코드 ─────────
  const tplLang = document.getElementById('tplLang');
  const tplText = document.getElementById('tplText');
  const tplState = document.getElementById('tplState');
  let lang = 'cpp';
  function defaultTemplate(family) {
    if (family !== 'cpp') return TEMPLATES[family];
    const compiler = globalThis.cbojLocalCompiler(runnerChoice.value, { kind: 'cpp', std: 'gnu++17' }, hostInfo);
    return globalThis.cbojCppTemplate(compiler === 'msvc');
  }
  function refreshDefault() {
    if (!tplState.classList.contains('dirty') && !tplState.classList.contains('error')) showTemplate();
  }

  const currentTemplate = (l) => {
    const custom = s.templates && s.templates[l];
    return typeof custom === 'string' ? custom : defaultTemplate(l);
  };
  const isCustom = (l) => typeof s.templates?.[l] === 'string';

  function showState(kind, message) {
    tplState.className = 'tpl-state ' + (kind || '');
    tplState.textContent = message
      || (kind === 'dirty' ? '저장 안 됨' : kind === 'saved' ? '저장했어요' : (isCustom(lang) ? '내가 바꾼 코드' : '기본값'));
  }

  // 크롬 동기화 저장소는 항목 하나에 8KB(키 이름 + JSON 길이)까지만 들어간다.
  const SYNC_ITEM_LIMIT = 8192;
  const syncItemBytes = (key, value) => new TextEncoder().encode(key + JSON.stringify(value)).length;

  function showTemplate() {
    tplLang.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    tplText.value = currentTemplate(lang);
    showState();
  }

  // 저장에 성공하면 true. 실패하면 이유를 보여 주고 이전 상태를 유지한다.
  async function saveTemplate(text) {
    const templates = { ...(s.templates || {}) };
    if (text === defaultTemplate(lang)) delete templates[lang];
    else templates[lang] = text;

    const bytes = syncItemBytes('templates', templates);
    if (bytes > SYNC_ITEM_LIMIT) {
      const kb = (n) => (n / 1024).toFixed(1);
      showState('error', `너무 길어서 저장하지 못했어요 (세 언어 합계 ${kb(bytes)}KB / 최대 8KB)`);
      return false;
    }
    try {
      await ext.storage.sync.set({ templates });
    } catch (e) {
      showState('error', '저장하지 못했어요: ' + ((e && e.message) || '알 수 없는 오류'));
      return false;
    }
    s.templates = templates;
    return true;
  }

  tplLang.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.dataset.lang === lang) return;
    const unsaved = tplState.classList.contains('dirty') || tplState.classList.contains('error');
    if (unsaved && !confirm('저장하지 않은 기본 코드가 있어요. 그래도 다른 언어로 넘어갈까요?')) return;
    lang = b.dataset.lang;
    showTemplate();
  });
  tplText.addEventListener('input', () => showState(tplText.value === currentTemplate(lang) ? '' : 'dirty'));
  tplText.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey) { // 탭 키는 공백 4칸
      e.preventDefault();
      tplText.setRangeText('    ', tplText.selectionStart, tplText.selectionEnd, 'end');
      tplText.dispatchEvent(new Event('input'));
    } else if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      document.getElementById('tplSave').click();
    }
  });
  document.getElementById('tplSave').addEventListener('click', async () => {
    if (await saveTemplate(tplText.value)) showState('saved');
  });
  document.getElementById('tplReset').addEventListener('click', async () => {
    tplText.value = defaultTemplate(lang);
    if (await saveTemplate(tplText.value)) showState('saved');
  });

  // ───────── 실행 위치 (내 PC 실행 도우미) ─────────
  const runnerState = document.getElementById('runnerState');
  const GUIDE = 'https://github.com/gaudium1257/Convenient_BOJ#2단계-내-pc에서-실행-진짜-터미널-선택';
  function showRunner(info) {
    hostInfo = info;
    refreshDefault();
    runnerState.textContent = '';
    if (info) {
      const parts = [`Python ${info.python}`];
      if (info.msvc) parts.push('MSVC x64 ' + info.msvc);
      if (info.gcc) parts.push('GCC');
      if (info.gpp) parts.push('G++');
      if (!info.msvc && !info.gcc && !info.gpp) parts.push('C/C++ 컴파일러 없음');
      if (info.protocol !== 2) parts.push('이전 도우미 · MSVC는 host/install.bat 재실행');
      runnerState.className = 'runner-state on';
      runnerState.append('● 내 PC', Object.assign(document.createElement('small'), { textContent: parts.join(' · ') }));
    } else {
      runnerState.className = 'runner-state off';
      const a = Object.assign(document.createElement('a'), { href: GUIDE, target: '_blank', textContent: '설치 방법' });
      runnerState.append('도우미 없음', a);
    }
  }
  try {
    ext.runtime.sendNativeMessage('com.convenient_boj.runner', { type: 'info', protocol: 2 }, (res) => {
      showRunner(!ext.runtime.lastError && res && res.type === 'info' ? res : null);
    });
  } catch { showRunner(null); }

  if (ext) ext.storage.sync.get(DEFAULTS, (v) => { s = { ...DEFAULTS, ...v }; render(); showTemplate(); });
  render();
  showTemplate();
})();
