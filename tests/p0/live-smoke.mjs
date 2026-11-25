// Optional anonymous read-only check. The default test suite uses local HTML.
import { strict as assert } from 'node:assert';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

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
  await context.route(/^https?:/, route => {
    const request = route.request();
    const url = new URL(request.url());
    const problem = ['acmicpc.net', 'www.acmicpc.net'].includes(url.hostname) && url.pathname === '/problem/1000';
    if (request.method() !== 'GET' || url.protocol !== 'https:' || (request.isNavigationRequest() && !problem)) {
      return route.abort();
    }
    return route.continue();
  });
  const cdp = await context.browser().newBrowserCDPSession();
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: root });
  assert.equal(id, 'mabfdombglhmfnjklbnoglebinejifdi');
  const isWorker = w => w.url() === 'chrome-extension://' + id + '/background.js';
  const worker = context.serviceWorkers().find(isWorker) || await context.waitForEvent('serviceworker', { predicate: isWorker });
  const host = await worker.evaluate(async () => {
    try {
      const result = await chrome.runtime.sendNativeMessage('com.convenient_boj.runner', { type: 'info' });
      return result.version;
    } catch (error) { return error.message; }
  });
  console.log('Chrome', context.browser().version(), 'registered native host:', host);
  const page = await context.newPage();
  const response = await page.goto('https://www.acmicpc.net/problem/1000', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  assert.equal(response?.status(), 200);
  await page.locator('#sample-input-1').waitFor();
  await page.locator('#sample-output-1').waitFor();
  const statement = await page.locator('#problem_description').elementHandle();
  const original = await statement.innerHTML();
  await mkdir(output, { recursive: true });
  await page.locator('.cboj-toggle').waitFor();
  await page.screenshot({ path: path.join(output, 'live-toggle.png') });
  await page.locator('.cboj-toggle').click();
  await page.locator('.CodeMirror-focused').waitFor();
  assert.equal(await statement.evaluate(el => el === document.querySelector('#problem_description')), true);
  assert.equal(await statement.innerHTML(), original);
  const styles = await page.locator('link[rel~="stylesheet"]').evaluateAll(links => links.map(link => ({
    file: new URL(link.href).pathname.split('/').pop(), loaded: Boolean(link.sheet),
  })));
  console.log('Public page', page.url(), await page.title(), 'stylesheets', styles);
  await page.screenshot({ path: path.join(output, 'live-problem.png') });
} finally {
  await context.close();
}
