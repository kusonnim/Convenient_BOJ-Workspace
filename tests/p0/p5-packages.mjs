// Smoke both actual ZIP layouts in installed Chrome, including the keyless ID.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { extensionId, origin } from './chrome-fixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../..');
const output = path.resolve(process.argv[2] || 'dist');
await mkdir(path.join(here, 'measurements'), { recursive: true });
const scratch = await mkdtemp(path.join(here, 'measurements/package-'));
const baseline = JSON.parse(execFileSync('git', ['show', '22192f2:manifest.json'], { cwd: root, encoding: 'utf8' }));
let directFiles, directManifest;
for (const store of [false, true]) {
  const archive = path.join(output, store ? 'Convenient_BOJ-webstore.zip' : 'Convenient_BOJ.zip');
  const dest = path.join(scratch, store ? 'store' : 'direct'); await mkdir(dest);
  execFileSync('tar', ['-xf', archive, '-C', dest], { windowsHide: true });
  const unpacked = store ? dest : path.join(dest, 'Convenient_BOJ');
  const manifest = JSON.parse(await readFile(path.join(unpacked, 'manifest.json'), 'utf8'));
  const files = {};
  async function walk(dir) {
    for (const e of await readdir(path.join(unpacked, dir), { withFileTypes: true })) {
      const name = path.posix.join(dir, e.name);
      if (e.isDirectory()) await walk(name);
      else files[name] = createHash('sha256').update(await readFile(path.join(unpacked, name))).digest('hex');
    }
  }
  await walk('');
  assert.deepEqual(manifest.permissions, baseline.permissions);
  assert.deepEqual(manifest.host_permissions, baseline.host_permissions);
  assert.deepEqual(manifest.content_security_policy, baseline.content_security_policy);
  assert.deepEqual(manifest.web_accessible_resources, baseline.web_accessible_resources);
  assert.deepEqual(manifest.content_scripts.map(s => [s.world, s.matches]), baseline.content_scripts.map(s => [s.world, s.matches]));
  for (const script of manifest.content_scripts) for (const name of [...script.js, ...(script.css || [])]) assert.ok(files[name], name);
  assert.ok(files.NOTICE && files['vendor/monaco/LICENSE'] && files['vendor/themes/NOTICE.txt']);
  assert.ok(Object.keys(files).every(name => !/^(tests|docs|tools|\.git|backups)\/|\.pem$|__pycache__/.test(name)));
  if (!store) {
    directFiles = files; directManifest = manifest;
    assert.equal(manifest.key, baseline.key);
    assert.ok(files['host/install.ps1'] && files['host/cboj_host.py']);
  } else {
    const { key, ...expected } = directManifest;
    assert.deepEqual(manifest, expected);
    const expectedFiles = Object.fromEntries(Object.entries(directFiles).filter(([k]) => !k.startsWith('host/')));
    assert.deepEqual(files, { ...expectedFiles, 'manifest.json': files['manifest.json'] });
  }
  const ctx = await chromium.launchPersistentContext('', { channel: 'chrome', headless: true, chromiumSandbox: true,
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging', '--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND'] });
  try {
    await ctx.route(/^https?:/, route => route.request().method() === 'GET' && route.request().url() === origin + '/problem/1000'
      ? route.fulfill({ path: path.join(here, 'fixtures/problem.html'), contentType: 'text/html; charset=utf-8' }) : route.abort());
    const cdp = await ctx.browser().newBrowserCDPSession();
    const { id } = await cdp.send('Extensions.loadUnpacked', { path: unpacked });
    if (store) assert.notEqual(id, extensionId); else assert.equal(id, extensionId);
    const sw = ctx.serviceWorkers().find(w => w.url().endsWith('/background.js')) || await ctx.waitForEvent('serviceworker');
    assert.equal(await sw.evaluate(() => chrome.runtime.id), id);
    await sw.evaluate(async () => {
      chrome.runtime.connectNative = () => { throw Error('Package smoke fixture'); };
      await chrome.storage.sync.set({ lastLangId: '93' });
    });
    const page = await ctx.newPage(); await page.goto(origin + '/problem/1000'); await page.locator('.cboj-toggle').click();
    const frame = page.frameLocator('iframe[title="코드 편집기"]');
    await frame.locator('.view-lines').filter({ hasText: 'BufferedReader' }).waitFor();
    const f = page.frames().find(x => x.url().startsWith('chrome-extension://' + id + '/editor/frame.html'));
    assert.deepEqual(await f.evaluate(async () => {
      const { editor } = await import('/vendor/monaco/editor.js'), model = editor.getModels()[0];
      return [model.getLanguageId(), model.uri.path];
    }), ['java', '/ConvenientBOJ/1000/Main.java']);
    await f.evaluate(async () => {
      const { editor } = await import('/vendor/monaco/editor.js'), v = editor.getEditors()[0];
      v.setValue('class LocalPackageFixture {}\nLocalPa');
      v.setPosition({ lineNumber: 2, column: 8 }); v.focus();
    });
    await page.keyboard.press('Control+Space');
    await frame.locator('.suggest-widget.visible').filter({ hasText: 'LocalPackageFixture' }).waitFor();
    const { targetInfos } = await cdp.send('Target.getTargets');
    assert.ok(targetInfos.some(t => t.type === 'worker' && t.url === 'chrome-extension://' + id + '/vendor/monaco/editor.worker.js'));
    console.log(JSON.stringify({ variant: store ? 'store' : 'unpacked', chrome: ctx.browser().version(), id,
      files: Object.keys(files).length, version: manifest.version, sha256: createHash('sha256').update(await readFile(archive)).digest('hex') }));
  } finally { await ctx.close(); }
}
