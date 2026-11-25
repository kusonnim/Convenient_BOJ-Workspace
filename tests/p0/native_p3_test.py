"""Real native framing and clangd positions, plus deterministic transport edge cases."""
from io import BytesIO
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from native_test import HOST, HostWire, process_exists

sys.path.insert(0, str(HOST.parent))
from clangd_session import Session, definition, read_packet, valid
from clangd_tools import discover
from process_tree import Control

CPP = '''#include <vector>
#include <string>
#include <map>
template<class T> T twice(T v) { return v + v; }
int combine(int left, int right) { return left + right; }
int main() {
    std::vector<std::string> words;
    std::string title;
    std::map<int, int> counts;
    /* 한글🙂 */ words.push_back("one");
    auto it = words.begin();
    (void)title.substr(0, 1);
    counts.emplace(1, 2);
    (void)it->size();
    return combine(twice(2), 4);
}'''


def position(code, tail):
    before = code[:code.index(tail) + len(tail)]
    line = before.split('\n')[-1]
    return dict(line=before.count('\n'), character=len(line.encode('utf-16-le')) // 2)


class Clangd(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='cboj test 한글#')
        self.addCleanup(self.temp.cleanup)
        self.host = HostWire(self.temp.name)
        self.addCleanup(self.host.close)
        self.version = self.request_id = 1
        self.seen = []

    def wait_for(self, kind, **fields):
        deadline = time.monotonic() + 65
        def matches(m):
            return m['type'] == kind and all(m.get(k) == v for k, v in fields.items())
        for i, m in enumerate(self.seen):
            if matches(m):
                return self.seen.pop(i)
        while True:
            m = self.host.receive(max(0, deadline - time.monotonic()))
            if matches(m):
                return m
            self.assertNotIn(m['type'], ['analysis-unavailable', 'analysis-lost'], m)
            self.seen.append(m)

    def open(self, code, standard='gnu++17'):
        self.code = code
        self.host.send('analysis-info')
        self.assertEqual(self.host.receive()['version'], 1)
        self.host.send('analysis-open', code=code, version=self.version, standard=standard)
        return self.wait_for('analysis-ready')['family']

    def edit(self, code):
        self.code = code
        self.version += 1
        self.host.send('analysis-change', code=code, version=self.version)

    def ask(self, feature, tail):
        self.request_id += 1
        self.host.send('analysis-request', feature=feature, id=self.request_id, version=self.version,
                       position=position(self.code, tail))
        return self.wait_for('analysis-result', id=self.request_id, version=self.version)['result']

    def test_real_cpp(self):
        start = time.perf_counter()
        self.assertEqual(self.open(CPP), 'MSVC')
        self.assertIn('push_back', str(self.ask('completion', 'words.pu')))
        cold_ms = round((time.perf_counter() - start) * 1000)
        warm_ms = []
        for _ in range(5):
            start = time.perf_counter()
            self.assertIn('push_back', str(self.ask('completion', 'words.pu')))
            warm_ms.append(round((time.perf_counter() - start) * 1000, 1))
        self.assertEqual(self.wait_for('analysis-diagnostics', version=1)['items'], [])
        for tail, expected in [('title.sub', 'substr'), ('counts.empl', 'emplace'),
                               ('it->si', 'size'), ('return comb', 'combine'), ('return combine(tw', 'twice'),
                               ('#include <vec', 'vector')]:
            with self.subTest(tail=tail):
                r = self.ask('completion', tail)
                self.assertTrue(any(expected in i['label'] for i in r['items']), str(r)[:1500])
        signature = self.ask('signatureHelp', 'return combine(twice(2), ')
        self.assertEqual(signature['activeParameter'], 1)
        self.assertIn('int right', signature['signatures'][0]['label'])
        self.assertIn('combine', self.ask('hover', 'return comb')['text'])
        self.assertEqual(self.ask('definition', 'return comb')['range']['start']['line'], 4)
        self.assertIn('push_back', self.ask('definition', 'words.push_b')['text'])
        start = time.perf_counter()
        self.edit(CPP.replace('words.push_back("one")', 'words.missing_member()'))
        diagnostics = self.wait_for('analysis-diagnostics', version=self.version)['items']
        diag_ms = round((time.perf_counter() - start) * 1000)
        d = next(x for x in diagnostics if 'missing_member' in x['message'])
        self.assertEqual(d['range']['start'], position(self.code, '/* 한글🙂 */ words.'))
        self.edit(CPP + '\nint unfinished(')
        self.assertTrue(self.wait_for('analysis-diagnostics', version=self.version)['items'])
        self.edit(CPP)
        self.assertEqual(self.wait_for('analysis-diagnostics', version=self.version)['items'], [])
        self.host.send('analysis-close')
        self.wait_for('analysis-closed')
        self.assertFalse(list(Path(self.temp.name).glob('cboj-lsp_*')))
        if destination := os.environ.get('CBOJ_P3_NATIVE_METRICS'):
            Path(destination).write_text(json.dumps(dict(coldCompletionMs=cold_ms, warmCompletionMs=warm_ms,
                                                        changeToDiagnosticsMs=diag_ms), indent=2) + '\n', encoding='utf-8')

    def test_gcc_headers(self):
        self.assertEqual(self.open('#include <vector>\nint main(){std::vector<int> v; v.clear();}', 'gnu++11'), 'GCC')
        self.assertEqual(self.wait_for('analysis-diagnostics', version=1)['items'], [])
        self.assertIn('clear', str(self.ask('completion', 'v.cle')))

    def test_gnu_competitive_template(self):
        self.assertEqual(self.open('#include <bits/stdc++.h>\nint main(){std::vector<int> v; v.clear();}'), 'GCC')
        self.assertEqual(self.wait_for('analysis-diagnostics', version=1)['items'], [])
        self.assertIn('clear', str(self.ask('completion', 'v.cle')))

    @unittest.skipUnless(os.name == 'nt', 'Windows Job Object ownership')
    def test_forced_native_exit_reclaims_its_server_and_workspace(self):
        self.open('int main(){}')
        (owned,) = Path(self.temp.name).glob('cboj-lsp_*')
        query = ("Get-CimInstance Win32_Process -Filter \"Name='clangd.exe'\" | "
                 "Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:CBOJ_TEST_WORK) } | "
                 "Select-Object -ExpandProperty ProcessId")
        pid = int(subprocess.check_output(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', query],
                                          env=dict(os.environ, CBOJ_TEST_WORK=str(owned)), timeout=15))
        self.assertTrue(process_exists(pid))
        self.host.proc.kill()
        self.host.proc.wait(5)
        for _ in range(50):
            if not process_exists(pid):
                break
            time.sleep(0.1)
        self.assertFalse(process_exists(pid))
        replacement = HostWire(self.temp.name)
        self.addCleanup(replacement.close)
        replacement.send('analysis-open', code='int main(){}', version=1, standard='c++17')
        while (m := replacement.receive())['type'] == 'analysis-diagnostics':
            pass
        self.assertEqual(m['type'], 'analysis-ready')
        self.assertFalse(owned.exists())
        replacement.send('analysis-close')
        while (m := replacement.receive())['type'] == 'analysis-diagnostics':
            pass
        self.assertEqual(m['type'], 'analysis-closed')


class Boundaries(unittest.TestCase):
    @unittest.skipUnless(os.name == 'nt', 'Windows native host installer')
    def test_uninstall_removes_only_project_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / 'ConvenientBOJ'
            dest.mkdir()
            for name in ('clangd_session.py', 'clangd_tools.py', 'workspace.py', 'formatting.py', 'owner-note.txt'):
                (dest / name).write_text('fixture')
            # The uninstaller compares each existing registration's full
            # manifest path with this private directory before touching its key.
            subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                            '-File', str(HOST.with_name('uninstall.ps1')), '-ChromeOnly', '-Yes'],
                           env=dict(os.environ, LOCALAPPDATA=tmp), check=True, capture_output=True, timeout=15)
            self.assertEqual([p.name for p in dest.iterdir()], ['owner-note.txt'])

    def test_frames_and_fixed_schema(self):
        self.assertEqual(read_packet(BytesIO(b'Content-Length: 2\r\n\r\n{}')), {})
        for b in [b'Content-Length: 9\r\n\r\n{}', b'Content-Length: -1\r\n\r\n', b'ignored']:
            with self.assertRaises((ValueError, EOFError)):
                read_packet(BytesIO(b))
        good = dict(type='analysis-request', id=1, version=2, feature='hover', position={'line': 0, 'character': 3})
        self.assertTrue(valid(good))
        for invalid in [dict(good, uri='file:///arbitrary'), dict(good, feature='workspace/executeCommand'),
                        dict(good, position={'line': 0, 'character': -1}), dict(good, id=True)]:
            self.assertFalse(valid(invalid))
        opened = dict(type='analysis-open', standard='c++17', version=1, code='int main(){}')
        self.assertTrue(valid(opened))
        for invalid in [dict(opened, code='한' * 180000), dict(opened, standard='unknown'), dict(opened, code='\ud800')]:
            self.assertFalse(valid(invalid))
        with tempfile.TemporaryDirectory() as tmp:
            f = Path(tmp) / 'private'; f.write_text('private')
            r = dict(start=good['position'], end=good['position'])
            self.assertIsNone(definition([dict(uri=f.as_uri(), range=r)], 'file:///draft', []))
            with patch('clangd_tools.clangd_paths', return_value=[]):
                self.assertEqual(discover(Path(tmp), 'gnu++17', Control()), (None, 'no-server'))
            with patch('clangd_tools.clangd_paths', return_value=[Path(sys.executable)]), patch('clangd_tools.profiles', return_value=[]):
                self.assertEqual(discover(Path(tmp), 'gnu++17', Control()), (None, 'no-headers'))

    def test_cancellation_and_late_packets(self):
        with patch.object(Session, 'run'):
            replies, rpc = [], []
            s = Session(dict(standard='gnu++17', code='int i;', version=1), replies.append)
            s.worker.join()
            s.opened, s.ready, s.uri, s.roots = True, True, 'file:///draft', []
            s.packet = lambda **m: rpc.append(m)
            request = dict(type='analysis-request', feature='hover', position={'line': 0, 'character': 4}, version=1)
            s.message(dict(request, id=1))
            s.message(dict(type='analysis-cancel', id=1))
            self.assertEqual(rpc[-1]['method'], '$/cancelRequest')
            s.handle_packet(dict(id=1, result={'contents': 'late'}))
            s.message(dict(request, id=2))
            s.message(dict(type='analysis-change', version=3, code='int newer;'))
            s.message(dict(type='analysis-change', version=2, code='int older;'))
            s.handle_packet(dict(id=2, result={'contents': 'stale'}))
            s.handle_packet(dict(method='textDocument/publishDiagnostics', params=dict(uri=s.uri, version=1, diagnostics=[])))
            self.assertEqual(replies, [])
            self.assertEqual((s.version, s.text), (3, 'int newer;'))
            s.ready, s.parsing_version, s.family = False, 1, 'MSVC'
            s.handle_packet(dict(id=-2, error={'code': -32801}))
            self.assertEqual(rpc[-1]['method'], 'textDocument/documentSymbol')
            self.assertFalse(s.ready)
            s.handle_packet(dict(id=-2, result=[]))
            self.assertTrue(s.ready)


if __name__ == '__main__':
    unittest.main(verbosity=2)
