import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { editorFrame, editorInput, extensionId, info, loadCode, observeComposition, openPanel, origin, problem, stored, test } from './chrome-fixture.mjs';

const native = async (lab, outputs) => lab.worker.evaluate(({ info, outputs }) => {
  self.fixtureIO.native = { info: [info], batch: [{ type: 'batch-result', cmd: 'fixture', results: outputs.map(stdout => ({ stdout, code: 0 })) }] };
}, { info, outputs });
const cases = p => p.locator('[data-tab="cases"]').click();
const frameValue = f => f.evaluate(async () => (await import('/vendor/monaco/editor.js')).editor.getModels()[0].getValue());
async function popup(lab) {
  const p = await lab.context.newPage(); await p.goto('chrome-extension://' + extensionId + '/popup/popup.html'); return p;
}
test('upstream records, selected and batch results, per-problem tabs, concurrent edits, reorder and raw diff', async ({ lab }, t) => {
  await native(lab, ['abc \t\r\nnext\n']);
  await lab.worker.evaluate(() => chrome.storage.local.set({ 'cases:1000': [
    { id: 'old', input: 'old\n', expected: '', on: false }, { id: 'second', input: 'next', expected: 'next', on: true },
  ] }));
  const p = await problem(lab); await openPanel(p); await cases(p);
  await p.locator('[data-case="old"]').click();
  await expect(p.getByLabel('전체에 포함')).not.toBeChecked();
  await expect(p.locator('.case-io input')).not.toBeChecked();
  await p.getByRole('button', { name: '▶ 선택 실행' }).click();
  await expect(p.locator('.cboj-term-out')).toContainText('출력 확인 필요');
  await cases(p); await p.getByRole('button', { name: '테스트 추가' }).click();
  await expect(p.locator('.case-tab[aria-selected=true]')).toHaveText('테스트 3');
  const name = p.getByRole('textbox', { name: '테스트 이름' });
  await name.fill('공백 경계'); await p.getByRole('textbox', { name: '입력', exact: true }).fill('3  5\n');
  await p.getByRole('textbox', { name: '기대 출력' }).fill('abc\nn ext\n');
  await p.locator('.case-io input').check();
  await p.locator('.case-tab[aria-selected=true]').dragTo(p.locator('[data-case=old]'));
  await expect(p.locator('.case-tab').nth(2)).toHaveText('공백 경계');
  await p.screenshot({ path: t.outputPath('light-cases.png') });
  await p.getByRole('button', { name: '▶ 선택 실행' }).click();
  await expect(p.locator('.tdiff-note')).toContainText('2번째 줄');
  await p.locator('.tdiff-note').evaluate(el => el.scrollIntoView({ block: 'start' }));
  await expect(p.locator('.tdiff tr.bad').first()).toBeInViewport();
  await p.screenshot({ path: t.outputPath('output-diff.png') });
  await expect(p.locator('.tdiff tr.bad')).toContainText('n ext');
  await p.locator('.case-raw summary').click();
  expect(await p.locator('.case-raw pre').allTextContents()).toEqual(['3  5\n','abc\nn ext\n','abc \t\r\nnext\n','']);
  await native(lab, ['']);
  await cases(p); await p.getByRole('textbox', { name: '기대 출력' }).fill('');
  await p.getByRole('button', { name: '▶ 선택 실행' }).click();
  await expect(p.locator('.cboj-status')).toHaveText('테스트 통과');
  await p.reload(); await openPanel(p); await cases(p);
  await expect(name).toHaveValue('공백 경계');
  const selected = p.locator('.case-tab[aria-selected=true]');
  await selected.focus(); await p.keyboard.press('Alt+ArrowRight');
  await expect(p.locator('.case-tab').nth(3)).toHaveText('공백 경계');
  await expect(selected).toBeFocused(); await p.keyboard.press('Alt+ArrowLeft');
  await expect(p.locator('.case-tab').nth(2)).toHaveText('공백 경계');
  const b = await problem(lab); await openPanel(b); await cases(b); await b.locator('[data-case=second]').click();
  await Promise.all([name.fill('병행 A'), b.getByRole('textbox', { name: '테스트 이름' }).fill('병행 B')]);
  await expect.poll(async () => (await stored(lab.worker, 'local', 'cases:1000')).map(c => c.name || '')).toEqual(['병행 A','','병행 B']);
  await native(lab, ['5\r\n', '9  \n', '', 'next']);
  await p.locator('.case-actions').getByText('전체 실행').click();
  await expect(p.locator('.cboj-status')).toHaveText('테스트 통과');
  expect(await lab.worker.evaluate(() => self.fixtureIO.nativeCalls.filter(c => c.type === 'batch').at(-1).inputs))
    .toEqual(['2 3\n','4 5\n','3  5\n','next']);
  const other = await problem(lab, '2000'); await openPanel(other); await cases(other);
  await expect(other.locator('.case-tab')).toHaveCount(2);
  await cases(p); p.once('dialog', d => d.accept()); await p.getByText('삭제', { exact: true }).click();
  await expect(p.locator('.case-tab')).toHaveCount(4);
  await lab.worker.evaluate(() => chrome.storage.sync.set({ shortcutProfile:'tests' }));
  await expect(p.locator('.cboj-toolbar .run')).toHaveAttribute('title', /Ctrl\+Shift\+Enter/);
  await p.locator('[data-case="sample:2"]').click();
  await editorInput(await editorFrame(p)).focus(); await p.keyboard.press('Control+Enter');
  await expect.poll(() => lab.worker.evaluate(() => self.fixtureIO.nativeCalls.filter(m => m.type === 'batch').at(-1).inputs)).toEqual(['4 5\n']);
  await expect(p.locator('.cboj-status')).toHaveText('예제 0/1');
  await p.keyboard.press('Control+Shift+Enter');
  await expect.poll(() => lab.worker.evaluate(() => self.fixtureIO.nativeCalls.filter(m => m.type === 'batch').at(-1).inputs.length)).toBe(3);
  const opened = lab.context.waitForEvent('page'); await p.keyboard.press('Control+Shift+s');
  const form = await opened; await expect(form.locator('#cboj-banner')).toBeVisible();
  expect(await form.evaluate(() => window.fixtureSubmitCount)).toBe(0);
});

