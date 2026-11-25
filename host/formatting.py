"""Explicit local formatting, with fixed binaries, arguments and bounded IO."""
import json
import os
from pathlib import Path

from process_tree import Control, WINDOWS, execute
from toolchains import child_env, find_tool, vs_installations
from workspace import workspace


def executable():
    on_path = find_tool('clang-format')
    if on_path:
        return on_path
    if WINDOWS:
        candidates = [Path(os.environ['ProgramFiles']) / 'LLVM/bin/clang-format.exe']
        candidates.extend(vs / 'VC/Tools/Llvm/x64/bin/clang-format.exe' for vs in vs_installations())
        return next((str(p) for p in candidates if p.is_file()), None)


def reply(msg):
    if msg == {'type': 'format-info'}:
        return dict(type='format-info', version=1, available=bool(executable()))
    if (set(msg) != {'type', 'language', 'code', 'tabs'} or msg['type'] != 'format' or
            msg['language'] not in ('cpp', 'c') or type(msg['tabs']) is not bool or not isinstance(msg['code'], str)):
        return dict(type='format-result', error='invalid')
    try:
        data = msg['code'].encode('utf-8')
        if len(data) > 512 * 1024:
            return dict(type='format-result', error='size')
        binary = executable()
        if not binary:
            return dict(type='format-result', error='missing')
        name = 'main.cpp' if msg['language'] == 'cpp' else 'main.c'
        style = '{BasedOnStyle: LLVM, IndentWidth: 4, TabWidth: 4, UseTab: ' + ('ForIndentation' if msg['tabs'] else 'Never') + '}'
        with workspace() as root:
            result = execute([binary, '--style=' + style, '--assume-filename=' + name], root, child_env(),
                             Control(), timeout=6, limit=512 * 1024, stdin=data)
        if result['timeout'] or result['overLimit'] or result['code']:
            return dict(type='format-result', error='failed')
        code = result['stdout'].decode('utf-8')
        if len(json.dumps(code, ensure_ascii=False).encode('utf-8')) > 900_000:
            return dict(type='format-result', error='size')
        return dict(type='format-result', code=code)
    except (OSError, ValueError):
        return dict(type='format-result', error='failed')
