import { writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { extensionId, focusedEditor, loadCode, observeComposition, openPanel, problem, stored, test } from './chrome-fixture.mjs';

// Observe Monaco via its public API inside the real extension document.
// All edits below use Chrome mouse, keyboard or IME input.
async function state(frame) {
  return frame.evaluate(async () => {
    const { editor } = await import('/vendor/monaco/editor.js');
    const view = editor.getEditors()[0];
    return { views: editor.getEditors().length, models: editor.getModels().length,
      code: view?.getValue(), selections: view?.getSelections(), cursor: view?.getPosition(),
      lang: view?.getModel()?.getLanguageId(), scroll: view?.getScrollTop() };
  });
}
async function point(frame, lineNumber, column) {
  const relative = await frame.evaluate(async pos => {
    const { editor } = await import('/vendor/monaco/editor.js');
    return editor.getEditors()[0].getScrolledVisiblePosition(pos);
  }, { lineNumber, column });
  const box = await frame.locator('.monaco-editor').boundingBox();
  return { x: box.x + relative.left + 1, y: box.y + relative.top + relative.height / 2 };
}
async function drag(p, start, end) {
  await p.mouse.move(start.x, start.y);
  await p.mouse.down();
  await p.mouse.move(end.x, end.y, { steps: 12 });
  await p.mouse.up();
}
const codeIs = (frame, expected) => expect.poll(async () => (await state(frame)).code).toBe(expected);
const draft = lab => stored(lab.worker, 'local', 'draft:1000:cpp');

test('mouse selection moves text, creates multiple cursors and edits a column', async ({ lab }) => {
  const p = await problem(lab);
  await openPanel(p);
  const frame = await focusedEditor(p);
  await loadCode(p, 'alpha beta\nomega:');
  await p.keyboard.press('Control+Home');
  for (let i = 0; i < 5; i++) await p.keyboard.press('Shift+ArrowRight');
  await drag(p, await point(frame, 1, 3), await point(frame, 2, 7));
  await codeIs(frame, ' beta\nomega:alpha');
  await loadCode(p, 'a1\nb2\nc3');
  const a = await point(frame, 1, 2), b = await point(frame, 2, 2);
  await p.mouse.click(a.x, a.y);
  await p.keyboard.down('Alt');
  await p.mouse.click(b.x, b.y);
  await p.keyboard.up('Alt');
  await expect.poll(async () => (await state(frame)).selections.length).toBe(2);
  await p.keyboard.type('X');
  await codeIs(frame, 'aX1\nbX2\nc3');
  await loadCode(p, 'abc\nabc\nabc');
  const start = await point(frame, 1, 2), end = await point(frame, 3, 3);
  await p.mouse.click(start.x, start.y);
  await p.keyboard.down('Shift');
  await p.keyboard.down('Alt');
  await drag(p, start, end);
  await p.keyboard.up('Alt');
  await p.keyboard.up('Shift');
  await expect.poll(async () => (await state(frame)).selections.length).toBe(3);
  await p.keyboard.type('Q');
  await codeIs(frame, 'aQc\naQc\naQc');
  await frame.locator('.margin-view-overlays .line-numbers').nth(1).click();
  const [selection] = (await state(frame)).selections;
  expect(selection).toMatchObject({ startLineNumber: 2, startColumn: 1, endLineNumber: 3, endColumn: 1 });
});

test('indentation, paired brackets, line actions, folding, find/replace and history', async ({ lab }) => {
  await lab.worker.evaluate(() => chrome.storage.sync.set({ indent: 'space' }));
  const p = await problem(lab);
  await openPanel(p);
  const frame = await focusedEditor(p);
  await loadCode(p, 'first\nsecond');
  await p.keyboard.press('Control+a');
  await p.keyboard.press('Tab');
  await codeIs(frame, '    first\n    second');
  await p.keyboard.press('Shift+Tab');
  await codeIs(frame, 'first\nsecond');
  await p.keyboard.press('Control+Home');
  await p.keyboard.press('Alt+ArrowDown');
  await codeIs(frame, 'second\nfirst');
  await p.keyboard.press('Shift+Alt+ArrowDown');
  await codeIs(frame, 'second\nfirst\nfirst');
  await p.keyboard.press('Control+z');
  await codeIs(frame, 'second\nfirst');
  await p.keyboard.press('Control+Shift+z');
  await codeIs(frame, 'second\nfirst\nfirst');
  await loadCode(p, 'int main() ');
  await p.keyboard.type('{');
  await codeIs(frame, 'int main() {}');
  await p.keyboard.press('Enter');
  await codeIs(frame, 'int main() {\n    \n}');
  await loadCode(p, 'int main() {\n    int apple = 1;\n    return apple;\n}\n');
  await p.keyboard.press('Control+Home');
  await p.keyboard.press('Control+Shift+[');
  await expect(frame.locator('.view-lines')).not.toContainText('return apple');
  await p.keyboard.press('Control+Shift+]');
  await expect(frame.locator('.view-lines')).toContainText('return apple');
  await p.keyboard.press('Control+f');
  const find = frame.locator('.find-widget');
  await expect(find).toBeVisible();
  await p.keyboard.insertText('apple');
  await find.locator('.toggle').click();
  const replace = find.locator('.replace-part textarea');
  await replace.fill('pear');
  await find.getByRole('button', { name: /Replace All/i }).click();
  await codeIs(frame, 'int main() {\n    int pear = 1;\n    return pear;\n}\n');
  await p.keyboard.press('Escape');
  await p.keyboard.press('Control+s');
  await expect.poll(() => draft(lab)).toMatchObject({ code: expect.stringContaining('return pear;') });
});

test('keyword and document completions, local worker, collapse/reopen and navigation cleanup', async ({ lab }, t) => {
  const p = await problem(lab);
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (/content security policy|could not create web worker|falling back to loading web worker code/i.test(m.text())) errors.push(m.text()); });
  const browser = await lab.context.browser().newBrowserCDPSession();
  const workers = async () => (await browser.send('Target.getTargets')).targetInfos.filter(x => x.type === 'worker' && x.url.includes('/vendor/monaco/'));
  await openPanel(p);
  const frame = await focusedEditor(p);
  await loadCode(p, 'conste');
  await p.keyboard.press('Control+Space');
  await expect(frame.locator('.suggest-widget.visible')).toContainText('constexpr');
  await p.keyboard.press('Enter');
  await codeIs(frame, 'constexpr');
  await loadCode(p, 'int locallyDeclaredName;\nlocallyDecl');
  await p.keyboard.press('Control+Space');
  await expect(frame.locator('.suggest-widget.visible')).toContainText('locallyDeclaredName');
  await p.keyboard.press('Enter');
  await codeIs(frame, 'int locallyDeclaredName;\nlocallyDeclaredName');
  await expect.poll(async () => (await workers()).length).toBe(1);
  const urls = (await workers()).map(x => x.url);
  const session = await lab.context.newCDPSession(frame);
  const scripts = new Set();
  session.on('Debugger.scriptParsed', ({ url }) => { if (/^(https?|chrome-extension|blob|data):/.test(url)) scripts.add(url); });
  await session.send('Debugger.enable');
  const styles = await frame.evaluate(() => [...document.styleSheets].map(s => s.href).filter(Boolean));
  const resources = [...scripts, ...styles];
  const origin = 'chrome-extension://' + lab.worker.url().split('/')[2] + '/';
  expect(resources).toContain(origin + 'vendor/monaco/editor.js');
  expect(resources).toContain(origin + 'vendor/monaco/editor.css');
  expect(resources.every(s => s.startsWith(origin))).toBe(true);
  await session.detach();
  // Separate the last typed edit into its own undo operation.
  await p.keyboard.press('End');
  await p.keyboard.type(';');
  const final = (await state(frame)).code;
  await p.keyboard.press('Alt+c');
  await expect(p.locator('#cboj-panel')).toBeHidden();
  await expect.poll(() => state(frame)).toMatchObject({ views: 0, models: 0 });
  await expect.poll(async () => (await workers()).length).toBe(0);
  await openPanel(p);
  await codeIs(frame, final);
  await p.keyboard.press('Control+z');
  await expect.poll(async () => (await state(frame)).code).not.toBe(final);
  await p.keyboard.press('Control+Shift+z');
  await codeIs(frame, final);
  await p.reload();
  await openPanel(p);
  await codeIs(await focusedEditor(p), final);
  await p.close();
  await expect.poll(async () => (await workers()).length).toBe(0);
  expect(errors).toEqual([]);
  await writeFile(t.outputPath('worker.json'), JSON.stringify({ workerUrls: urls, resources, errors, workersAfterClose: await workers() }, null, 2));
});

