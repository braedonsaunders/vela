/** Accept only the non-Metro player payload; a diagnostic or Exact runtime is never an input. */
import { copyFile, lstat, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { comparePaths, hashFile, inventory, safePath, sha256, type FileRecord } from './inventory';

const manifestName = 'PLAYER-ASSETS-MANIFEST.json';

export async function stagePlayerAssets(input: string, dist: string, revision: string) {
  const root = resolve(input);
  const manifestPath = join(root, '..', '..', manifestName);
  if (!(await lstat(manifestPath)).isFile()) throw new Error('Player manifest must be a regular file');
  const bytes = await readFile(manifestPath);
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(manifest.digest)
    || manifest.sourceRevision !== revision || manifest.sourceDirty !== false
    || !Array.isArray(manifest.dependencies) || !manifest.dependencies.length || !Array.isArray(manifest.files)) {
    throw new Error('Expected a clean player payload built from the captured source revision');
  }
  const expected = new Map<string, FileRecord>();
  for (const file of manifest.files as FileRecord[]) {
    safePath(file.path);
    if (/[^\x20-\x7e]/.test(file.path) || file.path === manifestName || expected.has(file.path)
      || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)
      || !(file.path.startsWith('libraries/') || file.path.startsWith('sources/')
        || file.path === 'capabilities.json' || file.path === 'THIRD_PARTY_NOTICES')) {
      throw new Error(`Invalid player inventory record: ${file.path}`);
    }
    expected.set(file.path, file);
  }
  const actual = (await inventory(root)).filter(file => file.path !== manifestName);
  if (actual.length !== expected.size || actual.some(file => {
    const record = expected.get(file.path);
    return !record || file.bytes !== record.bytes || file.sha256 !== record.sha256;
  })) throw new Error('Player payload has missing, unlisted or changed files');
  const records = [...expected.values()].sort((a, b) => comparePaths(a.path, b.path));
  const digest = sha256(records.map(file => `${file.path}\0${file.bytes}\0${file.sha256}\n`).join(''));
  if (digest !== manifest.digest) throw new Error('Player aggregate digest mismatch');
  for (const path of [
    'capabilities.json', 'THIRD_PARTY_NOTICES', 'sources/mediabunny.tar.gz',
    'libraries/webgpu-player/CustomDecode.worker.js',
    'libraries/webgpu-player/CustomAudioDecode.worker.js',
    'libraries/webgpu-player/GPUDecoderCoordinator.worker.js',
    'libraries/webgpu-player/GPUDecoderParse.worker.js',
    'libraries/audio-decoders/vela-audio.wasm',
    'libraries/audio-output-stage/audio-output-stage.wasm',
    'libraries/video-decoders/hevc.wasm',
    'libraries/subtitles/jassub.js', 'libraries/subtitles/jassub-worker.js',
    'libraries/subtitles/jassub-worker.wasm', 'libraries/subtitles/NotoSans.ttf',
  ]) {
    if (!expected.has(path)) throw new Error(`Missing required player resource: ${path}`);
  }
  const target = join(dist, 'player', digest);
  for (const file of actual) {
    const output = join(target, file.path);
    await mkdir(dirname(output), { recursive: true });
    await copyFile(join(root, file.path), output);
    if (await hashFile(output) !== file.sha256) throw new Error(`Player input changed: ${file.path}`);
  }
  await copyFile(manifestPath, join(dist, manifestName));
  if (await hashFile(join(dist, manifestName)) !== sha256(bytes)) throw new Error('Player manifest changed');
  return { digest, baseURL: `/vela/player/${digest}/`, payloadManifestSha256: sha256(bytes) };
}
