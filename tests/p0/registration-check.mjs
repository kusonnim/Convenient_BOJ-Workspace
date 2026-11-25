// Check Chrome's actual native registration before or after running the installer.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const expected = process.argv[2];
assert.ok(['installed', 'missing'].includes(expected), 'Use installed or missing');
const context = await chromium.launchPersistentContext('', {
  channel: 'chrome', executablePath: process.env.CBOJ_CHROME || undefined,
  headless: true, chromiumSandbox: true, ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--enable-unsafe-extension-debugging', '--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND'],
});
try {
  const cdp = await context.browser().newBrowserCDPSession();
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: fileURLToPath(new URL('../../', import.meta.url)) });
  assert.equal(id, 'mabfdombglhmfnjklbnoglebinejifdi');
  const isRunner = w => w.url() === 'chrome-extension://' + id + '/background.js';
  const worker = context.serviceWorkers().find(isRunner) || await context.waitForEvent('serviceworker', { predicate: isRunner });
  const response = await worker.evaluate(async () => {
    try { return await chrome.runtime.sendNativeMessage('com.convenient_boj.runner', { type: 'info', protocol: 2 }); }
    catch (error) { return error.message; }
  });
  if (expected === 'missing') assert.match(String(response), /specified native messaging host not found/i);
  else assert.equal(response.protocol, 2);
  console.log(JSON.stringify({ chrome: context.browser().version(), id, expected, response }, null, 2));
} finally {
  await context.close();
}
