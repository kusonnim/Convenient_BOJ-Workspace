"""Exercise the checked-out host as Chrome would over stdin/stdout. Standard library only."""
import json
import os
from pathlib import Path
import queue
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest


HOST = Path(__file__).resolve().parents[2] / 'host' / 'cboj_host.py'


class HostWire:
    def __init__(self, temp):
        env = dict(os.environ, TMP=temp, TEMP=temp, TMPDIR=temp)
        self.proc = subprocess.Popen(
            [sys.executable, '-u', str(HOST)], stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env,
        )
        self.messages = queue.Queue()
        self.reader = threading.Thread(target=self.read_frames, daemon=True)
        self.reader.start()

    def read_frames(self):
        try:
            while header := self.proc.stdout.read(4):
                size, = struct.unpack('=I', header)
                data = self.proc.stdout.read(size)
                if len(data) != size:
                    raise EOFError('Truncated native frame')
                self.messages.put(json.loads(data.decode('utf-8')))
        except Exception as error:
            self.messages.put(error)
        finally:
            self.messages.put(None)

    def send(self, kind, **fields):
        data = json.dumps(dict(type=kind, **fields), ensure_ascii=False).encode('utf-8')
        self.proc.stdin.write(struct.pack('=I', len(data)) + data)
        self.proc.stdin.flush()

    def receive(self, timeout=70):
        try:
            message = self.messages.get(timeout=timeout)
        except queue.Empty as error:
            raise AssertionError('Timed out waiting for a native message') from error
        if isinstance(message, Exception):
            raise message
        if message is None:
            raise AssertionError('Host closed its output before the expected reply')
        return message

    def close(self):
        self.proc.stdin.close()
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.wait(timeout=5)
            raise AssertionError('Native host stayed alive after stdin closed')
        finally:
            self.reader.join(timeout=5)
            self.proc.stdout.close()
            self.proc.stderr.close()


def process_exists(pid):
    if os.name == 'nt':
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
        kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
        synchronize = 0x00100000
        handle = kernel.OpenProcess(synchronize, False, pid)
        if not handle:
            if ctypes.get_last_error() == 87:  # ERROR_INVALID_PARAMETER for an exited PID
                return False
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            status = kernel.WaitForSingleObject(handle, 0)
            if status not in (0, 258):  # WAIT_OBJECT_0, WAIT_TIMEOUT
                raise ctypes.WinError(ctypes.get_last_error())
            return status == 258
        finally:
            kernel.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


