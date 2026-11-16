// Release identity for the React skin renderer. Hash its source so the identity follows the
// vocabulary, style translation and widget behavior shipped with the application.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { RENDERER_VERSION } from '../packages/skin/src/resolve';

const source = resolve(import.meta.dir, '../packages/skin/src');

async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (/\.(ts|tsx)$/.test(entry.name)) result.push(path);
  }
  return result;
}

export async function rendererMetadata() {
  const hash = createHash('sha256');
  for (const file of (await files(source)).sort()) {
    hash.update(relative(source, file));
    hash.update('\0');
    hash.update(await readFile(file));
    hash.update('\0');
  }
  return { schema: 1, version: RENDERER_VERSION, digest: hash.digest('hex') };
}

if (import.meta.main) console.log(JSON.stringify(await rendererMetadata()));
