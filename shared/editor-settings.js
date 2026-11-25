(() => {
  const defaults = Object.freeze({
    editorFontFamily: '"D2Coding", "Cascadia Code", Consolas, monospace',
    editorFontSize: 14, editorLineHeight: 22, editorWrap: false,
    editorSticky: true, editorBrackets: true, editorOccurrences: true, editorBreadcrumbs: true,
    sampleTimeLimit: 10, terminalTimeLimit: 120,
  });
  const bounds = { editorFontSize: [10, 32], editorLineHeight: [12, 56], sampleTimeLimit: [1, 300], terminalTimeLimit: [1, 300] };
  function valid(key, value) {
    if (key === 'editorFontFamily') return typeof value === 'string' && value.trim().length > 0 && value.length <= 160
      && !/[^\p{L}\p{N} ,.'"_()-]/u.test(value);
    if (Object.hasOwn(bounds, key)) {
      const [min, max] = bounds[key];
      return Number.isInteger(value) && value >= min && value <= max;
    }
    return Object.hasOwn(defaults, key) && typeof value === 'boolean';
  }
  function read(raw) {
    return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, valid(key, raw[key]) ? raw[key] : value]));
  }
  function paint(node, id) {
    const p = Object.hasOwn(CBOJ_PALETTES, id) ? CBOJ_PALETTES[id] : CBOJ_PALETTES.light;
    node.classList.toggle('dark', p.dark);
    node.dataset.theme = p.dark ? 'dark' : 'light';
    node.style.colorScheme = p.dark ? 'dark' : 'light';
    const values = { bg: p.base, ink: p.ink, bg2: p.surface, line: p.border, blue: p.accent,
      green: p.green, amber: p.amber, red: p.red, 'term-bg': p.base, 'term-ink': p.ink,
      'success-ink': p.green, muted: 'color-mix(in srgb, ' + p.ink + ' 75%, ' + p.surface + ')' };
    for (const [key, value] of Object.entries(values)) node.style.setProperty('--' + key, value);
  }
  globalThis.CBOJ_POLISH = Object.freeze({ defaults, bounds, read, valid, paint });
})();
