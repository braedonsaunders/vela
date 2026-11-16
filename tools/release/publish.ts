/** Deliberate public release operation. Never called by build.ts or sign.ts. */
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { command, keychain, output, sha256, verifySignature } from './signing';
const version = process.argv[2], dryRun = process.argv.includes('--dry-run'), testKey = process.argv.includes('--test-key');
if (!/^\d+\.\d+\.\d+$/.test(version ?? '') || testKey && !dryRun) throw new Error('Usage: publish.ts <version> --dry-run [--test-key] OR --approved=<version>');
if (!dryRun && !process.argv.includes(`--approved=${version}`)) throw new Error('Public publication requires the owner go for this version, then --approved=<version>. Use --dry-run to validate locally.');
const dir = resolve(process.argv.find(a=>a.startsWith('--output-dir='))?.slice(13) ?? join(output, `signed-${version}${testKey ? '-test' : ''}`));
const descriptorName = `vela-${version}.release.json`, descriptorFile = join(dir,descriptorName);
const bytes = await readFile(descriptorFile), descriptor = JSON.parse(bytes.toString('utf8'));
verifySignature(bytes,await readFile(descriptorFile+'.sig','utf8'),await keychain('public',testKey?'lab-test-v1':process.argv.includes('--next-key')?'production-v2':'production-v1'));
if (descriptor.schemaVersion !== 1 || descriptor.kind !== 'vela-release' || descriptor.channel !== 'stable' || descriptor.version !== version || descriptor.sourceDirty !== false || Date.parse(descriptor.expiresAt) <= Date.now() || !Number.isFinite(Date.parse(descriptor.publishedAt))) throw new Error('Invalid/expired signed descriptor');
const base = `https://github.com/braedonsaunders/vela/releases/download/v${version}/`;
if (!/^[a-f0-9]{64}$/.test(descriptor.playerAssetsDigest) || 'engines' in descriptor
  || 'universalRuntimeKey' in descriptor) throw new Error('Expected a single-app player-assets descriptor');
const refs = [descriptor.archive, descriptor.manifest];
const uploads = [descriptorFile, descriptorFile+'.sig'];
for (const ref of refs) {
  const url = new URL(ref.url), name = decodeURIComponent(url.pathname.split('/').at(-1)!);
  if (!name || name.includes('/') || name.includes('\\') || !dryRun && ref.url !== base+name) throw new Error('Unexpected release asset URL');
  const file = join(dir,name), content = await readFile(file);
  if (content.length !== ref.bytes || sha256(content) !== ref.sha256) throw new Error(`Signed asset mismatch: ${name}`);
  uploads.push(file);
}
if (await readFile(join(dir,'channel.json'),'utf8') !== bytes.toString('utf8') || await readFile(join(dir,'channel.json.sig'),'utf8') !== await readFile(descriptorFile+'.sig','utf8')) throw new Error('Stable channel differs from signed release');
if (dryRun) { console.log(JSON.stringify({dryRun:true,version,filesVerified:uploads.length,publicActions:0,directory:dir})); process.exit(0); }
const repo = 'braedonsaunders/vela', tag = `v${version}`;
const notes = join(dir,'release-notes.txt');
await writeFile(notes,`Vela ${version}\n\nProtocol ${descriptor.protocol.minInclusive}–${descriptor.protocol.maxInclusive}; Ether >= ${descriptor.minimumEtherVersion}.\nSource ${descriptor.sourceRevision}. Signed Ed25519 descriptor and complete file inventory attached.\n`);
// Creating an existing tag's release fails rather than rewriting versioned bytes.
await command(['gh','release','create',tag,'--repo',repo,'--target',descriptor.sourceRevision,'--draft','--title',`Vela ${version}`,'--notes-file',notes,...uploads]);
await command(['gh','release','edit',tag,'--repo',repo,'--draft=false','--latest=false']);
const channel = Bun.spawn(['gh','release','view','vela-stable','--repo',repo],{stdout:'ignore',stderr:'inherit'});
if (await channel.exited) await command(['gh','release','create','vela-stable','--repo',repo,'--target',descriptor.sourceRevision,'--draft','--title','Vela stable channel','--notes','Signed channel pointer; versioned release assets are immutable.']);
// Channel changes last. A reader spanning the two uploads rejects a mismatched signature.
await command(['gh','release','upload','vela-stable','--repo',repo,'--clobber',join(dir,'channel.json'),join(dir,'channel.json.sig')]);
await command(['gh','release','edit','vela-stable','--repo',repo,'--draft=false','--latest=false']);
console.log(JSON.stringify({published:version,channel:'https://github.com/braedonsaunders/vela/releases/download/vela-stable/channel.json'}));
