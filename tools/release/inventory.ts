/** Shared static-file rules for the archive and its separately signed inventory. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface FileRecord {
  path: string;
  bytes: number;
  sha256: string;
}

export const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
export const comparePaths = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));

export function safePath(path: string): void {
  if (typeof path !== 'string' || !path || /[\\\x00-\x1f\x7f]/.test(path)
    || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe static path: ${JSON.stringify(path)}`);
  }
}

export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function inventory(root: string, prefix = ''): Promise<FileRecord[]> {
  if (!(await lstat(join(root, prefix))).isDirectory()) throw new Error(`Not a regular directory: ${root}`);
  const files: FileRecord[] = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    safePath(path);
    if (entry.isDirectory()) files.push(...await inventory(root, path));
    else if (entry.isFile()) {
      const file = join(root, path);
      files.push({ path, bytes: (await lstat(file)).size, sha256: await hashFile(file) });
    } else throw new Error(`Static tree contains a link or special file: ${path}`);
  }
  return files.sort((a, b) => comparePaths(a.path, b.path));
}
