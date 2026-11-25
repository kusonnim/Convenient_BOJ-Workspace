"""Discover local analysis tools and verify their standard library with a fixed program."""
import json
import os
from pathlib import Path
import re

from process_tree import WINDOWS, execute
from toolchains import TOOLS, child_env, find_tool, vs_installations


def clangd_paths():
    on_path = find_tool('clangd')
    if on_path:
        yield Path(on_path)
    if not WINDOWS:
        return
    program = Path(os.environ['ProgramFiles'])
    yield program / 'LLVM/bin/clangd.exe'
    local = Path(os.environ['LOCALAPPDATA'])
    yield local / 'Programs/LLVM/bin/clangd.exe'
    packages = local / 'Microsoft/WinGet/Packages'
    for pattern in ('LLVM.LLVM*/bin/clangd.exe', 'LLVM.LLVM*/LLVM*/bin/clangd.exe'):
        yield from sorted(packages.glob(pattern), reverse=True)
    # clangd's VS Code extension also supports a non-versioned storage layout.
    yield from (Path(os.environ['APPDATA']) / 'Code/User/globalStorage/llvm-vs-code-extensions.vscode-clangd/install').glob('clangd_*/bin/clangd.exe')
    for vs in vs_installations():
        yield vs / 'VC/Tools/Llvm/x64/bin/clangd.exe'
    # These IDE bundles are common on Windows even without a PATH entry.
    yield program / 'Android/Android Studio/plugins/cidr-clangd/bin/clang/win/x64/bin/clangd.exe'
    yield from (program / 'JetBrains').glob('*/plugins/*/bin/clang/win/x64/bin/clangd.exe')
    yield from (Path.home() / '.vscode/extensions').glob('llvm-vs-code-extensions.vscode-clangd-*/install/*/clangd_*/bin/clangd.exe')
    yield from (Path(os.environ['APPDATA']) / 'Code/User/globalStorage/llvm-vs-code-extensions.vscode-clangd/install').glob('*/clangd_*/bin/clangd.exe')


def resource_dirs(server):
    # Most LLVM distributions ship matching builtins next to the server.
    # Some IDEs package the executable alone. Test other installed LLVM
    # resources against real STL headers before accepting such a pairing.
    # IDE packages without adjacent builtins would parse the STL twice, once
    # with missing intrinsics. Try verified installed resources first there.
    adjacent = server.parent.parent / 'lib/clang'
    packaged = any(adjacent.glob('*/include/stddef.h'))
    if packaged or not WINDOWS:
        yield None
    roots = [server.parent.parent / 'lib/clang']
    if WINDOWS:
        roots.append(Path(os.environ['ProgramFiles']) / 'LLVM/lib/clang')
        sdk = Path(os.environ.get('ANDROID_HOME') or Path.home() / 'AppData/Local/Android/Sdk')
        roots.extend(sorted(sdk.glob('ndk/*/toolchains/llvm/prebuilt/windows-x86_64/lib/clang'), reverse=True))
    for root in roots:
        for path in sorted(root.glob('*'), reverse=True):
            if (path / 'include/stddef.h').is_file():
                yield path
    if WINDOWS and not packaged:
        yield None


def msvc_header_sets():
    if not WINDOWS:
        return
    import winreg
    kits = [Path(os.environ[key]) for key in ('WindowsSdkDir', 'UniversalCRTSdkDir') if os.environ.get(key)]
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r'SOFTWARE\Microsoft\Windows Kits\Installed Roots') as key:
            kits.append(Path(winreg.QueryValueEx(key, 'KitsRoot10')[0]))
    except OSError:
        pass
    kits.append(Path(os.environ['ProgramFiles(x86)']) / 'Windows Kits/10')
    sdk_headers = []
    for kit in dict.fromkeys(kits):
        for sdk in sorted((kit / 'Include').glob('10.*'), key=lambda p: [int(s) for s in re.findall(r'\d+', p.name)], reverse=True):
            if (sdk / 'ucrt/stdio.h').is_file() and (sdk / 'um/Windows.h').is_file():
                sdk_headers = [sdk / name for name in ('ucrt', 'shared', 'um', 'winrt', 'cppwinrt') if (sdk / name).is_dir()]
                break
        if sdk_headers:
            break
    if sdk_headers:
        for install in dict.fromkeys(vs_installations()):
            try:
                version = (install / 'VC/Auxiliary/Build/Microsoft.VCToolsVersion.default.txt').read_text().strip()
            except OSError:
                continue
            if not re.fullmatch(r'14\.\d+\.\d+', version):
                continue
            tools = install / 'VC/Tools/MSVC' / version
            driver = tools / 'bin/Hostx64/x64/cl.exe'
            if driver.is_file() and (tools / 'include/vector').is_file():
                yield str(driver), [tools / 'include', *sdk_headers], version, child_env()
    # Chrome launched from a developer environment can already have a custom
    # SDK layout. Analysis only reads these paths and verifies the full profile.
    configured = os.environ.get('VCToolsInstallDir')
    if configured:
        tools = Path(configured)
        driver = tools / 'bin/Hostx64/x64/cl.exe'
        roots = [Path(p).resolve() for p in os.environ.get('INCLUDE', '').split(os.pathsep) if p and Path(p).is_dir()]
        if driver.is_file() and any((p / 'vector').is_file() for p in roots):
            yield str(driver), roots, tools.name, child_env()


