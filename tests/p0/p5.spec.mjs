import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect } from '@playwright/test';
import { editorFrame, extensionId, loadCode, openPanel, origin, problem, stored, test } from './chrome-fixture.mjs';

const java = ['import java.io.*;', 'import java.util.*;', '', 'public final class Main {',
  '    public static void main(String[] args) throws IOException {',
  '        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));',
  '        StringTokenizer parts = new StringTokenizer(br.readLine());',
  '        System.out.println(Integer.parseInt(parts.nextToken()) + Integer.parseInt(parts.nextToken()));',
  '    }', '}'].join('\n');
const state = f => f.evaluate(async () => {
  const { editor } = await import('/vendor/monaco/editor.js');
  const v = editor.getEditors()[0], m = v.getModel();
  return { language: m.getLanguageId(), file: m.uri.path, code: m.getValue(), position: v.getPosition() };
});
async function popup(lab) {
  const p = await lab.context.newPage();
  await p.goto('chrome-extension://' + extensionId + '/popup/popup.html');
  return p;
}
async function javaProblem(lab, pid) {
  const p = await problem(lab, pid); await openPanel(p);
  await p.locator('.cboj-lang').selectOption('93'); await expect(p.locator('.cboj-lang')).toBeEnabled();
  return p;
}
async function form(lab, p) {
  const opened = lab.context.waitForEvent('page');
  await p.locator('.cboj-toolbar .submit').click();
  const tab = await opened; await expect(tab.locator('#cboj-banner')).toBeVisible();
  expect(await tab.evaluate(() => window.fixtureSubmitCount)).toBe(0);
  return tab;
}

