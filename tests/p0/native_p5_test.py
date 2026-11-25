"""P5 compiler compatibility using real executables and the native wire protocol."""
import os
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

from native_test import HOST, HostWire, process_exists
sys.path.insert(0, str(HOST.parent))
from process_tree import Control
from toolchains import BuildError, Toolchains


class ParityTools(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tools = Toolchains()

    @unittest.skipUnless(os.name == 'nt', 'Windows linker reserve')
    def test_real_stack_reserve_and_cache_identity(self):
        for kind, compiler in [('cpp', 'msvc'), ('cpp', 'gcc'), ('c', 'gcc')]:
            with self.subTest(kind=kind, compiler=compiler), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                msg = dict(type='batch', code='int main(void){return 0;}', compiler=compiler, lang={'kind': kind})
                for mib, expected_cache in [(None, 'miss'), (8, 'miss'), (8, 'hit')]:
                    if mib is not None:
                        msg['stackSizeMiB'] = mib
                    with tempfile.TemporaryDirectory(dir=root) as temp:
                        args, _, result = self.tools.prepare(msg, Path(temp), Control())
                        self.assertEqual(result['cache'], expected_cache)
                        pe = Path(args[0]).read_bytes()
                        header = struct.unpack_from('<I', pe, 60)[0]
                        self.assertEqual(pe[header:header + 4], b'PE\0\0')
                        optional = header + 24
                        magic = struct.unpack_from('<H', pe, optional)[0]
                        size = struct.unpack_from('<Q' if magic == 0x20b else '<I', pe, optional + 72)[0]
                        self.assertEqual(size, (mib or 256) << 20)

    def test_missing_jdk(self):
        with patch.object(self.tools, 'jdk', None), tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(BuildError) as error:
                self.tools.prepare(dict(type='batch', lang={'kind': 'java'}, code=''), Path(temp), Control())
            self.assertEqual(error.exception.code, 'nocompiler')

    def test_java_batch_cache_release_errors_and_inputs(self):
        source = ('public class Main { static class Echo { static String read() throws Exception {'
                  'return new java.io.BufferedReader(new java.io.InputStreamReader(System.in)).readLine(); }}'
                  'public static void main(String[] args) throws Exception { System.out.print(Echo.read());'
                  'System.err.print(System.getProperty("ONLINE_JUDGE")); }}')
        with tempfile.TemporaryDirectory() as root:
            host = HostWire(root)
            try:
                host.send('info')
                self.assertRegex(host.receive()['javac'], r'javac \d')
                for rid, (release, cache) in enumerate([(11, 'miss'), (11, 'hit'), (17, 'miss')], 1):
                    host.send('batch', protocol=2, id=rid, lang=dict(kind='java', release=release), code=source,
                              inputs=['한글🙂\n', 'second\n'])
                    reply = host.receive()
                    self.assertEqual(reply.get('cache'), cache, reply)
                    self.assertEqual([(r['stdout'], r['stderr'], r['code']) for r in reply['results']],
                                     [('한글🙂', '1', 0), ('second', '1', 0)])
                # A newer platform API must fail when the submission language is Java 11.
                host.send('batch', protocol=2, id=4, lang=dict(kind='java', release=11),
                          code='public class Main { String value = "x".stripIndent(); }', inputs=[''])
                self.assertEqual(host.receive()['error']['code'], 'compile')
                for fields in [dict(lang=dict(kind='java', release='11')), dict(lang=dict(kind='java', std='gnu11')),
                               dict(lang=dict(kind='c'), stackSizeMiB=False), dict(lang=dict(kind='cpp'), stackSizeMiB=513)]:
                    host.send('batch', id=5, code='', inputs=[''], **fields)
                    self.assertEqual(host.receive()['error']['code'], 'invalid')
                self.assertEqual(list(Path(root).glob('cboj_*')), [])
            finally:
                host.close()

    def test_java_interactive_eof_cancel_and_timeout(self):
        source = ('public class Main { public static void main(String[] args) throws Exception {'
                  'System.out.println(ProcessHandle.current().pid());'
                  'System.out.println(new java.io.BufferedReader(new java.io.InputStreamReader(System.in)).readLine()); }}')
        with tempfile.TemporaryDirectory() as root:
            host = HostWire(root)
            try:
                for rid, action in enumerate(['eof', 'kill', 'timeout'], 1):
                    host.send('run', id=rid, protocol=2, lang={'kind': 'java'}, code=source,
                              timeLimit=1.5 if action == 'timeout' else 20)
                    for event in ('compile', 'compiled', 'start'):
                        reply = host.receive()
                        self.assertEqual(reply['type'], event, reply)
                        if event == 'compiled':
                            self.assertTrue(reply['ok'], reply)
                    output = ''
                    while '\n' not in output:
                        output += host.receive()['data']
                    pid = int(output.strip())
                    if action == 'eof':
                        host.send('stdin', id=rid, data='반가워요')
                    if action != 'timeout':
                        host.send(action, id=rid)
                    while True:
                        result = host.receive()
                        if result['type'] == 'exit':
                            break
                        output += result['data']
                    if action == 'eof':
                        self.assertIn('반가워요', output)
                        self.assertEqual(result['code'], 0)
                    else:
                        self.assertTrue(result['killed' if action == 'kill' else 'timeout'])
                    self.assertFalse(process_exists(pid))
                    self.assertEqual(list(Path(root).glob('cboj_*')), [])
            finally:
                host.close()


if __name__ == '__main__':
    unittest.main(verbosity=2)
