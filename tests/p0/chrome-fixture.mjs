import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test as base } from '@playwright/test';
import { extensionWorker } from './extension-worker.mjs';

export const origin = 'https://www.acmicpc.net';
export const extensionId = 'mabfdombglhmfnjklbnoglebinejifdi';
const root = fileURLToPath(new URL('../../', import.meta.url));
const files = fileURLToPath(new URL('fixtures/', import.meta.url));
const packageFiles = ['manifest.json', 'background.js', 'content', 'editor', 'popup', 'shared', 'icons', 'vendor', 'host'];

// Only the two external endpoints of background.js are doubled. Chrome owns
// both script worlds, storage, tab selection, runtime messages and tab ports.
function installDoubles(hostName) {
  const io = self.fixtureIO = { native: null, nativeCalls: [], analysisCalls: [], remote: {}, remoteCalls: [] };
  chrome.runtime.connectNative = name => {
    if (name !== hostName || !io.native) throw Error('Fixture host unavailable');
    let deliver;
    return {
      onMessage: { addListener: fn => { deliver = fn; } },
      onDisconnect: { addListener() {} },
      disconnect() {},
      postMessage(message) {
        if (message.type.startsWith('analysis-')) {
          io.analysisCalls.push(message);
          if (message.type === 'analysis-info') deliver(io.analysis
            ? { type: 'analysis-info', version: 1 } : { type: 'error', error: 'unsupported command' });
          if (message.type === 'analysis-open' && io.analysis) deliver({ type: 'analysis-unavailable', reason: io.analysis });
          return;
        }
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
  realHost: [false, { option: true }],
  backForwardCache: [false, { option: true }],
  unpacked: [async ({}, use, workerInfo) => {
    const dir = path.join(workerInfo.project.outputDir, 'unpacked');
    await mkdir(dir, { recursive: true });
    for (const file of packageFiles) await cp(path.join(process.env.CBOJ_P41_UNPACKED || root, file), path.join(dir, file), { recursive: true });
    await use(dir);
  }, { scope: 'worker' }],

  lab: [async ({ unpacked, realHost, backForwardCache }, use, testInfo) => {
    const nativeTemp = testInfo.outputPath('native-temp');
    await mkdir(nativeTemp, { recursive: true });
    const context = await chromium.launchPersistentContext('', {
      channel: 'chrome',
      executablePath: process.env.CBOJ_CHROME || undefined,
      headless: true,
      chromiumSandbox: true,
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      env: { ...process.env, TEMP: nativeTemp, TMP: nativeTemp, TMPDIR: nativeTemp },
      ignoreDefaultArgs: backForwardCache ? ['--disable-extensions', '--disable-back-forward-cache'] : ['--disable-extensions'],
      args: ['--enable-unsafe-extension-debugging', '--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND'],
    });
    try {
      const badRequests = [];
      await context.route(/^https?:/, async route => {
        const url = new URL(route.request().url());
        if (url.origin === origin && route.request().method() === 'GET') {
          if (['/fixtures/codemirror.js', '/fixtures/codemirror.css'].includes(url.pathname)) {
            return route.fulfill({ path: path.join(files, 'codemirror', path.basename(url.pathname)) });
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
      const worker = await extensionWorker(context, unpacked, id);
      if (!realHost) await worker.evaluate(installDoubles, process.env.CBOJ_P41_HOST || 'com.convenient_boj.runner');
      await use({ context, worker, nativeTemp });
      expect(badRequests).toEqual([]);
    } finally {
      try { await Promise.all(context.pages().map(p => p.close())); }
      finally { await context.close(); }
    }
  }, { timeout: 90_000 }],
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
  // A fresh automatic C++ template awaits the P1 compiler probe (45 s).
  // The language control becomes enabled once the document has been chosen.
  await expect(page.locator('.cboj-lang')).toBeEnabled({ timeout: 50000 });
  await focusedEditor(page);
}

export async function editorFrame(page, id = extensionId) {
  const match = f => f.url().startsWith('chrome-extension://' + id + '/editor/frame.html');
  return page.frames().find(match) || page.waitForEvent('framenavigated', { predicate: match });
}
export async function focusedEditor(page) {
  const frame = await editorFrame(page);
  await expect(frame.locator('.monaco-editor.focused')).toBeVisible({ timeout: 20000 });
  return frame;
}
export async function editorLines(page) {
  return (await editorFrame(page)).locator('.view-lines');
}
export function editorInput(frame) {
  return frame.locator('.monaco-editor .native-edit-context, .monaco-editor textarea.inputarea');
}
export async function observeComposition(frame) {
  return editorInput(frame).evaluate(node => {
    const target = node.editContext || node;
    window.testComposition = [];
    for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'textupdate', 'beforeinput', 'input']) {
      target.addEventListener(type, e => window.testComposition.push({
        type, text: e.text ?? e.data ?? '', trusted: e.isTrusted, inputType: e.inputType,
      }), true);
    }
    return node.editContext ? 'EditContext' : 'textarea';
  });
}
export async function loadCode(page, code) {
  const frame = await editorFrame(page);
  const input = editorInput(frame);
  await input.focus();
  await page.keyboard.press('Control+a');
  // Chrome's Input.insertText sends a typing operation: Monaco legitimately
  // auto-indents new lines. Use the paste handler for a whole source file.
  await input.evaluate((node, text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    node.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  }, code);
}

export function stored(worker, area, key) {
  return worker.evaluate(async ([area, key]) => (await chrome.storage[area].get(key))[key], [area, key]);
}

export const info = { type: 'info', version: '1.0.0', python: '3.12', gcc: 'fixture gcc', gpp: 'fixture g++' };
