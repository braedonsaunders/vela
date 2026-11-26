// Copy the mock's generated music and audiobook files with their sound removed, for parity runs that
// play (Listen's paused now-playing state, the visualizer): nothing may be audible on the Mac, and a
// simulator plays through its speakers. Codec, duration, tags and chapters are kept, so the plans the
// mock serves still match; only the samples become silence.
//
//   bun tools/parity/silent-music.ts --to ~/.scratch/tmp/<thread>/media-music [--from ~/.scratch/tmp/vela/media-music]
//
// Then start the mock with VELA_MOCK_MUSIC_ROOT=<to>.
import { mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { from: { type: 'string', default: join(homedir(), '.scratch/tmp/vela/media-music') }, to: { type: 'string' } } });
if (!values.to) throw new Error('--to <dir> is required');
const from = resolve(values.from!), to = resolve(values.to);
if (from === to) throw new Error('--to must differ from --from');
mkdirSync(to, { recursive: true });
const ffmpeg = Bun.which('ffmpeg') ?? '/opt/homebrew/bin/ffmpeg';
/** The encoder per container, matching make-music-media.ts and make-gapless-media.ts closely enough for a plan. */
const CODEC: Record<string, string[]> = {
  '.m4a': ['-c:a', 'aac', '-b:a', '128k'], '.mp3': ['-c:a', 'libmp3lame', '-b:a', '128k'],
  '.flac': ['-c:a', 'flac'], '.wav': ['-c:a', 'pcm_s16le'], '.ogg': ['-c:a', 'libvorbis'], '.opus': ['-c:a', 'libopus'],
};
let count = 0;
for (const name of readdirSync(from)) {
  const codec = CODEC[extname(name)];
  if (!codec) continue;
  const run = Bun.spawnSync([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', join(from, name),
    '-map', '0:a', '-map_metadata', '0', '-map_chapters', '0', '-af', 'volume=0', ...codec, join(to, name)]);
  if (run.exitCode !== 0) throw new Error(`${name}: ${run.stderr.toString().trim()}`);
  count++;
}
console.log(`silenced ${count} files into ${to}`);
