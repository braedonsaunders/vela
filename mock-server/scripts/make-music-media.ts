// Synthesizes the music and audiobook fixtures: six short original pieces (AAC, MP3 and FLAC)
// and one spoken-word stand-in per audiobook file, with a chime at every chapter start and the
// chapters embedded. Samples are computed here; ffmpeg only encodes. Durations come from
// packages/protocol/fixtures/media.ts and are verified with ffprobe after encoding.
// Usage: bun mock-server/scripts/make-music-media.ts [output-dir]
// (default ~/.scratch/tmp/vela/media-music, or VELA_MOCK_MUSIC_ROOT).
import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { audiobookFiles, mediaTitle, musicClips } from '../../packages/protocol/fixtures/media';
import type { Chapter } from '../../packages/protocol/types';
import { musicRoot } from '../media-kinds';

const root = process.argv[2] ?? musicRoot;
const ffmpeg = Bun.which('ffmpeg') ?? '/opt/homebrew/bin/ffmpeg', ffprobe = Bun.which('ffprobe') ?? '/opt/homebrew/bin/ffprobe';
await mkdir(root, { recursive: true });

const TAU = Math.PI * 2;
const SINE = new Float32Array(8192).map((_, i) => Math.sin(TAU * i / 8192));
/** Table sine of a phase in cycles. */
const sin = (cycles: number) => SINE[((cycles % 1 + 1) * 8192 | 0) & 8191]!;
const midi = (note: number) => 440 * 2 ** ((note - 69) / 12);
function random(seed: number) {
  let state = seed | 0;
  return () => { state = state + 0x6d2b79f5 | 0; let t = Math.imul(state ^ state >>> 15, 1 | state); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

class Track {
  readonly left: Float32Array; readonly right: Float32Array;
  constructor(readonly seconds: number, readonly rate = 44100) { this.left = new Float32Array(Math.round(seconds * rate)); this.right = new Float32Array(this.left.length); }
  /** Adds `fn(t)` (seconds since the note began) for `length` seconds at `start`, panned -1..1. */
  add(start: number, length: number, pan: number, gain: number, fn: (t: number) => number) {
    const from = Math.max(0, Math.round(start * this.rate)), to = Math.min(this.left.length, Math.round((start + length) * this.rate));
    const l = gain * Math.cos((pan + 1) * Math.PI / 4), r = gain * Math.sin((pan + 1) * Math.PI / 4);
    for (let i = from; i < to; i++) { const v = fn((i - from) / this.rate); this.left[i]! += v * l; this.right[i]! += v * r; }
  }
  /** Feedback echo, ping-ponged between channels. */
  echo(seconds: number, feedback: number, mix: number) {
    const d = Math.round(seconds * this.rate);
    for (let i = d; i < this.left.length; i++) { this.left[i]! += this.right[i - d]! * feedback * mix; this.right[i]! += this.left[i - d]! * feedback * mix; }
  }
  /** A small Schroeder reverb (four combs, two all-passes per channel). */
  reverb(mix: number, size = 1) {
    for (const [channel, offset] of [[this.left, 0], [this.right, 23]] as const) {
      const dry = Float32Array.from(channel), wet = new Float32Array(channel.length);
      for (const [ms, g] of [[29.7, 0.77], [37.1, 0.75], [41.1, 0.73], [43.7, 0.71]] as const) {
        const d = Math.round((ms * size + offset * 0.1) * this.rate / 1000), buffer = new Float32Array(channel.length);
        for (let i = 0; i < channel.length; i++) { buffer[i] = dry[i]! + (i >= d ? buffer[i - d]! * g : 0); wet[i]! += buffer[i]! * 0.25; }
      }
      for (const [ms, g] of [[5, 0.7], [1.7, 0.7]] as const) {
        const d = Math.round(ms * this.rate / 1000), input = Float32Array.from(wet);
        for (let i = 0; i < wet.length; i++) wet[i] = -g * input[i]! + (i >= d ? input[i - d]! + g * wet[i - d]! : 0);
      }
      for (let i = 0; i < channel.length; i++) channel[i] = dry[i]! * (1 - mix) + wet[i]! * mix;
    }
  }
  /** Fades, soft clipping and normalisation to -1 dBFS; 16-bit WAV bytes. */
  wav(channels: 1 | 2 = 2, fadeIn = 0.3, fadeOut = 2.5): Uint8Array {
    const n = this.left.length;
    for (let i = 0; i < n; i++) {
      const t = i / this.rate, fade = Math.min(1, t / fadeIn, (this.seconds - t) / fadeOut);
      this.left[i] = Math.tanh(this.left[i]! * 1.2) * fade; this.right[i] = Math.tanh(this.right[i]! * 1.2) * fade;
    }
    let peak = 1e-9; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(this.left[i]!), Math.abs(this.right[i]!));
    const scale = 0.89 / peak, bytes = new DataView(new ArrayBuffer(44 + n * channels * 2));
    const text = (at: number, value: string) => [...value].forEach((ch, i) => bytes.setUint8(at + i, ch.charCodeAt(0)));
    text(0, 'RIFF'); bytes.setUint32(4, 36 + n * channels * 2, true); text(8, 'WAVEfmt '); bytes.setUint32(16, 16, true);
    bytes.setUint16(20, 1, true); bytes.setUint16(22, channels, true); bytes.setUint32(24, this.rate, true); bytes.setUint32(28, this.rate * channels * 2, true);
    bytes.setUint16(32, channels * 2, true); bytes.setUint16(34, 16, true); text(36, 'data'); bytes.setUint32(40, n * channels * 2, true);
    for (let i = 0; i < n; i++) {
      if (channels === 1) bytes.setInt16(44 + i * 2, Math.round((this.left[i]! + this.right[i]!) / 2 * scale * 32767), true);
      else { bytes.setInt16(44 + i * 4, Math.round(this.left[i]! * scale * 32767), true); bytes.setInt16(46 + i * 4, Math.round(this.right[i]! * scale * 32767), true); }
    }
    return new Uint8Array(bytes.buffer);
  }
}

// Voices: functions of time since note-on, for a frequency and a held length.
const env = (t: number, attack: number, decay: number) => Math.min(1, t / attack) * Math.exp(-t / decay);
const voices = {
  pluck: (f: number) => (t: number) => { let v = 0; for (let k = 1; k <= 6; k++) v += sin(f * k * t) * Math.exp(-t * (2 + k * 1.6)) / k; return v * Math.min(1, t / 0.003); },
  bell: (f: number) => (t: number) => sin(f * t + 2.2 * Math.exp(-t * 2.5) * sin(f * 3.5 * t)) * env(t, 0.002, 1.4),
  keys: (f: number) => (t: number) => (sin(f * t + 1.4 * Math.exp(-t * 3) * sin(f * t)) + 0.3 * sin(2 * f * t) * Math.exp(-t * 2)) * env(t, 0.004, 1.8),
  bass: (f: number) => (t: number) => (sin(f * t) + 0.35 * sin(2 * f * t) * Math.exp(-t * 6)) * env(t, 0.006, 0.9),
  pad: (f: number, hold: number) => (t: number) => {
    let v = 0; for (const detune of [0.997, 1, 1.004]) for (let k = 1; k <= 5; k++) v += sin(f * detune * k * t) / (k * k * 0.8);
    return v * Math.min(1, t / 1.6) * Math.min(1, Math.max(0, (hold - t) / 1.8)) * 0.25;
  },
  square: (f: number) => (t: number) => { let v = 0; for (let k = 1; k <= 9; k += 2) v += sin(f * k * t) / k; return v * env(t, 0.002, 0.25); },
  kick: () => (t: number) => Math.sin(TAU * (45 * t + 75 * (1 - Math.exp(-t * 30)) / 30)) * Math.exp(-t * 9),
};
function noise(seed: number, decay: number) { const r = random(seed); let last = 0; return (t: number) => { const n = r() * 2 - 1, hp = n - last; last = n; return hp * Math.exp(-t / decay); }; }

/** One original piece per clip key. Each returns the finished stereo track. */
function compose(key: string, seconds: number): Track {
  const track = new Track(seconds), r = random(key.length * 7919 + key.charCodeAt(0));
  const chordTones = (root: number, quality: number[]) => quality.map(step => root + step);
  const maj = [0, 4, 7], min = [0, 3, 7], maj7 = [0, 4, 7, 11], min7 = [0, 3, 7, 10], dom7 = [0, 4, 7, 10];
  if (key === 'lantern-waltz') { // Folk waltz in D: oom-pah-pah with a plucked melody
    const beat = 60 / 132, bar = beat * 3, progression = [[50, maj], [47, min], [43, maj], [45, maj]] as const;
    for (let b = 0; b * bar < seconds - 2; b++) {
      const [root, quality] = progression[b % 4]!, tones = chordTones(root, [...quality]), t0 = b * bar;
      track.add(t0, bar, -0.2, 0.5, voices.bass(midi(root - 12)));
      for (const n of [1, 2]) for (const [i, note] of tones.entries()) track.add(t0 + n * beat, beat, 0.3 - i * 0.15, 0.13, voices.pluck(midi(note + 12)));
      const contour = [0, 1, 2, 1, 2, 3, 2, 0][b % 8]!;
      track.add(t0, beat * 2, 0.1, 0.32, voices.pluck(midi(tones[contour % 3]! + 24 + (contour > 2 ? 12 : 0))));
      if (b % 2) track.add(t0 + beat * 2, beat, 0.1, 0.22, voices.pluck(midi(tones[(contour + 1) % 3]! + 24)));
    }
    track.reverb(0.22);
  } else if (key === 'harbour-pluck') { // Minor-key arpeggios with kick, hats and bass
    const beat = 60 / 112, step = beat / 4, progression = [[57, min], [53, maj], [48, maj], [55, maj]] as const;
    for (let s = 0; s * step < seconds - 1.5; s++) {
      const bar = Math.floor(s / 16), [root, quality] = progression[bar % 4]!, tones = chordTones(root, [...quality]), t0 = s * step;
      const pattern = [0, 1, 2, 3, 2, 1][s % 6]!, note = pattern === 3 ? tones[0]! + 12 : tones[pattern]!;
      track.add(t0, step * 3, Math.sin(s * 0.7) * 0.6, 0.2, voices.pluck(midi(note + 12)));
      if (s % 8 === 0) track.add(t0, beat * 2, 0, 0.55, voices.kick());
      if (s % 2 === 0) track.add(t0, 0.08, 0.4, 0.05, noise(s, 0.02));
      if (s % 4 === 0) track.add(t0, beat, -0.1, 0.35, voices.bass(midi(root - 12)));
    }
    track.echo(beat * 0.75, 0.35, 0.6); track.reverb(0.15);
  } else if (key === 'music-box') { // A little music-box tune in F, three-four time
    const beat = 60 / 90, bar = beat * 3, progression = [[53, maj], [50, min], [46, maj], [48, maj]] as const;
    const tune = [0, 2, 4, 5, 4, 2, 0, -1, 0, 2, 4, 7, 5, 4, 2, 0];
    for (let b = 0; b * bar < seconds - 3; b++) {
      const [root, quality] = progression[b % 4]!, t0 = b * bar, scale = [0, 2, 4, 5, 7, 9, 11, 12];
      track.add(t0, bar, -0.3, 0.16, voices.bell(midi(root)));
      track.add(t0 + beat, beat, 0.3, 0.1, voices.bell(midi(root + quality[1]! + 12)));
      for (let n = 0; n < 2; n++) {
        const degree = tune[(b * 2 + n) % tune.length]!, pitch = 77 + (degree < 0 ? -1 : scale[degree % 8]! + (degree >= 8 ? 12 : 0));
        track.add(t0 + n * beat * 1.5, beat * 2, 0.15, 0.3, voices.bell(midi(pitch)));
      }
    }
    track.reverb(0.35, 1.3);
  } else if (key === 'blue-hour-keys') { // Late-night ii–V–I with electric piano, walking bass and brushes
    const beat = 60 / 84, bar = beat * 4, progression = [[50, min7], [43, dom7], [48, maj7], [45, dom7]] as const;
    for (let b = 0; b * bar < seconds - 3; b++) {
      const [root, quality] = progression[b % 4]!, [next] = progression[(b + 1) % 4]!, tones = chordTones(root, [...quality]), t0 = b * bar;
      for (const [i, note] of tones.slice(1).entries()) track.add(t0 + (b % 2 ? beat * 0.5 : 0), bar, -0.3 + i * 0.3, 0.16, voices.keys(midi(note + 12)));
      const walk = [root, root + quality[1]!, root + 7, next + (next > root ? -1 : 1)];
      walk.forEach((note, n) => track.add(t0 + n * beat, beat, -0.1, 0.42, voices.bass(midi(note - 12))));
      for (const n of [1, 3]) track.add(t0 + n * beat, 0.3, 0.3, 0.06, noise(b * 4 + n, 0.12));
      if (b % 2 === 1) for (let k = 0; k < 4; k++) track.add(t0 + beat * (2 + k * 0.5), beat, 0.2, 0.18, voices.keys(midi(tones[(k + 1) % 4]! + 24)));
    }
    track.reverb(0.25);
  } else if (key === 'glasshouse-drone') { // Slow pads with glassy sparkles
    const chords = [[51, [0, 7, 14, 16]], [56, [0, 4, 11, 14]], [48, [0, 3, 10, 14]], [53, [0, 7, 9, 16]]] as const;
    for (let c = 0; c * 8 < seconds; c++) {
      const [root, steps] = chords[c % 4]!;
      for (const [i, step] of steps.entries()) track.add(c * 8, 10, -0.5 + i * 0.33, 0.3, voices.pad(midi(root + step), 10));
    }
    for (let i = 0; i < seconds * 1.2; i++) track.add(r() * (seconds - 4), 4, r() * 2 - 1, 0.07 + r() * 0.06, voices.bell(midi(75 + [0, 2, 7, 9, 12, 14][Math.floor(r() * 6)]!)));
    track.reverb(0.5, 1.6); track.echo(0.75, 0.4, 0.5);
  } else { // arcade-bounce: chiptune arpeggios in E
    const beat = 60 / 140, step = beat / 4, progression = [[64, maj], [71, maj], [61, min], [69, maj]] as const;
    const melody = [0, 0, 7, 7, 9, 9, 7, -1, 5, 5, 4, 4, 2, 2, 0, -1];
    for (let s = 0; s * step < seconds - 1; s++) {
      const bar = Math.floor(s / 16), [root, quality] = progression[bar % 4]!, t0 = s * step;
      track.add(t0, step, 0.35, 0.09, voices.square(midi(root + quality[s % 3]! + 12)));
      if (s % 2 === 0) { const degree = melody[(s / 2) % 16]!; if (degree >= 0) track.add(t0, step * 2, -0.25, 0.14, voices.square(midi(64 + 12 + [0, 2, 4, 5, 7, 9, 11, 12, 14, 16][degree]!))); }
      if (s % 4 === 0) track.add(t0, beat, 0, 0.3, voices.bass(midi(root - 24)));
      if (s % 4 === 2) track.add(t0, 0.06, 0.2, 0.07, noise(s, 0.015));
    }
    track.echo(step * 3, 0.25, 0.4);
  }
  return track;
}

/** A spoken-word stand-in: a formant "voice" murmuring in phrases, with a chime at each chapter. */
function narrate(seconds: number, chapters: Chapter[], seed: number, pitch: number): Track {
  const rate = 22050, track = new Track(seconds, rate), r = random(seed);
  const vowels = [[730, 1090], [270, 2290], [300, 870], [530, 1840], [570, 840], [440, 1020], [660, 1720]];
  const quiet = (t: number) => chapters.some(chapter => t > chapter.startSeconds - 0.9 && t < chapter.startSeconds + 2.4);
  let t = 0.4;
  while (t < seconds - 2) {
    if (quiet(t)) { t += 0.25; continue; }
    const syllables = 5 + Math.floor(r() * 10), base = pitch * (0.92 + r() * 0.16);
    for (let s = 0; s < syllables && t < seconds - 2 && !quiet(t); s++) {
      const length = 0.13 + r() * 0.16, [f1, f2] = vowels[Math.floor(r() * vowels.length)]!, [g1, g2] = vowels[Math.floor(r() * vowels.length)]!;
      const f0 = base * (1.08 - 0.16 * s / syllables) * (s === 0 ? 1.06 : 1);
      if (r() < 0.35) track.add(t, 0.05, 0, 0.05, noise(Math.floor(t * 1000), 0.015));
      // Harmonic weights from two formants, interpolated from the syllable's start vowel to its end vowel.
      const weights = (a: number, b: number) => Array.from({ length: Math.floor(3400 / f0) }, (_, i) => { const h = (i + 1) * f0; return Math.exp(-((h - a) ** 2) / 18000) + 0.6 * Math.exp(-((h - b) ** 2) / 30000) + 0.08 / (i + 1); });
      const w0 = weights(f1, f2), w1 = weights(g1, g2);
      track.add(t, length, 0, 0.5, u => {
        const shape = Math.sin(Math.PI * Math.min(1, u / length)), mixAmount = u / length, time = u + 0.0003 * Math.sin(TAU * 5 * u);
        let v = 0;
        for (let k = 0; k < w0.length; k++) v += sin((k + 1) * f0 * time) * (w0[k]! + (w1[k]! - w0[k]!) * mixAmount);
        return v * shape * shape * 0.18;
      });
      t += length + (r() < 0.15 ? 0.06 : 0.015);
    }
    t += 0.35 + r() * 0.5 + (r() < 0.2 ? 0.6 : 0);
  }
  for (const chapter of chapters) {
    const at = chapter.startSeconds + (chapter.startSeconds === 0 ? 0.3 : 0);
    track.add(at, 3, -0.2, 0.22, voices.bell(midi(76)));
    track.add(at + 0.45, 3, 0.2, 0.2, voices.bell(midi(83)));
  }
  track.add(0, seconds, 0, 0.004, noise(seed, 1e9));
  track.reverb(0.12, 0.6);
  return track;
}

async function encode(wav: Uint8Array, file: string, args: string[], metadata?: string): Promise<void> {
  const target = join(root, file), temp = `${target}.partial`, wavFile = `${target}.wav`, metaFile = `${target}.ffmeta`;
  await Bun.write(wavFile, wav);
  if (metadata) await Bun.write(metaFile, metadata);
  const format = file.endsWith('.m4a') ? 'mp4' : file.endsWith('.mp3') ? 'mp3' : 'flac';
  const child = Bun.spawn([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', wavFile, ...(metadata ? ['-i', metaFile, '-map_metadata', '1', '-map_chapters', '1'] : []), ...args, '-f', format, temp], { stdout: 'inherit', stderr: 'inherit' });
  const failed = await child.exited;
  await rm(wavFile, { force: true }); await rm(metaFile, { force: true });
  if (failed) throw new Error(`ffmpeg failed for ${file}`);
  await rename(temp, target);
}
async function probeDuration(file: string): Promise<number> {
  const probe = Bun.spawn([ffprobe, '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', join(root, file)], { stdout: 'pipe' });
  return Number((await new Response(probe.stdout).text()).trim());
}
const escapeMeta = (value: string) => value.replace(/[=;#\\\n]/g, m => `\\${m}`);

for (const clip of musicClips) {
  const name = clip.key.split('-').map(word => word[0]!.toUpperCase() + word.slice(1)).join(' ');
  const tags = `;FFMETADATA1\ntitle=${escapeMeta(name)}\nartist=Vela fixtures\ncomment=Original synthesized clip for the Vela mock server\n`;
  const codec = clip.codec === 'aac' ? ['-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'] : clip.codec === 'mp3' ? ['-c:a', 'libmp3lame', '-b:a', '192k'] : ['-c:a', 'flac'];
  await encode(compose(clip.key, clip.durationSeconds).wav(), clip.file, codec, tags);
  console.log(clip.file);
}
for (const book of audiobookFiles) {
  const title = mediaTitle(book.titleId)!, parent = title.media?.parents?.[0] ? mediaTitle(title.media.parents[0].id) : undefined;
  const narrator = title.media?.credits?.find(credit => credit.role === 'narrator')?.name ?? '';
  const pitch = ({ 'Beatrix Thornfield': 196, 'Elias Varno': 112, 'Samir Holloway': 126, 'Rosalind Achterberg': 210, 'Callum Driscoll': 98 } as Record<string, number>)[narrator] ?? 150;
  const metadata = `;FFMETADATA1\ntitle=${escapeMeta(title.name)}\nalbum=${escapeMeta(parent?.name ?? title.name)}\nartist=${escapeMeta(narrator)}\ngenre=Audiobook\n${book.chapters.map(chapter =>
    `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${chapter.startSeconds * 1000}\nEND=${(chapter.endSeconds ?? book.durationSeconds) * 1000}\ntitle=${escapeMeta(chapter.name)}\n`).join('')}`;
  const seed = [...book.titleId].reduce((sum, ch) => sum * 31 + ch.charCodeAt(0) | 0, 7);
  await encode(narrate(book.durationSeconds, book.chapters, seed, pitch).wav(1, 0.05, 1.5), book.file, ['-ac', '1', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart'], metadata);
  console.log(book.file);
}
// Plans advertise these durations; refuse files that do not match them.
for (const source of [...musicClips, ...audiobookFiles]) {
  const actual = await probeDuration(source.file);
  if (!(Math.abs(actual - source.durationSeconds) <= 0.1)) throw new Error(`${source.file}: ${actual}s, fixture says ${source.durationSeconds}s`);
}
console.log(`Music and audiobook media ready: ${root}`);
