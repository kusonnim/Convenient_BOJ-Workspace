import { readdir, writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { editorLines, extensionId, loadCode, openPanel, problem, stored, test } from './chrome-fixture.mjs';

test.use({ realHost: true });
const sum = [
  '#include <iostream>',
  '#if !defined(_MSC_VER) || !defined(ONLINE_JUDGE) || !defined(BOJ)',
  '#error Expected the registered MSVC runner',
  '#endif',
  'static_assert(__cplusplus == _MSVC_LANG);',
  'int main() {',
  '    int a, b;',
  '    std::cin >> a >> b;',
  '    std::cout << a + b;',
  '    std::cerr << "한글 · MSVC " << _MSC_FULL_VER << " / " << _MSVC_LANG;',
  '}',
].join('\n');
const terminal = p => p.locator('.cboj-term-out');
const status = p => p.locator('.cboj-status');
const run = p => p.locator('.cboj-toolbar .run').click();
const workdirs = async lab => (await readdir(lab.nativeTemp)).filter(n => n.startsWith('cboj_'));
const finished = p => expect(p.locator('.cboj-toolbar .run')).toHaveText('▶ 실행');

test('registered MSVC, samples, UTF-8, cache identity, diagnostics and explicit GCC', async ({ lab }, t) => {
  const info = await lab.worker.evaluate(() => chrome.runtime.sendNativeMessage('com.convenient_boj.runner', { type: 'info', protocol: 2 }));
  expect(info).toMatchObject({ protocol: 2, version: '2.0.0', msvcStandards: ['c++17', 'c++20'] });
  expect(info.msvc).toMatch(/^\d+$/);
  const p = await problem(lab);
  await openPanel(p);
  await expect(p.locator('.cboj-where')).toContainText('MSVC');
  await expect(await editorLines(p)).toContainText('#include <iostream>');
  await expect(await editorLines(p)).not.toContainText('bits/stdc++');
  // Use the workspace's own handle to keep commands and both sample outputs visible.
  const handle = await p.locator('.cboj-resizer-y').boundingBox();
  await p.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await p.mouse.down();
  await p.mouse.move(handle.x + handle.width / 2, 355, { steps: 4 });
  await p.mouse.up();
  await loadCode(p, sum);
  await run(p);
  await expect(status(p)).toHaveText('예제 통과');
  await expect(terminal(p)).toContainText('새로 컴파일');
  await expect(terminal(p)).toContainText('한글 · MSVC ' + info.msvc + ' / 201703');
  await finished(p);
  await run(p);
  await expect(terminal(p)).toContainText('캐시 재사용');
  await expect(status(p)).toHaveText('예제 통과');
  await p.screenshot({ path: t.outputPath('msvc-cache.png') });
  await p.locator('.cboj-lang').selectOption('95');
  await expect(p.locator('.cboj-lang')).toBeEnabled();
  await run(p);
  await expect(terminal(p)).toContainText('/std:c++20');
  await expect(terminal(p)).toContainText('새로 컴파일');
  await expect(terminal(p)).toContainText('/ 202002');
  await loadCode(p, sum.replace('<< a + b', '<< 5'));
  await run(p);
  await expect(status(p)).toHaveText('예제 1/2');
  await expect(terminal(p).locator('.tgrid pre')).toHaveText(['4 5', '9', '5']);
  await expect(terminal(p)).toContainText('새로 컴파일');
  await p.screenshot({ path: t.outputPath('msvc-mismatch.png') });
  const invalid = '#include <bits/stdc++.h>\nint main() {}';
  await loadCode(p, invalid);
  for (let i = 0; i < 2; i++) {
    await run(p);
    await expect(status(p)).toHaveText('컴파일 에러');
    await expect(terminal(p)).toContainText('C1083');
    await expect(terminal(p)).toContainText('bits/stdc++.h');
    await finished(p);
  }
  await p.screenshot({ path: t.outputPath('msvc-error.png') });
  const popup = await lab.context.newPage();
  await popup.goto('chrome-extension://' + extensionId + '/popup/popup.html');
  await expect(popup.locator('#runnerState')).toContainText('MSVC x64');
  await popup.locator('body').screenshot({ path: t.outputPath('compiler-settings.png') });
  await popup.locator('#runnerChoice').selectOption('gcc');
  await expect(p.locator('.cboj-where')).toContainText('g++');
  await expect(p.locator('.cboj-lang')).toHaveValue('95');
  await expect(await editorLines(p)).toContainText('bits/stdc++.h');
  await loadCode(p, '#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b;}');
  await run(p);
  await expect(status(p)).toHaveText('예제 통과');
  await expect(terminal(p)).toContainText('g++ -O2 -std=gnu++20');
  await expect.poll(() => workdirs(lab)).toEqual([]);
  await writeFile(t.outputPath('capabilities.json'), JSON.stringify(info, null, 2));
});

const liveCode = [
  '#include <iostream>', '#include <string>', '#include <windows.h>',
  'int main() {', '    std::string s;',
  '    std::cout << "PID=" << GetCurrentProcessId() << std::endl;',
  '    while (std::getline(std::cin, s)) {',
  '        std::cout << "echo " << s << std::endl;',
  '        std::cerr << "진단" << std::endl;',
  '    }', '}',
].join('\n');
function exists(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { if (e.code === 'ESRCH') return false; throw e; }
}
async function startTerminal(page) {
  await page.locator('[data-tab="term"]').click();
  const count = await page.locator('.tlive').count();
  await page.locator('.cboj-term-actions .run').click();
  await expect(page.locator('.tlive')).toHaveCount(count + 1);
  const output = page.locator('.tlive').last();
  await expect(output).toContainText(/PID=\d+/);
  const pid = Number((await output.innerText()).match(/PID=(\d+)/)[1]);
  expect(exists(pid)).toBe(true);
  return pid;
}

test('real terminal input, EOF, stop, simultaneous tabs and disconnect cleanup', async ({ lab }, t) => {
  const p = await problem(lab);
  await openPanel(p);
  await loadCode(p, liveCode);
  const first = await startTerminal(p);
  await expect.poll(() => workdirs(lab)).not.toEqual([]);
  const input = p.locator('.cboj-term-in');
  await input.fill('한글 42');
  await input.press('Enter');
  await expect(p.locator('.tlive').last()).toContainText('echo 한글 42');
  await expect.poll(async () => (await p.locator('.tlive .err').allTextContents()).join('')).toContain('진단');
  await input.press('Control+d');
  await expect(status(p)).toHaveText('실행 완료');
  await expect.poll(() => exists(first)).toBe(false);
  await expect.poll(() => workdirs(lab)).toEqual([]);
  await p.screenshot({ path: t.outputPath('msvc-terminal.png') });
  const second = await startTerminal(p);
  await expect(terminal(p)).toContainText('캐시 재사용');
  const other = await problem(lab, '1001');
  await openPanel(other);
  await loadCode(other, liveCode);
  const third = await startTerminal(other);
  expect(third).not.toBe(second);
  await p.close();
  await expect.poll(() => exists(second)).toBe(false);
  expect(exists(third)).toBe(true);
  await other.locator('.cboj-term-in').press('Control+c');
  await expect(status(other)).toHaveText('중지됨');
  await expect.poll(() => exists(third)).toBe(false);
  await expect.poll(() => workdirs(lab)).toEqual([]);
  const reopened = await problem(lab);
  await openPanel(reopened);
  await expect(await editorLines(reopened)).toContainText('GetCurrentProcessId');
  const afterReconnect = await startTerminal(reopened);
  await expect(terminal(reopened)).toContainText('새로 컴파일');
  await reopened.locator('.cboj-term-in').press('Control+d');
  await expect.poll(() => exists(afterReconnect)).toBe(false);
  await expect.poll(() => workdirs(lab)).toEqual([]);
});

test('batch stop and timeout release the registered runner for another job', async ({ lab }, t) => {
  const p = await problem(lab);
  await openPanel(p);
  await loadCode(p, '#include <chrono>\n#include <thread>\nint main(){std::this_thread::sleep_for(std::chrono::seconds(18));}');
  await run(p);
  await expect(p.locator('.cboj-toolbar .run')).toHaveText('■ 중지');
  await expect.poll(() => workdirs(lab)).not.toEqual([]);
  await run(p);
  await expect(status(p)).toHaveText('중지됨');
  await expect.poll(() => workdirs(lab)).toEqual([]);
  // One timed fixture keeps this check to the production 10-second limit.
  await p.locator('#sample-input-2').evaluate(el => el.remove());
  await run(p);
  await expect(terminal(p)).toContainText('시간 초과 (10초)', { timeout: 40_000 });
  await expect(status(p)).toHaveText('예제 0/1');
  await expect.poll(() => workdirs(lab)).toEqual([]);
  await p.screenshot({ path: t.outputPath('msvc-timeout.png') });
  await loadCode(p, sum);
  await run(p);
  await expect(status(p)).toHaveText('예제 통과');
  await expect.poll(() => stored(lab.worker, 'local', 'draft:1000:cpp')).toMatchObject({ code: sum });
});

test.describe('host compatibility and user choice', () => {
  test.use({ realHost: false });
  for (const legacy of [true, false]) {
    test(legacy ? 'old host offers repair and keeps GCC available' : 'missing compiler offers an explicit remote choice', async ({ lab }) => {
      await lab.worker.evaluate(async legacy => {
        const info = legacy ? { version: '1.0.0', gcc: 'old gcc', gpp: 'old g++' }
          : { protocol: 2, version: '2.0.0', gcc: null, gpp: null, msvc: null };
        self.fixtureIO.native = { info: [{ type: 'info', python: '3.14', ...info }] };
        self.fixtureIO.remote = { '2 3\n': { status: '0', program_output: '5' }, '4 5\n': { status: '0', program_output: '9' } };
        await chrome.storage.local.set({ runnerChoice: 'msvc', 'draft:1000:cpp': { code: '// saved GNU draft: bits/stdc++.h' } });
      }, legacy);
      const p = await problem(lab);
      await openPanel(p);
      await expect(p.locator('.cboj-where')).toContainText('컴파일러 없음');
      await expect(await editorLines(p)).toContainText('saved GNU draft');
      p.once('dialog', async dialog => {
        expect(dialog.message()).toContain(legacy ? 'host/install.bat' : 'Wandbox(wandbox.org)');
        await dialog.dismiss();
      });
      await run(p);
      await expect(status(p)).toHaveText('중지됨');
      expect(await lab.worker.evaluate(() => self.fixtureIO.remoteCalls.length)).toBe(0);
      if (legacy) {
        await lab.worker.evaluate(() => chrome.storage.local.set({ runnerChoice: 'gcc' }));
        await expect(p.locator('.cboj-where')).toContainText('g++');
        await expect(p.locator('.cboj-where')).toHaveAttribute('title', /host\/install\.bat/);
      } else {
        await lab.worker.evaluate(() => chrome.storage.local.set({ runnerChoice: 'wandbox' }));
        await expect(p.locator('.cboj-where')).toContainText('Wandbox');
        await run(p);
        await expect(status(p)).toHaveText('예제 통과');
        expect(await lab.worker.evaluate(() => self.fixtureIO.remoteCalls.map(r => r.stdin))).toEqual(['2 3\n', '4 5\n']);
      }
    });
  }
});
