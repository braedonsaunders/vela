// The measurement signals (docs/sound.md, tools/sound-measure/README.md): 48 kHz stereo FLAC made with
// ffmpeg. Usage: bun tools/sound-measure/signals.ts <out dir>
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2];
if (!out) { console.error('usage: bun tools/sound-measure/signals.ts <out dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });

/** The same expression in both channels: an explicit stereo source (ffmpeg's mono-to-stereo upmix would
 * lower each channel by 3 dB). */
const both = (expr: string) => `${expr}|${expr}`;

const signals: Record<string, string[]> = {
  // 1 kHz at −20 dBFS (amplitude 0.1), 10 s, as a cosine: a whole number of cycles, so two in a row join
  // in phase, at a peak (a gain switch there is visible on the very sample).
  'tone1k.flac': ['-f', 'lavfi', '-i', `aevalsrc=${both('0.1*cos(2*PI*1000*t)')}:s=48000:d=10`],
  'toneA.flac': ['-f', 'lavfi', '-i', `aevalsrc=${both('0.25*sin(2*PI*440*t)')}:s=48000:d=30`],
  'toneB.flac': ['-f', 'lavfi', '-i', `aevalsrc=${both('0.25*sin(2*PI*660*t)')}:s=48000:d=30`],
  // White noise, the same in both channels (one channel's noise duplicated without a level change).
  'noise.flac': ['-f', 'lavfi', '-i', 'anoisesrc=color=white:amplitude=0.05:seed=7:r=48000:d=12', '-af', 'pan=stereo|c0=c0|c1=c0'],
  // Click tracks for beat alignment: 120 BPM, the outgoing with beats at 0.10 s + k·0.5 s, the incoming
  // with its first beat 0.31 s in.
  'beatsA.flac': ['-f', 'lavfi', '-i', `aevalsrc='${both('0.6*exp(-mod(t-0.10+10,0.5)/0.006)*sin(2*PI*1800*t)*gte(t,0.10)')}':s=48000:d=30`],
  'beatsB.flac': ['-f', 'lavfi', '-i', `aevalsrc='${both('0.6*exp(-mod(t-0.31+10,0.5)/0.006)*sin(2*PI*1200*t)*gte(t,0.31)')}':s=48000:d=30`],
};

for (const [name, input] of Object.entries(signals)) {
  const run = Bun.spawnSync(['ffmpeg', '-y', '-loglevel', 'error', ...input, '-sample_fmt', 's16', join(out, name)]);
  if (run.exitCode !== 0) { console.error(name, run.stderr.toString()); process.exit(1); }
  console.log('wrote', join(out, name));
}
