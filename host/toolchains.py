"""Tool discovery and effective compile commands for single-file BOJ jobs."""
import hashlib
import json
import locale
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from collections import OrderedDict

from process_tree import Control, NO_WINDOW, WINDOWS, execute
from workspace import reclaim_abandoned, workspace

IS_WIN = WINDOWS


def _search_path():
    """크롬이 켜진 뒤에 gcc를 설치해도 찾을 수 있게 레지스트리의 PATH와 흔한 설치 위치까지 본다."""
    dirs = os.environ.get('PATH', '').split(os.pathsep)
    if IS_WIN:
        try:
            import winreg
            for root, sub in ((winreg.HKEY_CURRENT_USER, r'Environment'),
                              (winreg.HKEY_LOCAL_MACHINE, r'SYSTEM\CurrentControlSet\Control\Session Manager\Environment')):
                try:
                    with winreg.OpenKey(root, sub) as k:
                        value, _ = winreg.QueryValueEx(k, 'Path')
                        dirs += os.path.expandvars(value).split(os.pathsep)
                except OSError:
                    pass
        except ImportError:
            pass
        local = os.environ.get('LOCALAPPDATA', '')
        dirs += [
            os.path.join(local, 'Microsoft', 'WinGet', 'Links'),
            r'C:\msys64\ucrt64\bin', r'C:\msys64\mingw64\bin', r'C:\MinGW\bin', r'C:\mingw64\bin',
        ]
        pkgs = os.path.join(local, 'Microsoft', 'WinGet', 'Packages')
        if os.path.isdir(pkgs):
            for name in os.listdir(pkgs):
                if name.lower().startswith('brechtsanders.winlibs'):
                    dirs.append(os.path.join(pkgs, name, 'mingw64', 'bin'))
    seen, out = set(), []
    for d in dirs:
        d = d.strip().strip('"')
        if d and d.lower() not in seen and os.path.isdir(d):
            seen.add(d.lower())
            out.append(d)
    return os.pathsep.join(out)


SEARCH_PATH = _search_path()


def find_tool(name):
    return shutil.which(name, path=SEARCH_PATH)


def tool_version(path):
    if not path:
        return None
    try:
        r = subprocess.run([path, '--version'], capture_output=True, timeout=10, creationflags=NO_WINDOW)
        return (r.stdout or r.stderr).decode('utf-8', 'replace').splitlines()[0].strip()
    except Exception:  # noqa: BLE001
        return None


TOOLS = {'gcc': find_tool('gcc'), 'g++': find_tool('g++')}


def child_env():
    env = dict(os.environ)
    extra = [os.path.dirname(p) for p in TOOLS.values() if p]
    env['PATH'] = os.pathsep.join(extra + [env.get('PATH', '')])
    env['PYTHONIOENCODING'] = 'utf-8'
    env['PYTHONUTF8'] = '1'
    return env


UNBUF_STUB = '#include <stdio.h>\n__attribute__((constructor)) static void cboj_unbuf(void) { setvbuf(stdout, NULL, _IONBF, 0); }\n'
MS_STANDARDS = {'gnu++17': 'c++17', 'c++17': 'c++17', 'gnu++20': 'c++20', 'c++20': 'c++20'}


class BuildError(Exception):
    def __init__(self, code, message, cmd=''):
        super().__init__(message)
        self.code = code
        self.cmd = cmd


def vs_installations():
    roots = [Path(os.environ[k]) for k in ('ProgramFiles(x86)', 'ProgramFiles') if os.environ.get(k)]
    for root in roots:
        vswhere = root / 'Microsoft Visual Studio/Installer/vswhere.exe'
        if vswhere.is_file():
            query = [str(vswhere), '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
                     '-sort', '-property', 'installationPath', '-utf8']
            try:
                paths = subprocess.check_output(query, timeout=10, creationflags=NO_WINDOW).decode('utf-8-sig')
                yield from (Path(line) for line in paths.splitlines() if line.strip())
            except (OSError, subprocess.SubprocessError, UnicodeError):
                pass
            break
    # Older/offline VS installations can lack vswhere.
    for root in roots:
        for edition in ('Community', 'Professional', 'Enterprise', 'BuildTools'):
            yield from sorted((root / 'Microsoft Visual Studio').glob('*/' + edition), reverse=True)


