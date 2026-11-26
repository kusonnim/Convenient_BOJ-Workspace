// Check Chrome's actual native registration before or after running the installer.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { extensionWorker } from './extension-worker.mjs';

const expected = process.argv[2];
assert.ok(['installed', 'missing'].includes(expected), 'Use installed or missing');
const context = await chromium.launchPersistentContext('', {
  channel: 'chrome', executablePath: process.env.CBOJ_CHROME || undefined,
  headless: true, chromiumSandbox: true, ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--enable-unsafe-extension-debugging', '--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND'],
});
try {
  const cdp = await context.browser().newBrowserCDPSession();
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: root });
  assert.equal(id, 'mabfdombglhmfnjklbnoglebinejifdi');
  const worker = await extensionWorker(context, root, id);
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
