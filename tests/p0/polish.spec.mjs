import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect } from '@playwright/test';
import { editorFrame, editorInput, extensionId, loadCode, openPanel, problem, stored, test } from './chrome-fixture.mjs';

const evidence = process.env.CBOJ_P41_EVIDENCE || path.resolve('measurements/p41-evidence');
await mkdir(evidence, { recursive: true });
async function capture(page, id) {
  await page.bringToFront();
  // Headless Chrome composites the extension iframe separately. Let its widget
  // transition and the next browser frame reach the screenshot surface.
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(evidence, id + '.png') });
}
const record = (id, value) => writeFile(path.join(evidence, id + '.json'), JSON.stringify(value, null, 2) + '\n');
const phases = { light: 'Light+', dark: 'Dark+', 'one-dark': 'One Dark', dracula: 'Dracula',
  monokai: 'Monokai', nord: 'Nord', 'github-dark': 'GitHub Dark', 'tokyo-night': 'Tokyo Night' };
const code = ['namespace atlas {', '    class Counter {', '    public:', '        int sum(int value) {',
  '            int total = value + 2;', '            if (total > 0) {', ...Array.from({ length: 24 }, (_, i) =>
  '                total += (value + ' + i + ');'), '            }', '            return total;', '        }', '    };', '}',
  'int main() { atlas::Counter counter; return counter.sum(4); }'].join('\n');

async function seed(lab, source = code) {
  await lab.worker.evaluate(source => chrome.storage.local.set({ runnerChoice: 'wandbox',
    'draft:1000:cpp': { code: source, cursor: { line: 4, ch: 17 } } }), source);
}
async function popup(lab) {
  const page = await lab.context.newPage();
  await page.goto('chrome-extension://' + extensionId + '/popup/popup.html');
  return page;
}
async function viewState(frame) {
  return frame.evaluate(async () => {
    const { editor } = await import('/vendor/monaco/editor.js'), v = editor.getEditors()[0];
    return { code: v.getModel().getValue(), pos: v.getPosition(), opts: v.getRawOptions(), height: v.getContentHeight() };
  });
}
async function point(frame, lineNumber, column, top = false) {
  await frame.evaluate(async ({ lineNumber, column, top }) => {
    const { editor } = await import('/vendor/monaco/editor.js'), v = editor.getEditors()[0];
    v.setPosition({ lineNumber, column }); v.focus();
    if (top) v.revealLineNearTop(lineNumber); else v.revealLineInCenterIfOutsideViewport(lineNumber);
  }, { lineNumber, column, top });
}
test('all eight popup themes, editor colors, original statement and saved personalization', async ({ lab }) => {
  await seed(lab);
  const p = await problem(lab), statement = p.locator('#problem-body');
  const original = await statement.evaluate(el => [el.innerHTML, getComputedStyle(el).color, getComputedStyle(el).backgroundColor]);
  await openPanel(p);
  const f = await editorFrame(p), settings = await popup(lab);
  const select = settings.locator('#editor-theme');
  await expect(select.locator('option')).toHaveCount(8);
  const colors = new Set();
  for (const [id, label] of Object.entries(phases)) {
    await select.selectOption(id);
    await expect.poll(() => stored(lab.worker, 'sync', 'editorTheme')).toBe(id);
    await expect.poll(() => f.evaluate(id => document.body.style.getPropertyValue('--bg') === CBOJ_PALETTES[id].base, id)).toBe(true);
    const bg = await p.locator('#cboj-panel').evaluate(el => getComputedStyle(el).backgroundColor);
    await expect(f.locator('.monaco-editor-background').first()).toHaveCSS('background-color', bg);
    expect(await select.locator('option:checked').textContent()).toBe(label);
    expect(await statement.evaluate(el => [el.innerHTML, getComputedStyle(el).color, getComputedStyle(el).backgroundColor])).toEqual(original);
    colors.add(bg);
    await p.locator('[data-tab=term]').click();
    await expect(p.locator('.cboj-pane.term')).toHaveCSS('background-color', bg);
    await point(f, 1, 5);
    await p.keyboard.press('Control+Space');
    await expect(f.locator('.suggest-widget.visible')).toContainText('namespace');
    await expect(f.locator('.suggest-widget.visible .monaco-list-row').first()).toBeVisible();
    const widgetColors = await f.locator('.monaco-editor').first().evaluate(el => {
      const style = getComputedStyle(el);
      return ['--vscode-editorSuggestWidget-background','--vscode-editorError-foreground','--vscode-scrollbarSlider-background']
        .map(k => style.getPropertyValue(k).trim());
    });
    expect(widgetColors.every(Boolean)).toBe(true);
    if (id === 'tokyo-night') await capture(p, 'completion-widget');
    await p.keyboard.press('Escape'); await point(f, 5, 18);
    await p.locator('[data-tab=term]').click();
    await capture(p, 'theme-' + id);
  }
  expect(colors.size).toBe(8);
  await settings.locator('summary').filter({ hasText: '편집 및 실행 설정' }).click();
  for (const [id, value] of [['edit-font', 'Consolas'], ['edit-size', '18'], ['edit-height', '27']]) {
    const el = settings.locator('#' + id); await el.fill(value); await el.press('Tab');
  }
  await settings.locator('label.toggle').filter({ has: settings.locator('[data-key=editorMinimap]') }).click();
  await expect.poll(async () => (await viewState(f)).opts.fontSize).toBe(18);
  const longCode = 'int main() { /*' + ' long word'.repeat(90) + ' */ }';
  await loadCode(p, longCode);
  const compactHeight = (await viewState(f)).height;
  await p.keyboard.press('Alt+z');
  await expect.poll(() => stored(lab.worker, 'sync', 'editorWrap')).toBe(true);
  await expect.poll(async () => (await viewState(f)).height).toBeGreaterThan(compactHeight);
  await p.keyboard.press('Control+s');
  await p.reload(); await openPanel(p);
  await expect.poll(async () => (await viewState(await editorFrame(p))).opts).toMatchObject({
    fontFamily: 'Consolas', fontSize: 18, lineHeight: 27, minimap: { enabled: true }, wordWrap: 'on',
  });
  await expect(settings.locator('#editor-theme')).toHaveValue('tokyo-night');
});

