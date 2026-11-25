"""Send a fixed Korean IME sample or editor shortcut to the owned test Chrome window."""
import ctypes
from ctypes import wintypes as w
import sys
import time

user = ctypes.WinDLL('user32', use_last_error=True)
pid, title, action = int(sys.argv[1]), sys.argv[2], sys.argv[3]
if not title.startswith('CBOJ IME '):
    raise ValueError('Expected the disposable test window title')
user.GetForegroundWindow.restype = w.HWND
user.GetWindowThreadProcessId.argtypes = [w.HWND, ctypes.POINTER(w.DWORD)]
user.GetKeyboardLayout.restype = w.HKL
user.SetForegroundWindow.argtypes = [w.HWND]
user.GetWindowTextW.argtypes = [w.HWND, w.LPWSTR, ctypes.c_int]
windows = []


@ctypes.WINFUNCTYPE(w.BOOL, w.HWND, w.LPARAM)
def own_window(hwnd, _):
    owner = w.DWORD()
    user.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
    label = ctypes.create_unicode_buffer(512)
    user.GetWindowTextW(hwnd, label, len(label))
    if owner.value == pid and title in label.value:
        windows.append(hwnd)
    return True


class Keyboard(ctypes.Structure):
    _fields_ = [('key', w.WORD), ('scan', w.WORD), ('flags', w.DWORD), ('time', w.DWORD), ('extra', ctypes.c_size_t)]


class Mouse(ctypes.Structure):
    _fields_ = [('dx', w.LONG), ('dy', w.LONG), ('data', w.DWORD), ('flags', w.DWORD), ('time', w.DWORD), ('extra', ctypes.c_size_t)]


class Payload(ctypes.Union):
    _fields_ = [('keyboard', Keyboard), ('mouse', Mouse)]


class Input(ctypes.Structure):
    _fields_ = [('type', w.DWORD), ('payload', Payload)]


user.EnumWindows(own_window, 0)
if len(windows) != 1:
    raise RuntimeError('Could not identify one owned Chrome window')
hwnd, = windows
thread = user.GetWindowThreadProcessId(hwnd, None)
if user.GetKeyboardLayout(thread) & 0xffff != 0x0412:
    raise RuntimeError('Korean input layout is unavailable in the test Chrome window')
user.ShowWindow.argtypes = [w.HWND, ctypes.c_int]
if user.IsIconic(hwnd):
    user.ShowWindow(hwnd, 9)  # SW_RESTORE, only the disposable Chrome window
foreground = user.GetForegroundWindow()
caller_thread = ctypes.windll.kernel32.GetCurrentThreadId()
foreground_thread = user.GetWindowThreadProcessId(foreground, None) if foreground else 0
attached = [other for other in {foreground_thread, thread} if other and other != caller_thread
            and user.AttachThreadInput(caller_thread, other, True)]
try:
    user.BringWindowToTop.argtypes = [w.HWND]
    user.BringWindowToTop(hwnd)
    activated = bool(user.SetForegroundWindow(hwnd))
    time.sleep(0.12)
finally:
    for other in attached:
        user.AttachThreadInput(caller_thread, other, False)
time.sleep(0.12)


def chord(*keys):
    if user.GetForegroundWindow() != hwnd:
        raise RuntimeError(f'The test Chrome window does not own foreground input (activation={activated}, foreground available={bool(user.GetForegroundWindow())})')
    events = [Input(1, Payload(keyboard=Keyboard(k, user.MapVirtualKeyW(k, 0), flag, 0, 0)))
              for group, flag in [(keys, 0), (reversed(keys), 2)] for k in group]
    inputs = (Input * len(events))(*events)
    if user.SendInput(len(inputs), inputs, ctypes.sizeof(Input)) != len(inputs):
        raise ctypes.WinError(ctypes.get_last_error())
    time.sleep(0.06)


if action == 'toggle':
    chord(0x15)  # VK_HANGUL
elif action in ('first', 'finish'):
    for key in {'first': 'GK', 'finish': 'SRMF '}[action]:  # Korean two-set keyboard: 하 → 한글.
        chord(ord(key))
elif action in ('find', 'save', 'replace'):
    chord(0x11, ord({'find': 'F', 'save': 'S', 'replace': 'H'}[action]))
else:
    raise ValueError('Unknown test action')
