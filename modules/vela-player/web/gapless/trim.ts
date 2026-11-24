// Where a compressed track's real audio begins and ends. Encoders add silence: MP3 and AAC start with
// encoder delay ("priming") and end with padding to a whole frame, and a gapless player must drop both
// or every join between tracks carries a few dozen milliseconds of silence. Mediabunny's demuxers
// already shift the start (the LAME delay for MP3, the edit list's media time for MP4); the end, and
// iTunes' iTunSMPB note in files without an edit list, are read here from the file's own bytes.

/** The real audio on the demuxer's timeline, in seconds: from `start` up to `end`. */
export interface GaplessTrim { start: number; end: number }

/** The ranges of the file `gaplessTrim` needs: the head, then (MP4 with its index at the end) that box. */
export type ByteReader = (start: number, end: number) => Promise<Uint8Array>;

const HEAD_BYTES = 256 * 1024;
const text = (bytes: Uint8Array, at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));
const u32 = (bytes: Uint8Array, at: number) => ((bytes[at]! << 24) >>> 0) + (bytes[at + 1]! << 16) + (bytes[at + 2]! << 8) + bytes[at + 3]!;
const u64 = (bytes: Uint8Array, at: number) => u32(bytes, at) * 2 ** 32 + u32(bytes, at + 4);
const i32 = (bytes: Uint8Array, at: number) => u32(bytes, at) | 0;

/** LAME's (and FFmpeg's) gapless header on the first MP3 frame: encoder delay and padding, in samples. */
export interface LameGapless { delay: number; padding: number; frames: number; samplesPerFrame: number; sampleRate: number }

export function readLame(bytes: Uint8Array): LameGapless | null {
  let at = 0;
  // An ID3v2 tag (with its footer) comes first.
  if (text(bytes, 0, 3) === 'ID3' && bytes.length >= 10) {
    const size = (bytes[6]! & 0x7f) << 21 | (bytes[7]! & 0x7f) << 14 | (bytes[8]! & 0x7f) << 7 | (bytes[9]! & 0x7f);
    at = 10 + size + (bytes[5]! & 0x10 ? 10 : 0);
  }
  for (; at + 4 <= bytes.length; at++) if (bytes[at] === 0xff && (bytes[at + 1]! & 0xe0) === 0xe0) break;
  if (at + 4 > bytes.length) return null;
  const version = (bytes[at + 1]! >> 3) & 3; // 3: MPEG-1, 2: MPEG-2, 0: MPEG-2.5
  const layer = (bytes[at + 1]! >> 1) & 3; // 1: Layer III
  if (layer !== 1 || version === 1) return null;
  const rates = [44100, 48000, 32000][(bytes[at + 2]! >> 2) & 3];
  if (!rates) return null;
  const sampleRate = version === 3 ? rates : version === 2 ? rates / 2 : rates / 4;
  const mono = (bytes[at + 3]! >> 6) === 3;
  const xing = at + 4 + (version === 3 ? (mono ? 17 : 32) : (mono ? 9 : 17));
  const tag = text(bytes, xing, 4);
  if ((tag !== 'Xing' && tag !== 'Info') || xing + 8 > bytes.length) return null;
  const flags = u32(bytes, xing + 4);
  let field = xing + 8;
  const frames = flags & 1 ? u32(bytes, field) : 0;
  if (flags & 1) field += 4;
  if (flags & 2) field += 4;
  if (flags & 4) field += 100;
  if (flags & 8) field += 4;
  if (field + 24 > bytes.length || !frames) return null;
  const encoder = text(bytes, field, 4);
  if (encoder !== 'LAME' && encoder !== 'Lavf' && encoder !== 'Lavc' && encoder !== 'L3.9') return null;
  const delay = bytes[field + 21]! << 4 | bytes[field + 22]! >> 4;
  const padding = (bytes[field + 22]! & 0x0f) << 8 | bytes[field + 23]!;
  return { delay, padding, frames, samplesPerFrame: version === 3 ? 1152 : 576, sampleRate };
}

