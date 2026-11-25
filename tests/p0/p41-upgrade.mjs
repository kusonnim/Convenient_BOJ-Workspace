import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { editorFrame, extensionId, openPanel, origin } from './chrome-fixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../..');
const measurements = path.join(here, 'measurements');
await mkdir(measurements, { recursive: true });
const temp = await mkdtemp(path.join(measurements, 'profile-upgrade-')), stage = path.join(temp, 'extension');
const profile = path.join(temp, 'profile'), archive = path.join(temp, 'base.tar');
const files = ['manifest.json', 'background.js', 'content', 'editor', 'host', 'icons', 'popup', 'shared', 'vendor'];
await mkdir(stage);
execFileSync('git', ['archive', '--format=tar', '-o', archive, 'f5fd0b4', ...files], { cwd: root, windowsHide: true });
execFileSync('tar', ['-xf', archive, '-C', stage], { windowsHide: true });
const sync = { editorTheme: 'dark', editorMinimap: true, indent: 'space', codeOpen: 'onlyaccepted', templates: { cpp: '// template $0' } };
const draft = { code: '// 저장됨 🙂\r\nint main(){}', cursor: { line: 1, ch: 4 } };
const local = { runnerChoice: 'gcc', 'draft:1000:cpp': draft };
const observations = [];
for (const phase of ['base', 'polish', 'restart']) {
  if (phase === 'polish') {
    for (const file of files) await cp(path.join(root, file), path.join(stage, file), { recursive: true });
  }
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chrome', headless: true, chromiumSandbox: true, executablePath: process.env.CBOJ_CHROME || undefined,
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging', '--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND'],
  });
  try {
    await ctx.route(/^https?:/, route => route.request().url() === origin + '/problem/1000' && route.request().method() === 'GET'
      ? route.fulfill({ path: path.join(here, 'fixtures/problem.html'), contentType: 'text/html; charset=utf-8' }) : route.abort());
    const devtools = await ctx.browser().newBrowserCDPSession();
    assert.equal((await devtools.send('Extensions.loadUnpacked', { path: stage })).id, extensionId);
    const worker = ctx.serviceWorkers().find(w => w.url().endsWith('/background.js')) || await ctx.waitForEvent('serviceworker');
    await worker.evaluate(() => { chrome.runtime.connectNative = () => { throw Error('Offline upgrade fixture'); }; });
    if (phase === 'base') await worker.evaluate(async ({ sync, local }) => {
      await chrome.storage.sync.set(sync); await chrome.storage.local.set(local);
    }, { sync, local });
    const actual = await worker.evaluate(async () => ({ sync: await chrome.storage.sync.get(null), local: await chrome.storage.local.get(null) }));
    if (phase !== 'restart') {
      assert.deepEqual(actual.sync, sync);
      assert.equal(actual.local.runnerChoice, local.runnerChoice);
      assert.deepEqual(actual.local['draft:1000:cpp'], draft);
    } else assert.equal(actual.sync.editorWrap, true);
    if (phase !== 'base') {
      const p = await ctx.newPage(); await p.goto(origin + '/problem/1000'); await openPanel(p);
      const f = await editorFrame(p);
      const state = await f.evaluate(async () => {
        const { editor } = await import('/vendor/monaco/editor.js'), view = editor.getEditors()[0], opts = view.getRawOptions();
        return { dark: document.body.classList.contains('dark'), minimap: opts.minimap.enabled, spaces: view.getModel().getOptions().insertSpaces,
          code: view.getValue(), pos: view.getPosition(), wrap: opts.wordWrap };
      });
      assert.equal(state.code, draft.code); assert.equal(state.dark && state.minimap && state.spaces, true);
      assert.deepEqual(state.pos, { lineNumber: 2, column: 5 });
      assert.equal(state.wrap, phase === 'restart' ? 'on' : 'off');
      if (phase === 'polish') {
        await p.keyboard.press('Alt+z');
        await f.waitForFunction(async () => (await chrome.storage.sync.get('editorWrap')).editorWrap === true);
      }
      observations.push({ phase, ...state });
    }
    if (phase === 'base') observations.push({ phase, chrome: ctx.browser().version(), extensionId, source: 'f5fd0b4' });
  } finally { await ctx.close(); }
}
const evidence = process.env.CBOJ_P41_EVIDENCE || path.join(measurements, 'p41-evidence');
await mkdir(evidence, { recursive: true });
await writeFile(path.join(evidence, 'upgrade.json'), JSON.stringify(observations, null, 2) + '\n');
console.log('Same-profile unpacked upgrade and restart passed with saved theme, minimap, indentation, privacy, template, compiler, CRLF draft, UTF-16 cursor and new wrap preference.');
