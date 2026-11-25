import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';
import { editorInput, focusedEditor, observeComposition, openPanel } from './chrome-fixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const title = 'CBOJ IME ' + randomUUID();
const context = await chromium.launchPersistentContext('', {
  channel: 'chrome', headless: false, chromiumSandbox: true, executablePath: process.env.CBOJ_CHROME,
  ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging', '--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND'],
});
let toggled = false, key;
try {
  const browser = await context.browser().newBrowserCDPSession();
  await browser.send('Extensions.loadUnpacked', { path: path.resolve(process.argv[2] || path.join(here, '../..')) });
  const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await sw.evaluate(() => chrome.storage.local.set({ 'draft:1000:cpp': { code: '', cursor: { line: 0, ch: 0 } } }));
  const page = await context.newPage();
  await page.route('https://www.acmicpc.net/problem/1000', r => r.fulfill({ path: path.join(here, 'fixtures/problem.html'), contentType: 'text/html; charset=utf-8' }));
  await page.goto('https://www.acmicpc.net/problem/1000');
  await page.evaluate(t => { document.title = t; }, title);
  await openPanel(page);
  const frame = await focusedEditor(page);
  await page.bringToFront();
  await editorInput(frame).focus();
  const pid = (await browser.send('SystemInfo.getProcessInfo')).processInfo.find(x => x.type === 'browser').id;
  key = action => promisify(execFile)(process.env.CBOJ_TEST_PYTHON || 'python',
    ['-B', path.join(here, 'windows-ime-input.py'), String(pid), title, action], { windowsHide: true });
  const inputMethod = await observeComposition(frame);
  await frame.evaluate(async () => {
    const { editor } = await import('/vendor/monaco/editor.js');
    const view = editor.getEditors()[0];
    window.imeTrace = [];
    addEventListener('keydown', e => window.imeTrace.push({ key: e.key, code: e.code, keyCode: e.keyCode, composing: e.isComposing }), true);
    view.onDidChangeModelContent(e => window.imeTrace.push({ changes: e.changes.map(c => [c.rangeOffset, c.rangeLength, c.text]) }));
  });
  const value = () => frame.evaluate(async () => (await import('/vendor/monaco/editor.js')).editor.getModels()[0].getValue());
  const stages = { initial: await value() };
  assert.equal(stages.initial, '');
  await key('first');
  stages.first = await value();
  if (stages.first === 'gk') {
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    stages.cleared = await value();
    assert.equal(stages.cleared, '');
    await key('toggle');
    toggled = true;
    stages.toggled = await value();
    await key('first');
  }
  const preedit = await value();
  assert.equal(preedit, '하', JSON.stringify({ inputMethod, stages, preedit, events: await frame.evaluate(() => window.testComposition),
    trace: await frame.evaluate(() => window.imeTrace) }));
  await key('finish');
  assert.equal(await value(), '한글 ');
  const events = await frame.evaluate(() => window.testComposition);
  assert.ok(events.some(e => ['compositionupdate', 'textupdate'].includes(e.type) && e.trusted && e.text === '한'), JSON.stringify(events));
  assert.ok(events.some(e => e.type === 'compositionend'), JSON.stringify(events));
  if (toggled) { await key('toggle'); toggled = false; }
  await key('save');
  await page.locator('.cboj-status').filter({ hasText: '저장했어요' }).waitFor({ timeout: 4000 });
  await key('find');
  await frame.locator('.find-widget.visible').waitFor({ timeout: 4000 });
  await page.keyboard.press('Escape');
  await editorInput(frame).focus();
  await key('replace');
  const replaceWidget = await frame.locator('.find-widget.visible .replace-part').isVisible();
  const history = context.pages().some(p => p.url().startsWith('chrome://history'));
  const out = { chrome: context.browser().version(), layout: '0412', inputMethod, keys: 'gksrmf + Space', preedit, text: await value(), events,
    ctrlS: 'workspace saved', ctrlF: 'editor find', ctrlH: replaceWidget ? 'editor replace' : history ? 'Chrome History' : 'no replace widget' };
  if (history) await Promise.all(context.pages().filter(p => p.url().startsWith('chrome://history')).map(p => p.close()));
  await mkdir(path.join(here, 'measurements'), { recursive: true });
  await writeFile(path.join(here, 'measurements/windows-ime.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify(out));
} finally {
  if (toggled && key) await key('toggle').catch(() => {});
  await context.close();
}
