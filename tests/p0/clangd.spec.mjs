import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { editorFrame, loadCode, openPanel, problem, test } from './chrome-fixture.mjs';

const code = [
  '#include <vector>', '#include <string>', '#include <map>', '',
  'template<class T> T twice(T x) { return x + x; }',
  'int combine(int left, int right) { return left + right; }', '',
  'int main() {', '    std::vector<std::string> words;', '    std::map<int, int> counts;',
  '    /* 한글🙂 */ words.push_back("one");', '    counts.emplace(1, 2);',
  '    return combine(twice(2), 4);', '}',
].join('\n');
const setDraft = (lab, text) => lab.worker.evaluate(code =>
  chrome.storage.local.set({ runnerChoice: 'wandbox', 'draft:1000:cpp': { code, cursor: { line: 0, ch: 0 } } }), text);
const ready = frame => expect(frame.locator('#analysis-status')).toHaveText('C++ 분석 · clangd · MSVC', { timeout: 55000 });
const ms = start => Math.round(performance.now() - start);

async function cursor(frame, tail, atEnd = true) {
  return frame.evaluate(async ({ tail, atEnd }) => {
    const { editor } = await import('/vendor/monaco/editor.js');
    const view = editor.getEditors()[0], model = view.getModel(), at = model.getValue().indexOf(tail);
    if (at < 0) throw Error('Missing fixture text ' + tail);
    const pos = model.getPositionAt(at + (atEnd ? tail.length : 0));
    view.setPosition(pos);
    view.revealPositionInCenterIfOutsideViewport(pos);
    view.focus();
    return pos;
  }, { tail, atEnd });
}
async function suggest(page, frame, tail, expected) {
  await page.keyboard.press('Escape');
  await cursor(frame, tail);
  const start = performance.now();
  await page.keyboard.press('Control+Space');
  await frame.waitForFunction(expected => [...document.querySelectorAll('.suggest-widget.visible .monaco-list-row')]
    .some(el => el.textContent.includes(expected)), expected, { timeout: 12000 });
  return ms(start);
}
function markers(frame) {
  return frame.evaluate(async () => {
    const { editor } = await import('/vendor/monaco/editor.js');
    return editor.getModelMarkers({ owner: 'clangd' }).map(({ message, startLineNumber, startColumn, source }) =>
      ({ message, startLineNumber, startColumn, source }));
  });
}
async function servers(lab) {
  // Only return processes whose compilation directory belongs to this fixture.
  const command = [
    "$ErrorActionPreference='Stop'",
    "$owned = Get-CimInstance Win32_Process -Filter \"Name='clangd.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:CBOJ_FIXTURE_DIR + '\\cboj-lsp_') -and !$_.CommandLine.Contains('--check=') }",
    '$rows = @(foreach ($p in $owned) {',
    '  $launcher = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $p.ParentProcessId)',
    '  $hostProcess = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $launcher.ParentProcessId)',
    '  if (!$launcher.CommandLine.Contains("process_tree.py") -or !$hostProcess.CommandLine.Contains("cboj_host.py")) { throw "Unexpected language server owner" }',
    '  [pscustomobject]@{id=$p.ProcessId;launcherId=$launcher.ProcessId;hostId=$hostProcess.ProcessId;workingSetKiB=$p.WorkingSetSize / 1024;launcherKiB=$launcher.WorkingSetSize / 1024;hostKiB=$hostProcess.WorkingSetSize / 1024}',
    '})',
    'ConvertTo-Json -InputObject $rows -Compress',
  ].join('\n');
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command],
    { windowsHide: true, env: { ...process.env, CBOJ_FIXTURE_DIR: lab.nativeTemp } });
  return JSON.parse(stdout.trim());
}
const workspaces = async lab => (await readdir(lab.nativeTemp)).filter(n => n.startsWith('cboj-lsp_'));
function alive(id) {
  try { process.kill(id, 0); return true; } catch (e) { if (e.code === 'ESRCH') return false; throw e; }
}

