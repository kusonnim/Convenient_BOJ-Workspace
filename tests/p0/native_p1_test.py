"""P1 cache, native protocol and Windows process-lifetime regressions."""
from pathlib import Path
import os
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from native_test import HOST, HostWire, process_exists

sys.path.insert(0, str(HOST.parent))
from process_tree import Control, execute
from toolchains import BuildError, Toolchains


class LegacyHostTests(unittest.TestCase):
    def test_p0_host_accepts_capability_probe_and_legacy_gcc_job(self):
        with tempfile.TemporaryDirectory(prefix='p1-old-host-') as tmp:
            prior = Path(tmp) / 'cboj_host.py'
            prior.write_bytes(subprocess.check_output(['git', 'show', '84360dc:host/cboj_host.py'], cwd=HOST.parents[1]))
            host = HostWire(tmp, prior)
            try:
                host.send('info', protocol=2, id=1)
                info = host.receive()
                self.assertEqual(info['version'], '1.0.0')
                self.assertNotIn('protocol', info)
                if not info['gpp']:
                    self.skipTest('G++ unavailable in original host')
                code = '#include <cstdio>\nint main(){int a,b;std::scanf("%d%d",&a,&b);std::printf("%d",a+b);}'
                host.send('batch', id=2, lang=dict(kind='cpp', std='gnu++17'), code=code, inputs=['2 3', '4 5'])
                reply = host.receive()
                self.assertEqual([r['stdout'] for r in reply['results']], ['5', '9'])
            finally:
                host.close()


class CacheTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tools = Toolchains()

    def setUp(self):
        scratch = tempfile.TemporaryDirectory(prefix='p1 cache ')
        self.addCleanup(scratch.cleanup)
        self.root = Path(scratch.name).resolve()
        self.header = self.root / 'local header.h'
        self.header.write_text('#define FIXTURE 7', encoding='utf-8')
        self.code = '#include <cstdio>\n#include "' + self.header.as_posix() + '"\nint main(){std::printf("%d", FIXTURE);}'

    def build(self, compiler, mode='batch', std='gnu++17'):
        with tempfile.TemporaryDirectory(dir=self.root) as directory:
            msg = dict(type=mode, protocol=2, lang=dict(kind='cpp', std=std), code=self.code, compiler=compiler)
            args, env, build = self.tools.prepare(msg, Path(directory), Control())
            run = execute(args, directory, env, Control(), timeout=5, limit=256)
            self.assertEqual(run['code'], 0)
            return build['cache'], run['stdout'].decode()

    def test_msvc_identity_and_dependencies(self):
        if not self.tools.msvc:
            self.skipTest('x64 MSVC unavailable')
        self.assertEqual(self.build('msvc'), ('miss', '7'))
        self.assertEqual(self.build('msvc'), ('hit', '7'))
        self.header.write_text('#define FIXTURE 42', encoding='utf-8')
        self.assertEqual(self.build('msvc'), ('miss', '42'))
        self.assertEqual(self.build('msvc', mode='run'), ('miss', '42'))
        self.assertEqual(self.build('msvc', mode='run'), ('hit', '42'))
        with patch.dict(self.tools.msvc[1], {'CBOJ_TEST_ENVIRONMENT': 'second'}):
            self.assertEqual(self.build('msvc'), ('miss', '42'))
        self.assertEqual(self.build('msvc'), ('hit', '42'))
        if self.tools.gcc_versions['g++']:
            self.assertEqual(self.build('gcc'), ('miss', '42'))

    def test_gnu_interactive_header_dependency(self):
        if not self.tools.gcc_versions['g++']:
            self.skipTest('G++ unavailable')
        self.assertEqual(self.build('gcc', mode='run'), ('miss', '7'))
        self.assertEqual(self.build('gcc', mode='run'), ('hit', '7'))
        self.header.write_text('#define FIXTURE 123', encoding='utf-8')
        self.assertEqual(self.build('gcc', mode='run'), ('miss', '123'))

    def test_cache_evicts_the_oldest_build(self):
        compiler = 'msvc' if self.tools.msvc else 'gcc'
        if compiler == 'gcc' and not self.tools.gcc_versions['g++']:
            self.skipTest('C++ compiler unavailable')
        source = '#include <cstdio>\nint main(){std::printf("%d", NUMBER);}'
        for i in range(9):
            self.code = source.replace('NUMBER', str(i))
            self.assertEqual(self.build(compiler), ('miss', str(i)))
        self.assertLessEqual(len(self.tools.cache), 8)
        self.assertLessEqual(self.tools.cache_bytes, 32 * 1024 * 1024)
        self.assertEqual(self.build(compiler), ('hit', '8'))
        self.code = source.replace('NUMBER', '0')
        self.assertEqual(self.build(compiler), ('miss', '0'))

    def test_unavailable_msvc_and_unsupported_standard(self):
        if self.tools.msvc:
            with self.assertRaises(BuildError) as err:
                self.build('msvc', std='gnu++14')
            self.assertEqual(err.exception.code, 'standard')
        with patch.object(self.tools, 'msvc', None):
            with self.assertRaises(BuildError) as err:
                self.build('msvc')
            self.assertEqual(err.exception.code, 'nocompiler')


