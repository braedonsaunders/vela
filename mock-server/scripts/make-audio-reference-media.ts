import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
const root = join(homedir(), '.scratch/tmp/vela/media-audio');
await mkdir(root, { recursive: true });
const revision = '672c83e67ce2b0de0070602980f98023e0baaddd';
const base = `https://raw.githubusercontent.com/alchemyyy/webgpu-player-decoders/${revision}/truehd/vectors/`;
const name = 'fba_atmos_cbi.mlp';
const expected = '4bb63a8e0e0b2ae86d4dd58a55ace5ec78fd9ff0ceb514c601e0f413ac25b53c';
const input = join(root, name);
if (!await Bun.file(input).exists()) {
  const response = await fetch(base + name);
  if (!response.ok) throw new Error(`TrueHD vector HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (new Bun.CryptoHasher('sha256').update(bytes).digest('hex') !== expected) throw new Error('TrueHD vector integrity mismatch');
  await Bun.write(input, bytes);
}
if (new Bun.CryptoHasher('sha256').update(await Bun.file(input).arrayBuffer()).digest('hex') !== expected) throw new Error('Existing TrueHD vector integrity mismatch');
for (const file of ['LICENSE', 'PROVENANCE.txt']) {
  const response = await fetch(base + file);
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  await Bun.write(join(root, 'truehd-reference-' + file), response);
}
const output = join(root, 'truehd-bed-7.1.mkv');
if (!await Bun.file(output).exists()) {
  const child = Bun.spawn(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-n', '-f', 'truehd', '-i', input,
    '-c:a', 'copy', '-strict', '-2', output], { stdout: 'inherit', stderr: 'inherit' });
  if (await child.exited) throw new Error('TrueHD reference remux failed');
}
const probe = Bun.spawn(['ffprobe', '-v', 'error', '-show_entries', 'stream=channels,codec_name', '-of', 'json', output], { stdout: 'pipe' });
const result = await new Response(probe.stdout).json();
if (await probe.exited || result.streams[0]?.channels !== 8 || result.streams[0]?.codec_name !== 'truehd') throw new Error('Reference remux lost TrueHD 7.1');
console.log(`${output}: 136 access units / 5440 frames, Apache-2.0 upstream channel-bed vector. See adjacent licence and provenance; not a full film or physical surround qualification.`);