def discover_msvc():
    if not WINDOWS:
        return None
    seen = set()
    for install in vs_installations():
        script = install / 'Common7/Tools/VsDevCmd.bat'
        if script in seen or not script.is_file():
            continue
        seen.add(script)
        cmd = Path(os.environ['SystemRoot']) / 'System32/cmd.exe'
        env = dict(os.environ, CBOJ_VSDEVCMD=str(script), VSCMD_SKIP_SENDTELEMETRY='1')
        # The only shell command initializes Microsoft's environment. Neither the
        # command text nor its arguments come from an extension message.
        command = f'"{cmd}" /d /u /c call "%CBOJ_VSDEVCMD%" -no_logo -arch=x64 -host_arch=x64 >nul && set'
        try:
            raw = subprocess.check_output(command, executable=str(cmd), env=env, cwd=install,
                                          stderr=subprocess.DEVNULL, timeout=30, creationflags=NO_WINDOW)
            build_env = dict(line.split('=', 1) for line in raw.decode('utf-16le').splitlines()
                             if '=' in line and not line.startswith('='))
            build_env = {k.upper(): v for k, v in build_env.items()}
            for key in ('CL', '_CL_', 'LINK', '_LINK_', 'CBOJ_VSDEVCMD'):
                build_env.pop(key, None)
            build_env['VSLANG'] = '1033'
            cl = Path(build_env['VCTOOLSINSTALLDIR']) / 'bin/Hostx64/x64/cl.exe'
            if not cl.is_file() or not cl.resolve().is_relative_to(install.resolve()):
                continue
            with workspace() as temp:
                source = '#include <iostream>\nint main(){static_assert(sizeof(void*)==8); std::cout << _MSC_FULL_VER;}'
                (Path(temp) / 'probe.cpp').write_text(source, encoding='utf-8')
                build = execute([str(cl), '/nologo', '/EHsc', '/std:c++17', '/utf-8', 'probe.cpp'],
                                temp, build_env, Control(), timeout=30, limit=32768)
                if build['code'] != 0:
                    continue
                probe = execute([str(Path(temp) / 'probe.exe')], temp, build_env, Control(), timeout=5, limit=256)
                version = probe['stdout'].decode('ascii').strip()
                if probe['code'] == 0 and version.isdigit():
                    return str(cl), build_env, version
        except (OSError, KeyError, ValueError, subprocess.SubprocessError):
            continue
    return None


def stamp(path):
    stat = os.stat(path)
    return stat.st_mtime_ns, stat.st_size


def dependencies(work, msvc):
    try:
        if msvc:
            paths = json.loads((work / 'deps.json').read_text(encoding='utf-8-sig'))['Data']['Includes']
        else:
            depfiles = list(work.glob('*.d'))
            if not depfiles:
                return None
            paths = []
            for depfile in depfiles:
                rule = depfile.read_text(encoding='utf-8').replace('\\\n', ' ').removeprefix('target:')
                words = re.findall(r'(?:\\[ \t#\\]|[^\s])+', rule)
                paths.extend(re.sub(r'\\([ \t#\\])', r'\1', token).replace('$$', '$') for token in words)
        files = {}
        for name in paths:
            path = (work / name).resolve()
            if not path.is_relative_to(work):
                files[path] = stamp(path)
        return files
    except (OSError, ValueError, KeyError, TypeError):
        return None  # Still run a successful build when dependency metadata is unavailable.


def diagnostics(data, work):
    try:
        output = data.decode('utf-8')
    except UnicodeError:
        output = data.decode(locale.getpreferredencoding(False), 'replace')
    return output.replace(str(work) + os.sep, '').replace(str(work).replace('\\', '/') + '/', '').strip()


def compile_step(tool, args, work, env, control, shown):
    result = execute([tool, *args], work, env, control, timeout=60, limit=32 * 1024)
    if result['killed']:
        raise BuildError('cancelled', '컴파일을 중지했어요.', shown)
    if result['timeout'] or result['overLimit']:
        raise BuildError('compile', '컴파일 시간 또는 진단 출력 한도를 넘었어요.', shown)
    output = diagnostics(result['stderr'] + result['stdout'], work)
    if result['code'] != 0:
        raise BuildError('compile', output, shown)
    return output


