// bun client/player/universal/audio/install-packages.ts <served-decoder-directory>
// Installs binaries WITH corresponding source and licenses, never into app bundle.
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { audioPackages, audioPackageRelease, audioSourceFiles } from './packages';
const target = process.argv[2];
if (!target) throw new Error('Supply an output directory for separately served audio modules and source');
await mkdir(resolve(target), { recursive: true });
const sumsResponse = await fetch(audioPackageRelease + 'SHA256SUMS');
if (!sumsResponse.ok) throw new Error(`Audio release checksums HTTP ${sumsResponse.status}`);
const checksums = new Map((await sumsResponse.text()).trim().split('\n').map(line => {
  const [hash, file] = line.trim().split(/\s+\*?/); return [file, hash];
}));
for (const file of [...Object.entries(audioPackages).filter(([id]) => id !== 'vela-audio').map(([, p]) => p.file), ...audioSourceFiles]) {
  const response = await fetch(audioPackageRelease + file);
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  const hash = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
  const pinned = Object.values(audioPackages).find(p => p.file === file)?.sha256;
  if (hash !== checksums.get(file) || (pinned && hash !== pinned)) throw new Error(`${file}: integrity mismatch`);
  await Bun.write(resolve(target, file), bytes);
  console.log(`Installed ${file}`);
}
await Bun.write(resolve(target, 'SOURCE.txt'), `Vela separately loads LGPL-2.1-or-later audio decoders from WebGPU Player decoders v0.1.1.\nCorresponding FFmpeg, libdcadec and decoder bridge source archives and license texts are served in this same directory. You may replace/relink these modules under LGPL terms. No Vela restriction forbids reverse engineering to debug such modifications.\nUpstream source: https://github.com/alchemyyy/webgpu-player-decoders/tree/672c83e67ce2b0de0070602980f98023e0baaddd\nAtmos HRIR credit: MIT KEMAR measurements, Bill Gardner and Keith Martin, MIT Media Lab, 1994.\n`);

if (process.argv.includes('--general')) {
  const child = Bun.spawn([process.execPath, new URL('./ffmpeg/build.ts', import.meta.url).pathname, resolve(target)], { stdout: 'inherit', stderr: 'inherit' });
  if (await child.exited) throw new Error('General audio package build failed');
}