test.describe('registered language server', () => {
  test.use({ realHost: true });

  test('Wandbox selection, STL and user symbols, signatures, navigation, live UTF-16 errors and timing', async ({ lab }, t) => {
    await setDraft(lab, code);
    const p = await problem(lab);
    const started = performance.now();
    await openPanel(p);
    const frame = await editorFrame(p);
    const editorReadyMs = ms(started);
    await ready(frame);
    const readyMs = ms(started);
    const warm = [];
    await suggest(p, frame, 'words.pu', 'push_back');
    const coldCompletionMs = ms(started);
    for (let i = 0; i < 5; i++) warm.push(await suggest(p, frame, 'words.pu', 'push_back'));
    await expect(frame.locator('.suggest-widget.visible')).not.toContainText('public');
    await p.screenshot({ path: t.outputPath('completion.png') });
    await suggest(p, frame, '#include <vec', 'vector');
    await suggest(p, frame, 'counts.empl', 'emplace');
    await suggest(p, frame, 'return combine(tw', 'twice');
    await p.keyboard.press('Escape');
    await cursor(frame, 'return combine(twice(2), ');
    await p.keyboard.press('Control+Shift+Space');
    await expect(frame.locator('.parameter-hints-widget.visible')).toContainText('int right');
    await p.screenshot({ path: t.outputPath('signature.png') });
    await p.keyboard.press('Escape');
    await cursor(frame, 'return comb');
    await p.keyboard.press('F12');
    const line = () => frame.evaluate(async () => (await import('/vendor/monaco/editor.js')).editor.getEditors()[0].getPosition().lineNumber);
    await expect.poll(line).toBe(6);
    await cursor(frame, 'return comb');
    await frame.evaluate(async () => (await import('/vendor/monaco/editor.js')).editor.getEditors()[0].getAction('editor.action.showHover').run());
    await expect(frame.locator('.monaco-hover:visible').first()).toContainText('combine');
    await p.keyboard.press('Escape');
    await cursor(frame, 'words.push_b');
    await p.keyboard.press('F12');
    await expect(frame.locator('#header-preview[open]')).toContainText('push_back');
    await p.screenshot({ path: t.outputPath('definition.png') });
    await p.keyboard.press('Escape');
    await lab.worker.evaluate(() => chrome.storage.sync.set({ editorTheme: 'dark' }));
    await expect(frame.locator('.monaco-editor.vs-dark')).toBeVisible();
    await frame.evaluate(async () => {
      const { editor } = await import('/vendor/monaco/editor.js');
      const model = editor.getEditors()[0].getModel();
      let editedAt;
      const edits = model.onDidChangeContent(() => { editedAt = performance.now(); });
      const marks = editor.onDidChangeMarkers(() => {
        if (editor.getModelMarkers({ owner: 'clangd' }).some(m => m.message.includes('unknown_member'))) {
          window.measuredDiagnosticsMs = Math.round(performance.now() - editedAt);
          edits.dispose(); marks.dispose();
        }
      });
    });
    await loadCode(p, code.replace('words.push_back("one")', 'words.unknown_member()'));
    await frame.waitForFunction(() => Number.isFinite(window.measuredDiagnosticsMs));
    const diagnosticsMs = await frame.evaluate(() => window.measuredDiagnosticsMs);
    const errors = await markers(frame);
    expect(errors).toContainEqual({ message: expect.stringContaining('unknown_member'),
      startLineNumber: 11, startColumn: '    /* 한글🙂 */ words.'.length + 1, source: 'clangd' });
    await cursor(frame, 'words.unknown_');
    await frame.evaluate(async () => (await import('/vendor/monaco/editor.js')).editor.getEditors()[0].getAction('editor.action.showHover').run());
    await expect(frame.locator('.monaco-hover:visible').first()).toContainText('unknown_member');
    await p.screenshot({ path: t.outputPath('diagnostic.png') });
    await p.keyboard.press('Escape');
    await loadCode(p, code);
    await expect.poll(() => markers(frame)).toEqual([]);
    const owned = await servers(lab);
    expect(owned).toHaveLength(1);
    await writeFile(t.outputPath('latency.json'), JSON.stringify({ chromeVersion: lab.context.browser().version(),
      editorReadyMs, readyMs, coldCompletionMs, warmWidgetMs: warm, diagnosticsMs, serverWorkingSetKiB: owned[0].workingSetKiB,
      launcherWorkingSetKiB: owned[0].launcherKiB, nativeHostWorkingSetKiB: owned[0].hostKiB }, null, 2));
    await loadCode(p, '#include <bits/stdc++.h>\nint main(){std::vector<int> values; values}');
    await expect(frame.locator('#analysis-status')).toContainText('clangd · GCC', { timeout: 55000 });
    await cursor(frame, '; values');
    await p.keyboard.type('.pu', { delay: 70 });
    await expect(frame.locator('.suggest-widget.visible')).toContainText('push_back');
    await p.keyboard.press('Enter');
    await expect(frame.locator('.view-lines')).toContainText('values.push_back');
    await loadCode(p, code);
    await ready(frame);
  });

  test('same-problem tabs, server crash, rapid edits and repeated close release all resources', async ({ lab }, t) => {
    await setDraft(lab, code);
    const a = await problem(lab), b = await problem(lab);
    await openPanel(a);
    const fa = await editorFrame(a);
    await ready(fa);
    const [original] = await servers(lab);
    expect(original).toBeTruthy();
    await openPanel(b);
    const fb = await editorFrame(b);
    await ready(fb);
    expect(await servers(lab)).toHaveLength(2);
    await loadCode(a, 'struct OnlyHere { int local_member; };\nint main(){OnlyHere a; return a.local_member;}');
    await loadCode(b, 'int main(){return tab_b_error;}');
    await expect.poll(() => markers(fb)).toEqual([expect.objectContaining({ message: expect.stringContaining('tab_b_error') })]);
    await suggest(a, fa, 'a.loc', 'local_member');
    expect(await markers(fa)).toEqual([]);
    // The selected PID was observed before the second tab opened and its
    // command line contains this test's private temporary directory.
    expect((await servers(lab)).map(s => s.id)).toContain(original.id);
    process.kill(original.id);
    await expect.poll(async () => (await servers(lab)).map(s => s.id)).not.toContain(original.id);
    await expect.poll(async () => (await servers(lab)).length, { timeout: 60000 }).toBe(2);
    await ready(fa);
    await suggest(a, fa, 'a.loc', 'local_member');
    await b.close();
    await expect.poll(async () => (await workspaces(lab)).length).toBe(1);
    const cycles = [];
    for (let i = 0; i < 3; i++) {
      const [owner] = await servers(lab);
      await a.locator('.cboj-toggle').click();
      await expect.poll(() => workspaces(lab)).toEqual([]);
      expect(await servers(lab)).toEqual([]);
      await expect.poll(() => [owner.id, owner.hostId, owner.launcherId].filter(alive)).toEqual([]);
      const view = await fa.evaluate(async () => {
        const { editor } = await import('/vendor/monaco/editor.js');
        return { models: editor.getModels().length, editors: editor.getEditors().length };
      });
      expect(view).toEqual({ models: 0, editors: 0 });
      const start = performance.now();
      await openPanel(a);
      await ready(fa);
      cycles.push({ reopenReadyMs: ms(start), workingSetKiB: (await servers(lab))[0].workingSetKiB });
    }
    await loadCode(a, 'int main(){return stale_error;}');
    await loadCode(a, 'int main(){return final_error;}');
    await expect.poll(() => markers(fa)).toEqual([expect.objectContaining({ message: expect.stringContaining('final_error') })]);
    await a.locator('.cboj-lang').selectOption('75');
    await expect(fa.locator('#analysis-status')).toBeHidden();
    await expect.poll(() => workspaces(lab)).toEqual([]);
    expect(await servers(lab)).toEqual([]);
    await writeFile(t.outputPath('lifecycle.json'), JSON.stringify({ cycles, serversAfterClose: 0, helpersAfterClose: 0, workspacesAfterClose: 0 }, null, 2));
  });

  test('changing the draft cancels a real completion and rejects delayed native replies', async ({ lab }) => {
    await setDraft(lab, '#include <vector>\nint main(){return obsolete_startup;}');
    await lab.worker.evaluate(() => {
      const connect = chrome.runtime.connectNative.bind(chrome.runtime);
      const trace = self.analysisTrace = { cancelled: [], holdNext: false, ready: false };
      chrome.runtime.connectNative = name => {
        const native = connect(name), listeners = [];
        const deliver = m => listeners.forEach(fn => fn(m));
        native.onMessage.addListener(m => {
          if (m.type === 'analysis-ready') trace.ready = true;
          if (m.type === 'analysis-result' && m.id === trace.heldId) {
            trace.receivedMember = m.result.items.some(i => i.label.includes('push_back'));
            trace.releaseCompletion = () => deliver(m);
          } else if (m.type === 'analysis-diagnostics' && m.items.some(d => d.message.includes('obsolete_error'))) {
            trace.releaseDiagnostics = () => deliver(m);
          } else deliver(m);
        });
        return { onMessage: { addListener: fn => listeners.push(fn) }, onDisconnect: native.onDisconnect,
          disconnect: () => native.disconnect(), postMessage: m => {
            if (!trace.ready && ['analysis-open', 'analysis-change'].includes(m.type) && m.code.includes('words.push_back')) {
              trace.editedDuringStartup = true;
            }
            if (trace.holdNext && m.type === 'analysis-request' && m.feature === 'completion') {
              trace.heldId = m.id; trace.holdNext = false;
            }
            if (m.type === 'analysis-cancel') trace.cancelled.push(m.id);
            native.postMessage(m);
          } };
      };
    });
    const p = await problem(lab);
    await openPanel(p);
    const f = await editorFrame(p);
    await loadCode(p, code);
    await ready(f);
    expect(await lab.worker.evaluate(() => self.analysisTrace.editedDuringStartup)).toBe(true);
    await cursor(f, 'words.pu');
    await lab.worker.evaluate(() => { self.analysisTrace.holdNext = true; });
    await p.keyboard.press('Control+Space');
    await expect.poll(() => lab.worker.evaluate(() => self.analysisTrace.receivedMember)).toBe(true);
    await loadCode(p, 'int main(){return obsolete_error;}');
    await expect.poll(() => lab.worker.evaluate(() => self.analysisTrace.cancelled.includes(self.analysisTrace.heldId))).toBe(true);
    await expect.poll(() => lab.worker.evaluate(() => !!self.analysisTrace.releaseDiagnostics)).toBe(true);
    await loadCode(p, 'int main(){return current_error;}');
    await expect.poll(() => markers(f)).toEqual([expect.objectContaining({ message: expect.stringContaining('current_error') })]);
    await lab.worker.evaluate(() => { self.analysisTrace.releaseCompletion(); self.analysisTrace.releaseDiagnostics(); });
    await f.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await markers(f)).toEqual([expect.objectContaining({ message: expect.stringContaining('current_error') })]);
    await expect(f.locator('.suggest-widget.visible')).toHaveCount(0);
  });

  test('a missing-server capability preserves real MSVC execution', async ({ lab }) => {
    await lab.worker.evaluate(() => {
      const connect = chrome.runtime.connectNative.bind(chrome.runtime);
      chrome.runtime.connectNative = name => {
        const native = connect(name), listeners = [];
        const deliver = m => listeners.forEach(fn => fn(m));
        native.onMessage.addListener(deliver);
        return { onMessage: { addListener: fn => listeners.push(fn) }, onDisconnect: native.onDisconnect,
          disconnect: () => native.disconnect(), postMessage: m => {
            if (m.type === 'analysis-open') deliver({ type: 'analysis-unavailable', reason: 'no-server' });
            else if (m.type === 'analysis-close') deliver({ type: 'analysis-closed' });
            else native.postMessage(m);
          } };
      };
      return chrome.storage.local.set({ runnerChoice: 'msvc' });
    });
    const p = await problem(lab);
    await openPanel(p);
    const f = await editorFrame(p);
    await expect(f.locator('#analysis-status')).toContainText('clangd 설치 필요');
    await loadCode(p, '#include <iostream>\n#ifndef _MSC_VER\n#error expected MSVC\n#endif\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b;}');
    await p.locator('.cboj-toolbar .run').click();
    await expect(p.locator('.cboj-status')).toHaveText('예제 통과', { timeout: 45000 });
    await expect(p.locator('.cboj-term-out')).toContainText('/std:c++17');
  });
});