class NativeBaseline(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory(prefix='p0-host-')
        self.addCleanup(scratch.cleanup)
        self.temp = Path(scratch.name)
        self.host = HostWire(scratch.name)
        self.addCleanup(self.host.close)
        self.host.send('info')
        self.info = self.host.receive()
        self.assertEqual(self.info['type'], 'info')

    def batch(self, kind, code, inputs, std=None, limit=3):
        lang = dict(kind=kind)
        if std:
            lang['std'] = std
        self.host.send('batch', id=17, lang=lang, code=code, inputs=inputs, timeLimit=limit)
        reply = self.host.receive()
        self.assertEqual((reply['type'], reply['id']), ('batch-result', 17))
        self.assert_clean()
        return reply

    def assert_clean(self):
        # The host sends its terminal frame just before its finally block.
        deadline = time.monotonic() + 3
        while any(self.temp.glob('cboj_*')) and time.monotonic() < deadline:
            time.sleep(0.025)
        self.assertEqual(list(self.temp.glob('cboj_*')), [])

    def start_python(self, code):
        self.host.send('run', id=23, lang={'kind': 'python'}, code=code, stdin='', interactive=True)
        for kind in ['compile', 'compiled', 'start']:
            msg = self.host.receive()
            self.assertEqual((msg['type'], msg['id']), (kind, 23))
            if kind == 'compiled':
                self.assertTrue(msg['ok'])

    def test_info(self):
        for key in ['version', 'python', 'gcc', 'gpp']:
            self.assertIn(key, self.info)
        print('Host inventory', json.dumps(self.info, ensure_ascii=True), flush=True)

    def test_c_batch(self):
        if not self.info['gcc']:
            self.skipTest('Host did not discover gcc')
        code = '#include <stdio.h>\nint main(void){int x; scanf("%d",&x); printf("%d", x+1);}'
        self.check_sums(self.batch('c', code, ['2\n', '5\n'], 'gnu11'))

    def test_cpp_batch(self):
        if not self.info['gpp']:
            self.skipTest('Host did not discover g++')
        code = '#include <iostream>\nint main(){int x; std::cin >> x; std::cout << x+1;}'
        self.check_sums(self.batch('cpp', code, ['2\n', '5\n'], 'gnu++17'))

    def check_sums(self, reply):
        self.assertNotIn('error', reply)
        self.assertEqual([(r['stdout'], r['code']) for r in reply['results']], [('3', 0), ('6', 0)])
        self.assertTrue(all(r['ms'] >= 0 for r in reply['results']))

    def test_compiler_diagnostic(self):
        if not self.info['gpp']:
            self.skipTest('Host did not discover g++')
        reply = self.batch('cpp', 'int main(){return undeclared_fixture;}', [''])
        self.assertEqual(reply['error']['code'], 'compile')
        self.assertIn('undeclared_fixture', reply['error']['message'])
        self.assertEqual(reply['results'], [])

    def test_python_output_and_runtime_error(self):
        code = 'import sys\nprint(input())\nprint("detail", file=sys.stderr)\nsys.exit(7)'
        result, = self.batch('python', code, ['한글 🐍\n'])['results']
        self.assertEqual((result['stdout'].splitlines(), result['stderr'].splitlines(), result['code']),
                         (['한글 🐍'], ['detail'], 7))

    def test_batch_timeout(self):
        result, = self.batch('python', 'import time\ntime.sleep(2)', [''], limit=0.2)['results']
        self.assertTrue(result['timeout'])
        self.assertIsNone(result['code'])

    def test_interactive_input_eof_and_separate_streams(self):
        self.start_python('import sys\nfor s in sys.stdin:\n print(s.strip())\n print("err", file=sys.stderr)')
        self.host.send('stdin', id=99, data='wrong job\n')
        self.host.send('stdin', id=23, data='반가워요\n')
        # Verify streaming before EOF. Pipe reads may split UTF-8 or coalesce writes.
        streams = dict(stdout='', stderr='')
        while '반가워요' not in streams['stdout'] or 'err' not in streams['stderr']:
            msg = self.host.receive(timeout=5)
            self.assertEqual((msg['id'], msg['type']), (23, 'out'))
            streams[msg['stream']] += msg['data']
        self.host.send('eof', id=23)
        while True:
            msg = self.host.receive(timeout=5)
            self.assertEqual(msg['id'], 23)
            if msg['type'] == 'exit':
                self.assertEqual(msg['code'], 0)
                break
            self.assertEqual(msg['type'], 'out')
            streams[msg['stream']] += msg['data']
        self.assertEqual(streams['stdout'].splitlines(), ['반가워요'])
        self.assertEqual(streams['stderr'].splitlines(), ['err'])
        self.assert_clean()

    def test_interactive_stop(self):
        self.start_python('import time\ntime.sleep(10)')
        self.host.send('kill', id=23)
        msg = self.host.receive(timeout=5)
        self.assertEqual((msg['id'], msg['type'], msg['killed']), (23, 'exit', True))
        self.assert_clean()

    def test_disconnect_during_interactive_run(self):
        self.start_python('import os, time\nprint(os.getpid())\ntime.sleep(15)')
        output = ''
        while '\n' not in output:
            msg = self.host.receive(timeout=5)
            self.assertEqual((msg['type'], msg['stream']), ('out', 'stdout'))
            output += msg['data']
        pid = int(output.strip())
        self.assertTrue(process_exists(pid))
        self.host.proc.stdin.close()
        self.assertEqual(self.host.proc.wait(timeout=5), 0)
        deadline = time.monotonic() + 3
        while process_exists(pid) and time.monotonic() < deadline:
            time.sleep(0.05)
        self.assertFalse(process_exists(pid), 'Interactive child survived host disconnect')
        # Daemon threads may lose their finally block on interpreter shutdown.
        leftovers = len(list(self.temp.glob('cboj_*')))
        print(f'Job directories remaining after host disconnect: {leftovers}', flush=True)


if __name__ == '__main__':
    unittest.main(verbosity=2)
