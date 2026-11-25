#!/usr/bin/env python3
"""Convenient BOJ native messaging host. Each browser port owns its compiler cache and job."""
import json
import os
import re
import struct
import sys
import threading

from process_tree import Control, WINDOWS, execute
from toolchains import BuildError, Toolchains
from workspace import workspace

if WINDOWS:
    import msvcrt
    msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
    msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)

PROTOCOL = 2
FRAME_LIMIT = 8 * 1024 * 1024
SOURCE_LIMIT = INPUT_LIMIT = 512 * 1024
_send_lock = threading.Lock()


def describe_exit(code):
    """윈도우 예외 코드 등을 알아보기 쉬운 말로."""
    if code is None:
        return ''
    known = {
        0xC0000005: '메모리 접근 오류 (Segmentation fault)',
        0xC00000FD: '스택 오버플로 (재귀가 너무 깊어요)',
        0xC0000094: '0으로 나누기',
        0xC0000409: '버퍼 오버런 / abort',
        3: 'abort() 호출',
    }
    return known.get(code & 0xFFFFFFFF, '')


def send(message):
    data = json.dumps({'protocol': PROTOCOL, **message}, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    with _send_lock:
        try:
            sys.stdout.buffer.write(struct.pack('=I', len(data)) + data)
            sys.stdout.buffer.flush()
        except (BrokenPipeError, OSError):
            pass  # EOF on the input pipe also wakes the owner to join its worker.


def read_message():
    header = sys.stdin.buffer.read(4)
    if len(header) != 4:
        return None
    size, = struct.unpack('=I', header)
    if not 0 < size <= FRAME_LIMIT:
        return None
    data = sys.stdin.buffer.read(size)
    if len(data) != size:
        return None
    return json.loads(data.decode('utf-8'))


def byte_length(value, maximum):
    if not isinstance(value, str) or len(value) > maximum:
        raise ValueError('코드 또는 입력의 크기나 형식이 올바르지 않아요.')
    size = len(value.encode('utf-8'))
    if size > maximum:
        raise ValueError('코드 또는 입력의 크기 한도를 넘었어요.')
    return size


def validate(msg):
    if not isinstance(msg, dict) or msg.get('protocol', PROTOCOL) != PROTOCOL:
        raise ValueError('지원하지 않는 실행 도우미 메시지예요.')
    kind = msg.get('type')
    if kind not in ('info', 'shutdown', 'batch', 'run', 'stdin', 'eof', 'kill'):
        raise ValueError('지원하지 않는 명령이에요.')
    if kind in ('info', 'shutdown') and 'id' not in msg:
        return
    if type(msg.get('id')) is not int or not 0 < msg['id'] < 2**53:
        raise ValueError('작업 번호가 올바르지 않아요.')
    if kind == 'stdin':
        byte_length(msg.get('data'), INPUT_LIMIT)
    if kind not in ('batch', 'run'):
        return
    lang = msg.get('lang')
    if not isinstance(lang, dict) or lang.get('kind') not in ('c', 'cpp', 'python'):
        raise ValueError('지원하지 않는 언어예요.')
    std = lang.get('std')
    patterns = {'c': r'(?:gnu|c)(?:90|99|11|17|2x|23)', 'cpp': r'(?:gnu|c)\+\+(?:98|03|11|14|17|20|23|2c)'}
    if std is not None and (not isinstance(std, str) or not re.fullmatch(patterns.get(lang['kind'], r'(?!)'), std)):
        raise ValueError('지원하지 않는 언어 표준이에요.')
    if msg.get('compiler', 'auto') not in ('auto', 'gcc', 'msvc'):
        raise ValueError('지원하지 않는 컴파일러예요.')
    byte_length(msg.get('code'), SOURCE_LIMIT)
    limit = msg.get('timeLimit', 10)
    if type(limit) not in (int, float) or not 0.05 <= limit <= 300:
        raise ValueError('실행 시간 제한이 범위를 벗어났어요.')
    if kind == 'batch':
        inputs = msg.get('inputs')
        if not isinstance(inputs, list) or not 1 <= len(inputs) <= 64:
            raise ValueError('한 번에 예제 1~64개를 실행할 수 있어요.')
        if sum(byte_length(s, INPUT_LIMIT) for s in inputs) > INPUT_LIMIT:
            raise ValueError('예제 입력 합계가 512 KiB를 넘었어요.')
    else:
        byte_length(msg.get('stdin', ''), INPUT_LIMIT)


def failure(msg, code, message, cmd=''):
    rid = msg.get('id') if type(msg.get('id')) is int else None
    if msg.get('type') == 'batch':
        return dict(type='batch-result', id=rid, cmd=cmd, error=dict(code=code, message=message), results=[])
    if msg.get('type') == 'run':
        if code != 'cancelled':
            send(dict(type='compiled', id=rid, ok=False, cmd=cmd, code=code, message=message))
        return dict(type='exit', id=rid, code=None, killed=code == 'cancelled', compileFailed=code != 'cancelled', ms=0)
    return dict(type='error', id=rid, code=code, message=message)


class Job(threading.Thread):
    def __init__(self, tools, msg):
        super().__init__()
        self.tools = tools
        self.msg = msg
        self.id = msg['id']
        self.control = Control()
        self.finished = threading.Event()
        if msg['type'] == 'run' and msg.get('stdin'):
            self.control.feed(msg['stdin'].encode('utf-8'))

    def run(self):
        try:
            # Send the terminal event only after all processes, pipes and files are gone.
            with workspace() as work:
                if self.msg['type'] == 'run':
                    send(dict(type='compile', id=self.id))
                args, env, build = self.tools.prepare(self.msg, work, self.control)
                if self.control.cancelled.is_set():
                    raise BuildError('cancelled', '작업을 중지했어요.')
                if self.msg['type'] == 'batch':
                    terminal = self.batch(args, env, work, build)
                else:
                    terminal = self.live(args, env, work, build)
        except BuildError as error:
            terminal = failure(self.msg, error.code, str(error), error.cmd)
        except (OSError, ValueError, RuntimeError) as error:
            terminal = failure(self.msg, 'host', '도우미 작업에 실패했어요 (' + type(error).__name__ + ').')
        self.finished.set()
        send(terminal)

    def batch(self, args, env, work, build):
        results = []
        # JSON escaping can cost six bytes per output byte. Keep the complete
        # native reply (including compiler warnings) below Chrome's 1 MiB limit.
        remaining = 96 * 1024
        for index, data in enumerate(self.msg['inputs']):
            case = work / str(index)
            case.mkdir()
            result = execute(args, case, env, self.control, timeout=self.msg.get('timeLimit', 10),
                             limit=min(64 * 1024, remaining), stdin=data.encode('utf-8'))
            if result['killed']:
                raise BuildError('cancelled', '실행을 중지했어요.')
            for stream in ('stdout', 'stderr'):
                raw = result[stream]
                remaining -= len(raw)
                result[stream] = raw.decode('utf-8', 'replace')
            if result['timeout']:
                result['code'] = None
            result['note'] = describe_exit(result['code'])
            results.append(result)
        return dict(type='batch-result', id=self.id, results=results, **build)

    def live(self, args, env, work, build):
        send(dict(type='compiled', id=self.id, ok=True, **build))
        result = execute(args, work, env, self.control, timeout=self.msg.get('timeLimit', 120),
                         limit=2_000_000, stdin=None,
                         on_start=lambda: send(dict(type='start', id=self.id)),
                         on_output=lambda name, data: send(dict(type='out', id=self.id, stream=name, data=data)))
        del result['stdout'], result['stderr']
        return dict(type='exit', id=self.id, note=describe_exit(result['code']), **result)


def main():
    tools = None
    job = None
    msg = None
    last_id = 0
    try:
        while True:
            msg = read_message()
            if msg is None:
                break
            if msg == {'type': 'analysis-info'} and tools is None and job is None:
                send(dict(type='analysis-info', version=1))
                continue
            if isinstance(msg, dict) and msg.get('type') == 'analysis-open' and tools is None and job is None:
                from clangd_session import serve
                serve(msg, read_message, send)
                return
            try:
                validate(msg)
                kind = msg['type']
                if kind == 'shutdown':
                    break
                if kind in ('info', 'run', 'batch') and tools is None:
                    tools = Toolchains()
                if kind == 'info':
                    reply = tools.info()
                    if 'id' in msg:
                        reply['id'] = msg['id']
                    send(reply)
                elif kind in ('run', 'batch'):
                    if msg.get('protocol') == PROTOCOL and msg['id'] <= last_id:
                        continue  # A redelivery must never launch the job twice.
                    if job and job.finished.is_set():
                        job.join()
                    elif job and job.is_alive():
                        if msg.get('protocol') == PROTOCOL:
                            send(failure(msg, 'busy', '이 탭에서 다른 작업을 실행 중이에요.'))
                            continue
                        job.control.cancel()
                        job.join()
                    last_id = msg['id']
                    job = Job(tools, msg)
                    job.start()
                elif job and msg['id'] == job.id and job.is_alive():
                    if kind == 'kill':
                        job.control.cancel()
                    elif kind == 'stdin':
                        job.control.feed(msg['data'].encode('utf-8'))
                    elif kind == 'eof':
                        job.control.feed(None)
            except (ValueError, TypeError) as error:
                send(failure(msg if isinstance(msg, dict) else {}, 'invalid', str(error)))
    except (EOFError, OSError, ValueError):
        pass
    finally:
        if job:
            job.control.cancel()
            job.join()
    if isinstance(msg, dict) and msg.get('type') == 'shutdown':
        send(dict(type='closed'))


if __name__ == '__main__':
    if len(sys.argv) == 1 or sys.argv[1] == 'chrome-extension://mabfdombglhmfnjklbnoglebinejifdi/':
        main()