test('Korean browser composition, UTF-16 selection and old scroll/draft recovery', async ({ lab }, t) => {
  const lines = Array.from({ length: 85 }, (_, i) => '// ' + i);
  lines[60] = '// 🙂ab';
  await lab.worker.evaluate(data => chrome.storage.local.set({ 'draft:1000:cpp': data }),
    { code: lines.join('\n'), cursor: { line: 60, ch: 5 }, scroll: { top: 1080, left: 0 } });
  const p = await problem(lab);
  await openPanel(p);
  const frame = await focusedEditor(p);
  const cdp = await lab.context.newCDPSession(frame);
  const inputMethod = await observeComposition(frame);
  await expect.poll(() => state(frame)).toMatchObject({ cursor: { lineNumber: 61, column: 6 }, scroll: 1080 });
  await cdp.send('Input.imeSetComposition', { text: 'ㅎ', selectionStart: 1, selectionEnd: 1 });
  await cdp.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 });
  await cdp.send('Input.insertText', { text: '한' });
  await p.keyboard.press('Control+s');
  lines[60] = '// 🙂한ab';
  await expect.poll(() => draft(lab)).toMatchObject({ code: lines.join('\n'), cursor: { line: 60, ch: 6 } });
  const events = await frame.evaluate(() => window.testComposition);
  await writeFile(t.outputPath('browser-ime.json'), JSON.stringify({ inputMethod, events, line: lines[60], saved: (await draft(lab)).cursor }, null, 2));
  expect(events.some(e => e.type === 'compositionend')).toBe(true);
  expect(events.some(e => ['compositionupdate', 'textupdate'].includes(e.type) && e.trusted && e.text === '한')).toBe(true);
  expect(await lab.worker.evaluate(() => self.fixtureIO.nativeCalls.filter(x => ['run', 'batch'].includes(x.type)))).toEqual([]);
  await p.reload();
  await openPanel(p);
  await expect.poll(() => state(p.frames().find(f => f.url().includes('/editor/frame.html')))).toMatchObject({ cursor: { lineNumber: 61, column: 7 } });
});

