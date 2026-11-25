"""Bounded pipe I/O and ownership of a compiler or program and its children."""
import codecs
import os
import queue
import signal
import subprocess
import sys
import threading
import time

WINDOWS = os.name == 'nt'
NO_WINDOW = subprocess.CREATE_NO_WINDOW if WINDOWS else 0

if WINDOWS:
    import ctypes
    from ctypes import wintypes as w

    class BasicLimits(ctypes.Structure):
        _fields_ = [
            ('process_time', ctypes.c_int64), ('job_time', ctypes.c_int64), ('flags', w.DWORD),
            ('min_ws', ctypes.c_size_t), ('max_ws', ctypes.c_size_t), ('active', w.DWORD),
            ('affinity', ctypes.c_size_t), ('priority', w.DWORD), ('scheduling', w.DWORD),
        ]

    class ExtendedLimits(ctypes.Structure):
        _fields_ = [('basic', BasicLimits), ('io', ctypes.c_uint64 * 6), ('memory', ctypes.c_size_t * 4)]

    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateJobObjectW.argtypes = [w.LPVOID, w.LPCWSTR]
    kernel.CreateJobObjectW.restype = w.HANDLE
    kernel.SetInformationJobObject.argtypes = [w.HANDLE, ctypes.c_int, w.LPVOID, w.DWORD]
    kernel.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
    kernel.CloseHandle.argtypes = [w.HANDLE]


class Tree:
    def __init__(self, args, cwd, env):
        self.lock = threading.Lock()
        self.closed = False
        pipes = dict(stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                     bufsize=0, cwd=cwd, env=env)
        if not WINDOWS:
            self.proc = subprocess.Popen(args, start_new_session=True, **pipes)
            return
        self.job = kernel.CreateJobObjectW(None, None)
        if not self.job:
            raise ctypes.WinError(ctypes.get_last_error())
        self.proc = None
        try:
            limits = ExtendedLimits()
            limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if not kernel.SetInformationJobObject(self.job, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
                raise ctypes.WinError(ctypes.get_last_error())
            # The launcher reads exactly one byte before spawning. Even a very
            # short-lived compiler cannot create children outside this job.
            launcher = [sys.executable, '-I', '-S', '-B', os.path.abspath(__file__)]
            self.proc = subprocess.Popen(launcher + args, creationflags=NO_WINDOW, **pipes)
            if not kernel.AssignProcessToJobObject(self.job, int(self.proc._handle)):
                raise ctypes.WinError(ctypes.get_last_error())
            self.proc.stdin.write(b'\x01')
        except BaseException:
            if self.proc:
                self.proc.kill()
                self.proc.wait()
                for pipe in (self.proc.stdin, self.proc.stdout, self.proc.stderr):
                    pipe.close()
            kernel.CloseHandle(self.job)
            raise

    def stop(self):
        with self.lock:
            if self.closed:
                return
            self.closed = True
            if WINDOWS:
                kernel.CloseHandle(self.job)
            else:
                try:
                    os.killpg(self.proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass


class Control:
    def __init__(self):
        self.lock = threading.Lock()
        self.tree = None
        self.cancelled = threading.Event()
        self.input = queue.Queue()
        self.input_bytes = 0
        self.eof = False

    def attach(self, tree):
        with self.lock:
            self.tree = tree
            if self.cancelled.is_set():
                tree.stop()

    def cancel(self):
        with self.lock:
            self.cancelled.set()
            if self.tree:
                self.tree.stop()

    def feed(self, data):
        if self.eof:
            return
        if data is None:
            self.eof = True
        else:
            if not data:
                return
            self.input_bytes += len(data)
            if self.input_bytes > 512 * 1024:
                self.cancel()
                raise ValueError('터미널 입력 한도(512 KiB)를 넘었어요.')
        self.input.put(data)


def execute(args, cwd, env, control, *, timeout, limit, stdin=b'', on_start=None, on_output=None):
    """stdin=None consumes the job's interactive queue. Other inputs close at EOF."""
    if control.cancelled.is_set():
        return dict(code=None, ms=0, killed=True, stdout=b'', stderr=b'', overLimit=False, timeout=False)
    tree = Tree(args, cwd, env)
    proc = tree.proc
    control.attach(tree)
    started = time.monotonic()
    done = threading.Event()
    overflow = threading.Event()
    streams = {'stdout': bytearray(), 'stderr': bytearray()}
    remaining = limit
    budget_lock = threading.Lock()

    def read(name):
        nonlocal remaining
        decoder = codecs.getincrementaldecoder('utf-8')('replace')
        pipe = getattr(proc, name)
        with pipe:
            while chunk := pipe.read(8192):
                with budget_lock:
                    count = min(len(chunk), remaining)
                    remaining -= count
                if on_output:
                    text = decoder.decode(chunk[:count])
                    if text:
                        on_output(name, text)
                else:
                    streams[name].extend(chunk[:count])
                if count < len(chunk):
                    overflow.set()
                    tree.stop()
                    break
            tail = decoder.decode(b'', final=True)
            if on_output and tail:
                on_output(name, tail)

    def write():
        def write_all(pipe, data):
            view = memoryview(data)
            while view:
                view = view[pipe.write(view):]
        try:
            with proc.stdin as pipe:
                if stdin is not None:
                    write_all(pipe, stdin)
                    return
                while not done.is_set():
                    try:
                        data = control.input.get(timeout=0.1)
                    except queue.Empty:
                        continue
                    if data is None:
                        return
                    write_all(pipe, data)
        except (BrokenPipeError, OSError, ValueError):
            pass  # The program can exit with input still queued.

    threads = [threading.Thread(target=read, args=(name,)) for name in streams]
    threads.append(threading.Thread(target=write))
    timed_out = False
    try:
        if on_start:
            on_start()
        for thread in threads:
            thread.start()
        try:
            proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
    finally:
        # Close the entire group even on normal exit. Descendants can still own pipes.
        tree.stop()
        proc.wait()
        elapsed = int((time.monotonic() - started) * 1000)
        done.set()
        for thread in threads:
            if thread.ident is not None:
                thread.join()
        with control.lock:
            control.tree = None
    return dict(code=proc.returncode, ms=elapsed,
                stdout=bytes(streams['stdout']), stderr=bytes(streams['stderr']),
                killed=control.cancelled.is_set(), timeout=timed_out, overLimit=overflow.is_set())


if __name__ == '__main__' and WINDOWS:
    import msvcrt
    msvcrt.setmode(0, os.O_BINARY)
    if os.read(0, 1) == b'\x01':
        result = subprocess.call(sys.argv[1:], stdin=sys.stdin, stdout=sys.stdout, stderr=sys.stderr,
                                 creationflags=NO_WINDOW)
        sys.exit(ctypes.c_int32(result).value)
