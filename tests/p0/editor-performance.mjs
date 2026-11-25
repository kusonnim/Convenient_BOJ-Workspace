import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const phase = process.argv[2];
if (!['p1', 'p2'].includes(phase)) throw Error('Use p1 or p2 and optionally the unpacked extension path');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[3] || path.join(here, '../..'));
const samples = [];
const id = 'mabfdombglhmfnjklbnoglebinejifdi';
let chromeVersion;
for (let trial = 0; trial < 3; trial++) {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chrome', headless: true, chromiumSandbox: true, executablePath: process.env.CBOJ_CHROME,
    viewport: { width: 1280, height: 800 }, ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging', '--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND'],
  });
  try {
    chromeVersion = context.browser().version();
    const browser = await context.browser().newBrowserCDPSession();
    const loaded = await browser.send('Extensions.loadUnpacked', { path: root });
    if (loaded.id !== id) throw Error('Extension ID mismatch');
    const sw = context.serviceWorkers().find(w => w.url().endsWith('/background.js')) || await context.waitForEvent('serviceworker');
    await sw.evaluate(async () => {
      chrome.runtime.connectNative = () => { throw Error('Offline timing fixture'); };
      const code = Array.from({ length: 400 }, (_, i) => 'int sample_' + i + ' = ' + i + ';').join('\n');
      await chrome.storage.local.set({ 'draft:1000:cpp': { code, cursor: { line: 0, ch: 0 } } });
    });
    const page = await context.newPage();
    await page.route('https://www.acmicpc.net/problem/1000', r => r.fulfill({ path: path.join(here, 'fixtures/problem.html'), contentType: 'text/html; charset=utf-8' }));
    await page.goto('https://www.acmicpc.net/problem/1000');
    await page.locator('.cboj-toggle').waitFor();
    const tab = await context.newCDPSession(page);
    const heap = async cdp => Math.round((await cdp.send('Runtime.getHeapUsage')).usedSize / 1024);
    const before = await heap(tab);
    const opens = [];
    for (let n = 0; n < 2; n++) {
      const start = performance.now();
      await page.locator('.cboj-toggle').click();
      let frame;
      if (phase === 'p2') {
        const ownsEditor = f => f.url().startsWith('chrome-extension://' + id + '/editor/frame.html');
        frame = page.frames().find(ownsEditor) || await page.waitForEvent('framenavigated', { predicate: ownsEditor });
        await frame.locator('.monaco-editor.focused .view-line').first().waitFor();
      } else await page.locator('.CodeMirror-focused').waitFor();
      const readyMs = Math.round(performance.now() - start);
      const frameSession = frame ? await context.newCDPSession(frame) : null;
      opens.push({ readyMs, tabHeapKiB: await heap(tab), frameHeapKiB: frameSession ? await heap(frameSession) : null });
      if (frameSession) await frameSession.detach();
      await page.locator('.cboj-icon').click();
      await page.locator('#cboj-panel').waitFor({ state: 'hidden' });
      if (frame) await frame.locator('.monaco-editor').waitFor({ state: 'detached' });
    }
    const afterClose = { tabHeapKiB: await heap(tab) };
    if (phase === 'p2') {
      const frame = page.frames().find(f => f.url().startsWith('chrome-extension://' + id + '/editor/frame.html'));
      const session = await context.newCDPSession(frame);
      afterClose.frameHeapKiB = await heap(session);
      Object.assign(afterClose, await frame.evaluate(async () => {
        const { editor } = await import('/vendor/monaco/editor.js');
        return { views: editor.getEditors().length, models: editor.getModels().length };
      }));
      await session.detach();
    }
    const targets = (await browser.send('Target.getTargets')).targetInfos;
    samples.push({ beforeTabHeapKiB: before, opens, afterClose, editorWorkersAfterClose: targets.filter(t => t.type === 'worker' && t.url.includes('/vendor/monaco/')).length });
  } finally { await context.close(); }
}
const out = path.join(here, 'measurements');
await mkdir(out, { recursive: true });
const result = { phase, chromeVersion, lines: 400, samples };
await writeFile(path.join(out, phase + '.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
