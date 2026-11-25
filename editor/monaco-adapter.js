import { editor, languages, Uri, cpp, python } from '../vendor/monaco/editor.js';
import { CppAnalysis } from './cpp-analysis.js';
import { Breadcrumbs } from './breadcrumbs.js';
import { formatting } from './formatting.js';
import { definitions } from '../vendor/themes/definitions.js';
const registeredThemes = new Set();

// Workers are created in this extension document's origin, with the default MV3 CSP.
globalThis.MonacoEnvironment = {
  getWorker: () => new Worker(new URL('../vendor/monaco/editor.worker.js', import.meta.url), { type: 'module', name: 'cboj-editor' }),
};

const cKeywords = 'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while _Alignas _Alignof _Atomic _Bool _Complex _Generic _Imaginary _Noreturn _Static_assert _Thread_local'.split(' ');
for (const [id, grammar] of [['cpp', cpp], ['c', cpp], ['python', python]]) {
  languages.register({ id });
  languages.setMonarchTokensProvider(id, id === 'c' ? { ...grammar.language, keywords: cKeywords } : grammar.language);
  const configuration = { ...grammar.conf };
  const pairRules = [['{', '}'], ['[', ']'], ['(', ')']].map(([a, b]) => ({
    beforeText: new RegExp('\\' + a + '\\s*$'), afterText: new RegExp('^\\s*\\' + b),
    action: { indentAction: languages.IndentAction.IndentOutdent },
  }));
  configuration.onEnterRules = [...pairRules, ...(configuration.onEnterRules || [])];
  if (id === 'python') {
    configuration.onEnterRules = [...pairRules,
      { beforeText: /^\s*(?:def|class|for|if|elif|else|while|try|with|finally|except|async|match|case)\b.*:\s*(?:#.*)?$|[([{]\s*(?:#.*)?$/, action: { indentAction: languages.IndentAction.Indent } },
      { beforeText: /^\s*(?:pass|break|continue|raise\b.*|return\b.*)\s*(?:#.*)?$/, action: { indentAction: languages.IndentAction.Outdent } },
    ];
  } else {
    configuration.indentationRules = { increaseIndentPattern: /^.*(?:\{[^}"']*|\([^)"']*)$/, decreaseIndentPattern: /^\s*[})]/ };
  }
  languages.setLanguageConfiguration(id, configuration);
  const words = id === 'c' ? cKeywords : grammar.language.keywords;
  languages.registerCompletionItemProvider(id, {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
      const prefix = word.word.toLowerCase();
      const matches = words.filter(label => label.toLowerCase().startsWith(prefix));
      return { suggestions: matches.map(label => ({ label, kind: languages.CompletionItemKind.Keyword, insertText: label, range })) };
    },
  });
}

export class MonacoWorkspace {
  constructor(container, notify) {
    this.container = container;
    this.notify = notify;
  }

  open(doc, settings, resume) {
    this.suspend();
    this.doc = doc;
    const name = { cpp: 'main.cpp', c: 'main.c', python: 'main.py' }[doc.language];
    // A stable, virtual file URI gives Monaco model identity and bounded undo
    // restoration across collapse. It is never opened on the filesystem.
    const uri = Uri.from({ scheme: 'file', path: '/ConvenientBOJ/' + doc.problem + '/' + name });
    const model = this.model = editor.createModel(doc.code, doc.language, uri);
    const eol = doc.code.includes('\r\n') ? editor.EndOfLineSequence.CRLF : editor.EndOfLineSequence.LF;
    model.setEOL(eol);
    this.initialVersion = model.getAlternativeVersionId();
    const normalizedLegacyText = /\r(?!\n)|^\uFEFF/.test(doc.code) || (doc.code.includes('\r\n') && /(?<!\r)\n/.test(doc.code));
    this.view = editor.create(this.container, {
      model, theme: settings.theme === 'dark' ? 'vs-dark' : 'vs', automaticLayout: true,
      ariaLabel: '코드 편집기', fontFamily: '"D2Coding", "Cascadia Code", Consolas, monospace',
      fontSize: 14, lineHeight: 22, lineNumbersMinChars: 3, glyphMargin: false,
      minimap: { enabled: settings.minimap }, padding: { top: 5 }, scrollBeyondLastLine: false,
      detectIndentation: false, tabSize: 4, insertSpaces: settings.spaces, autoIndent: 'full', renderWhitespace: 'boundary',
      autoIndentOnPaste: false, formatOnPaste: false,
      dragAndDrop: true, columnSelection: false, multiCursorModifier: 'alt', folding: true,
      wordBasedSuggestions: 'currentDocument', acceptSuggestionOnEnter: 'smart', links: false,
      automaticHighContrastDetection: false, lightbulb: { enabled: 'off' },
    });
    this.configure(settings);
    if (resume && this.savedView) this.view.restoreViewState(this.savedView);
    else {
      const pos = doc.cursor && Number.isInteger(doc.cursor.line) && doc.cursor.line >= 0 && doc.cursor.line < model.getLineCount()
        ? { lineNumber: doc.cursor.line + 1, column: Number.isInteger(doc.cursor.ch) ? Math.max(1, doc.cursor.ch + 1) : 1 }
        : model.getPositionAt(model.getValueLength());
      const cursor = model.validatePosition(pos);
      this.view.setPosition(cursor);
      if (Number.isFinite(doc.scroll?.top) && Number.isFinite(doc.scroll.left)) this.view.setScrollPosition({ scrollTop: doc.scroll.top, scrollLeft: doc.scroll.left });
      else this.view.revealPositionInCenterIfOutsideViewport(cursor);
    }
    this.listeners = [
      model.onDidChangeContent(e => {
        // Offsets are UTF-16. Preserve a legacy mixed-EOL/BOM draft exactly until edited.
        if (e.isFlush || e.isEolChange || normalizedLegacyText) {
          this.notify({ type: 'snapshot', state: this.snapshot() });
        } else {
          this.notify({ type: 'edit', changes: e.changes.map(c => ({ at: c.rangeOffset, count: c.rangeLength, text: c.text })) });
        }
      }),
      this.view.onDidChangeCursorSelection(() => this.notify({ type: 'view', ...this.position() })),
      this.view.onDidScrollChange(() => this.notify({ type: 'view', ...this.position() })),
    ];
    if (doc.language === 'cpp') this.analysis = new CppAnalysis(model, this.view, doc.standard, this.notify, () => this.crumbs?.refresh());
    if (doc.language !== 'python') this.listeners.push(formatting(this.view, model));
    this.view.focus();
    return this.snapshot();
  }

  configure(settings) {
    if (!this.view) return;
    const id = Object.hasOwn(definitions, settings.theme) ? settings.theme : 'light';
    if (!registeredThemes.has(id)) {
      editor.defineTheme('cboj-' + id, definitions[id]);
      registeredThemes.add(id);
    }
    editor.setTheme('cboj-' + id);
    CBOJ_POLISH.paint(document.body, id);
    this.model.updateOptions({ tabSize: 4, insertSpaces: settings.spaces });
    this.settings = CBOJ_POLISH.read(settings);
    const s = this.settings;
    this.view.updateOptions({
      minimap: { enabled: settings.minimap }, fontFamily: s.editorFontFamily, fontSize: s.editorFontSize, lineHeight: s.editorLineHeight,
      stickyScroll: { enabled: s.editorSticky, maxLineCount: 3, defaultModel: 'indentationModel' },
      bracketPairColorization: { enabled: s.editorBrackets },
      guides: { bracketPairs: s.editorBrackets, highlightActiveBracketPair: s.editorBrackets, bracketPairsHorizontal: s.editorBrackets ? 'active' : false },
      wordWrap: s.editorWrap ? 'on' : 'off', occurrencesHighlight: s.editorOccurrences ? 'singleFile' : 'off',
    });
    if (s.editorBreadcrumbs && !this.crumbs) this.crumbs = new Breadcrumbs(this.view, this.doc.language, () => this.analysis);
    if (!s.editorBreadcrumbs && this.crumbs) { this.crumbs.dispose(); this.crumbs = null; }
  }

  position() {
    const p = this.view.getPosition();
    return { cursor: { line: p.lineNumber - 1, ch: p.column - 1 },
      scroll: { top: this.view.getScrollTop(), left: this.view.getScrollLeft() } };
  }

  snapshot() {
    if (!this.view) return;
    const code = this.model.getAlternativeVersionId() === this.initialVersion ? this.doc.code : this.model.getValue(undefined, true);
    return { code, ...this.position() };
  }

  suspend() {
    if (!this.view) return;
    const state = this.snapshot();
    this.savedView = this.view.saveViewState();
    this.crumbs?.dispose();
    this.crumbs = null;
    this.analysis?.dispose();
    this.analysis = null;
    for (const listener of this.listeners) listener.dispose();
    this.view.dispose();
    this.model.dispose();
    this.model = this.view = null;
    return state;
  }
}
