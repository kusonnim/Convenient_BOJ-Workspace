// Use the real old and new extension packages in one disposable Chrome profile.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { extensionId, openPanel } from './chrome-fixture.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const out = path.join(root, 'tests/p0/measurements/p4');
await mkdir(out, { recursive:true });
const dir = await mkdtemp(path.join(out, 'upgrade-')), pkg = path.join(dir, 'extension');
await mkdir(pkg);
const files = ['manifest.json','background.js','content','editor','host','popup','shared','icons','vendor'];
execFileSync('git', ['archive','--format=zip','-o',path.join(dir,'original.zip'),'f5fd0b4',...files], { cwd:root, windowsHide:true });
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
    if (stage === 'old') {
      assert.equal(version,'1.3.3');
      await sw.evaluate(async draft => {
        await chrome.storage.local.set({ 'draft:1000:cpp':draft, runnerChoice:'gcc', 'cases:1000':[{ id:'legacy', input:' hi ', expected:'', on:false }] });
        await chrome.storage.sync.set({ templates:{c:'// preserved $0'}, editorTheme:'dark', splitAutoOpen:false });
      },seed);
    } else {
      assert.equal(version,'1.4.1');
      const saved = await sw.evaluate(async () => ({ local:await chrome.storage.local.get(null), sync:await chrome.storage.sync.get(null) }));
      assert.deepEqual(saved.local['draft:1000:cpp'],seed); assert.equal(saved.local.runnerChoice,'gcc');
      assert.deepEqual(saved.sync.templates,{c:'// preserved $0'}); assert.equal(saved.sync.editorTheme,'dark');
      const settings = await context.newPage(); await settings.goto('chrome-extension://' + extensionId + '/popup/popup.html');
      assert.equal(await settings.locator('[data-key=powerMode]').isChecked(),false);
      const tab = await context.newPage(); await tab.goto('https://www.acmicpc.net/problem/1000'); await openPanel(tab);
      await tab.locator('[data-tab=cases]').click(); await tab.locator('[data-case=legacy]').click();
      assert.equal(await tab.locator('.case-io textarea').first().inputValue(),' hi ');
      assert.equal(await tab.getByLabel('전체에 포함').isChecked(),false);
      assert.equal(await tab.locator('.case-io input').isChecked(),false);
    }
    return version;
  } finally { await context.close(); }
}
const before = await installed('old');
for (const file of files) await cp(path.join(root,file),path.join(pkg,file),{recursive:true});
const after = await installed('new');
const result = { before, after, id:extensionId, preserved:['draft','cursor','scroll','template','compiler','theme','upstream cases'], powerDefault:false };
await writeFile(path.join(out,'upgrade.json'),JSON.stringify(result,null,2)+'\n'); console.log(result);
