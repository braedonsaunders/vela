import type { ByteReader } from '../../core/types';
import { SubtitleReadScope, integer, text, type Box } from './binary';
import { subtitleIdentity } from './identity';
import type {
  SubtitleContainer,
  SubtitleDescription,
  SubtitleFont,
  SubtitlePacketWindow,
  SubtitleTrack,
} from './types';
interface Edit {
  duration: number;
  mediaTime: number;
  rate: number;
}
interface Sample {
  time: number;
  duration: number;
  offset: number;
  size: number;
  description: number;
}
interface Track {
  public: SubtitleTrack;
  scale: number;
  tables: Map<string, Box>;
  configuration: Uint8Array;
  edits: Edit[];
  samples?: Sample[];
}
const u32 = (bytes: Uint8Array, at: number) => {
  if (at + 4 > bytes.length) throw new Error('Truncated subtitle sample table');
  return new DataView(bytes.buffer, bytes.byteOffset + at, 4).getUint32(0);
};
const i32 = (bytes: Uint8Array, at: number) =>
  new DataView(bytes.buffer, bytes.byteOffset + at, 4).getInt32(0);
function signed(bytes: Uint8Array) {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  if (bytes[0] & 128) value -= 1n << BigInt(bytes.length * 8);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('Subtitle edit time exceeds precision');
  return number;
}
/** ISO BMFF text tracks, preserving full trak order and actual track_ID. */
export class MP4Subtitles implements SubtitleContainer {
  readonly tracks: SubtitleTrack[] = [];
  readonly fonts: SubtitleFont[] = [];
  private actual = new Map<string, Track>();
  private size = 0;
  private movieScale = 0;
  private disposed = false;
  private fragmented = false;
  constructor(
    private reader: ByteReader,
    private descriptions: readonly SubtitleDescription[] = [],
  ) {}
  private scope(signal: AbortSignal) {
    if (this.disposed) throw new DOMException('Subtitle container retired', 'AbortError');
    return new SubtitleReadScope(this.reader, this.size, signal);
  }
  async open(signal: AbortSignal): Promise<this> {
    this.size = await this.reader.size(signal);
    const scope = this.scope(signal);
    let moov: Box | null = null;
    for (let at = 0; at < this.size; ) {
      const box = await scope.box(at);
      if (box.type === 'moov') moov = box;
      if (box.type === 'moof') this.fragmented = true;
      at = box.end;
    }
    if (!moov) throw new Error('Subtitle source has no MP4 movie metadata');
    const traks: Box[] = [];
    await scope.boxes(moov, async (box) => {
      if (box.type === 'mvhd') {
        const bytes = await scope.read(box.data, Math.min(32, box.end - box.data));
        this.movieScale = u32(bytes, bytes[0] === 1 ? 20 : 12);
      }
      if (box.type === 'trak') traks.push(box);
      if (box.type === 'mvex') this.fragmented = true;
    });
    const seen = new Set<number>();
    for (let index = 0; index < traks.length; index++) await this.track(scope, traks[index], index, seen);
    return this;
  }
  private async track(scope: SubtitleReadScope, trak: Box, index: number, seen: Set<number>) {
    let id = 0,
      scale = 0,
      language = 'und',
      handler = '',
      label = '',
      stbl: Box | null = null,
      elst: Box | null = null;
    const tables = new Map<string, Box>();
    await scope.boxes(trak, async (box) => {
      if (box.type === 'tkhd') {
        const bytes = await scope.read(box.data, Math.min(32, box.end - box.data));
        id = u32(bytes, bytes[0] === 1 ? 20 : 12);
      }
      if (box.type === 'edts')
        await scope.boxes(box, async (child) => {
          if (child.type === 'elst') elst = child;
        });
      if (box.type === 'mdia')
        await scope.boxes(box, async (child) => {
          if (child.type === 'mdhd') {
            const bytes = await scope.read(child.data, Math.min(36, child.end - child.data)),
              version = bytes[0];
            scale = u32(bytes, version === 1 ? 20 : 12);
            const at = version === 1 ? 32 : 20;
            if (at + 2 <= bytes.length) {
              const code = bytes[at] * 256 + bytes[at + 1];
              language = String.fromCharCode(
                96 + ((code >> 10) & 31),
                96 + ((code >> 5) & 31),
                96 + (code & 31),
              );
              if (!/^[a-z]{3}$/.test(language)) language = 'und';
            }
          }
          if (child.type === 'hdlr') {
            const bytes = await scope.read(child.data, Math.min(512, child.end - child.data));
            handler = text(bytes.subarray(8, 12));
            label = text(bytes.subarray(24));
          }
          if (child.type === 'minf')
            await scope.boxes(child, async (nested) => {
              if (nested.type === 'stbl') stbl = nested;
            });
        });
    });
    if (id && seen.has(id)) throw new Error('Ambiguous MP4 subtitle track ID');
    if (id) seen.add(id);
    if (!stbl || !['text', 'subt', 'sbtl', 'clcp'].includes(handler)) return;
    await scope.boxes(stbl, async (box) => {
      tables.set(box.type, box);
    });
    const stsd = tables.get('stsd');
    if (!stsd) return;
    const header = await scope.read(stsd.data, 8),
      count = u32(header, 4);
    if (!count) return;
    if (count > 32) throw new Error('Subtitle sample descriptions exceed bound');
    const first = await scope.box(stsd.data + 8, stsd.end);
    if (!['tx3g', 'wvtt'].includes(first.type)) return;
    if (!id || !scale) throw new Error('Incomplete MP4 subtitle identity/timescale');
    const configuration = await scope.read(first.start, first.end - first.start);
    if (configuration.length > 1024 * 1024) throw new Error('Subtitle sample description exceeds bound');
    const edits: Edit[] = [];
    const edit = elst as Box | null;
    if (edit) {
      if (!this.movieScale) throw new Error('Subtitle movie timescale is missing');
      const bytes = await scope.read(edit.data, edit.end - edit.data),
        version = bytes[0],
        entries = u32(bytes, 4),
        stride = version === 1 ? 20 : 12;
      if (entries > 64 || 8 + entries * stride > bytes.length) throw new Error('Invalid subtitle edit list');
      for (let i = 0; i < entries; i++) {
        const at = 8 + i * stride,
          duration = version === 1 ? integer(bytes.subarray(at, at + 8)) : u32(bytes, at),
          mediaTime = version === 1 ? signed(bytes.subarray(at + 8, at + 16)) : i32(bytes, at + 4),
          rate = i32(bytes, at + (version === 1 ? 16 : 8)) / 65536;
        edits.push({
          duration: duration / this.movieScale,
          mediaTime: mediaTime === -1 ? -1 : mediaTime / scale,
          rate,
        });
      }
    }
    const codec = first.type === 'wvtt' ? 'webvtt' : 'tx3g',
      actual = subtitleIdentity('mp4', id, index, codec, language, label, false, false, this.descriptions);
    this.tracks.push(actual);
    this.actual.set(actual.id, { public: actual, scale, tables, configuration, edits });
  }
  configuration(id: string) {
    return this.actual.get(id)?.configuration.slice() ?? null;
  }
  private async table(scope: SubtitleReadScope, track: Track, type: string, required = true) {
    const box = track.tables.get(type);
    if (!box) {
      if (required) throw new Error(`Missing subtitle ${type} sample table`);
      return null;
    }
    return scope.read(box.data, box.end - box.data);
  }
  private async samples(scope: SubtitleReadScope, track: Track) {
    if (track.samples) return track.samples;
    if (track.edits.some((edit) => edit.rate !== 1))
      throw new Error('Subtitle edit rate requires server rendering');
    const sizes = (await this.table(scope, track, 'stsz'))!,
      fixed = u32(sizes, 4),
      count = u32(sizes, 8);
    if (count > 200000 || (!fixed && 12 + count * 4 > sizes.length))
      throw new Error('Subtitle sample count exceeds bound');
    if (!count && this.fragmented)
      throw new Error('Fragmented MP4 subtitle packets require an indexed fragment reader');
    const [stts, stsc, stco, co64, ctts] = await Promise.all([
      this.table(scope, track, 'stts'),
      this.table(scope, track, 'stsc'),
      this.table(scope, track, 'stco', false),
      this.table(scope, track, 'co64', false),
      this.table(scope, track, 'ctts', false),
    ]);
    const offsets = co64 ?? stco;
    if (!offsets) throw new Error('Missing subtitle chunk offsets');
    const stride = co64 ? 8 : 4,
      chunks = u32(offsets, 4);
    if (chunks > 200000 || 8 + chunks * stride > offsets.length)
      throw new Error('Invalid subtitle chunk offsets');
    const mapping: { first: number; samples: number; description: number }[] = [];
    const entries = u32(stsc!, 4);
    if (entries > 200000 || 8 + entries * 12 > stsc!.length)
      throw new Error('Invalid subtitle chunk mapping');
    for (let i = 0; i < entries; i++) {
      const at = 8 + i * 12;
      const entry = { first: u32(stsc!, at), samples: u32(stsc!, at + 4), description: u32(stsc!, at + 8) };
      if (
        !entry.first ||
        !entry.samples ||
        entry.description !== 1 ||
        (i && entry.first <= mapping[i - 1].first)
      )
        throw new Error('Unsupported subtitle sample-description mapping');
      mapping.push(entry);
    }
    const decode: number[] = [],
      duration: number[] = [];
    let clock = 0;
    const timing = u32(stts!, 4);
    if (timing > 200000 || 8 + timing * 8 > stts!.length)
      throw new Error('Invalid subtitle time-to-sample table');
    for (let i = 0; i < timing; i++) {
      const repeats = u32(stts!, 8 + i * 8),
        delta = u32(stts!, 12 + i * 8);
      if (decode.length + repeats > count) throw new Error('Subtitle timing count mismatch');
      for (let n = 0; n < repeats; n++) {
        decode.push(clock);
        duration.push(delta);
        clock += delta;
        if (!Number.isSafeInteger(clock)) throw new Error('Subtitle timeline exceeds precision');
      }
    }
    if (decode.length !== count) throw new Error('Subtitle timing count mismatch');
    if (ctts) {
      let sample = 0;
      const entries = u32(ctts, 4);
      if (entries > 200000 || 8 + entries * 8 > ctts.length)
        throw new Error('Invalid subtitle composition table');
      for (let i = 0; i < entries; i++) {
        const repeats = u32(ctts, 8 + i * 8),
          offset = ctts[0] === 1 ? i32(ctts, 12 + i * 8) : u32(ctts, 12 + i * 8);
        if (sample + repeats > count) throw new Error('Subtitle composition count mismatch');
        for (let n = 0; n < repeats; n++) decode[sample++] += offset;
      }
      if (sample !== count) throw new Error('Subtitle composition count mismatch');
    }
    const samples: Sample[] = [];
    let sample = 0,
      group = 0;
    for (let chunk = 1; chunk <= chunks; chunk++) {
      while (group + 1 < mapping.length && mapping[group + 1].first <= chunk) group++;
      const entry = mapping[group];
      if (!entry || entry.first > chunk) throw new Error('Subtitle chunk mapping is incomplete');
      let offset = co64
        ? integer(offsets.subarray(8 + (chunk - 1) * 8, 16 + (chunk - 1) * 8))
        : u32(offsets, 8 + (chunk - 1) * 4);
      for (let n = 0; n < entry.samples; n++) {
        if (sample >= count) throw new Error('Subtitle chunk sample count mismatch');
        const size = fixed || u32(sizes, 12 + sample * 4);
        if (size > 16 * 1024 * 1024 || offset + size > this.size)
          throw new Error('Subtitle sample exceeds source bounds');
        const time = decode[sample] / track.scale,
          span = duration[sample] / track.scale;
        if (!track.edits.length) samples.push({ time, duration: span, offset, size, description: 1 });
        else {
          let timeline = 0;
          for (const edit of track.edits) {
            if (edit.mediaTime !== -1) {
              const from = Math.max(time, edit.mediaTime),
                to = Math.min(time + span, edit.mediaTime + edit.duration);
              if (to > from)
                samples.push({
                  time: timeline + from - edit.mediaTime,
                  duration: to - from,
                  offset,
                  size,
                  description: 1,
                });
            }
            timeline += edit.duration;
          }
        }
        if (samples.length > 200000) throw new Error('Edited subtitle timeline exceeds bounds');
        offset += size;
        sample++;
      }
    }
    if (sample !== count) throw new Error('Subtitle chunk sample count mismatch');
    scope.signal.throwIfAborted();
    track.samples = samples.sort((a, b) => a.time - b.time);
    return track.samples;
  }
  async packets(id: string, start: number, end: number, signal: AbortSignal): Promise<SubtitlePacketWindow> {
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end - start > 60)
      throw new Error('Invalid subtitle packet window');
    const track = this.actual.get(id);
    if (!track) throw new Error('Unknown actual subtitle track');
    const scope = this.scope(signal),
      samples = await this.samples(scope, track),
      packets = [];
    for (const sample of samples)
      if (sample.time <= end && sample.time + sample.duration > start) {
        if (packets.length >= 8192) throw new Error('Subtitle packet window exceeds bound');
        packets.push({
          time: sample.time,
          duration: sample.duration,
          data: await scope.read(sample.offset, sample.size),
        });
      }
    return { packets, fromStart: true, completeHistory: true, historyFrom: 0 };
  }
  dispose() {
    this.disposed = true;
    this.actual.clear();
  }
}
