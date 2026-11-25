import { expect } from '@playwright/test';
import { editorFrame, editorInput, editorLines, focusedEditor, extensionId, info, loadCode, openPanel, origin, problem, stored, test } from './chrome-fixture.mjs';

const cpp = '#include <iostream>\n\nint main() {\n    int a, b;\n    std::cin >> a >> b;\n    std::cout << a + b;\n}';
const verdict = page => page.locator('.cboj-status');
const log = page => page.locator('.cboj-term-out');

async function launchSubmit(lab, page) {
  await expect(page.locator('.cboj-btn.submit')).toBeEnabled();
  await editorInput(await editorFrame(page)).focus();
  const opened = lab.context.waitForEvent('page');
  await page.keyboard.press('Control+Shift+Enter');
  const tab = await opened;
  await expect(tab.locator('#cboj-banner')).toBeVisible();
  return tab;
}

test('split toggle, statement identity and both persisted resize handles', async ({ lab }, testInfo) => {
  const page = await problem(lab);
  const statement = await page.locator('#problem-body').elementHandle();
  const before = await statement.innerHTML();
  await openPanel(page);
  await page.screenshot({ path: testInfo.outputPath('split.png') });
  for (const [selector, x, y] of [['.cboj-resizer-x', 576, 250], ['.cboj-resizer-y', 900, 490]]) {
    const box = await page.locator(selector).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 4 });
    await page.mouse.up();
  }
  await expect.poll(() => stored(lab.worker, 'local', 'cbojLayout')).toEqual({ width: 55, bottom: 310 });
  expect(await statement.evaluate(node => node === document.querySelector('#problem-body'))).toBe(true);
  expect(await statement.innerHTML()).toBe(before);
  await page.keyboard.press('Alt+c');
  await expect(page.locator('#cboj-panel')).toBeHidden();
  await page.reload();
  await expect(page.locator('.cboj-toggle')).toBeVisible();
  await page.keyboard.press('Alt+c');
  await expect(page.locator('#cboj-panel')).toBeVisible();
  await expect(page.locator('#cboj-panel')).toHaveCSS('width', '704px');
  await expect(page.locator('.cboj-bottom')).toHaveCSS('height', '310px');
});

test('old drafts, template cursor, language families and explicit save survive reload', async ({ lab }) => {
  await lab.worker.evaluate(async () => {
    await chrome.storage.sync.set({ indent: 'space', editorTheme: 'dark', templates: { py: 'print("$0")' } });
    await chrome.storage.local.set({ 'draft:1000:cpp': { code: '// old' } });
  });
  const page = await problem(lab);
  await openPanel(page);
  await expect(page.locator('#cboj-panel')).toHaveClass(/dark/);
  await page.keyboard.insertText('!');
  await page.keyboard.press('Control+s');
  const draft = family => stored(lab.worker, 'local', 'draft:1000:' + family);
  await expect.poll(() => draft('cpp')).toMatchObject({ code: '// old!', cursor: { line: 0, ch: 7 } });
  await page.locator('.cboj-lang').selectOption('95');
  await expect(await editorLines(page)).toContainText('// old!');
  await page.locator('.cboj-lang').selectOption('75');
  await expect(await editorLines(page)).toContainText('stdio.h');
  await page.locator('.cboj-lang').selectOption('28');
  await expect(await editorLines(page)).toContainText('print("")');
  await page.keyboard.insertText('한글');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Control+s');
  await expect.poll(() => draft('py')).toMatchObject({ code: 'print("한글")', cursor: { line: 0, ch: 8 } });
  await page.reload();
  await openPanel(page);
  await expect(page.locator('.cboj-lang')).toHaveValue('28');
  await page.keyboard.insertText('A');
  await page.keyboard.press('Control+s');
  await expect.poll(() => draft('py')).toMatchObject({ code: 'print("한A글")' });
  await expect.poll(() => draft('cpp')).toMatchObject({ code: '// old!' });
  const other = await problem(lab, '1001');
  await openPanel(other);
  await expect(await editorLines(other)).toContainText('print("")');
});