test('a full collection runs across the native message boundary in saved order', async ({ lab }) => {
  await native(lab, Array(64).fill(''));
  await lab.worker.evaluate(() => chrome.storage.local.set({ 'cases:1000': Array.from({length:64}, (_,i) =>
    ({ id:'c' + i, input:'custom ' + i, expected:'', compare:true, on:true })) }));
  await lab.worker.evaluate(() => chrome.storage.sync.set({ sampleTimeLimit: 7 }));
  const p = await problem(lab); await openPanel(p); await p.locator('.cboj-toolbar .run').click();
  await expect.poll(() => lab.worker.evaluate(() => self.fixtureIO.nativeCalls.filter(m => m.type === 'batch')
    .map(m => [m.inputs.length, m.timeLimit]))).toEqual([[64, 7], [2, 7]]);
  await expect(p.locator('.cboj-status')).toHaveText('테스트 64/66');
});
test('direct Wandbox fixture execution preserves stdout, stderr and status', async ({ lab }) => {
  await lab.worker.evaluate(async () => {
    await chrome.storage.local.set({ runnerChoice: 'wandbox' });
    self.fixtureIO.remote['edge'] = { status:'0', program_output:'edge output', program_error:'diagnostic' };
  });
  const p = await problem(lab); await openPanel(p); await p.locator('[data-tab=term]').click();
  await p.locator('.cboj-term-in').fill('edge'); await p.locator('.cboj-term-actions .run').click();
  await expect(p.locator('.cboj-status')).toHaveText('실행 완료');
  await expect(p.locator('.cboj-term-out')).toContainText('edge output');
  await expect(p.locator('.cboj-term-out')).toContainText('diagnostic');
  expect(await lab.worker.evaluate(() => self.fixtureIO.remoteCalls.map(r => r.stdin))).toEqual(['edge']);
});

test('snippet CRUD, language isolation, real tab stops and local fallback', async ({ lab }) => {
  const p = await popup(lab); await p.locator('#snippet-settings summary').click();
  await p.locator('#snippet-lang').selectOption('py'); await p.locator('#snippet-prefix').fill('zzprint');
  await p.locator('#snippet-body').fill('print(${1:value})$0'); await p.locator('#snippet-save').click();
  await expect(p.locator('#snippet-state')).toHaveText('저장됨');
  const tab = await problem(lab); await openPanel(tab); await tab.locator('.cboj-lang').selectOption('28');
  const f = await editorFrame(tab); await loadCode(tab, 'zzpri'); await tab.keyboard.press('Control+Space');
  await expect(f.locator('.suggest-widget.visible')).toContainText('zzprint'); await tab.keyboard.press('Enter');
  expect(await frameValue(f)).toBe('print(value)'); await tab.keyboard.type('answer'); await tab.keyboard.press('Tab');
  expect(await frameValue(f)).toBe('print(answer)');
  await tab.locator('.cboj-lang').selectOption('75'); await loadCode(tab, 'zzpri'); await tab.keyboard.press('Control+Space');
  await expect(f.locator('.suggest-widget.visible')).not.toContainText('zzprint');
  await p.locator('#snippet-prefix').fill('zzoutput'); await p.locator('#snippet-save').click();
  await expect(p.locator('#snippet-list option:checked')).toHaveText('zzoutput');
  p.once('dialog', d => d.accept()); await p.locator('#snippet-delete').click();
  await expect.poll(() => stored(lab.worker, 'local', 'workspaceSnippets')).toEqual({ py: [] });
});

