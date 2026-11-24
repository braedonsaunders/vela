// Synthesizes the gapless test albums (packages/protocol/fixtures/media.ts, `gaplessSources`): one
// continuous 30-second signal, a 220 to 880 Hz linear sweep over a seeded white-noise floor (so a
// recording lines up with it unambiguously), cut into four parts at sample counts no codec frame lines
// up with, each encoded as FLAC, MP3 (LAME, whose header carries the encoder delay and padding) and AAC
// in MP4 (whose edit list carries them). The whole signal is kept as gapless-sweep-reference.wav for
// tools/gapless/measure.ts. Samples are computed here; ffmpeg only encodes.
// Usage: bun mock-server/scripts/make-gapless-media.ts [output-dir]
// (default ~/.scratch/tmp/vela/media-music, or VELA_MOCK_MUSIC_ROOT).
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { GAPLESS_RATE, gaplessPartFrames, gaplessSources } from '../../packages/protocol/fixtures/media';
import { musicRoot } from '../media-kinds';

const root = process.argv[2] ?? musicRoot;
const ffmpeg = Bun.which('ffmpeg') ?? '/opt/homebrew/bin/ffmpeg';

/** The signal's samples, 16-bit, both channels alike. */
export function gaplessSignal(): Int16Array {
  const total = gaplessPartFrames.reduce((sum, frames) => sum + frames, 0);
  const seconds = total / GAPLESS_RATE;
  const out = new Int16Array(total);
  let state = 0x5eed;
  const noise = () => { state = (Math.imul(state, 1103515245) + 12345) >>> 0; return (state / 4294967296) * 2 - 1; };
  const f0 = 220, f1 = 880, k = (f1 - f0) / seconds;
  for (let i = 0; i < total; i++) {
    const t = i / GAPLESS_RATE;
    const value = 0.45 * Math.sin(2 * Math.PI * (f0 * t + k * t * t / 2)) + 0.04 * noise();
    out[i] = Math.round(value * 32767);
  }
  return out;
}

function wav(samples: Int16Array): Uint8Array {
  const channels = 2, bytes = new DataView(new ArrayBuffer(44 + samples.length * channels * 2));
  const text = (at: number, value: string) => [...value].forEach((ch, i) => bytes.setUint8(at + i, ch.charCodeAt(0)));
  text(0, 'RIFF'); bytes.setUint32(4, 36 + samples.length * channels * 2, true); text(8, 'WAVEfmt '); bytes.setUint32(16, 16, true);
  bytes.setUint16(20, 1, true); bytes.setUint16(22, channels, true); bytes.setUint32(24, GAPLESS_RATE, true); bytes.setUint32(28, GAPLESS_RATE * channels * 2, true);
  bytes.setUint16(32, channels * 2, true); bytes.setUint16(34, 16, true); text(36, 'data'); bytes.setUint32(40, samples.length * channels * 2, true);
  for (let i = 0; i < samples.length; i++) { bytes.setInt16(44 + i * 4, samples[i]!, true); bytes.setInt16(46 + i * 4, samples[i]!, true); }
  return new Uint8Array(bytes.buffer);
}

if (import.meta.main) {
  await mkdir(root, { recursive: true });
  const signal = gaplessSignal();
  await Bun.write(join(root, 'gapless-sweep-reference.wav'), wav(signal));
  const encoders: Record<string, string[]> = {
    flac: ['-c:a', 'flac'],
    mp3: ['-c:a', 'libmp3lame', '-b:a', '256k'],
    m4a: ['-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart'],
  };
  let offset = 0;
  for (const [index, frames] of gaplessPartFrames.entries()) {
    const part = join(root, `gapless-sweep-${index + 1}.wav`);
    await Bun.write(part, wav(signal.subarray(offset, offset + frames)));
    offset += frames;
    for (const source of gaplessSources.filter(source => source.part === index + 1)) {
      const ext = source.file.split('.').pop()!;
      const out = join(root, source.file);
      const run = Bun.spawnSync([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', part, ...encoders[ext]!, out]);
      if (run.exitCode !== 0) throw new Error(`ffmpeg ${source.file}: ${run.stderr.toString()}`);
    }
    await rm(part);
  }
  console.log(`Wrote the gapless sweep (${gaplessSources.length} files and the reference) to ${root}`);
}