test('popup saves a template for fresh problems and preserves the previous value on quota rejection', async ({ lab }) => {
  const popup = await lab.context.newPage();
  // The popup has its own one-shot info probe, separate from the worker port.
  await popup.addInitScript(() => {
    chrome.runtime.sendNativeMessage = (_host, _msg, reply) => reply(null);
  });
  await popup.goto('chrome-extension://' + extensionId + '/popup/popup.html');
  const field = popup.locator('#tplText');
  await expect(field).toHaveValue(/bits\/stdc\+\+\.h/);
  await field.fill('// $0new template');
  await field.press('Control+s');
  await expect(popup.locator('#tplState')).toHaveClass(/saved/);
  await field.fill('한'.repeat(3000));
  await popup.locator('#tplSave').click();
  await expect(popup.locator('#tplState')).toHaveClass(/error/);
  expect(await stored(lab.worker, 'sync', 'templates')).toEqual({ cpp: '// $0new template' });
  await popup.locator('label.toggle').filter({ has: popup.locator('[data-key=splitAutoOpen]') }).click();
  const page = await problem(lab);
  await focusedEditor(page);
  await page.keyboard.insertText('a ');
  await page.keyboard.press('Control+s');
  await expect.poll(() => stored(lab.worker, 'local', 'draft:1000:cpp')).toMatchObject({ code: '// a new template' });
});

test('native batch UI distinguishes normalized pass, mismatch, compiler and runtime errors', async ({ lab }, testInfo) => {
  const good = { stdout: '5 \t\r\n\r\n', stderr: 'diagnostic only', code: 0, ms: 10 };
  const second = { stdout: '9\n', stderr: '', code: 0, ms: 12 };
  const batch = { type: 'batch-result', cmd: 'g++ -O2 -std=gnu++17 main.cpp', results: [good, second] };
  await lab.worker.evaluate(data => { self.fixtureIO.native = data; }, { info: [info], batch: [batch] });
  const page = await problem(lab);
  await openPanel(page);
  await loadCode(page, cpp);
  await page.keyboard.press('Control+Enter');
  await expect(verdict(page)).toHaveText('예제 통과');
  await expect(log(page)).toContainText('diagnostic only');
  const calls = await lab.worker.evaluate(() => self.fixtureIO.nativeCalls.filter(m => m.type === 'batch'));
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ code: cpp, lang: { kind: 'cpp', std: 'gnu++17' }, inputs: ['2 3\n', '4 5\n'], timeLimit: 10 });
  await page.screenshot({ path: testInfo.outputPath('pass.png') });
  const runWith = async reply => {
    await lab.worker.evaluate(reply => { self.fixtureIO.native.batch = [reply]; }, reply);
    await page.locator('.cboj-toolbar .run').click();
  };
  await loadCode(page, cpp.replace('<< a + b', '<< 5'));
  await runWith({ ...batch, results: [{ ...good, stderr: '' }, { ...second, stdout: '5\n' }] });
  await expect(verdict(page)).toHaveText('예제 1/2');
  await expect(log(page).locator('.tgrid pre')).toHaveText(['4 5', '9', '5']);
  await page.screenshot({ path: testInfo.outputPath('mismatch.png') });
  await runWith({ ...batch, results: [good, { ...second, code: 7, stderr: 'fixture exit' }] });
  await expect(log(page)).toContainText('종료 코드 7');
  await expect(log(page)).toContainText('fixture exit');
  await lab.worker.evaluate(() => chrome.storage.sync.set({ editorTheme: 'dark' }));
  await expect(page.locator('#cboj-panel')).toHaveClass(/dark/);
  await loadCode(page, 'int main() { return undeclared_fixture; }');
  const diagnostic = "main.cpp:1:21: error: 'undeclared_fixture' was not declared in this scope";
  await runWith({ ...batch, error: { code: 'compile', message: diagnostic }, results: [] });
  await expect(verdict(page)).toHaveText('컴파일 에러');
  await expect(log(page)).toContainText(diagnostic);
  await page.screenshot({ path: testInfo.outputPath('compile-dark.png') });
  expect(await lab.worker.evaluate(() => self.fixtureIO.remoteCalls)).toEqual([]);
});