test.describe('real local tools', () => {
  test.use({ realHost: true });
  test('nested breadcrumbs, picking declarations, sticky scopes, guides and semantic reads', async ({ lab }) => {
    await seed(lab);
    await lab.worker.evaluate(() => {
      const connect = chrome.runtime.connectNative.bind(chrome.runtime);
      self.polishFeatures = [];
      chrome.runtime.connectNative = name => {
        const port = connect(name), post = port.postMessage.bind(port);
        port.postMessage = m => { if (m.type === 'analysis-request') self.polishFeatures.push(m.feature); return post(m); };
        return port;
      };
    });
    const p = await problem(lab); await openPanel(p);
    const f = await editorFrame(p);
    await expect(f.locator('#analysis-status')).toContainText('clangd · MSVC', { timeout: 55000 });
    await point(f, 17, 19, true);
    const nav = f.locator('#breadcrumbs');
    await expect(nav).toContainText('Counter');
    await expect(nav).toContainText('sum(');
    await expect(nav).toContainText('atlas');
    await expect(f.locator('.sticky-line-content').first()).toBeVisible();
    const sticky = f.locator('.sticky-line-content');
    expect(await sticky.count()).toBeLessThanOrEqual(3);
    await expect(f.locator('.wordHighlight, .wordHighlightStrong').first()).toBeVisible();
    expect(await f.locator('.core-guide').count()).toBeGreaterThan(0);
    await f.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await capture(p, 'scope-highlights');
    const sum = nav.getByRole('button', { name: /sum/ });
    await sum.click(); await expect(f.locator('#symbol-list')).toBeVisible();
    await capture(p, 'symbol-picker');
    await f.locator('#symbol-list button').filter({ hasText: 'sum' }).click();
    await expect.poll(async () => (await viewState(f)).pos).toEqual({ lineNumber: 4, column: 13 });
    await nav.getByRole('button', { name: 'main.cpp' }).click();
    await f.locator('#symbol-list button').filter({ hasText: /^main\(/ }).click();
    await expect.poll(async () => (await viewState(f)).pos.lineNumber).toBe(code.split('\n').length);
    await loadCode(p, 'namespace replaced { struct Incomplete {');
    await expect(nav).not.toContainText('Counter');
    await loadCode(p, 'namespace final_scope { int done() { return 0; } }');
    await point(f, 1, 40);
    await expect(nav).toContainText('done()');
    await expect(nav).not.toContainText('replaced');
    const features = await lab.worker.evaluate(() => self.polishFeatures);
    expect(features).toEqual(expect.arrayContaining(['documentSymbol', 'documentHighlight']));
    await lab.worker.evaluate(() => chrome.storage.sync.set({ editorBreadcrumbs: false, editorOccurrences: false, editorSticky: false }));
    await expect(nav).toBeHidden();
    await lab.worker.evaluate(() => { self.polishFeatures = []; });
    await loadCode(p, 'int current;\nint copy = current;');
    await point(f, 2, 14);
    await p.waitForTimeout(950); // Covers the symbol debounce and Monaco occurrence delay.
    expect(await lab.worker.evaluate(() => self.polishFeatures.filter(s => ['documentSymbol', 'documentHighlight'].includes(s)))).toEqual([]);
    await p.locator('.cboj-icon').click();
    await expect(nav).toBeHidden();
    await expect.poll(async () => (await readdir(lab.nativeTemp)).filter(n => n.startsWith('cboj-lsp_'))).toEqual([]);
  });

  test('explicit local C/C++ formatting and undo, MSVC/GCC diagnostic bytes and actual limits', async ({ lab }) => {
    await seed(lab, 'int main(){int a=1;return a;}');
    await lab.worker.evaluate(() => chrome.storage.local.set({ runnerChoice: 'msvc' }));
    const p = await problem(lab); await openPanel(p);
    const f = await editorFrame(p), settings = await popup(lab);
    await point(f, 1, 4); await p.keyboard.press('Shift+Alt+f');
    await expect.poll(async () => (await viewState(f)).code).toContain('int a = 1;');
    await p.keyboard.press('Control+z');
    await expect.poll(async () => (await viewState(f)).code).toBe('int main(){int a=1;return a;}');
    await p.locator('.cboj-lang').selectOption('75'); await loadCode(p, 'int main(void){return 0;}');
    await p.keyboard.press('Shift+Alt+f');
    await expect.poll(async () => (await viewState(f)).code).toContain('main(void) {');
    await p.locator('.cboj-lang').selectOption('84');
    const source = 'int main() {\n\t/* 한🙂 */ return missing;\n}';
    await loadCode(p, source);
    for (const compiler of ['msvc', 'gcc']) {
      await settings.locator('#runnerChoice').selectOption(compiler);
      await expect(p.locator('.cboj-where')).toContainText(compiler === 'msvc' ? 'MSVC' : 'g++', { timeout: 45000 });
      await p.locator('.cboj-toolbar .run').click();
      const location = p.locator('.cboj-diagnostic').first();
      await expect(location).toBeVisible({ timeout: 45000 });
      await location.click();
      await expect.poll(async () => (await viewState(f)).pos).toEqual({ lineNumber: 2, column: 19 });
      if (compiler === 'msvc') await capture(p, 'compiler-location');
    }
    await p.keyboard.insertText('x');
    await p.locator('.cboj-diagnostic').first().click();
    await expect(p.locator('.cboj-status')).toContainText('코드가 변경');
    await settings.locator('summary').filter({ hasText: '편집 및 실행 설정' }).click();
    for (const id of ['sample-limit', 'term-limit']) {
      const input = settings.locator('#' + id); await input.fill('1'); await input.press('Tab');
    }
    await p.locator('.cboj-lang').selectOption('28');
    await loadCode(p, 'import time\ntime.sleep(4)');
    await p.locator('.cboj-toolbar .run').click();
    await expect(p.locator('.cboj-term-out')).toContainText('시간 초과 (1초)', { timeout: 18000 });
    await p.locator('.cboj-term-actions .run').click();
    await expect(p.locator('.cboj-status')).toHaveText('시간 초과', { timeout: 10000 });
  });

  test('MSVC guidance follows the raw diagnostic for GNU headers and integer extensions', async ({ lab }) => {
    await seed(lab, 'int main() {}');
    await lab.worker.evaluate(() => chrome.storage.local.set({ runnerChoice: 'msvc' }));
    const p = await problem(lab); await openPanel(p);
    await expect(p.locator('.cboj-where')).toContainText('MSVC', { timeout: 45000 });
    const terminal = p.locator('.cboj-term-out');
    for (const [source, diagnostic, hint] of [
      ['#include <ext/pb_ds/assoc_container.hpp>\nint main() {}', 'ext/pb_ds/assoc_container.hpp', 'GNU libstdc++'],
      ['int main() { __int128 number = 0; }', '__int128', 'MSVC x64'],
    ]) {
      await loadCode(p, source);
      await p.locator('.cboj-toolbar .run').click();
      await expect(terminal).toContainText(hint, { timeout: 45000 });
      await expect(terminal).toContainText(diagnostic);
    }
  });
});

if (process.env.CBOJ_P41_LEGACY) test.describe('prior host', () => {
  test.use({ realHost: true });
  test('P3.5 completion works without the new capabilities', async ({ lab }) => {
    await seed(lab, 'struct Item { int known_member; };\nint main() { Item item; return item.known_member; }');
    const p = await problem(lab); await openPanel(p);
    const f = await editorFrame(p);
    await expect(f.locator('#analysis-status')).toContainText('clangd · MSVC', { timeout: 55000 });
    await expect(f.locator('#breadcrumbs button')).toHaveCount(1);
    await point(f, 2, 37); await p.keyboard.press('Control+Space');
    await expect(f.locator('.suggest-widget.visible')).toContainText('known_member');
    await p.keyboard.press('Escape'); await p.keyboard.press('Shift+Alt+f');
    await expect(f.locator('#format-status')).toContainText('도우미 업데이트');
    await expect(f.locator('#analysis-status')).toContainText('clangd · MSVC');
  });
});

test('missing tools, text-only occurrences, manual reconnect and disabled contributions', async ({ lab }) => {
  await seed(lab, 'int value = 1;\nint both = value + value;\n// value');
  await lab.worker.evaluate(() => { self.fixtureIO.native = {}; self.fixtureIO.analysis = 'no-server'; });
  const p = await problem(lab); await openPanel(p);
  const f = await editorFrame(p);
  await expect(f.locator('#analysis-status')).toContainText('clangd 설치 필요');
  await f.locator('#analysis-retry').click();
  await expect.poll(() => lab.worker.evaluate(() => self.fixtureIO.analysisCalls.filter(m => m.type === 'analysis-open').length)).toBe(2);
  await expect(f.locator('#breadcrumbs button')).toHaveCount(1);
  await p.bringToFront(); await point(f, 2, 14);
  await expect(f.locator('.wordHighlightText').first()).toBeVisible();
  const highlight = f.locator('.wordHighlightText').first();
  await expect(highlight).toHaveCSS('border-style', 'dashed');
  await f.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await capture(p, 'textual-highlights');
  await record('textual-render', await highlight.evaluate(el => {
    const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
    return { border: style.border, background: style.backgroundColor, width: rect.width, height: rect.height };
  }));
  await f.evaluate(() => { chrome.runtime.sendNativeMessage = async () => ({ type: 'format-info', version: 1, available: false }); });
  await p.keyboard.press('Shift+Alt+f');
  await expect(f.locator('#format-status')).toContainText('clang-format 설치 필요');
  await lab.worker.evaluate(() => chrome.storage.sync.set({ editorSticky: false, editorBrackets: false, editorOccurrences: false, editorBreadcrumbs: false }));
  await expect(f.locator('#breadcrumbs')).toBeHidden();
  await expect.poll(async () => (await viewState(f)).opts).toMatchObject({ occurrencesHighlight: 'off', stickyScroll: { enabled: false },
    bracketPairColorization: { enabled: false } });
  await expect(f.locator('.wordHighlightText')).toHaveCount(0);
  await expect(f.locator('.sticky-line-content')).toHaveCount(0);
});

test('local backup download, merge, open draft protection, invalid import and confirmed replacement', async ({ lab }) => {
  await lab.worker.evaluate(async () => {
    await chrome.storage.local.set({ 'draft:1000:cpp': { code: 'owner draft' }, 'draft:555:py': { code: '예전 초안' },
      cbojPending: { token: 'never-export' }, runnerChoice: 'auto' });
    await chrome.storage.sync.set({ templates: { c: 'user C' }, indent: 'tab', editorTheme: 'dark' });
  });
  const p = await problem(lab); await openPanel(p);
  const prefs = await popup(lab);
  await prefs.locator('summary').filter({ hasText: '백업' }).click();
  const downloaded = prefs.waitForEvent('download');
  await prefs.locator('#backup-export').click();
  const file = await (await downloaded).path(), data = JSON.parse(await readFile(file, 'utf8'));
  expect(data.local['draft:555:py']).toEqual({ code: '예전 초안' });
  expect(JSON.stringify(data)).not.toContain('never-export');
  data.local['draft:555:py'] = { code: 'replacement' }; data.local['draft:1000:cpp'] = { code: 'open conflict' };
  data.local['draft:777:c'] = { code: 'recovered' }; data.sync.templates = { cpp: 'extra', c: 'overwrite' };
  const input = prefs.locator('#backup-file'), out = prefs.locator('#backup-status');
  async function upload(value) { await input.setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) }); }
  await upload({ ...data, local: { ...data.local, cbojPending: true } }); await expect(out).toContainText('형식');
  expect(await stored(lab.worker, 'local', 'draft:777:c')).toBeUndefined();
  await upload(data); await expect(out).toContainText('열린 초안 제외 1개');
  expect(await stored(lab.worker, 'local', 'draft:555:py')).toEqual({ code: '예전 초안' });
  expect(await stored(lab.worker, 'sync', 'templates')).toEqual({ cpp: 'extra', c: 'user C' });
  expect(await stored(lab.worker, 'local', 'draft:777:c')).toEqual({ code: 'recovered' });
  await prefs.locator('#backup-policy').selectOption('replace');
  prefs.once('dialog', d => d.dismiss()); await upload(data); await expect(out).toContainText('취소');
  prefs.once('dialog', d => d.accept()); await upload(data); await expect(out).toContainText('열린 초안 제외 1개');
  expect(await stored(lab.worker, 'local', 'draft:555:py')).toEqual({ code: 'replacement' });
  expect((await stored(lab.worker, 'local', 'draft:1000:cpp')).code).toBe('owner draft');
  expect(await stored(lab.worker, 'local', 'cbojPending')).toEqual({ token: 'never-export' });
  await prefs.locator('body').screenshot({ path: path.join(evidence, 'backup-settings.png') });
  await input.setInputFiles({ name: 'oversized.json', mimeType: 'application/json', buffer: Buffer.alloc(32 * 1024 * 1024 + 1) });
  await expect(out).toContainText('32 MiB');
  const confirmations = [];
  const keepLocal = async dialog => {
    confirmations.push(dialog.message());
    if (dialog.message().includes('Wandbox')) await dialog.dismiss(); else await dialog.accept();
  };
  prefs.on('dialog', keepLocal);
  await upload({ ...data, sync: {}, local: { runnerChoice: 'wandbox' } });
  await expect(out).toContainText('복원 0개');
  prefs.off('dialog', keepLocal);
  expect(confirmations).toHaveLength(2);
  expect(confirmations[1]).toContain('Wandbox');
  expect(await stored(lab.worker, 'local', 'runnerChoice')).toBe('auto');
  const other = await problem(lab); await openPanel(other);
  await other.bringToFront();
  await loadCode(other, 'different unsaved tab');
  await expect.poll(async () => (await viewState(await editorFrame(other))).code).toBe('different unsaved tab');
  await expect.poll(async () => (await viewState(await editorFrame(p))).code).toBe('owner draft');
  await prefs.bringToFront();
  await prefs.locator('#backup-export').click();
  await expect(out).toContainText('서로 다른 코드');
});

