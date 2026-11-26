// Convenient BOJ — 제출 페이지 (확장 world)
// 1) 사용자가 백준에서 고른 언어 목록을 저장해 분할 화면 언어 목록에 쓴다.
// 2) 분할 화면의 [제출]로 열린 창이면, 작성한 코드·언어를 채우고 [제출] 버튼을 안내한다.
(() => {
  const m = /^\/submit\/(\d+)/.exec(location.pathname);
  if (!m || globalThis.__cbojSubmitLoaded) return;
  globalThis.__cbojSubmitLoaded = true;
  const PID = m[1];
  const ext = globalThis.chrome;
  const S = CBOJ_SUBMIT_SELECTORS;

  const sel = (document.querySelector(S.form) || document).querySelector(S.language);
  if (sel) {
    const langs = [...sel.options].filter((o) => o.value !== '').map((o) => ({ id: o.value, name: o.textContent.trim() }));
    if (langs.length) ext.storage.local.set({ cbojLangs: langs });
  }

  function banner(kind, text) {
    let el = document.getElementById('cboj-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cboj-banner';
      el.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483000;' +
        'padding:10px 16px;border-radius:10px;font:600 14px/1.4 "Malgun Gothic","Apple SD Gothic Neo",sans-serif;' +
        'box-shadow:0 6px 20px rgba(0,0,0,.18);max-width:90vw;text-align:center;';
      document.body.appendChild(el);
    }
    el.style.background = kind === 'warn' ? '#FFF4E0' : '#E8F4FD';
    el.style.color = kind === 'warn' ? '#8A4B00' : '#0B4F80';
    el.style.border = '1px solid ' + (kind === 'warn' ? '#F5C27A' : '#9CCBF0');
    el.textContent = text;
  }

  function submitButton() {
    const form = document.querySelector(S.form) || document;
    return [...form.querySelectorAll(S.buttons)]
      .find((b) => b.offsetParent !== null && /제출/.test(b.textContent || b.value || ''));
  }

  function fill(p) {
    let done = false;
    const onMsg = (e) => {
      if (e.source !== window || e.origin !== location.origin || !e.data || e.data.cboj !== 'filled' || done) return;
      done = true;
      cleanup();
      const r = e.data;
      ext.runtime.sendMessage({ type: 'cboj:filled', langOk: r.langOk === true }).catch(() => {});
      if (!r.ok) { banner('warn', 'Convenient BOJ: 코드를 넣지 못했어요. 클립보드에 복사해 두었으니 붙여넣어 주세요.'); navigator.clipboard?.writeText(p.code).catch(() => {}); return; }
      banner(r.langOk ? 'info' : 'warn', r.langOk
        ? 'Convenient BOJ: 코드를 채워 두었어요. 아래 [제출] 버튼을 눌러주세요. 결과는 분할 화면에 표시돼요.'
        : `Convenient BOJ: 코드는 채웠지만 ${p.langName} 언어가 목록에 없어요. 언어를 직접 고른 뒤 [제출]을 눌러주세요.`);
      const btn = submitButton();
      if (btn) {
        btn.scrollIntoView({ block: 'center' });
        btn.style.boxShadow = '0 0 0 4px rgba(0,118,192,.35)';
        btn.focus({ preventScroll: true });
      }
    };
    addEventListener('message', onMsg);
    const send = () => window.postMessage({ cboj: 'fill', code: p.code, langId: p.langId, langName: p.langName || '', codeOpen: p.codeOpen || 'default' }, location.origin);
    const timer = setInterval(send, 300);
    const deadline = setTimeout(cleanup, 6000);
    function cleanup() {
      clearInterval(timer); clearTimeout(deadline);
      removeEventListener('message', onMsg);
      removeEventListener('pagehide', cleanup);
    }
    addEventListener('pagehide', cleanup, { once: true });
    send();
  }

  // 분할 화면이 연 제출 탭(B)인지 백그라운드에 확인하고, 2분 안에 만든 제출 요청만 채운다.
  ext.runtime.sendMessage({ type: 'cboj:claim-submit' })
    .then(reply => { if (reply?.pending) fill(reply.pending); }).catch(() => {});
})();