test('absent server and legacy host keep P2 editing, basic completion and runner routing', async ({ lab }) => {
  await lab.worker.evaluate(() => {
    self.fixtureIO.analysis = 'no-server';
    self.fixtureIO.native = { info: [{ type: 'info', protocol: 2, version: '2.0.0', msvc: '1951', msvcStandards: ['c++17'] }],
      batch: [{ type: 'batch-result', results: [{ stdout: '5\n', code: 0 }, { stdout: '9\n', code: 0 }] }] };
  });
  const p = await problem(lab);
  await openPanel(p);
  const f = await editorFrame(p);
  await expect(f.locator('#analysis-status')).toContainText('clangd 설치 필요');
  await loadCode(p, 'constex');
  await suggest(p, f, 'constex', 'constexpr');
  await p.keyboard.press('Escape');
  await loadCode(p, '#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b;}');
  await p.locator('.cboj-toolbar .run').click();
  await expect(p.locator('.cboj-status')).toHaveText('예제 통과');
  await p.locator('.cboj-toggle').click();
  await lab.worker.evaluate(() => { self.fixtureIO.analysis = null; });
  await openPanel(p);
  await expect(f.locator('#analysis-status')).toContainText('도우미 업데이트 필요');
  const calls = await lab.worker.evaluate(() => self.fixtureIO.analysisCalls.map(x => x.type));
  expect(calls.slice(calls.lastIndexOf('analysis-info'))).toEqual(['analysis-info']);
});