/** The MP4 facts that bound an audio track: its edit (start and length) and iTunes' gapless note. */
export interface Mp4Gapless {
  /** The first edit: where the media begins (seconds into the media) and how long it plays. */
  edit?: { mediaStart: number; duration: number };
  /** iTunSMPB: priming and padding samples and the original sample count. */
  itunes?: { priming: number; padding: number; samples: number };
  sampleRate?: number;
}

interface Box { type: string; start: number; body: number; end: number }

function* boxes(bytes: Uint8Array, from: number, to: number): Generator<Box> {
  let at = from;
  while (at + 8 <= to) {
    let size = u32(bytes, at), body = at + 8;
    const type = text(bytes, at + 4, 4);
    if (size === 1) { size = u64(bytes, at + 8); body += 8; } else if (size === 0) size = to - at;
    if (size < 8) return;
    yield { type, start: at, body, end: Math.min(to, at + size) };
    at += size;
  }
}

const child = (bytes: Uint8Array, parent: Box, type: string) => {
  for (const box of boxes(bytes, parent.body, parent.end)) if (box.type === type) return box;
  return undefined;
};

/** Reads a `moov` box (the bytes from its start): the sound track's edit and the iTunes note. */
export function readMoov(bytes: Uint8Array): Mp4Gapless | null {
  const moov = [...boxes(bytes, 0, bytes.length)].find(box => box.type === 'moov');
  if (!moov) return null;
  const mvhd = child(bytes, moov, 'mvhd');
  const movieScale = mvhd ? u32(bytes, mvhd.body + (bytes[mvhd.body] === 1 ? 20 : 12)) : 0;
  const result: Mp4Gapless = {};
  for (const trak of boxes(bytes, moov.body, moov.end)) {
    if (trak.type !== 'trak') continue;
    const mdia = child(bytes, trak, 'mdia');
    const hdlr = mdia && child(bytes, mdia, 'hdlr');
    if (!mdia || !hdlr || text(bytes, hdlr.body + 8, 4) !== 'soun') continue;
    const mdhd = child(bytes, mdia, 'mdhd');
    const mediaScale = mdhd ? u32(bytes, mdhd.body + (bytes[mdhd.body] === 1 ? 20 : 12)) : 0;
    const stsd = child(bytes, mdia, 'minf') && child(bytes, child(bytes, mdia, 'minf')!, 'stbl') && child(bytes, child(bytes, child(bytes, mdia, 'minf')!, 'stbl')!, 'stsd');
    // An audio sample entry keeps its rate as 16.16 at a fixed place.
    if (stsd) { const entry = stsd.body + 8; result.sampleRate = u32(bytes, entry + 32) >>> 16; }
    if (!result.sampleRate && mediaScale) result.sampleRate = mediaScale;
    const elst = child(bytes, trak, 'edts') && child(bytes, child(bytes, trak, 'edts')!, 'elst');
    if (elst && movieScale && mediaScale) {
      const v1 = bytes[elst.body] === 1, count = u32(bytes, elst.body + 4);
      for (let i = 0, at = elst.body + 8; i < count; i++, at += v1 ? 20 : 12) {
        const duration = v1 ? u64(bytes, at) : u32(bytes, at);
        const time = v1 ? u64(bytes, at + 8) : i32(bytes, at + 4);
        if (time === -1 || (!v1 && time < 0)) continue; // an empty edit
        result.edit = { mediaStart: time / mediaScale, duration: duration / movieScale };
        break;
      }
    }
    break;
  }
  const note = findText(bytes, 'iTunSMPB', moov.body, moov.end);
  if (note >= 0) {
    const data = findText(bytes, 'data', note, Math.min(moov.end, note + 64));
    if (data >= 0) {
      const size = u32(bytes, data - 4);
      const fields = text(bytes, data + 12, Math.max(0, size - 16)).trim().split(/\s+/).map(value => parseInt(value, 16));
      if (fields.length >= 4 && fields.slice(1, 4).every(Number.isFinite)) result.itunes = { priming: fields[1]!, padding: fields[2]!, samples: fields[3]! };
    }
  }
  return result;
}

