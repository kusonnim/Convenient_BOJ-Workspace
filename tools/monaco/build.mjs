import { build } from 'esbuild';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const library = path.join(here, 'node_modules/monaco-editor');
const output = path.resolve(here, '../../vendor/monaco');
await mkdir(output, { recursive: true });
await build({
  absWorkingDir: here, bundle: true, minify: true, format: 'esm', target: 'chrome120',
  alias: { 'monaco-editor/esm/vs': path.join(library, 'esm/vs') },
  entryPoints: { editor: 'entry.mjs', 'editor.worker': path.join(library, 'esm/vs/editor/editor.worker.js') },
  outdir: output, loader: { '.ttf': 'file' }, assetNames: '[name]',
  legalComments: 'eof', logLevel: 'info',
});
for (const file of ['LICENSE', 'ThirdPartyNotices.txt']) await copyFile(path.join(library, file), path.join(output, file));
for (const [source, target] of [
  ['dompurify/LICENSE', 'DOMPurify-APACHE.txt'], ['dompurify/LICENSE-MPL', 'DOMPurify-MPL.txt'],
  ['marked/LICENSE.md', 'Marked-LICENSE.txt'], ['@vscode/diff/LICENSE', 'VSCode-Diff-LICENSE.txt'],
]) await copyFile(path.join(here, 'node_modules', source), path.join(output, target));
await writeFile(path.join(output, 'Codicons-NOTICE.txt'), [
  'Visual Studio Code Codicons by Microsoft. The bundled codicon.ttf is unmodified.',
  'Source: https://github.com/microsoft/vscode-codicons',
  'License: Creative Commons Attribution 4.0 International, https://creativecommons.org/licenses/by/4.0/',
  '',
].join('\n'));