test('unedited legacy bytes, fast navigation and language-specific editing survive a round trip', async ({ lab }) => {
  const key = 'draft:1000:cpp';
  const legacy = '\uFEFF// legacy\r\n// mixed\nint main() {}';
  await lab.worker.evaluate(([key, code]) => chrome.storage.local.set({ [key]: { code, cursor: { line: 1, ch: 8 } } }), [key, legacy]);
  const p = await problem(lab);
  await openPanel(p);
  await p.keyboard.press('Control+s');
  await expect(p.locator('.cboj-status')).toHaveText('저장했어요');
  expect((await draft(lab)).code).toBe(legacy);
  await loadCode(p, 'int value;');
  await p.keyboard.type('X');
  await p.reload();
  await openPanel(p);
  const frame = await focusedEditor(p);
  await codeIs(frame, 'int value;X');
  await p.locator('.cboj-lang').selectOption('28');
  await expect.poll(async () => (await state(frame)).lang).toBe('python');
  await loadCode(p, 'if True: # comment');
  await p.keyboard.press('Enter');
  await codeIs(frame, 'if True: # comment\n\t');
  await p.keyboard.type('pass');
  await p.keyboard.press('Enter');
  await codeIs(frame, 'if True: # comment\n\tpass\n');
  await p.locator('.cboj-lang').selectOption('75');
  await expect.poll(async () => (await state(frame)).lang).toBe('c');
  await loadCode(p, '_Stat');
  await p.keyboard.press('Control+Space');
  await expect(frame.locator('.suggest-widget.visible')).toContainText('_Static_assert');
  await p.keyboard.press('Escape');
  await p.locator('.cboj-lang').selectOption('84');
  await codeIs(frame, 'int value;X');
});