function findText(bytes: Uint8Array, value: string, from: number, to: number): number {
  outer: for (let at = from; at + value.length <= to; at++) {
    for (let i = 0; i < value.length; i++) if (bytes[at + i] !== value.charCodeAt(i)) continue outer;
    return at;
  }
  return -1;
}

/** Where the `moov` box is: the top-level boxes are walked from the file's start, reading each header
 * (the media box before it may be far longer than the head). */
export async function locateMoov(read: ByteReader, head: Uint8Array): Promise<{ start: number; end: number } | null> {
  let at = 0;
  for (let step = 0; step < 64; step++) {
    const header = at + 16 <= head.length ? head.subarray(at, at + 16) : await read(at, at + 16);
    if (header.length < 8) return null;
    let size = u32(header, 0);
    const type = text(header, 4, 4);
    if (size === 1 && header.length >= 16) size = u64(header, 8);
    if (type === 'moov') return { start: at, end: at + size };
    if (size < 8) return null;
    at += size;
  }
  return null;
}

/**
 * The real audio of a track on Mediabunny's timeline, given its codec and the demuxer's `duration`
 * (which counts the encoder's padding). Mediabunny already starts MP3 after the LAME delay and MP4
 * after the edit's media time; files that say nothing keep the whole decoded length.
 */
export function trimFor(container: 'mp3' | 'mp4' | 'other', facts: { lame?: LameGapless | null; mp4?: Mp4Gapless | null }, duration: number): GaplessTrim {
  const whole = { start: 0, end: duration > 0 ? duration : Infinity };
  if (container === 'mp3' && facts.lame) {
    const { delay, padding, frames, samplesPerFrame, sampleRate } = facts.lame;
    const samples = frames * samplesPerFrame - delay - padding;
    return samples > 0 ? { start: 0, end: samples / sampleRate } : whole;
  }
  if (container === 'mp4' && facts.mp4) {
    const { edit, itunes, sampleRate } = facts.mp4;
    if (edit && edit.duration > 0) return { start: 0, end: edit.duration };
    // No edit list: Mediabunny starts at the first sample, the priming included.
    if (itunes && sampleRate && itunes.samples > 0) return { start: itunes.priming / sampleRate, end: (itunes.priming + itunes.samples) / sampleRate };
  }
  return whole;
}

/** Reads what `trimFor` needs from the file itself: the head, and an MP4's `moov` where it is elsewhere. */
export async function readTrimFacts(container: 'mp3' | 'mp4' | 'other', read: ByteReader): Promise<{ lame?: LameGapless | null; mp4?: Mp4Gapless | null }> {
  if (container === 'other') return {};
  const head = await read(0, HEAD_BYTES);
  if (container === 'mp3') {
    let lame = readLame(head);
    // A large ID3 tag (cover art) pushes the first frame past the head.
    if (!lame && text(head, 0, 3) === 'ID3') {
      const size = (head[6]! & 0x7f) << 21 | (head[7]! & 0x7f) << 14 | (head[8]! & 0x7f) << 7 | (head[9]! & 0x7f);
      const at = 10 + size + (head[5]! & 0x10 ? 10 : 0);
      if (at >= head.length) lame = readLame(await read(at, at + 16 * 1024));
    }
    return { lame };
  }
  const place = await locateMoov(read, head);
  if (!place) return { mp4: null };
  const moov = place.end <= head.length ? head.subarray(place.start, place.end) : await read(place.start, place.end);
  return { mp4: readMoov(moov) };
}

/**
 * Which frames of a decoded block (starting at `start` seconds, `frames` long) lie in [begin, end):
 * [first, last) as frame indices. Times are rounded to whole frames, so blocks that meet join exactly.
 */
export function keptFrames(start: number, frames: number, rate: number, begin: number, end: number): [number, number] {
  const first = Math.min(frames, Math.max(0, Math.round((begin - start) * rate)));
  const last = Math.max(first, Math.min(frames, Number.isFinite(end) ? Math.round((end - start) * rate) : frames));
  return [first, last];
}
