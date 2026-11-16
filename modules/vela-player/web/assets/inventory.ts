// The payload inventory and digest agreed in docs/distribution.md ("Player assets and skins"):
// SHA-256 over bytewise-sorted records `path NUL bytes NUL sha256 LF`, the manifest excluded.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export const MANIFEST_NAME = 'PLAYER-ASSETS-MANIFEST.json';

export interface FileRecord {
  path: string;
  bytes: number;
  sha256: string;
}

/** Refuses anything that is not a plain, safe, relative POSIX path. */
export function assertSafePath(path: string) {
  const unsafe =
    path === '' ||
    path.startsWith('/') ||
    path.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(path) ||
    path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');
  if (unsafe) throw new Error(`Unsafe payload path: ${JSON.stringify(path)}`);
}

export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

/** Every regular file under `root`, as sorted relative paths; links and other kinds are refused. */
export async function listFiles(root: string, prefix = ''): Promise<string[]> {
  const names: string[] = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) names.push(...(await listFiles(root, name)));
    else if (entry.isFile()) names.push(name);
    else throw new Error(`Payload contains a link or special file: ${name}`);
  }
  return names.sort(compareBytes);
}

/** Bytewise order of the UTF-8 paths (ASCII by the path rules), not locale order. */
export function compareBytes(a: string, b: string) {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

export async function inventory(root: string): Promise<FileRecord[]> {
  const records: FileRecord[] = [];
  for (const path of await listFiles(root)) {
    if (path === MANIFEST_NAME) continue;
    assertSafePath(path);
    const stat = await lstat(join(root, path));
    records.push({ path, bytes: stat.size, sha256: await hashFile(join(root, path)) });
  }
  return records;
}

export function payloadDigest(records: FileRecord[]): string {
  const hash = createHash('sha256');
  for (const record of [...records].sort((a, b) => compareBytes(a.path, b.path))) {
    hash.update(`${record.path}\0${record.bytes}\0${record.sha256}\n`, 'utf8');
  }
  return hash.digest('hex');
}
