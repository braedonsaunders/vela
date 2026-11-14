import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
const root = join(homedir(), '.scratch/tmp/vela/media-audio');
await mkdir(root, { recursive: true });
// One distinct sequential tone per WAVE-order channel, then all channels.
// FL FR FC LFE BL BR SL SR; 80 Hz LFE, other channels 300 + 100*index Hz.
function signal(channels: number) {
  return Array.from({ length: channels }, (_, c) =>
    `0.12*sin(2*PI*${c === 3 ? 80 : 300 + c * 100}*t)*(between(t,${c},${c + 0.8})+between(t,8,10))`).join('|');
}
const fixtures = [
  ['truehd-5.1', 'truehd', '5.1(side)', 6], ['dts-5.1', 'dca', '5.1', 6],
  ['eac3-5.1', 'eac3', '5.1', 6], ['ac3-5.1', 'ac3', '5.1', 6],
  ['flac-7.1', 'flac', '7.1', 8], ['alac-7.1', 'alac', '7.1', 8],
  ['pcm-7.1', 'pcm_s24le', '7.1', 8],
] as const;
for (const [name, codec, layout, channels] of fixtures) {
  const file = join(root, name + '.mkv');
  if (await Bun.file(file).exists()) { console.log(`Keeping ${file}`); continue; }
  const args = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-n', '-f', 'lavfi', '-i',
    `aevalsrc='${signal(channels)}':s=48000:d=10:c=${layout}`, '-c:a', codec, '-strict', '-2',
    ...(codec === 'dca' ? ['-b:a', '1536k'] : []), file];
  const child = Bun.spawn(args, { stdout: 'inherit', stderr: 'inherit' });
  if (await child.exited) throw new Error(`ffmpeg failed for ${name}`);
  const probe = Bun.spawn(['ffprobe', '-v', 'error', '-show_entries', 'stream=channels', '-of', 'json', file], { stdout: 'pipe', stderr: 'inherit' });
  const actual = await new Response(probe.stdout).json();
  if (await probe.exited || actual.streams[0]?.channels !== channels) throw new Error(`Encoder changed ${name} channel count`);
  console.log(file);
}
await Bun.write(join(root, 'README.txt'), 'Synthetic 10s 48kHz fixtures. WAVE order FL FR FC LFE BL BR SL SR. Each channel solo for 0.8s at its integer second, then all at 8-10s. LFE 80Hz; others 300+100*index Hz. TrueHD/DTS/AC3/EAC3 5.1; FLAC/ALAC/PCM 7.1. The experimental TrueHD encoder supports at most 5.1; never label its output 7.1. DTS is core only: ffmpeg cannot encode DTS-HD MA. No Atmos metadata generated.\n');
