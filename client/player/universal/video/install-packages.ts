/** Separately served decoder modules with corresponding release source/licences. */
import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import pins from '../../../../vendor/webgpu-player/tools/pinned-releases.json';
const output = Bun.argv[2];
if (!output) throw new Error('Supply a separately served video decoder directory');
const target = resolve(output);
await mkdir(target, {recursive:true});
const release = `https://github.com/${pins.decoders.repository}/releases/download/${pins.decoders.tag}/`;
const prepared = Bun.argv.find(arg => arg.startsWith('--from='))?.slice(7);
let text: string;
if (prepared) text = await Bun.file(resolve(prepared,'SHA256SUMS')).text();
else {
  const response = await fetch(release+'SHA256SUMS',{signal:AbortSignal.timeout(20000)});
  if (!response.ok) throw new Error(`Decoder source checksums HTTP ${response.status}`);
  text = await response.text();
}
const sums = new Map(text.trim().split('\n').map(line => {
  const [hash,file] = line.trim().split(/\s+\*?/); return [file,hash];
}));
const binaries = ['hevc','av1','mpeg2','mpeg4','vc1','jpeg2000','uncompressed'].map(id=>`${id}.wasm`);
const sources = [...sums.keys()].filter(file => /^[\w.-]+$/.test(file) &&
  (/\.tar\.(?:gz|xz|bz2|zst)$/.test(file) || /COPYING|LICENSE/i.test(file)));
if (!sources.some(file => file.startsWith('webgpu-player-decoders-')) || !sources.some(file => /COPYING|LICENSE/i.test(file)))
  throw new Error('Decoder release has no corresponding source/licences');
for (const file of [...binaries,...sources]) {
  let bytes: ArrayBuffer;
  if (prepared) bytes = await Bun.file(resolve(prepared,file)).arrayBuffer();
  else {
    const response = await fetch(release+file,{signal:AbortSignal.timeout(120000)});
    if (!response.ok) throw new Error(`Decoder ${file}: HTTP ${response.status}`);
    bytes = await response.arrayBuffer();
  }
  const digest = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
  if (digest !== sums.get(file) || (file.endsWith('.wasm') && digest !== pins.decoders.files[file as keyof typeof pins.decoders.files]))
    throw new Error(`Decoder ${file}: integrity mismatch`);
  if (prepared && resolve(prepared) !== target) await copyFile(resolve(prepared,file),resolve(target,file));
  else if (!prepared) await Bun.write(resolve(target,file),bytes);
}
await Bun.write(resolve(target,'SHA256SUMS'),text);
await Bun.write(resolve(target,'SOURCE.txt'),`Decoder release ${pins.decoders.repository}@${pins.decoders.tag}.\nEach module remains independently loaded and replaceable. Exact corresponding release source archives and licence texts accompany the binaries in this directory.\nHost build source permits rebuilding module hashes for local replacements; no reverse-engineering restriction is imposed for debugging such modifications.\n`);
