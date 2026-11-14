/** Verified prebuilt player input: never runs a compiler or fetches packages. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';

const UPSTREAM = 'a7a95ef26bd0a71f5ee12f863b8ffb2cfbc3c9d2';
interface FileRecord { path: string; bytes: number; sha256: string }
interface PayloadManifest { schemaVersion: number; assetKey: string; files: FileRecord[] }
export interface UniversalAssets { baseURL: string; assetKey: string; upstreamRevision: string; payloadManifestSha256: string }
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function files(root: string, prefix = ''): Promise<string[]> {
  const names: string[] = [];
  for (const entry of (await readdir(join(root, prefix), { withFileTypes: true })).sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Universal payload contains a link: ${name}`);
    if (entry.isDirectory()) names.push(...await files(root, name));
    else if (entry.isFile()) names.push(name);
    else throw new Error(`Universal payload contains a non-file: ${name}`);
  }
  return names;
}

/** Validate all payload files, then stage one shared immutable runtime tree. */
export async function stageUniversalAssets(input: string, dist: string): Promise<UniversalAssets> {
  const root = resolve(input), manifestName = 'DIAGNOSTIC-MANIFEST.json';
  if (!(await lstat(join(root, manifestName))).isFile()) throw new Error('Universal payload manifest must be a regular file');
  const manifestBytes = await readFile(join(root, manifestName));
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as PayloadManifest;
  if (manifest.schemaVersion !== 1 || !/^[a-f0-9]{16}$/.test(manifest.assetKey) || !Array.isArray(manifest.files)) throw new Error('Invalid universal payload manifest');
  const expected = new Map<string, FileRecord>();
  for (const file of manifest.files) {
    if (typeof file.path !== 'string' || file.path.includes('\\') || file.path.includes('\0') || file.path.startsWith('/') || file.path !== posix.normalize(file.path)
      || file.path.split('/').includes('..') || !(file.path === 'index.js' || file.path.startsWith('universal/')) || expected.has(file.path)
      || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Invalid universal payload file record');
    expected.set(file.path, file);
  }
  const actual = (await files(root)).filter(name => name !== manifestName);
  if (actual.length !== expected.size || actual.some(name => !expected.has(name))) throw new Error('Universal payload has missing or unlisted files');
  for (const file of expected.values()) {
    const path = join(root, file.path), stat = await lstat(path);
    if (!stat.isFile() || stat.size !== file.bytes || await hashFile(path) !== file.sha256) throw new Error(`Universal payload digest mismatch: ${file.path}`);
  }
  for (const required of ['index.js', 'universal/assets.json', 'universal/runtime.js', 'universal/THIRD_PARTY_NOTICES', 'universal/sources/mediabunny.tar.gz']) {
    if (!expected.has(required)) throw new Error(`Universal payload missing ${required}`);
  }
  const identity = JSON.parse(await readFile(join(root, 'universal/assets.json'), 'utf8'));
  if (identity.version !== 1 || identity.assetKey !== manifest.assetKey || identity.upstreamRevision !== UPSTREAM || identity.libraries !== './libraries/' || identity.sources !== './sources/') throw new Error('Universal runtime identity mismatch');
  // Reproduce the asset build's key: sorted libraries, then runtime bytes.
  const key = createHash('sha256');
  for (const name of await files(join(root, 'universal/libraries'))) {
    key.update(`/libraries/${name}`);
    for await (const chunk of createReadStream(join(root, 'universal/libraries', name))) key.update(chunk);
  }
  for await (const chunk of createReadStream(join(root, 'universal/runtime.js'))) key.update(chunk);
  if (key.digest('hex').slice(0, 16) !== manifest.assetKey) throw new Error('Universal asset key does not match runtime/libraries');
  const target = join(dist, 'universal', manifest.assetKey);
  for (const file of expected.values()) {
    if (!file.path.startsWith('universal/')) continue; // Production host comes from committed Vela, not the diagnostic host.
    const output = join(target, file.path.slice('universal/'.length));
    await mkdir(dirname(output), { recursive: true });
    await copyFile(join(root, file.path), output);
    if (await hashFile(output) !== file.sha256) throw new Error(`Universal input changed while staging: ${file.path}`);
  }
  await mkdir(target, { recursive: true });
  await copyFile(join(root, manifestName), join(target, 'PAYLOAD-MANIFEST.json'));
  if (await hashFile(join(target, 'PAYLOAD-MANIFEST.json')) !== digest(manifestBytes)) throw new Error('Universal manifest changed while staging');
  return { baseURL: `/vela/universal/${manifest.assetKey}/`, assetKey: manifest.assetKey, upstreamRevision: UPSTREAM, payloadManifestSha256: digest(manifestBytes) };
}
