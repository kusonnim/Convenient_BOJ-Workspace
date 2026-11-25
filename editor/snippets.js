import { languages } from '../vendor/monaco/editor.js';

const records = new WeakMap();
export function setSnippets(model, byLanguage) {
  const id = model.getLanguageId() === 'python' ? 'py' : model.getLanguageId();
  const list = byLanguage?.[id];
  records.set(model, Array.isArray(list) ? list.filter(s => /^[\w-]{1,48}$/.test(s?.prefix) && typeof s.body === 'string' && s.body.length <= 16384) : []);
}
export function snippetSuggestions(model, pos) {
  const word = model.getWordUntilPosition(pos);
  const before = model.getLineContent(pos.lineNumber).slice(0, word.startColumn - 1);
  if (/(?:\.|->|::)\s*$/.test(before) || /^\s*#\s*include\b/.test(before)) return [];
  const prefix = word.word.toLowerCase();
  const range = { startLineNumber: pos.lineNumber, endLineNumber: pos.lineNumber, startColumn: word.startColumn, endColumn: pos.column };
  return (records.get(model) || []).filter(s => s.prefix.toLowerCase().startsWith(prefix)).map(s => ({
    label: s.prefix, detail: '사용자 스니펫', kind: languages.CompletionItemKind.Snippet, sortText: '!' + s.prefix,
    insertText: s.body, insertTextRules: languages.CompletionItemInsertTextRule.InsertAsSnippet, range,
  }));
}
