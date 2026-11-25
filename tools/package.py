"""Build the two extension ZIPs from the tracked files of one Git revision."""
import argparse
import io
import json
from pathlib import Path
import subprocess
import zipfile


ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ['manifest.json', 'background.js', 'content', 'editor', 'popup', 'shared', 'icons', 'vendor', 'NOTICE']


def build(revision, output):
    commit = subprocess.check_output(['git', 'rev-parse', '--verify', '--end-of-options', revision + '^{commit}'],
                                     cwd=ROOT, text=True).strip()
    blob = subprocess.check_output(['git', 'archive', '--format=zip', commit, '--', *RUNTIME, 'host'], cwd=ROOT)
    output.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(blob)) as source:
        files = sorted(entry.filename for entry in source.infolist() if not entry.is_dir())
        manifest = json.loads(source.read('manifest.json'))
        for store in (False, True):
            filename = 'Convenient_BOJ-webstore.zip' if store else 'Convenient_BOJ.zip'
            with zipfile.ZipFile(output / filename, 'w', zipfile.ZIP_DEFLATED) as archive:
                for name in files:
                    if store and name.startswith('host/'):
                        continue
                    data = source.read(name)
                    if store and name == 'manifest.json':
                        payload = {k: v for k, v in manifest.items() if k != 'key'}
                        data = (json.dumps(payload, indent=2, ensure_ascii=False) + '\n').encode()
                    item = zipfile.ZipInfo(name if store else 'Convenient_BOJ/' + name)
                    item.create_system = 3
                    item.external_attr = 0o100644 << 16
                    archive.writestr(item, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
            print(f'{commit}  {output / filename}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ref', default='HEAD')
    parser.add_argument('--output', type=Path, default=ROOT / 'dist')
    args = parser.parse_args()
    build(args.ref, args.output)