test('Power Mode, reduced motion, sustained typing, layout and actual demonstration', async ({ lab }, t) => {
  const settings = await popup(lab);
  await expect(settings.locator('[data-key=powerMode]')).not.toBeChecked();
  const p = await problem(lab); await p.setViewportSize({ width: 1280, height: 720 }); await openPanel(p);
  const f = await editorFrame(p); await p.locator('.cboj-lang').selectOption('28'); await loadCode(p, '# ');
  await p.keyboard.type('disabled'); await expect(f.locator('.typing-particles,.typing-combo')).toHaveCount(0);
  await cases(p); await p.screenshot({ path: t.outputPath('workspace-1280-light.png') });
  await settings.locator('label.toggle').filter({ has: settings.locator('[data-key=powerMode]') }).click(); await settings.locator('#effect').selectOption('aurora');
  await settings.locator('#intensity').selectOption('high'); await settings.locator('label.toggle').filter({ has: settings.locator('[data-key=powerShake]') }).click();
  await settings.locator('select[data-key=editorTheme]').selectOption('dark');
  await expect(p.locator('#cboj-panel')).toHaveClass(/dark/);
  await editorInput(f).focus(); await loadCode(p, 'def running_total(values):\n    total = 0\n    for value in values:\n        total += value\n    return total\n\n# ');
  await mkdir(t.outputPath('frames'), { recursive: true });
  await p.screenshot({ path: t.outputPath('frames', '00.png') });
  const text = 'accumulate values and inspect each step';
  for (let i = 0; i < text.length; i += 2) {
    await p.keyboard.type(text.slice(i,i+2), { delay: 35 });
    await p.screenshot({ path: t.outputPath('frames', String(1 + i/2).padStart(2,'0') + '.png') });
  }
  await expect(f.locator('.typing-combo')).toContainText('×');
  expect(await frameValue(f)).toContain(text);
  await expect(f.locator('.typing-particles')).toHaveCount(0);
  await p.emulateMedia({ reducedMotion: 'reduce' }); await p.keyboard.type(' motion');
  await expect(f.locator('.typing-particles,.typing-combo')).toHaveCount(0);
  await p.emulateMedia({ reducedMotion: 'no-preference' });
  for (const preset of ['spark','pixel']) {
    await settings.locator('#effect').selectOption(preset); await editorInput(f).focus();
    await p.keyboard.type(' queue'); await expect(f.locator('.typing-particles')).toHaveCount(1);
  }
  await p.keyboard.type('x'.repeat(160), { delay: 5 }); expect((await frameValue(f)).endsWith('x'.repeat(160))).toBe(true);
  await settings.locator('label.toggle').filter({ has: settings.locator('[data-key=powerMode]') }).click(); await expect(f.locator('.typing-particles,.typing-combo')).toHaveCount(0);
  await loadCode(p, 'def running_total(values):\n    total = 0\n    for value in values:\n        total += value\n    return total\n');
  await p.keyboard.press('Control+Home');
  await p.setViewportSize({ width: 1920, height: 1080 }); await cases(p);
  await p.screenshot({ path: t.outputPath('workspace-1920-dark.png') });
  await p.getByRole('button', { name: '아래 패널 최대화' }).click(); await expect(p.locator('#cboj-panel')).toHaveClass(/maximized/);
  await p.getByRole('button', { name: '아래 패널 접기 또는 펼치기' }).click(); await expect(p.locator('.cboj-pane.active')).toBeHidden();
  await cases(p); await p.getByRole('button', { name: '편집기 집중 모드' }).click(); await expect(p.locator('#cboj-panel')).toHaveClass(/focus/);
  await p.keyboard.press('Escape'); await expect(p.locator('#cboj-panel')).not.toHaveClass(/focus/);
  await p.setViewportSize({ width: 420, height: 780 }); await p.screenshot({ path: t.outputPath('workspace-420-dark.png') });
  expect(await p.locator('#cboj-panel').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
});

test('all intensities preserve IME, selection, typing latency and teardown', async ({ lab }, t) => {
  const tab = await problem(lab); await openPanel(tab); await tab.locator('.cboj-lang').selectOption('28');
  const f = await editorFrame(tab), cdp = await lab.context.newCDPSession(f);
  await expect(tab.locator('.cboj-lang')).toBeEnabled();
  const timings = {};
  for (const level of ['off','low','medium','high']) {
    await lab.worker.evaluate(level => chrome.storage.sync.set({ powerMode: level !== 'off', powerIntensity: level }), level);
    await loadCode(tab, '# ');
    await observeComposition(f);
    await cdp.send('Input.imeSetComposition', { text: 'ㅎ', selectionStart:1, selectionEnd:1 });
    await cdp.send('Input.imeSetComposition', { text:'한', selectionStart:1, selectionEnd:1 });
    expect(await f.locator('.typing-particles').count()).toBe(0);
    await cdp.send('Input.insertText', { text:'한' });
    expect(await frameValue(f)).toBe('# 한');
    await expect.poll(() => f.evaluate(() => window.testComposition.some(e => e.type === 'compositionend' && e.trusted))).toBe(true);
    await f.evaluate(async () => {
      const v = (await import('/vendor/monaco/editor.js')).editor.getEditors()[0];
      window.samples = [];
      let key;
      const down = e => { if (e.key === 'a') key = performance.now(); };
      window.removeTiming?.();
      addEventListener('keydown', down, true);
      const listener = v.onDidChangeModelContent(() => { if (key != null) { window.samples.push(performance.now() - key); key = null; } });
      window.removeTiming = () => { removeEventListener('keydown', down, true); listener.dispose(); };
    });
    await tab.keyboard.type('a'.repeat(48), { delay:6 });
    timings[level] = await f.evaluate(() => { window.removeTiming(); return window.samples.sort((a,b) => a-b); });
    expect(timings[level]).toHaveLength(48);
    await tab.keyboard.press('Shift+ArrowLeft');
    expect(await f.evaluate(async () => {
      const v = (await import('/vendor/monaco/editor.js')).editor.getEditors()[0]; return v.getModel().getValueInRange(v.getSelection());
    })).toBe('a');
    await tab.locator('.cboj-toggle').click();
    await expect(f.locator('.monaco-editor,.typing-particles,.typing-combo')).toHaveCount(0);
    await openPanel(tab);
  }
  await writeFile(t.outputPath('typing.json'), JSON.stringify(Object.fromEntries(Object.entries(timings).map(([k,s]) => [k, {
    count:s.length, medianMs:s[Math.floor(s.length/2)], p95Ms:s[Math.floor(s.length*.95)]
  }])),null,2));
});

test('same-problem forms, worker termination, ambiguity, pinned rows and origin recovery', async ({ lab }) => {
  const a = await problem(lab), b = await problem(lab);
  async function form(p, source) {
    await openPanel(p); await loadCode(p, source);
    const next = lab.context.waitForEvent('page'); await p.locator('.cboj-btn.submit').click(); const tab = await next;
    await expect(tab.locator('#cboj-banner')).toBeVisible();
    expect(await tab.locator('.CodeMirror').evaluate(el => el.CodeMirror.getValue())).toBe(source);
    expect(await tab.evaluate(() => window.fixtureSubmitCount)).toBe(0); return tab;
  }
  const one = await form(a, '// first fixture'), two = await form(b, '// second fixture');
  const cdp = await lab.context.browser().newBrowserCDPSession();
  const target = (await cdp.send('Target.getTargets')).targetInfos.find(t => t.type === 'service_worker' && t.url === lab.worker.url());
  expect(target).toBeTruthy();
  await cdp.send('Target.closeTarget', { targetId: target.targetId });
  await expect.poll(async () => (await cdp.send('Target.getTargets')).targetInfos.some(t => t.targetId === target.targetId)).toBe(false);
  await two.goto(origin + '/status'); await expect(b.locator('.cboj-card')).toContainText('제출 번호');
  await one.goto(origin + '/status?solution_id=93001');
  await expect(a.locator('.cboj-card')).toContainText('채점 중 (20%)');
  await one.evaluate(() => { const el = document.querySelector('.result-text'); el.className += ' result-ac'; el.textContent = '맞았습니다!!'; });
  await expect(a.locator('.cboj-card.ac')).toContainText('맞았습니다!!'); await expect.poll(() => one.isClosed()).toBe(true);
  await b.reload(); await openPanel(b); await expect(b.locator('.cboj-card')).toContainText('제출 번호');
  expect(two.isClosed()).toBe(false);
});

test.describe('registered tools', () => {
  test.use({ realHost: true });
  test('terminating a worker during native execution releases its child and permits recovery', async ({ lab }) => {
    await lab.worker.evaluate(async () => {
      await chrome.storage.sync.set({ lastLangId:'28', lastLangName:'Python 3' });
      await chrome.storage.local.set({ 'draft:1000:py':{ code:'import os\nprint(os.getpid(), flush=True)\ninput()' } });
    });
    const p = await problem(lab); await openPanel(p);
    await p.locator('[data-tab=term]').click(); await p.locator('.cboj-term-actions .run').click();
    const live = p.locator('.tlive').last();
    await expect(live).toHaveText(/^\s*\d+\s*$/, { timeout:45000 });
    const pid = Number((await live.innerText()).match(/\d+/)[0]);
    const alive = () => { try { process.kill(pid, 0); return true; } catch (e) { if (e.code === 'ESRCH') return false; throw e; } };
    expect(alive()).toBe(true);
    const cdp = await lab.context.browser().newBrowserCDPSession();
    const target = (await cdp.send('Target.getTargets')).targetInfos.find(t => t.type === 'service_worker' && t.url === lab.worker.url());
    await cdp.send('Target.closeTarget', { targetId: target.targetId });
    await expect.poll(alive, { timeout:45000 }).toBe(false);
    await expect(p.locator('.cboj-status')).toHaveText('실행 실패');
    await loadCode(p, 'print("recovered", flush=True)');
    await p.locator('.cboj-term-actions .run').click();
    await expect(p.locator('.cboj-term-out')).toContainText('recovered', { timeout:45000 });
    await expect(p.locator('.cboj-status')).toHaveText('실행 완료');
    await expect.poll(async () => (await readdir(lab.nativeTemp)).filter(n => n.startsWith('cboj_p1_'))).toEqual([]);
  });
  test('clangd suggestions coexist with user snippets, diagnostics navigation and real custom execution', async ({ lab }, t) => {
    await lab.worker.evaluate(() => chrome.storage.local.set({ workspaceSnippets: { cpp: [{ id:'s', prefix:'zzloop', body:'for (int i = 0; i < ${1:5}; ++i) {$0}' }] },
      'draft:1000:cpp': { code: '#include <iostream>\nint main(){\n    zzlo\n}' }, runnerChoice: 'msvc',
      'cases:1000': [{ id:'real', input:'-4 7\n', expected:'3\n', on:true }] }));
    await lab.worker.evaluate(() => chrome.storage.sync.set({ editorTheme: 'dracula', powerMode: true, powerPreset: 'aurora' }));
    const p = await problem(lab); await openPanel(p); const f = await editorFrame(p);
    await expect.poll(() => f.evaluate(() => document.body.style.getPropertyValue('--bg') === CBOJ_PALETTES.dracula.base)).toBe(true);
    await expect(f.locator('#analysis-status')).toContainText('C++ 분석 · clangd', { timeout: 60000 });
    await f.evaluate(async () => { const v = (await import('/vendor/monaco/editor.js')).editor.getEditors()[0]; v.setPosition({ lineNumber:3,column:9 }); v.focus(); });
    await p.keyboard.press('Control+Space'); await expect(f.locator('.suggest-widget.visible')).toContainText('zzloop');
    await p.keyboard.press('Enter'); expect(await frameValue(f)).toContain('i < 5');
    await loadCode(p, 'int main(){return missing_fixture_symbol;}');
    await p.locator('[data-tab=problems]').click(); await p.locator('.problem-item').filter({ hasText:'missing_fixture_symbol' }).first().click();
    expect(await f.evaluate(async () => (await import('/vendor/monaco/editor.js')).editor.getEditors()[0].getPosition().column)).toBe(19);
    await loadCode(p, '#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b;}');
    await p.keyboard.press('Shift+Alt+f');
    await expect.poll(() => frameValue(f)).toContain('int a, b;');
    await cases(p); await p.locator('[data-case=real]').click(); await p.getByRole('button', { name:'▶ 선택 실행' }).click();
    await expect(p.locator('.cboj-status')).toHaveText('테스트 통과', { timeout:45000 });
    await p.locator('.cboj-toolbar .run').click(); await expect(p.locator('.cboj-term-out')).toContainText('테스트 3개 모두');
    await expect(p.locator('.cboj-term-out')).toContainText('캐시 재사용');
    await p.screenshot({ path: t.outputPath('integrated-execution.png') });
    await writeFile(t.outputPath('result.json'), JSON.stringify({ backend:'MSVC', realCases:3, cache:'hit' }));
  });
});
