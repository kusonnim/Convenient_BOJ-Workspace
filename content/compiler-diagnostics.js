(() => {
  // Link only a location on the compiled draft. Header paths, source excerpts,
  // linker messages and program output remain plain text.
  function render(pre, raw, origin, jump) {
    if (!origin) return;
    const parts = document.createDocumentFragment();
    for (const [index, line] of raw.split('\n').entries()) {
      if (index) parts.append('\n');
      const match = /^(?:\.([\\/]))?(main\.(?:cpp|c))(?::(\d+):(\d+)|\((\d+)(?:,(\d+))?\))(?=\s*:)/i.exec(line);
      if (!match || match[2].toLowerCase() !== origin.file) { parts.append(line); continue; }
      const location = { line: Number(match[3] || match[5]), column: Number(match[4] || match[6] || 1), unit: origin.unit };
      if (!Number.isSafeInteger(location.line) || !Number.isSafeInteger(location.column) || location.line < 1 || location.column < 1) {
        parts.append(line); continue;
      }
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'cboj-diagnostic'; button.textContent = match[0];
      button.title = '편집기에서 열기';
      button.addEventListener('click', e => { if (e.isTrusted) jump(origin, location); });
      parts.append(button, line.slice(match[0].length));
    }
    pre.replaceChildren(parts);
  }
  globalThis.cbojCompilerDiagnostics = render;
})();
