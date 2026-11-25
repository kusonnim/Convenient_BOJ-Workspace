"""Temporary job ownership across normal disconnects and interrupted host exits."""
from contextlib import contextmanager
import os
from pathlib import Path
import re
import shutil
import stat
import tempfile

MARKER = '.cboj-workspace'
SIGNATURE = b'Convenient BOJ native workspace v2\n'


@contextmanager
def workspace():
    with tempfile.TemporaryDirectory(prefix=f'cboj_p1_{os.getpid()}_') as temp:
        root = Path(temp).resolve()
        (root / MARKER).write_bytes(SIGNATURE)
        yield root


def owner_gone(pid):
    if os.name == 'nt':
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = kernel.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE
        if not handle:
            return ctypes.get_last_error() == 87  # PID does not exist
        try:
            return kernel.WaitForSingleObject(handle, 0) == 0
        finally:
            kernel.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return True
    except PermissionError:
        pass
    return False


def reclaim_abandoned():
    root = Path(tempfile.gettempdir()).resolve()
    for directory in root.glob('cboj_p1_*'):
        match = re.fullmatch(r'cboj_p1_([1-9][0-9]{0,9})_[a-z0-9_]{8}', directory.name)
        if not match or int(match[1]) > 0x7fffffff or not owner_gone(int(match[1])):
            continue
        try:
            attrs = directory.lstat()
            if not stat.S_ISDIR(attrs.st_mode) or getattr(attrs, 'st_file_attributes', 0) & 0x400:
                continue
            if directory.resolve().parent != root:
                continue
            marker = directory / MARKER
            if not stat.S_ISREG(marker.lstat().st_mode) or marker.resolve().parent != directory:
                continue
            with marker.open('rb') as file:
                if file.read(len(SIGNATURE) + 1) != SIGNATURE:
                    continue
            shutil.rmtree(directory)
        except OSError:
            continue  # Another host can reclaim the same finished directory.