test.describe('browser history', () => {
  test.use({ backForwardCache: true });
  test('Back restores the last edit and exactly one editable model', async ({ lab }, t) => {
    const p = await problem(lab);
    await openPanel(p);
    await p.evaluate(() => addEventListener('pageshow', e => { window.fixtureRestored = e.persisted; }));
    await loadCode(p, '// before navigation');
    await p.keyboard.type('!');
    await p.goto('https://www.acmicpc.net/problem/1001');
    await p.goBack();
    await expect(p.locator('.cboj-toggle')).toBeVisible();
    const cached = await p.evaluate(() => window.fixtureRestored === true);
    if (!cached) await openPanel(p);
    await expect.poll(async () => {
      const frame = p.frames().find(f => f.url().includes('/editor/frame.html'));
      return frame ? state(frame).catch(() => null) : null;
    }).toMatchObject({ views: 1, models: 1, code: '// before navigation!' });
    await focusedEditor(p);
    await p.keyboard.type('?');
    await p.keyboard.press('Control+s');
    await expect.poll(() => draft(lab)).toMatchObject({ code: '// before navigation!?' });
    const navigation = await p.evaluate(() => {
      const entry = performance.getEntriesByType('navigation')[0];
      return { type: entry.type, reasons: entry.notRestoredReasons?.reasons?.map(r => r.reason) || [] };
    });
    await writeFile(t.outputPath('history.json'), JSON.stringify({ restoredFromCache: cached, navigation, views: 1, models: 1 }, null, 2));
  });
});

test.describe('installed runner and appearance', () => {
  test.use({ realHost: true });
  test('Monaco C++ runs on local MSVC in light and dark themes', async ({ lab }, t) => {
    const p = await problem(lab);
    await openPanel(p);
    const frame = await focusedEditor(p);
    const source = ['#include <iostream>', '', 'int sum(int a, int b) {', '    return a + b;', '}', '',
      'int main() {', '    static_assert(sizeof(void*) == 8 && _MSC_VER > 0);', '    int a, b;',
      '    std::cin >> a >> b;', "    std::cout << sum(a, b) << '\\n';", '}'].join('\n');
    await loadCode(p, source);
    await p.keyboard.press('Control+Enter');
    const status = p.locator('.cboj-status');
    await expect(status).toHaveText('예제 통과', { timeout: 45000 });
    await expect(p.locator('.cboj-term-out')).toContainText('cl /nologo');
    await expect(frame.locator('.monaco-editor.vs')).toBeVisible();
    await p.screenshot({ path: t.outputPath('monaco-msvc-light.png') });
    const popup = await lab.context.newPage();
    await popup.goto('chrome-extension://' + extensionId + '/popup/popup.html');
    await popup.locator('select[data-key="editorTheme"]').selectOption('dark');
    await popup.locator('label.toggle').filter({ has: popup.locator('[data-key="editorMinimap"]') }).click();
    await expect.poll(() => stored(lab.worker, 'sync', 'editorMinimap')).toBe(true);
    await popup.close();
    await p.bringToFront();
    await expect(frame.locator('.monaco-editor.vs-dark .minimap')).toBeVisible();
    await p.locator('.cboj-toolbar .run').click();
    await expect(p.locator('.cboj-term-out')).toContainText('캐시 재사용');
    await expect(status).toHaveText('예제 통과');
    await p.screenshot({ path: t.outputPath('monaco-msvc-dark.png') });
    await p.locator('.cboj-lang').selectOption('75');
    await expect.poll(async () => (await state(frame)).lang).toBe('c');
    await p.locator('.cboj-lang').selectOption('28');
    await expect.poll(async () => (await state(frame)).lang).toBe('python');
    await p.locator('.cboj-lang').selectOption('84');
    await codeIs(frame, source);
    await expect(p.locator('.cboj-where')).toContainText('MSVC');
  });
});