class WireTests(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory(prefix='p1-wire-')
        self.addCleanup(scratch.cleanup)
        self.root = Path(scratch.name)
        self.host = self.connect()

    def connect(self):
        host = HostWire(str(self.root))
        self.addCleanup(host.close)
        host.send('info', protocol=2, id=1)
        self.assertEqual(host.receive()['protocol'], 2)
        return host

    def until(self, kind):
        messages = []
        while not messages or messages[-1]['type'] != kind:
            messages.append(self.host.receive(timeout=10))
        return messages

    def start(self, code, limit=10):
        self.host.send('run', protocol=2, id=2, lang={'kind': 'python'}, code=code, interactive=True, timeLimit=limit)
        self.until('start')

    def descendants(self):
        self.start('import os, subprocess, sys, time\n'
                   'child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])\n'
                   'print(os.getpid(), child.pid, flush=True)\ntime.sleep(30)', 30)
        output = ''
        while '\n' not in output:
            msg = self.host.receive(timeout=5)
            self.assertEqual((msg['type'], msg['stream']), ('out', 'stdout'))
            output += msg['data']
        pids = list(map(int, output.split()))
        self.assertEqual(len(pids), 2)
        self.assertTrue(all(process_exists(pid) for pid in pids))
        return pids

    def assert_exited(self, pids):
        deadline = time.monotonic() + 5
        while any(process_exists(pid) for pid in pids) and time.monotonic() < deadline:
            time.sleep(0.025)
        self.assertFalse(any(process_exists(pid) for pid in pids))

    def test_descendants_on_disconnect(self):
        pids = self.descendants()
        self.host.proc.stdin.close()
        self.assertEqual(self.host.proc.wait(timeout=5), 0)
        self.assert_exited(pids)
        self.assertEqual(list(self.root.glob('cboj_*')), [])

    def test_descendant_exits_after_normal_parent_return(self):
        self.start('import subprocess, sys\n'
                   'child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])\n'
                   'print(child.pid, flush=True)')
        messages = self.until('exit')
        self.assertEqual(messages[-1]['code'], 0)
        child = int(''.join(m['data'] for m in messages if m['type'] == 'out'))
        self.assert_exited([child])
        self.assertEqual(list(self.root.glob('cboj_*')), [])

    @unittest.skipUnless(os.name == 'nt', 'Windows kill-on-close job objects')
    def test_forced_host_exit_and_scoped_reclamation(self):
        pids = self.descendants()
        work, = self.root.glob('cboj_p1_*')
        self.assertTrue((work / '.cboj-workspace').is_file())
        other = self.root / 'cboj_p1_2147483647_abcd1234'
        other.mkdir()
        (other / 'keep').write_text('unrelated', encoding='utf-8')
        self.host.proc.kill()
        self.host.proc.wait(timeout=5)
        self.assert_exited(pids)
        self.assertTrue(work.is_dir())
        self.connect()
        self.assertFalse(work.exists())
        self.assertEqual((other / 'keep').read_text(encoding='utf-8'), 'unrelated')

    def test_interactive_timeout_and_output_bound(self):
        self.start('import time\ntime.sleep(5)', 0.3)
        self.assertTrue(self.until('exit')[-1]['timeout'])
        self.host.send('batch', protocol=2, id=3, lang={'kind': 'python'},
                       code='import sys\nsys.stdout.buffer.write(b"x" * 100000)', inputs=['', ''])
        reply = self.host.receive()
        self.assertEqual(reply['type'], 'batch-result')
        self.assertTrue(all(r['overLimit'] for r in reply['results']))
        self.assertEqual(sum(len(r['stdout']) for r in reply['results']), 96 * 1024)
        self.assertEqual(list(self.root.glob('cboj_*')), [])

    def test_invalid_and_duplicate_requests_leave_port_usable(self):
        self.host.send('batch', id=2, protocol=999, lang={'kind': 'python'}, code='', inputs=[''])
        self.assertEqual(self.host.receive()['error']['code'], 'invalid')
        self.host.send('batch', id=2, protocol=2, lang={'kind': 'python'}, code='x' * (512 * 1024 + 1), inputs=[''])
        self.assertEqual(self.host.receive()['error']['code'], 'invalid')
        fields = dict(id=2, protocol=2, lang={'kind': 'python'}, code='print("single")', inputs=[''])
        self.host.send('batch', **fields, stdin=['unused legacy field'])
        self.assertEqual(self.host.receive()['results'][0]['stdout'].strip(), 'single')
        self.host.send('batch', **fields)
        self.host.send('info', protocol=2, id=3)
        self.assertEqual(self.host.receive()['type'], 'info')
        self.host.send('shutdown', protocol=2)
        self.assertEqual(self.host.receive()['type'], 'closed')
        self.assertEqual(self.host.proc.wait(timeout=5), 0)
        self.assertEqual(list(self.root.glob('cboj_*')), [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
