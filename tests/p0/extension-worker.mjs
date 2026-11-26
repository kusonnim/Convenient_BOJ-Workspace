import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function extensionWorker(context, unpacked, id) {
  const manifest = JSON.parse(await readFile(path.join(unpacked, 'manifest.json'), 'utf8'));
  const url = 'chrome-extension://' + id + '/' + manifest.background.service_worker;
  const matches = worker => worker.url() === url;
  return context.serviceWorkers().find(matches) || context.waitForEvent('serviceworker', { predicate: matches, timeout: 30000 });
}
