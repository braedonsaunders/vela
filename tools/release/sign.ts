/** Prepare signed assets locally. Does not contact GitHub or publish. */
import { copyFile, mkdir, readFile, rm, writeFile, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { output, sha256, keychain, verifySignature } from './signing';
import { stageUniversalFromRelease } from './universal-assets';
const [version] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error('Usage: sign.ts <version> [--test-key] [--base-url=file:///absolute/directory/]');
const testKey = process.argv.includes('--test-key');
const identity = testKey ? 'lab-test-v1' : 'production-v1';
const dir = join(output, `signed-${version}${testKey ? '-test' : ''}`);
if (await Bun.file(join(dir, `vela-${version}.release.json`)).exists()) throw new Error('Signed output exists; do not rewrite versioned descriptors');
await mkdir(dir,{recursive:true});
const base = new URL(process.argv.find(a=>a.startsWith('--base-url='))?.slice(11) ?? `https://github.com/braedonsaunders/vela/releases/download/v${version}/`);
if (!base.href.endsWith('/') || base.username || base.password || base.search || base.hash || !(base.protocol === 'https:' || testKey && base.protocol === 'file:')) throw new Error('Invalid release base URL');
const archive = `vela-${version}.tar.gz`, inventory = `vela-${version}.manifest.json`;
const manifest = JSON.parse(await readFile(join(output,inventory),'utf8'));
if (manifest.version !== version || manifest.sourceDirty || !/^[a-f0-9]{40}$/.test(manifest.sourceRevision)) throw new Error('Expected clean matching release');
// Check all archive files before signing; temporary copies are release intermediates.
const work = await mkdtemp(join(output,'.sign-verify-'));
try { await stageUniversalFromRelease(join(output, archive), work); } finally { await rm(work,{recursive:true,force:true}); }
async function asset(name: string) {
  const bytes = await readFile(join(output,name));
  await copyFile(join(output,name), join(dir,name));
  return {url:new URL(name,base).href,bytes:bytes.length,sha256:sha256(bytes)};
}
const archiveRef = await asset(archive), manifestRef = await asset(inventory);
const engines: Record<string,{manifest:{url:string;bytes:number;sha256:string}}> = {};
for (const engine of Object.keys(manifest.engines)) {
  const name = `vela-${version}-${engine}.manifest.json`;
  const child = JSON.parse(await readFile(join(output,name),'utf8'));
  if (child.sourceDirty || child.sourceRevision !== manifest.sourceRevision || child.version !== version) throw new Error(`Mismatched engine ${engine}`);
  const prefix = `engines/${engine}/${version}/`;
  const finalized = {schemaVersion:1,version,engine,basePath:`/vela/${prefix}`,sourceRevision:manifest.sourceRevision,sourceDirty:false,protocolVersions:manifest.protocolVersions,exactRevision:manifest.exactRevision,files:manifest.files.filter((f:any)=>f.path.startsWith(prefix)).map((f:any)=>({...f,path:f.path.slice(prefix.length)}))};
  if (!finalized.files.length) throw new Error(`Missing finalized engine ${engine}`);
  const bytes = Buffer.from(JSON.stringify(finalized,null,2)+'\n');
  await writeFile(join(dir,name),bytes);
  engines[engine] = {manifest:{url:new URL(name,base).href,bytes:bytes.length,sha256:sha256(bytes)}};
}
const publishedAt = new Date(), expiresAt = new Date(publishedAt.getTime()+30*86400000);
const descriptor = {schemaVersion:1,kind:'vela-release',channel:'stable',version,publishedAt:publishedAt.toISOString(),expiresAt:expiresAt.toISOString(),sourceRevision:manifest.sourceRevision,sourceDirty:false,protocol:{minInclusive:Math.min(...manifest.protocolVersions),maxInclusive:Math.max(...manifest.protocolVersions)},minimumEtherVersion:'0.3.13',archive:archiveRef,manifest:manifestRef,engines,universalRuntimeKey:manifest.universalAssets.assetKey};
const file = join(dir, `vela-${version}.release.json`);
await writeFile(file,JSON.stringify(descriptor,null,2)+'\n');
const publicKey = await keychain('public',identity);
const signature = await keychain('sign',identity,file);
verifySignature(await readFile(file),signature,publicKey);
await writeFile(file+'.sig',signature+'\n');
await copyFile(file,join(dir,'channel.json')); await copyFile(file+'.sig',join(dir,'channel.json.sig'));
console.log(JSON.stringify({directory:dir,descriptor:file,signature:file+'.sig',publicKey,descriptorSha256:sha256(await readFile(file)),testKey},null,2));
