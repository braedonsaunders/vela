/** Prepare exact-byte Ed25519 signed assets locally. Never contacts GitHub or publishes. */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { output, sha256, keychain, verifySignature, command } from './signing';

const [version] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  throw new Error('Usage: sign.ts <version> [--test-key] [--base-url=file:///absolute/directory/]');
}
const testKey = process.argv.includes('--test-key');
const identity = testKey ? 'lab-test-v1' : process.argv.includes('--next-key') ? 'production-v2' : 'production-v1';
const dir = resolve(process.argv.find(arg => arg.startsWith('--output-dir='))?.slice(13)
  ?? join(output, `signed-${version}${testKey ? '-test' : ''}`));
const file = join(dir, `vela-${version}.release.json`);
if (await Bun.file(file).exists()) throw new Error('Signed output exists; do not rewrite versioned descriptors');
await mkdir(dir, { recursive: true });
const base = new URL(process.argv.find(arg => arg.startsWith('--base-url='))?.slice(11)
  ?? `https://github.com/braedonsaunders/vela/releases/download/v${version}/`);
if (!base.href.endsWith('/') || base.username || base.password || base.search || base.hash
  || !(base.protocol === 'https:' || testKey && base.protocol === 'file:')) {
  throw new Error('Invalid release base URL');
}
const archive = `vela-${version}.tar.gz`;
const inventory = `vela-${version}.manifest.json`;
const manifestBytes = await readFile(join(output, inventory));
const manifest = JSON.parse(manifestBytes.toString('utf8'));
if (manifest.version !== version || manifest.sourceDirty !== false
  || !/^[a-f0-9]{40}$/.test(manifest.sourceRevision)) throw new Error('Expected clean matching release');

async function asset(name: string) {
  const bytes = await readFile(join(output, name));
  await copyFile(join(output, name), join(dir, name));
  const copied = await readFile(join(dir, name));
  if (sha256(copied) !== sha256(bytes)) throw new Error(`Release input changed: ${name}`);
  return { url: new URL(name, base).href, bytes: copied.length, sha256: sha256(copied) };
}
const archiveRef = await asset(archive);
const manifestRef = await asset(inventory);
if (manifestRef.sha256 !== sha256(manifestBytes)) throw new Error('Manifest changed while signing');
// Verify the copied bytes that the descriptor will identify, including every archive file and player aggregate.
await command(['python3', join(import.meta.dir, 'verify-release.py'), join(dir, archive)]);
if (!Array.isArray(manifest.protocolVersions) || !manifest.protocolVersions.length
  || manifest.protocolVersions.some((value: number) => !Number.isSafeInteger(value) || value < 0)) {
  throw new Error('Invalid supported protocol versions');
}
const publishedAt = new Date();
const expiresAt = new Date(publishedAt.getTime() + 30 * 86400000);
const descriptor = {
  schemaVersion: 1,
  kind: 'vela-release',
  channel: 'stable',
  version,
  publishedAt: publishedAt.toISOString(),
  expiresAt: expiresAt.toISOString(),
  sourceRevision: manifest.sourceRevision,
  sourceDirty: false,
  protocol: {
    minInclusive: Math.min(...manifest.protocolVersions),
    maxInclusive: Math.max(...manifest.protocolVersions),
  },
  minimumEtherVersion: '0.3.13',
  archive: archiveRef,
  manifest: manifestRef,
  playerAssetsDigest: manifest.playerAssetsDigest,
};
await writeFile(file, JSON.stringify(descriptor, null, 2) + '\n', { flag: 'wx' });
const publicKey = await keychain('public', identity);
const signature = await keychain('sign', identity, file);
verifySignature(await readFile(file), signature, publicKey);
await writeFile(file + '.sig', signature + '\n');
await copyFile(file, join(dir, 'channel.json'));
await copyFile(file + '.sig', join(dir, 'channel.json.sig'));
console.log(JSON.stringify({
  directory: dir, descriptor: file, signature: file + '.sig', publicKey,
  descriptorSha256: sha256(await readFile(file)), testKey,
}, null, 2));