test('missing host uses Wandbox fixtures for C, C++ and Python, including run-only samples', async ({ lab }) => {
  await lab.worker.evaluate(async () => {
    await chrome.storage.sync.set({ templates: { c: '// C ready', cpp: '// C++ ready', py: '# Python ready' } });
    self.fixtureIO.remote = { '2 3\n': { status: '0', program_output: '' }, '4 5\n': { status: '0', program_output: 'unjudged' } };
  });
  const page = await problem(lab);
  await page.locator('#sample-output-1').evaluate(el => { el.textContent = ''; });
  await page.locator('#sample-output-2').evaluate(el => el.remove());
  await openPanel(page);
  await expect(page.locator('.cboj-where')).toHaveText('● Wandbox');
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('.cboj-toolbar .run').click();
  await expect(verdict(page)).toHaveText('중지됨');
  expect(await lab.worker.evaluate(() => self.fixtureIO.remoteCalls)).toEqual([]);
  page.on('dialog', async dialog => {
    expect(dialog.message()).toContain('Wandbox(wandbox.org)');
    await dialog.accept();
  });
  for (const [id, template, code, compiler, std] of [
    ['75', '// C ready', 'int main(void) { return 0; }', 'gcc-13.2.0-c', '-std=gnu11'],
    ['95', '// C++ ready', 'int main() {}', 'gcc-13.2.0', '-std=gnu++20'],
    ['28', '# Python ready', 'pass', 'cpython-3.13.18', ''],
  ]) {
    await page.locator('.cboj-lang').selectOption(id);
    await expect(await editorLines(page)).toContainText(template);
    await loadCode(page, code);
    await lab.worker.evaluate(() => { self.fixtureIO.remoteCalls.length = 0; });
    await page.keyboard.press('Control+Enter');
    await expect.poll(() => lab.worker.evaluate(() => self.fixtureIO.remoteCalls.length)).toBe(2);
    await expect(verdict(page)).toHaveText('예제 통과');
    await expect(log(page)).toContainText('출력 확인 필요');
    const calls = await lab.worker.evaluate(() => self.fixtureIO.remoteCalls);
    expect(calls.map(c => c.stdin)).toEqual(['2 3\n', '4 5\n']);
    for (const c of calls) {
      expect(c).toMatchObject({ compiler, code, save: false });
      if (std) expect(c['compiler-option-raw'].split('\n')).toContain(std);
      else expect(c['compiler-option-raw']).toBe('');
    }
  }
});

test('interactive input, composing Enter, separate stderr, EOF and stop use the same job ID', async ({ lab }) => {
  await lab.worker.evaluate(() => chrome.storage.sync.set({ lastLangId: '28' }));
  await lab.worker.evaluate(data => { self.fixtureIO.native = data; }, {
    info: [info],
    run: [{ type: 'compile' }, { type: 'compiled', ok: true, cmd: 'python main.py' }, { type: 'start' }],
    stdin: [{ type: 'out', stream: 'stdout', data: 'fixture stdout\n' }, { type: 'out', stream: 'stderr', data: 'fixture stderr\n' }],
    eof: [{ type: 'exit', code: 0, ms: 10 }],
    kill: [{ type: 'exit', killed: true, ms: 10 }],
  });
  const page = await problem(lab);
  await openPanel(page);
  await expect(page.locator('.cboj-lang')).toHaveValue('28');
  await loadCode(page, 'import sys\nfor s in sys.stdin: print(s.strip())');
  await page.locator('[data-tab="term"]').click();
  const input = page.locator('.cboj-term-in');
  await page.locator('.cboj-term-actions .run').click();
  await expect(verdict(page)).toHaveText('● 실행 중');
  await input.fill('한글');
  await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  await expect(input).toHaveValue('한글');
  await input.press('Enter');
  await expect(page.locator('.tlive .err')).toHaveText('fixture stderr\n');
  await expect(page.locator('.tlive')).toContainText('fixture stdout');
  await input.press('Control+d');
  await expect(verdict(page)).toHaveText('실행 완료');
  await page.locator('.cboj-term-actions .run').click();
  await expect(verdict(page)).toHaveText('● 실행 중');
  await input.press('Control+c');
  await expect(verdict(page)).toHaveText('중지됨');
  const calls = await lab.worker.evaluate(() => self.fixtureIO.nativeCalls.filter(m => m.type !== 'info'));
  expect(calls.map(m => m.type)).toEqual(['run', 'stdin', 'eof', 'run', 'kill']);
  expect(calls[1]).toMatchObject({ id: calls[0].id, data: '한글\n' });
  expect(calls[2].id).toBe(calls[0].id);
  expect(calls[4].id).toBe(calls[3].id);
  expect(calls[3].id).not.toBe(calls[0].id);
});

