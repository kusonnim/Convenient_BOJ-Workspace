// Optional anonymous read-only check. The default test suite uses local HTML.
import { strict as assert } from 'node:assert';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { extensionWorker } from './extension-worker.mjs';
import { focusedEditor, loadCode } from './chrome-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = fileURLToPath(new URL('test-results/', import.meta.url));
const context = await chromium.launchPersistentContext('', {
  channel: 'chrome',
  executablePath: process.env.CBOJ_CHROME || undefined,
  headless: true, chromiumSandbox: true, viewport: { width: 1280, height: 800 },
  ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--enable-unsafe-extension-debugging'],
});
try {
  context.setDefaultTimeout(12_000);
  const reads = { document: 0, stylesheet: 0, font: 0 };
  await context.route(/^https?:/, route => {
    const request = route.request();
    const url = new URL(request.url());
    const kind = request.resourceType();
    const problem = request.isNavigationRequest() && ['acmicpc.net', 'www.acmicpc.net'].includes(url.hostname)
      && url.pathname === '/problem/1000' && !url.search;
    if (request.method() !== 'GET' || url.protocol !== 'https:') return route.abort();
    if (!(kind === 'document' && problem) && !['stylesheet', 'font'].includes(kind)) return route.abort();
    reads[kind]++;
    return route.continue();
  });
  const cdp = await context.browser().newBrowserCDPSession();
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: root });
  assert.equal(id, 'mabfdombglhmfnjklbnoglebinejifdi');
  const worker = await extensionWorker(context, root, id);
  const host = await worker.evaluate(async () => {
    try {
      const result = await chrome.runtime.sendNativeMessage('com.convenient_boj.runner', { type: 'info' });
      return result.version;
    } catch (error) { return error.message; }
  });
  console.log('Chrome', context.browser().version(), 'registered native host:', host);
  const page = await context.newPage();
  const response = await page.goto('https://acmicpc.net/problem/1000', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  assert.equal(response?.status(), 200);
  await page.locator('#sample-input-1').waitFor();
  await page.locator('#sample-output-1').waitFor();
  const statement = await page.locator('#problem_description').elementHandle();
  const original = await statement.innerHTML();
  await mkdir(output, { recursive: true });
  await page.locator('.cboj-toggle').waitFor();
  await page.screenshot({ path: path.join(output, 'live-toggle.png') });
  await page.locator('.cboj-toggle').click();
  await focusedEditor(page);
  assert.equal(await statement.evaluate(el => el === document.querySelector('#problem_description')), true);
  assert.equal(await statement.innerHTML(), original);
  const styles = await page.locator('link[rel~="stylesheet"]').evaluateAll(links => links.map(link => ({
    file: new URL(link.href).pathname.split('/').pop(), loaded: Boolean(link.sheet),
  })));
  console.log('Public page', page.url(), await page.title(), 'stylesheets', styles);
  await page.screenshot({ path: path.join(output, 'live-problem.png') });
  if (process.argv.includes('--msvc')) {
    assert.match(host, /^2\./);
    const badge = page.locator('.cboj-where');
    await badge.filter({ hasText: 'MSVC' }).waitFor();
    await loadCode(page, [
      '#include <iostream>',
      'static_assert(sizeof(void*) == 8 && _MSVC_LANG == 201703L);',
      'int main() {',
      '    int a, b;',
      '    std::cin >> a >> b;',
      '    std::cout << a + b;',
      '}',
    ].join('\n'));
    const runs = [];
    for (const note of ['새로 컴파일', '캐시 재사용']) {
      await page.locator('.cboj-toolbar .run').click();
      await page.locator('.cboj-term-out').getByText(note, { exact: false }).waitFor({ timeout: 45_000 });
      await page.locator('.cboj-status').filter({ hasText: '예제 통과' }).waitFor();
      const log = (await page.locator('.cboj-term-out').innerText()).trim();
      runs.push(log);
      console.log('Public MSVC run', log);
    }
    assert.equal(await statement.innerHTML(), original);
    await page.screenshot({ path: path.join(output, 'live-msvc-pass.png') });
    await writeFile(path.join(output, 'live-msvc.json'), JSON.stringify({
      url: page.url(), status: response.status(), chrome: context.browser().version(), extensionId: id,
      host, reads, stylesheetsLoaded: styles.filter(s => s.loaded).length, statementPreserved: true, runs,
    }, null, 2) + '\n');
  }
} finally {
  await context.close();
}
