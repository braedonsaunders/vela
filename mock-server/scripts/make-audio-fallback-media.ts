import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
const root = join(homedir(), '.scratch/tmp/vela/media-audio');
await mkdir(root, { recursive: true });
for (const [name, codec, extension] of [
  ['vorbis-stereo', 'vorbis', 'ogg'], ['opus-stereo', 'opus', 'ogg'],
  ['mp2-stereo', 'mp2', 'mka'], ['wma-stereo', 'wmav2', 'asf'],
  ['aac-stereo', 'aac', 'm4a'], ['pcm-f64-stereo', 'pcm_f64le', 'wav'],
] as const) {
  const file = join(root, `${name}.${extension}`);
  if (await Bun.file(file).exists()) { console.log(`Keeping ${file}`); continue; }
  const process = Bun.spawn(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-n', '-f', 'lavfi', '-i',
    "aevalsrc='0.1*sin(2*PI*440*t)|0.1*sin(2*PI*880*t)':s=48000:d=2:c=stereo", '-c:a', codec, '-strict', '-2', file],
    { stdout: 'inherit', stderr: 'inherit' });
  if (await process.exited) throw new Error(`Failed ${name}`);
  console.log(file);
}