class Toolchains:
    def __init__(self):
        reclaim_abandoned()
        self.msvc = discover_msvc()
        self.gcc_versions = {name: tool_version(path) for name, path in TOOLS.items()}
        self.env = child_env()
        self.cache = OrderedDict()
        self.cache_bytes = 0

    def info(self):
        return dict(type='info', version='2.0.0', protocol=2, python=sys.version.split()[0],
                    gcc=self.gcc_versions['gcc'], gpp=self.gcc_versions['g++'],
                    msvc=self.msvc[2] if self.msvc else None, msvcStandards=['c++17', 'c++20'] if self.msvc else [])

    def prepare(self, msg, work, control):
        kind = msg['lang']['kind']
        code = msg['code']
        interactive = msg['type'] == 'run'
        if kind == 'python':
            src = work / 'main.py'
            src.write_bytes(code.encode('utf-8'))
            return [sys.executable, '-u', str(src)], self.env, dict(cmd='python -u main.py', compiler='python', cache='none', warnings='')

        choice = msg.get('compiler', 'auto' if msg.get('protocol') == 2 else 'gcc')
        standard = msg['lang'].get('std') or ('gnu11' if kind == 'c' else 'gnu++17')
        prefer_msvc = choice == 'auto' and self.msvc and (standard in MS_STANDARDS or not TOOLS['g++'])
        msvc = kind == 'cpp' and (choice == 'msvc' or prefer_msvc)
        src = 'main.c' if kind == 'c' else 'main.cpp'
        exe = work / ('main.exe' if WINDOWS else 'main')
        stub_args = []
        if msvc:
            if not self.msvc:
                raise BuildError('nocompiler', '사용 가능한 x64 MSVC를 찾지 못했어요. Visual Studio C++ 도구와 Windows SDK를 확인해 주세요.')
            if standard not in MS_STANDARDS:
                raise BuildError('standard', 'MSVC 실행은 C++17과 C++20을 지원해요. 다른 표준은 GCC를 선택해 주세요.')
            tool, env, version = self.msvc
            compiler = 'msvc'
            flags = ['/nologo', '/EHsc', '/O2', '/utf-8', '/diagnostics:column', '/Zc:__cplusplus',
                     '/std:' + MS_STANDARDS[standard], '/DONLINE_JUDGE', '/DBOJ']
            args = [*flags, '/sourceDependencies', 'deps.json', src, '/Fe' + exe.name]
            shown = 'cl ' + ' '.join([*flags, src])
            binaries = [tool, *(Path(tool).with_name(name) for name in ('c1xx.dll', 'c2.dll', 'link.exe'))]
        else:
            compiler = 'gcc' if kind == 'c' else 'g++'
            tool = TOOLS[compiler]
            if not tool:
                raise BuildError('nocompiler', compiler + ' 컴파일러를 찾지 못했어요.')
            env, version = self.env, self.gcc_versions[compiler]
            flags = ['-O2', '-std=' + standard, '-DONLINE_JUDGE', '-DBOJ']
            gcc_version = re.search(r'\b(\d+)\.\d+(?:\.\d+)?\b', version or '')
            if gcc_version and int(gcc_version[1]) >= 11:
                flags += ['-fdiagnostics-column-unit=byte', '-fdiagnostics-color=never']
            args = [*flags, '-MD', '-MT', 'target', '-MF', 'main.d', src]
            if interactive:
                # A single MinGW driver invocation for both source files can
                # overwrite main.d with just the stub's includes.
                stub_args = [*flags, '-MD', '-MT', 'target', '-MF', 'stub.d', '-c', 'cboj_unbuf.c', '-o', 'stub.o']
                args.append('stub.o')
            args += ['-o', exe.name]
            if kind == 'c':
                args.append('-lm')
            if WINDOWS:
                args.append('-static')
            shown = ' '.join([compiler, *flags, src])
            binaries = [tool]
        identity = [(str(p), stamp(p)) for p in binaries]
        key = hashlib.sha256(json.dumps([code, kind, interactive, identity, version, args, stub_args, sorted(env.items())],
                                       ensure_ascii=False).encode('utf-8')).digest()
        entry = self.cache.pop(key, None)
        if entry:
            image, warnings, headers = entry
            self.cache_bytes -= len(image)
            try:
                fresh = all(stamp(p) == saved for p, saved in headers.items())
            except OSError:
                fresh = False
            if fresh:
                self.cache[key] = entry
                self.cache_bytes += len(image)
                exe.write_bytes(image)
                exe.chmod(0o700)
                return [str(exe)], env, dict(cmd=shown, compiler=compiler, cache='hit', warnings=warnings)
        (work / src).write_bytes(code.encode('utf-8'))
        if stub_args:
            (work / 'cboj_unbuf.c').write_text(UNBUF_STUB, encoding='utf-8')
            compile_step(tool, stub_args, work, env, control, shown)
        try:
            output = compile_step(tool, args, work, env, control, shown)
        except BuildError as error:
            if error.code == 'compile' and msvc:
                hints = []
                if re.search(r'(?:bits[/\\]stdc\+\+\.h|ext[/\\]pb_ds[/\\])', str(error)):
                    hints.append('GNU libstdc++ 전용 헤더예요. GCC로 실행하거나 필요한 표준 헤더를 포함해 주세요.')
                if re.search(r'\b__int128\b', str(error)):
                    hints.append('MSVC x64는 __int128 정수형을 지원하지 않아요. 128비트가 필요하면 지원하는 GCC 대상을 선택해 주세요.')
                if hints:
                    raise BuildError('compile', str(error) + '\n' + '\n'.join(hints), shown) from error
            raise
        # cl prints the source name even when it has emitted no diagnostics.
        warnings = '\n'.join(line for line in output.splitlines() if line.strip() != src)
        headers = dependencies(work, bool(msvc))
        if headers is not None and exe.stat().st_size <= 8 * 1024 * 1024 and not re.search(r'__(?:DATE|TIME|TIMESTAMP)__', code):
            image = exe.read_bytes()
            self.cache[key] = (image, warnings, headers)
            self.cache_bytes += len(image)
            while len(self.cache) > 8 or self.cache_bytes > 32 * 1024 * 1024:
                self.cache_bytes -= len(self.cache.popitem(last=False)[1][0])
        return [str(exe)], env, dict(cmd=shown, compiler=compiler, cache='miss', warnings=warnings)
