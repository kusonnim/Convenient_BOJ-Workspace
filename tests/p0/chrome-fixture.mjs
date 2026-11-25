import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test as base } from '@playwright/test';

export const origin = 'https://www.acmicpc.net';
export const extensionId = 'mabfdombglhmfnjklbnoglebinejifdi';
const root = fileURLToPath(new URL('../../', import.meta.url));
const files = fileURLToPath(new URL('fixtures/', import.meta.url));
const packageFiles = ['manifest.json', 'background.js', 'content', 'popup', 'shared', 'icons', 'vendor', 'host'];

// Only the two external endpoints of background.js are doubled. Chrome owns
// both script worlds, storage, tab selection, runtime messages and tab ports.
function installDoubles() {
  const io = self.fixtureIO = { native: null, nativeCalls: [], remote: {}, remoteCalls: [] };
  chrome.runtime.connectNative = name => {
    if (name !== 'com.convenient_boj.runner' || !io.native) throw Error('Fixture host unavailable');
    let deliver;
    return {
      onMessage: { addListener: fn => { deliver = fn; } },
      onDisconnect: { addListener() {} },
      disconnect() {},
      postMessage(message) {
        io.nativeCalls.push(message);
        for (const reply of io.native[message.type] || []) {
          deliver({ id: message.id, ...reply });
        }
      },
    };
  };
  self.fetch = async (url, options) => {
    if (url === 'https://wandbox.org/api/list.json') {
      return Response.json([{ name: 'gcc-13.2.0' }, { name: 'cpython-3.13.18' }]);
    }
    if (url !== 'https://wandbox.org/api/compile.json') throw Error('Unexpected fixture URL');
    const body = JSON.parse(options.body);
    io.remoteCalls.push(body);
    if (!Object.hasOwn(io.remote, body.stdin)) throw Error('Unconfigured Wandbox fixture input');
    return Response.json(io.remote[body.stdin]);
  };
}

export const test = base.extend({
  unpacked: [async ({}, use, workerInfo) => {
    const dir = path.join(workerInfo.project.outputDir, 'unpacked');
    await mkdir(dir, { recursive: true });
    for (const file of packageFiles) await cp(path.join(root, file), path.join(dir, file), { recursive: true });
    await use(dir);
  }, { scope: 'worker' }],

  lab: async ({ unpacked }, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chrome',
      executablePath: process.env.CBOJ_CHROME || undefined,
      headless: true,
      chromiumSandbox: true,
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: ['--enable-unsafe-extension-debugging', '--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND'],
    });
    try {
      const badRequests = [];
      await context.route(/^https?:/, async route => {
        const url = new URL(route.request().url());
        if (url.origin === origin && route.request().method() === 'GET') {
          if (['/fixtures/codemirror.js', '/fixtures/codemirror.css'].includes(url.pathname)) {
            return route.fulfill({ path: path.join(unpacked, 'vendor/codemirror', path.basename(url.pathname)) });
          }
          let name;
          if (/^\/problem\/\d+$/.test(url.pathname)) name = 'problem';
          if (/^\/submit\/\d+$/.test(url.pathname)) name = 'submit';
          if (url.pathname === '/status') name = 'status';
          if (name) return route.fulfill({ path: path.join(files, name + '.html'), contentType: 'text/html; charset=utf-8' });
          if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204 });
        }
        badRequests.push(route.request().method() + ' ' + url.origin + url.pathname);
        return route.abort();
      });
      const cdp = await context.browser().newBrowserCDPSession();
      const { id } = await cdp.send('Extensions.loadUnpacked', { path: unpacked });
      expect(id).toBe(extensionId);
      const isWorker = w => w.url() === 'chrome-extension://' + id + '/background.js';
      const worker = context.serviceWorkers().find(isWorker)
        || await context.waitForEvent('serviceworker', { predicate: isWorker });
      await worker.evaluate(installDoubles);
      await use({ context, worker });
      expect(badRequests).toEqual([]);
    } finally {
      await context.close();
    }
  },
});

export async function problem(lab, pid = '1000') {
  const page = await lab.context.newPage();
  await page.goto(origin + '/problem/' + pid);
  await expect(page.locator('.cboj-toggle')).toBeVisible();
  return page;
}

export async function openPanel(page) {
  await page.locator('.cboj-toggle').click();
  await expect(page.locator('#cboj-panel')).toBeVisible();
  await expect(page.locator('.cboj-lang option:checked')).toHaveCount(1);
  await expect(page.locator('.CodeMirror-focused')).toBeVisible();
}

export async function loadCode(page, code) {
  await page.locator('.CodeMirror textarea').focus();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(code);
}

export function stored(worker, area, key) {
  return worker.evaluate(async ([area, key]) => (await chrome.storage[area].get(key))[key], [area, key]);
}

export const info = { type: 'info', version: '1.0.0', python: '3.12', gcc: 'fixture gcc', gpp: 'fixture g++' };
