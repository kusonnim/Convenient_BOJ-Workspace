// Use the real old and new extension packages in one disposable Chrome profile.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { extensionId, openPanel } from './chrome-fixture.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const from = process.argv[2] || 'f5fd0b4';
const versions = { f5fd0b4: '1.3.3', cfb8499: '1.4.0', '22192f2': '1.4.1' };
assert.ok(Object.hasOwn(versions, from));
const out = path.join(root, 'tests/p0/measurements', from === 'f5fd0b4' ? 'p4' : 'p5-upgrade-' + from);
await mkdir(out, { recursive:true });
const dir = await mkdtemp(path.join(out, 'upgrade-')), pkg = path.join(dir, 'extension');
await mkdir(pkg);
const files = ['manifest.json','background.js','content','editor','host','popup','shared','icons','vendor'];
const priorFiles = execFileSync('git', ['ls-tree','--name-only',from,'--',...files], { cwd:root, encoding:'utf8' }).trim().split(/\r?\n/);
execFileSync('git', ['archive','--format=zip','-o',path.join(dir,'original.zip'),from,...priorFiles], { cwd:root, windowsHide:true });
execFileSync('tar',['-xf',path.join(dir,'original.zip'),'-C',pkg], { windowsHide:true });
const profile = path.join(dir, 'profile');
const seed = { code:'// 이전 초안 🙂\n', cursor:{ line:0,ch:2 }, scroll:{ top:0,left:0 } };
async function installed(stage) {
  const context = await chromium.launchPersistentContext(profile, { channel:'chrome', headless:true, chromiumSandbox:true,
    ignoreDefaultArgs:['--disable-extensions'], args:['--enable-unsafe-extension-debugging','--no-proxy-server','--host-resolver-rules=MAP * ~NOTFOUND'] });
  try {
    await context.route(/^https?:/, r => r.request().method() === 'GET' && r.request().url() === 'https://www.acmicpc.net/problem/1000'
      ? r.fulfill({ path:path.join(root,'tests/p0/fixtures/problem.html'), contentType:'text/html; charset=utf-8' }) : r.abort());
    const cdp = await context.browser().newBrowserCDPSession();
    assert.equal((await cdp.send('Extensions.loadUnpacked', { path:pkg })).id, extensionId);
    const match = w => w.url().startsWith('chrome-extension://' + extensionId);
    const sw = context.serviceWorkers().find(match) || await context.waitForEvent('serviceworker',{predicate:match});
    const version = await sw.evaluate(() => chrome.runtime.getManifest().version);
    await sw.evaluate(() => { chrome.runtime.connectNative = () => { throw Error('Offline upgrade fixture'); }; });
    if (stage === 'old') {
      assert.equal(version, versions[from]);
      await sw.evaluate(async draft => {
        await chrome.storage.local.set({ 'draft:1000:cpp':draft, runnerChoice:'gcc', 'cases:1000':[{ id:'legacy', input:' hi ', expected:'', on:false }] });
        await chrome.storage.sync.set({ templates:{c:'// preserved $0'}, editorTheme:'dark', splitAutoOpen:false });
      },seed);
      if (from === 'cfb8499') await sw.evaluate(async () => {
        await chrome.storage.sync.set({ lastLangId:'93', lastLangName:'Java 11', templates:{ c:'// preserved $0', java:'class Main { /* $0 */ }' }, autocomplete:false });
        await chrome.storage.local.set({ 'draft:1000:java':{ code:'// 한글🙂\r\npublic class Main {}', cursor:{ line:1, ch:6 }, at:42 },
          'timer:1000':{ elapsed:65000, since:null, solved:null } });
      });
    } else {
      assert.equal(version, JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')).version);
      const saved = await sw.evaluate(async () => ({ local:await chrome.storage.local.get(null), sync:await chrome.storage.sync.get(null) }));
      assert.deepEqual(saved.local['draft:1000:cpp'],seed); assert.equal(saved.local.runnerChoice,'gcc');
      assert.equal(saved.sync.templates.c,'// preserved $0'); assert.equal(saved.sync.editorTheme,'dark');
      const settings = await context.newPage(); await settings.goto('chrome-extension://' + extensionId + '/popup/popup.html');
      assert.equal(await settings.locator('[data-key=powerMode]').isChecked(),false);
      const tab = await context.newPage(); await tab.goto('https://www.acmicpc.net/problem/1000'); await openPanel(tab);
      if (from === 'cfb8499') {
        assert.equal(saved.sync.templates.java,'class Main { /* $0 */ }');
        assert.equal(saved.sync.autocomplete,false);
        assert.equal(await tab.locator('.cboj-lang').inputValue(),'93');
        assert.equal(await tab.locator('.cboj-timer').innerText(),'⏱ 01:05');
        const frame = tab.frames().find(f => f.url().includes('/editor/frame.html'));
        const model = await frame.evaluate(async () => {
          const { editor } = await import('/vendor/monaco/editor.js'), v = editor.getEditors()[0];
          return [v.getModel().getLanguageId(), v.getValue(), v.getPosition()];
        });
        assert.deepEqual(model, ['java','// 한글🙂\r\npublic class Main {}',{ lineNumber:2, column:7 }]);
      }
      await tab.locator('[data-tab=cases]').click(); await tab.locator('[data-case=legacy]').click();
      assert.equal(await tab.locator('.case-io textarea').first().inputValue(),' hi ');
      assert.equal(await tab.getByLabel('전체에 포함').isChecked(),false);
      assert.equal(await tab.locator('.case-io input').isChecked(),false);
    }
    return version;
  } finally { await context.close(); }
}
const before = await installed('old');
await rename(pkg, path.join(dir, 'original-extension'));
await mkdir(pkg);
for (const file of files) await cp(path.join(root,file),path.join(pkg,file),{recursive:true});
const after = await installed('new');
const result = { before, after, id:extensionId, preserved:['draft','cursor','scroll','template','compiler','theme','upstream cases'], powerDefault:false };
await writeFile(path.join(out,'upgrade.json'),JSON.stringify(result,null,2)+'\n'); console.log(result);