test('upstream Java drafts, templates, backup, completion preference and managed language selection', async ({ lab }) => {
  const draft = { code: '// 이전 초안 🙂\r\npublic class Main {}', cursor: { line: 1, ch: 6 }, at: 42 };
  await lab.worker.evaluate(draft => chrome.storage.local.set({ 'draft:1000:java': draft }), draft);
  const settings = await popup(lab);
  await settings.locator('#tplLang [data-lang=java]').click();
  await expect(settings.locator('#tplText')).toHaveValue(/BufferedReader[\s\S]+\$0/);
  await settings.locator('#tplText').fill('class Main { /*$0*/ }'); await settings.locator('#tplSave').click();
  const p = await javaProblem(lab), f = await editorFrame(p);
  expect(await state(f)).toMatchObject({ language: 'java', file: '/ConvenientBOJ/1000/Main.java', code: draft.code,
    position: { lineNumber: 2, column: 7 } });
  expect(await lab.worker.evaluate(() => self.fixtureIO.analysisCalls.slice(-1)[0]?.language)).not.toBe('java');
  await settings.locator('details').filter({ has: settings.locator('#backup-export') }).locator('summary').click();
  const saved = settings.waitForEvent('download'); await settings.locator('#backup-export').click();
  const backup = JSON.parse(await readFile(await (await saved).path(), 'utf8'));
  expect(backup.local['draft:1000:java'].code).toBe(draft.code);
  expect(backup.sync.templates.java).toBe('class Main { /*$0*/ }');
  const restore = { ...backup, sync: {}, local: { 'draft:8421:java': draft, 'timer:8421': { elapsed: 1250, since: null, solved: null },
    workspaceSnippets: { java: [{ id:'java-1', prefix:'fastread', body:'br.readLine()' }] } } };
  await settings.locator('#backup-file').setInputFiles({ name: 'java.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(restore)) });
  await expect.poll(() => stored(lab.worker, 'local', 'draft:8421:java')).toEqual(draft);
  expect(await stored(lab.worker, 'local', 'timer:8421')).toEqual(restore.local['timer:8421']);
  const tab = await form(lab, p);
  await expect(tab.locator('select')).toHaveValue('93');
  expect(await tab.locator('.CodeMirror').evaluate(el => el.CodeMirror.getValue())).toBe(draft.code.replaceAll('\r\n', '\n'));
  await tab.close();
  await settings.locator('.polish-settings summary').click();
  await settings.locator('label').filter({ has: settings.locator('[data-key=autocomplete]') }).click();
  const other = await javaProblem(lab, '1001'), frame = await editorFrame(other);
  expect((await state(frame)).code).toBe('class Main { /**/ }');
  await loadCode(other, 'pub'); await other.keyboard.press('End');
  await expect(frame.locator('.suggest-widget.visible')).toHaveCount(0);
  await other.keyboard.press('Control+Space');
  await expect(frame.locator('.suggest-widget.visible')).toContainText('public');
  await other.keyboard.press('Escape');
  // The official fixture can omit the chosen language. An incoming list must
  // never reclassify this live Java buffer as C++.
  await lab.worker.evaluate(() => chrome.storage.local.set({ cbojLangs: [{ id: '84', name: 'C++17' }] }));
  await expect(other.locator('.cboj-lang')).toHaveValue('93'); await other.keyboard.press('Control+s');
  await expect.poll(() => stored(lab.worker, 'local', 'draft:1001:java')).toMatchObject({ code: 'pub' });
  expect((await stored(lab.worker, 'local', 'draft:1001:cpp'))?.code).not.toBe('pub');
});

test('stack preference reaches capable Windows compilers and an older helper keeps its original messages', async ({ lab }) => {
  await lab.worker.evaluate(() => {
    self.fixtureIO.native = {
      info: [{ type: 'info', version: '2.1.0', protocol: 2, msvc: 'test MSVC', gcc: 'test gcc', gpp: 'test g++', stackSizeMiB: true }],
      batch: [{ type: 'batch-result', cmd: 'test compiler', results: ['5','9'].map(stdout => ({ stdout, stderr: '', code: 0 })) }],
    };
  });
  const settings = await popup(lab);
  await settings.locator('.polish-settings summary').click();
  const stack = settings.locator('#cpp-stack');
  await expect(stack).toHaveValue('256');
  await stack.fill('8'); await stack.press('Tab');
  await expect.poll(() => stored(lab.worker, 'sync', 'stackSizeMiB')).toBe(8);
  await stack.fill('513'); await stack.press('Tab'); await expect(stack).toHaveValue('8');
  const p = await problem(lab); await openPanel(p);
  const run = async page => {
    await page.locator('.cboj-toolbar .run').click();
    await expect(page.locator('.cboj-status')).toHaveText('예제 통과');
    return lab.worker.evaluate(() => self.fixtureIO.nativeCalls.filter(m => m.type === 'batch').at(-1));
  };
  expect(await run(p)).toMatchObject({ compiler: 'msvc', stackSizeMiB: 8 });
  await p.locator('.cboj-lang').selectOption('75'); await expect(p.locator('.cboj-lang')).toBeEnabled();
  expect(await run(p)).toMatchObject({ compiler: 'gcc', stackSizeMiB: 8 });
  await lab.worker.evaluate(() => {
    const info = self.fixtureIO.native.info[0];
    delete info.stackSizeMiB; info.version = '2.0.0';
  });
  const old = await problem(lab, '1001'); await openPanel(old);
  expect(await run(old)).not.toHaveProperty('stackSizeMiB');
  await old.locator('.cboj-lang').selectOption('93');
  await expect(old.locator('.cboj-where')).toContainText('JDK 없음');
  old.once('dialog', d => d.dismiss()); await old.locator('.cboj-toolbar .run').click();
  await expect(old.locator('.cboj-status')).toHaveText('중지됨');
  expect(await lab.worker.evaluate(() => self.fixtureIO.remoteCalls.length)).toBe(0);
});

test('per-problem stopwatch synchronizes tabs and freezes only on its owned AC', async ({ lab }, t) => {
  await lab.worker.evaluate(() => chrome.storage.local.set({ 'timer:1000': { elapsed: 3723000, since: null, solved: null } }));
  const a = await problem(lab), b = await problem(lab), other = await problem(lab, '1001');
  for (const p of [a,b,other]) await openPanel(p);
  const button = p => p.locator('.cboj-timer');
  await expect(button(a)).toHaveText('⏱ 1:02:03'); await expect(button(other)).toHaveText('⏱ 00:00');
  await button(a).click(); await expect(button(b)).toHaveAttribute('aria-pressed', 'true');
  await b.locator('.cboj-toggle').click();
  const tab = await form(lab, a);
  await tab.goto(origin + '/status?solution_id=93001');
  await expect(a.locator('.cboj-card')).toContainText('20%');
  expect((await stored(lab.worker, 'local', 'timer:1000')).since).toBeGreaterThan(0);
  await tab.locator('.result-text').evaluate(el => { el.textContent = '맞았습니다!!'; el.classList.add('result-ac'); });
  await expect(a.locator('.cboj-card.ac')).toContainText('풀이 시간 1:02:');
  const stopped = await stored(lab.worker, 'local', 'timer:1000');
  expect(stopped.since).toBeNull(); expect(stopped.solved).toBe(stopped.elapsed);
  expect(await stored(lab.worker, 'local', 'timer:1001')).toBeUndefined();
  await openPanel(b); await expect(button(b)).toHaveAttribute('aria-pressed', 'false');
  await a.screenshot({ path: t.outputPath('accepted-timer.png') });
  await button(b).click(); await expect(button(b)).toHaveAttribute('aria-pressed', 'true');
  await button(b).click(); await expect(button(a)).toHaveAttribute('aria-pressed', 'false');
  a.once('dialog', d => d.dismiss()); await a.locator('.cboj-timer-reset').click();
  expect((await stored(lab.worker, 'local', 'timer:1000')).elapsed).toBeGreaterThanOrEqual(stopped.elapsed);
  a.once('dialog', d => d.accept()); await a.locator('.cboj-timer-reset').click(); await expect(button(b)).toHaveText('⏱ 00:00');
  await a.reload(); await openPanel(a); await expect(button(a)).toHaveText('⏱ 00:00');
  await lab.worker.evaluate(() => chrome.storage.sync.set({ timerAutoStart: true }));
  const fresh = await problem(lab, '1002'); await openPanel(fresh);
  await expect(button(fresh)).toHaveAttribute('aria-pressed', 'true');
  await fresh.locator('.cboj-toggle').click(); await openPanel(fresh); await expect(button(fresh)).toHaveAttribute('aria-pressed', 'true');
});

test('Wandbox Java, consent, transient retries, global concurrency, ordering and cancellation', async ({ lab }, t) => {
  const p = await javaProblem(lab), q = await javaProblem(lab, '1001');
  await loadCode(p, java); await loadCode(q, java);
  await lab.worker.evaluate(() => {
    const io = self.fixtureIO;
    io.trace = []; io.attempt = {}; io.active = 0; io.peak = 0;
    self.fetch = async (url, options) => {
      if (url.endsWith('/list.json')) return Response.json([{ name: 'openjdk-jdk-22+36' }, { name: 'openjdk-jdk-21+35' }]);
      const body = JSON.parse(options.body), input = body.stdin;
      io.trace.push(body); io.active++; io.peak = Math.max(io.active, io.peak);
      try {
        io.attempt[input] = (io.attempt[input] || 0) + 1;
        if (input === '2 3\n' && io.attempt[input] === 1) return new Response('', { status: 429 });
        if (input === '2 3\n' && io.attempt[input] === 2) throw TypeError('fixture network error');
        await new Promise(resolve => setTimeout(resolve, 125));
        return Response.json({ status: '0', program_output: input === '2 3\n' ? '5' : input === '4 5\n' ? '9' : input });
      } finally { io.active--; }
    };
  });
  p.once('dialog', d => d.dismiss()); await p.locator('.cboj-toolbar .run').click();
  await expect(p.locator('.cboj-status')).toHaveText('중지됨');
  expect(await lab.worker.evaluate(() => self.fixtureIO.trace.length)).toBe(0);
  await lab.worker.evaluate(async () => {
    const cases = Array.from({ length: 6 }, (_, i) => ({ id: 'case-' + i, input: String(i), expected: String(i), on: true }));
    await chrome.storage.local.set({ runnerChoice: 'wandbox', 'cases:1000': cases, 'cases:1001': cases });
  });
  await p.locator('.cboj-toolbar .run').click();
  await expect.poll(() => lab.worker.evaluate(() => self.fixtureIO.attempt['2 3\n'])).toBe(2);
  await q.locator('.cboj-toolbar .run').click();
  for (const page of [p,q]) await expect(page.locator('.cboj-status')).toHaveText('테스트 통과');
  const { trace, peak } = await lab.worker.evaluate(() => ({ trace: self.fixtureIO.trace, peak: self.fixtureIO.peak }));
  expect(peak).toBe(3);
  expect(trace.filter(row => row.stdin === '2 3\n')).toHaveLength(4);
  expect(trace.every(body => body.compiler === 'openjdk-jdk-22+36' && body.save === false && body.codes[0].code === java
    && body.codes[0].file === 'Main.java' && body['compiler-option-raw'] === '--release\n11\nMain.java')).toBe(true);
  const fixture = t.outputPath('provider-java'); await mkdir(fixture);
  await writeFile(path.join(fixture, 'prog.java'), trace[0].code);
  await writeFile(path.join(fixture, 'Main.java'), trace[0].codes[0].code);
  execFileSync('javac', ['prog.java', ...trace[0]['compiler-option-raw'].split('\n')], { cwd: fixture, windowsHide: true, timeout: 30000 });
  expect(execFileSync('java', ['Main'], { cwd: fixture, input: '3 4\n', encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim()).toBe('7');
  const log = await p.locator('.cboj-term-out').innerText(); expect(log.indexOf('예제 1')).toBeLessThan(log.indexOf('예제 2'));
  await lab.worker.evaluate(() => {
    self.fixtureIO.failures = 0;
    self.fetch = async () => { self.fixtureIO.failures++; return new Response('', { status: 503, headers: { 'Retry-After': '8' } }); };
  });
  await p.locator('.cboj-toolbar .run').click(); await expect.poll(() => lab.worker.evaluate(() => self.fixtureIO.failures)).toBe(1);
  await p.locator('.cboj-toolbar .stop').click(); await expect(p.locator('.cboj-status')).toHaveText('중지됨');
  await expect.poll(() => lab.worker.evaluate(() => remoteJobs.size)).toBe(0);
  expect(await lab.worker.evaluate(() => self.fixtureIO.failures)).toBe(1);
});

test('Wandbox surfaces HTTP, protocol and timeout errors and rejects untrusted requests', async ({ lab }) => {
  const results = await lab.worker.evaluate(async () => {
    const sender = { id: chrome.runtime.id, frameId: 0, tab: { id: 100 }, url: 'https://www.acmicpc.net/problem/1000' };
    const request = { type: 'cboj:run', code: 'class Main {}', stdin: '', lang: { kind: 'java' }, remoteConfirmed: true };
    let calls = 0, next;
    self.fetch = async url => {
      if (url.endsWith('list.json')) return Response.json([]);
      calls++; return next();
    };
    const go = (m, s = sender) => HANDLERS['cboj:run'](m, s);
    const denied = [await go({ ...request, remoteConfirmed: false }), await go(request, { ...sender, frameId: 1 }),
      await go({ ...request, lang: { kind: 'java', release: '--help' } })];
    const deniedCalls = calls, rows = [];
    for (const [label, callback] of [
      ['bad request', () => new Response('', { status: 400 })],
      ['server', () => new Response('', { status: 503 })],
      ['rate', () => new Response('', { status: 429, headers: { 'Retry-After': '60' } })],
      ['body', () => new Response('bad json')],
      ['timeout', () => { throw new DOMException('fixture deadline', 'AbortError'); }],
      ['compiler', () => Response.json({ status: '1', compiler_error: 'Main.java:1: error: fixture' })],
    ]) {
      next = callback; calls = 0; rows.push({ label, result: await go(request), calls });
    }
    return { denied: denied.every(row => row.ok === false), deniedCalls, rows };
  });
  expect(results.denied && results.deniedCalls === 0).toBe(true);
  expect(results.rows.map(r => r.calls)).toEqual([1,3,1,1,1,1]);
  expect(results.rows.slice(0,5).every(r => !r.result.ok)).toBe(true);
  for (const [i, text] of ['400','503','바빠요','결과','40초'].entries()) expect(results.rows[i].result.error).toContain(text);
  expect(results.rows[5].result.compileError).toContain('Main.java:1');
});

test.describe('registered JDK', () => {
  test.use({ realHost: true });
  test('real Java batch, reusable classes, themes, narrow toolbar and model disposal', async ({ lab }, t) => {
    const info = await lab.worker.evaluate(name => chrome.runtime.sendNativeMessage(name, { type: 'info', protocol: 2 }),
      process.env.CBOJ_P41_HOST || 'com.convenient_boj.runner');
    expect(info.javac).toMatch(/^javac /); expect(info.stackSizeMiB).toBe(true);
    await lab.worker.evaluate(() => chrome.storage.sync.set({ lastLangId: '93', timerAutoStart: true }));
    const p = await problem(lab); await openPanel(p); const f = await editorFrame(p);
    await expect(p.locator('.cboj-where')).toContainText('javac', { timeout: 50000 });
    await loadCode(p, java); await p.locator('.cboj-toolbar .run').click();
    await expect(p.locator('.cboj-status')).toHaveText('예제 통과', { timeout: 45000 });
    await p.locator('.cboj-toolbar .run').click();
    await expect(p.locator('.cboj-term-out')).toContainText('캐시 재사용');
    await expect(f.locator('.view-lines')).toContainText('BufferedReader');
    const themes = ['light','dark','one-dark','dracula','monokai','nord','github-dark','tokyo-night'];
    const reports = [];
    for (const theme of themes) {
      await lab.worker.evaluate(theme => chrome.storage.sync.set({ editorTheme: theme }), theme);
      await expect.poll(() => f.evaluate(theme => document.body.style.getPropertyValue('--bg') === CBOJ_PALETTES[theme].base, theme)).toBe(true);
      const colors = await p.locator('.cboj-timer').evaluate(el => {
        const panel = el.closest('#cboj-panel');
        const luminance = rgb => rgb.match(/[\d.]+/g).slice(0,3).map(Number).map(n => n / 255)
          .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
          .reduce((sum, n, i) => sum + n * [0.2126,0.7152,0.0722][i], 0);
        const fg = getComputedStyle(el).color, bg = getComputedStyle(el.closest('.cboj-toolbar')).backgroundColor;
        const a = luminance(fg), b = luminance(bg === 'rgba(0, 0, 0, 0)' ? getComputedStyle(panel).backgroundColor : bg);
        return { fg, bg, contrast: (Math.max(a,b) + .05) / (Math.min(a,b) + .05) };
      });
      expect(colors.contrast).toBeGreaterThanOrEqual(4.5);
      reports.push({ theme, ...colors });
      if (theme === 'light' || theme === 'dracula') await p.screenshot({ path: t.outputPath('java-' + theme + '.png') });
    }
    await p.setViewportSize({ width: 420, height: 780 });
    const toolbar = p.locator('.cboj-toolbar'); await expect(toolbar.getByTitle('분할 화면 닫기')).toBeInViewport();
    expect(await toolbar.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await p.screenshot({ path: t.outputPath('java-narrow.png') });
    await toolbar.getByTitle('분할 화면 닫기').click();
    await expect(f.locator('.monaco-editor')).toHaveCount(0);
    await writeFile(t.outputPath('theme-contrast.json'), JSON.stringify({ chrome: lab.context.browser().version(), info, reports }, null, 2));
  });
});