def msvc_profiles(standard):
    # The runner choice, browser environment and draft cannot set compiler paths or flags.
    version = standard.partition('++')[2]
    if version in ('14', '17', '20', '23', '2c'):
        for driver, roots, tool_version, env in msvc_header_sets():
            flags = [driver, '--driver-mode=cl', '--target=x86_64-pc-windows-msvc', '/EHsc', '/utf-8',
                     '/clang:-std=c++' + version, '/DONLINE_JUDGE', '/DBOJ']
            toolset = tool_version.split('.')
            if len(toolset) >= 2 and toolset[1].isdigit():
                flags.append('/clang:-fms-compatibility-version=19.' + toolset[1])
            yield 'MSVC', roots, flags + ['/imsvc' + str(p) for p in roots], env


def gcc_profiles(standard, root, control):
    driver = TOOLS['g++']
    if driver:
        env = child_env()
        opts = dict(cwd=root, env=dict(env, LC_ALL='C'), control=control, timeout=5, limit=65536)
        try:
            target = execute([driver, '-dumpmachine'], **opts)['stdout'].decode().strip()
            listing = execute([driver, '-E', '-x', 'c++', '-', '-v'], **opts)['stderr'].decode(errors='replace')
        except (OSError, ValueError):
            return
        section = listing.partition('#include <...> search starts here:')[2].partition('End of search list.')[0]
        roots = [Path(p.strip()).resolve() for p in section.splitlines() if p.strip() and Path(p.strip()).is_dir()]
        if re.fullmatch(r'[a-zA-Z0-9_.-]+', target) and any((p / 'vector').is_file() for p in roots):
            flags = [driver, '--target=' + target, '-std=' + standard, '-DONLINE_JUDGE', '-DBOJ']
            # GCC intrinsic headers implement GCC builtins. Prefer clang's own intrinsics.
            for p in roots:
                if not (p / 'immintrin.h').is_file():
                    flags.extend(['-isystem', str(p)])
            yield 'GCC', roots, flags, env


def uses_gnu_headers(text):
    return bool(re.search(r'^[ \t]*#[ \t]*include[ \t]*[<"](?:bits/|ext/pb_ds/)', text, re.MULTILINE))


def profiles(standard, prefer_gcc, root, control):
    msvc, gcc = msvc_profiles(standard), gcc_profiles(standard, root, control)
    for family in ((gcc, msvc) if prefer_gcc else (msvc, gcc)):
        if control.cancelled.is_set():
            return
        yield from family


def discover(root, standard, control, prefer_gcc=False):
    probe, source = root / 'probe.cpp', root / 'main.cpp'
    probe.write_text('#include <vector>\n#include <string>\nint main(){std::vector<std::string> v; return v.size();}\n', encoding='utf-8')
    source.touch()  # didOpen supplies the draft in memory.
    servers = []
    for path in clangd_paths():
        if path.is_file() and path.resolve() not in servers:
            servers.append(path.resolve())
    if not servers:
        return None, 'no-server'
    for family, includes, flags, env in profiles(standard, prefer_gcc, root, control):
        db = [dict(directory=str(root), file=str(f), arguments=[*flags, str(f)]) for f in (source, probe)]
        (root / 'compile_commands.json').write_text(json.dumps(db), encoding='utf-8')
        for server in servers:
            for resource in resource_dirs(server):
                if control.cancelled.is_set():
                    return None, 'closed'
                args = [str(server), '--enable-config=false', '--background-index=false',
                        '--compile-commands-dir=' + str(root), '--log=error', '-j=2']
                if resource:
                    args.append('--resource-dir=' + str(resource))
                try:
                    checked = execute([*args, '--check=' + str(probe)], root, env, control, timeout=12, limit=65536)
                except OSError:
                    continue
                if checked['code'] == 0 and not checked['timeout'] and not checked['killed']:
                    roots = [*includes, *([resource / 'include'] if resource else [])]
                    private_env = {**env, 'TEMP': str(root), 'TMP': str(root), 'TMPDIR': str(root)}
                    return (args + ['--header-insertion=never', '--limit-results=80', '--pch-storage=disk'],
                            private_env, family, roots), None
    return None, 'no-headers'
