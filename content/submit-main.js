// Convenient BOJ — 제출 페이지 (페이지 world)
// 백준 제출 페이지의 CodeMirror·언어 선택(chosen)은 페이지 쪽 객체라서 여기서 값을 넣는다.
// content/submit.js가 postMessage로 보낸 코드를 채우기만 하고, [제출]은 누르지 않는다.
(() => {
  if (window.__cbojSubmitMain) return;
  window.__cbojSubmitMain = true;

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.cboj !== 'fill' || typeof d.code !== 'string' || !/^\d{1,8}$/.test(d.langId)
        || typeof d.langName !== 'string' || !['default', 'open', 'close', 'onlyaccepted'].includes(d.codeOpen)) return;
    const res = { cboj: 'filled', ok: false, langOk: false };
    try {
      const S = CBOJ_SUBMIT_SELECTORS, form = document.querySelector(S.form) || document;
      // 언어를 먼저 바꾼다(언어를 바꾸면 백준이 에디터 내용을 바꿀 수 있어서).
      const sel = form.querySelector(S.language);
      const matches = sel ? [...sel.options].filter(o => o.value && (!d.langName || o.textContent.trim() === d.langName)) : [];
      const option = matches.find(o => o.value === String(d.langId)) || (d.langName && matches.length === 1 && matches[0]);
      if (option) {
        if (sel.value !== option.value) {
          sel.value = option.value;
          if (window.jQuery) window.jQuery(sel).trigger('chosen:updated').trigger('change');
          else sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        res.langOk = true;
      }
      if (d.codeOpen && d.codeOpen !== 'default') {
        const r = [...form.querySelectorAll(S.codeOpen)].find(input => input.value === d.codeOpen);
        if (r) r.checked = true;
      }
      const cmEl = form.querySelector(S.editor);
      if (cmEl && cmEl.CodeMirror) {
        cmEl.CodeMirror.setValue(d.code);
        res.ok = true;
      } else {
        const ta = form.querySelector(S.source);
        if (ta) { ta.value = d.code; res.ok = true; }
      }
    } catch (err) {
      res.error = String(err);
    }
    window.postMessage(res, location.origin);
  });
})();