test('manual submit prefill, pending judge, focus return, final result and tab cleanup', async ({ lab }, testInfo) => {
  await lab.worker.evaluate(() => chrome.storage.sync.set({ codeOpen: 'close' }));
  const page = await problem(lab);
  await openPanel(page);
  await loadCode(page, cpp);
  const tab = await launchSubmit(lab, page);
  expect(tab.url()).toBe(origin + '/submit/1000');
  expect(await tab.locator('.CodeMirror').evaluate(el => el.CodeMirror.getValue())).toBe(cpp);
  await expect(tab.locator('select')).toHaveValue('84');
  await expect(tab.locator('[value="close"]')).toBeChecked();
  await expect(tab.getByRole('button', { name: '제출' })).toBeFocused();
  expect(await tab.evaluate(() => window.fixtureSubmitCount)).toBe(0);
  expect(await stored(lab.worker, 'local', 'cbojPending')).toBeUndefined();
  const session = await stored(lab.worker, 'session', 'cbojSubmitTab');
  expect(session).toMatchObject({ pid: '1000', submitted: false });
  await expect.poll(() => stored(lab.worker, 'local', 'cbojWatch')).toMatchObject({ token: session.token });
  await tab.screenshot({ path: testInfo.outputPath('prefill.png') });
  await tab.goto(origin + '/status');
  await expect(page.locator('.cboj-card')).toContainText('채점 중 (20%)');
  expect(await tab.evaluate(() => sessionStorage.getItem('cbojSolId'))).toBe('93001');
  await expect.poll(() => lab.worker.evaluate(async id => (await chrome.tabs.get(id)).active, session.originTabId)).toBe(true);
  await tab.evaluate(() => {
    document.querySelector('.memory').textContent = '2048';
    document.querySelector('.time').textContent = '4';
    const result = document.querySelector('.result-text');
    result.textContent = '맞았습니다!!';
    result.classList.add('result-ac');
  });
  await expect(page.locator('.cboj-card.ac')).toContainText('맞았습니다!!');
  await expect(page.locator('.cboj-card a')).toHaveAttribute('href', '/source/93001');
  await expect.poll(() => stored(lab.worker, 'local', 'cbojJudge')).toMatchObject({
    token: session.token, stage: 'done', key: 'ac', memory: '2048 KB', time: '4 ms', lang: 'C++17',
  });
  await expect.poll(() => tab.isClosed()).toBe(true);
  expect(await stored(lab.worker, 'session', 'cbojSubmitTab')).toBeUndefined();
  expect(await stored(lab.worker, 'local', 'cbojWatch')).toBeUndefined();
  await page.screenshot({ path: testInfo.outputPath('judge.png') });
});

test('unmanaged submit stays empty and closing the managed tab reports its lifecycle stage', async ({ lab }) => {
  await lab.context.addInitScript(() => { window.fixturePlainSubmit = true; });
  const idle = await lab.context.newPage();
  await lab.worker.evaluate(() => chrome.storage.local.set({
    cbojPending: { pid: '1000', code: 'fixture pending', token: 'fixture', at: Date.now() },
  }));
  await idle.goto(origin + '/submit/1000');
  await expect.poll(() => stored(lab.worker, 'local', 'cbojLangs')).toContainEqual({ id: '84', name: 'C++17' });
  await expect(idle.locator('textarea')).toHaveValue('');
  expect((await stored(lab.worker, 'local', 'cbojPending')).code).toBe('fixture pending');
  const page = await problem(lab);
  await openPanel(page);
  await loadCode(page, cpp);
  const first = await launchSubmit(lab, page);
  await expect(first.locator('textarea')).toHaveValue(cpp);
  await first.close();
  await expect(page.locator('.cboj-card')).toContainText('제출하지 않았어요');
  expect((await stored(lab.worker, 'local', 'cbojJudge')).stage).toBe('cancelled');
  const second = await launchSubmit(lab, page);
  await second.goto(origin + '/status');
  await expect(page.locator('.cboj-card')).toContainText('채점 중 (20%)');
  await second.close();
  await expect(page.locator('.cboj-card a')).toHaveAttribute('href', /\/status\?problem_id=1000/);
  expect((await stored(lab.worker, 'local', 'cbojJudge')).stage).toBe('closed');
});

test('two problem tabs can each keep a pending submission', async ({ lab }) => {
  const a = await problem(lab);
  await openPanel(a);
  const first = await launchSubmit(lab, a);
  const original = await stored(lab.worker, 'session', 'cbojSubmitTab');
  const b = await problem(lab, '1001');
  await openPanel(b);
  const second = await launchSubmit(lab, b);
  const current = await stored(lab.worker, 'session', 'cbojSubmitTab');
  expect(current.pid).toBe('1001');
  expect(current.token).not.toBe(original.token);
  expect(second.isClosed()).toBe(false);
  await expect(a.locator('.cboj-card')).toContainText('제출 탭에서 [제출]을 눌러주세요');
  // Mark only the isolation assertion as an expected v1.3.3 failure.
  test.fail(true, 'The single cbojSubmitTab slot replaces and closes the first submit tab.');
  expect(first.isClosed()).toBe(false);
});