for (let trial = 1; trial <= 3; trial++) test('startup and typing ' + trial, async ({ lab }) => {
  await seed(lab, Array.from({ length: 400 }, (_, i) => 'int sample_' + i + ' = ' + i + ';').join('\n'));
  const p = await problem(lab), tab = await lab.context.newCDPSession(p);
  const heap = async cdp => Math.round((await cdp.send('Runtime.getHeapUsage')).usedSize / 1024);
  const start = performance.now(); await openPanel(p);
  const startupMs = Math.round(performance.now() - start), f = await editorFrame(p), cdp = await lab.context.newCDPSession(f);
  const heapKiB = await heap(tab) + await heap(cdp);
  await editorInput(f).focus();
  const typing = [];
  for (const letter of 'abcdefghijklmnopqrstuvwx') {
    const begin = performance.now();
    await p.keyboard.type(letter);
    await f.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    typing.push(Math.round((performance.now() - begin) * 10) / 10);
  }
  const phase = process.env.CBOJ_P41_BASELINE ? 'base' : 'p41';
  if (trial === 1 && phase === 'base') {
    // Show the same draft, cursor and terminal as the eight palette captures.
    await loadCode(p, code); await point(f, 5, 18);
    await p.locator('[data-tab=term]').click();
    await capture(p, 'baseline');
  }
  await p.locator('.cboj-icon').click();
  await expect(f.locator('.monaco-editor')).toHaveCount(0);
  const counts = await f.evaluate(async () => {
    const { editor } = await import('/vendor/monaco/editor.js');
    return [editor.getEditors().length, editor.getModels().length];
  });
  expect(counts).toEqual([0, 0]);
  const browser = await lab.context.browser().newBrowserCDPSession();
  await expect.poll(async () => (await browser.send('Target.getTargets')).targetInfos.filter(t => t.type === 'worker' && t.url.includes('/vendor/monaco/')).length).toBe(0);
  // Keep the paired benchmark runs intact when repeating the general suite.
  if (process.env.CBOJ_P41_BENCHMARK || !process.env.CBOJ_P41_EVIDENCE) {
    await record(phase + '-timing-' + trial, { chrome: lab.context.browser().version(), startupMs, heapKiB, typing, views: counts[0], models: counts[1], workers: 0 });
  }
});
