import { languages } from '../vendor/monaco/editor.js';

const host = 'com.convenient_boj.runner';
export function formatting(view, model) {
  const status = document.getElementById('format-status');
  let timer, pending = false, disposed = false;
  function message(text) {
    if (disposed) return;
    clearTimeout(timer);
    status.textContent = text; status.hidden = false;
    timer = setTimeout(() => { status.hidden = true; }, 5500);
  }
  const selector = { language: model.getLanguageId(), scheme: model.uri.scheme, pattern: model.uri.path };
  const provider = languages.registerDocumentFormattingEditProvider(selector, {
    displayName: 'clang-format',
    async provideDocumentFormattingEdits(doc, options, token) {
      if (pending || view.inComposition || disposed) return [];
      const version = doc.getVersionId();
      const stale = () => disposed || token.isCancellationRequested || view.inComposition || doc.getVersionId() !== version;
      pending = true;
      try {
        const code = doc.getValue();
        if (code.length > 524288 || new TextEncoder().encode(code).length > 524288) {
          message('clang-format · 512 KiB 이하의 코드만 정렬할 수 있어요.'); return [];
        }
        const info = await chrome.runtime.sendNativeMessage(host, { type: 'format-info' });
        if (stale()) return [];
        if (info?.type !== 'format-info' || info.version !== 1) { message('서식 지정 · PC 도우미 업데이트 필요'); return []; }
        if (!info.available) { message('clang-format 설치 필요 · LLVM 또는 Visual Studio C++ 도구를 확인해 주세요.'); return []; }
        const r = await chrome.runtime.sendNativeMessage(host, { type: 'format', language: doc.getLanguageId(), code, tabs: !options.insertSpaces });
        if (stale()) return [];
        if (r?.type !== 'format-result' || typeof r.code !== 'string') { message('clang-format · 서식 지정 실패'); return []; }
        return r.code === code ? [] : [{ range: doc.getFullModelRange(), text: r.code }];
      } catch {
        if (!stale()) message('서식 지정 · PC 도우미 연결 필요');
        return [];
      } finally { pending = false; }
    },
  });
  return { dispose() { disposed = true; clearTimeout(timer); status.hidden = true; provider.dispose(); } };
}
