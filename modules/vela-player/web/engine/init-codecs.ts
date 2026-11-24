// What an fMP4 stream carries, read from its own bytes. A server that offers a media playlist
// without a quality ladder (Ether's live remux) never names its codecs, and MSE needs the exact
// RFC 6381 string before it takes a byte, so the segment pipeline reads it from the init segment:
// each track's sample entry (avcC, hvcC, av1C, vpcC, esds, …) and its timescale. A fragment's
// tfdt then says where its media starts, to splice a discontinuity onto the buffered timeline.

interface Box {
  type: string;
  start: number;
  end: number;
}

function boxes(view: DataView, start: number, end: number): Box[] {
  const out: Box[] = [];
  let at = start;
  while (at + 8 <= end) {
    let size = view.getUint32(at);
    const type = String.fromCharCode(
      view.getUint8(at + 4),
      view.getUint8(at + 5),
      view.getUint8(at + 6),
      view.getUint8(at + 7),
    );
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) break;
      size = Number(view.getBigUint64(at + 8));
      header = 16;
    } else if (size === 0) size = end - at;
    if (size < header || at + size > end) break;
    out.push({ type, start: at + header, end: at + size });
    at += size;
  }
  return out;
}

function child(view: DataView, parent: Box | undefined, type: string): Box | undefined {
  return parent && boxes(view, parent.start, parent.end).find((box) => box.type === type);
}

function children(view: DataView, parent: Box | undefined, type: string): Box[] {
  return parent ? boxes(view, parent.start, parent.end).filter((box) => box.type === type) : [];
}

const hex = (value: number) => value.toString(16).toUpperCase().padStart(2, '0');

function avc(view: DataView, entry: Box, type: string): string | null {
  // Visual sample entries carry 78 bytes of fixed fields before their own boxes.
  const config = boxes(view, entry.start + 78, entry.end).find((box) => box.type === 'avcC');
  if (!config || config.end - config.start < 4) return null;
  return `${type}.${hex(view.getUint8(config.start + 1))}${hex(view.getUint8(config.start + 2))}${hex(view.getUint8(config.start + 3))}`;
}

function hevc(view: DataView, entry: Box, type: string): string | null {
  const config = boxes(view, entry.start + 78, entry.end).find((box) => box.type === 'hvcC');
  if (!config || config.end - config.start < 13) return null;
  const at = config.start;
  const first = view.getUint8(at + 1);
  const space = ['', 'A', 'B', 'C'][first >> 6];
  const tier = first & 0x20 ? 'H' : 'L';
  const profile = first & 0x1f;
  // The compatibility flags are written bit-reversed (ISO/IEC 14496-15 E.3).
  let flags = view.getUint32(at + 2);
  let reversed = 0;
  for (let i = 0; i < 32; i++) {
    reversed = (reversed << 1) | (flags & 1);
    flags >>>= 1;
  }
  const constraints: number[] = [];
  for (let i = 0; i < 6; i++) constraints.push(view.getUint8(at + 6 + i));
  while (constraints.length && constraints.at(-1) === 0) constraints.pop();
  const level = view.getUint8(at + 12);
  return [
    type,
    `${space}${profile}`,
    (reversed >>> 0).toString(16).toUpperCase(),
    `${tier}${level}`,
    ...constraints.map(hex),
  ].join('.');
}

function av1(view: DataView, entry: Box): string | null {
  const config = boxes(view, entry.start + 78, entry.end).find((box) => box.type === 'av1C');
  if (!config || config.end - config.start < 4) return null;
  const a = view.getUint8(config.start + 1),
    b = view.getUint8(config.start + 2);
  const depth = b & 0x40 ? (b & 0x20 ? 12 : 10) : 8;
  return `av01.${a >> 5}.${String(a & 0x1f).padStart(2, '0')}${b & 0x80 ? 'H' : 'M'}.${String(depth).padStart(2, '0')}`;
}

function vp9(view: DataView, entry: Box): string | null {
  const config = boxes(view, entry.start + 78, entry.end).find((box) => box.type === 'vpcC');
  // A full box: version and flags, then profile, level and bit depth.
  if (!config || config.end - config.start < 7) return null;
  const at = config.start + 4;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `vp09.${pad(view.getUint8(at))}.${pad(view.getUint8(at + 1))}.${pad(view.getUint8(at + 2) >> 4)}`;
}

/** A descriptor's payload (ISO/IEC 14496-1): tag, a 1–4 byte length, then the body. */
function descriptor(view: DataView, at: number, end: number): { tag: number; start: number; end: number } | null {
  if (at + 2 > end) return null;
  const tag = view.getUint8(at++);
  let length = 0;
  for (let i = 0; i < 4 && at < end; i++) {
    const byte = view.getUint8(at++);
    length = (length << 7) | (byte & 0x7f);
    if (!(byte & 0x80)) break;
  }
  return at + length <= end ? { tag, start: at, end: at + length } : null;
}

function mp4a(view: DataView, entry: Box): string | null {
  // Audio sample entries carry 28 bytes of fixed fields before their own boxes.
  const esds = boxes(view, entry.start + 28, entry.end).find((box) => box.type === 'esds');
  if (!esds) return null;
  const es = descriptor(view, esds.start + 4, esds.end);
  if (!es || es.tag !== 3) return null;
  const flags = view.getUint8(es.start + 2);
  let at = es.start + 3;
  if (flags & 0x80) at += 2;
  if (flags & 0x40) at += 1 + view.getUint8(at);
  if (flags & 0x20) at += 2;
  const config = descriptor(view, at, es.end);
  if (!config || config.tag !== 4) return null;
  const objectType = view.getUint8(config.start);
  if (objectType !== 0x40) return `mp4a.${objectType.toString(16).toUpperCase()}`;
  const specific = descriptor(view, config.start + 13, config.end);
  if (!specific || specific.tag !== 5 || specific.end <= specific.start) return 'mp4a.40.2';
  let audioObjectType = view.getUint8(specific.start) >> 3;
  if (audioObjectType === 31 && specific.end - specific.start >= 2)
    audioObjectType = 32 + (((view.getUint8(specific.start) & 0x07) << 3) | (view.getUint8(specific.start + 1) >> 5));
  return `mp4a.40.${audioObjectType}`;
}

function sampleCodec(view: DataView, entry: Box): string | null {
  switch (entry.type) {
    case 'avc1':
    case 'avc3':
      return avc(view, entry, entry.type);
    case 'hvc1':
    case 'hev1':
      return hevc(view, entry, entry.type);
    case 'av01':
      return av1(view, entry);
    case 'vp09':
      return vp9(view, entry);
    case 'mp4a':
      return mp4a(view, entry);
    case 'Opus':
      return 'opus';
    case 'fLaC':
      return 'flac';
    case 'ac-3':
    case 'ec-3':
      return entry.type;
    default:
      // Encrypted (encv/enca) or a codec MSE has no name for.
      return null;
  }
}

export interface InitFacts {
  /** `video/mp4; codecs="…"` (or audio/mp4 for an audio-only stream). */
  mime: string;
  /** Each track's media timescale, by track ID. */
  timescales: Map<number, number>;
}

/** The stream's MIME type and timescales from its init segment, or null when it cannot be read. */
export function initFacts(bytes: ArrayBuffer): InitFacts | null {
  const view = new DataView(bytes);
  const moov = boxes(view, 0, view.byteLength).find((box) => box.type === 'moov');
  if (!moov) return null;
  const video: string[] = [],
    audio: string[] = [];
  const timescales = new Map<number, number>();
  for (const trak of children(view, moov, 'trak')) {
    const tkhd = child(view, trak, 'tkhd');
    const mdia = child(view, trak, 'mdia');
    const mdhd = child(view, mdia, 'mdhd');
    const hdlr = child(view, mdia, 'hdlr');
    const stsd = child(view, child(view, child(view, mdia, 'minf'), 'stbl'), 'stsd');
    if (!tkhd || !mdhd || !hdlr || !stsd) return null;
    const handler = String.fromCharCode(
      ...[8, 9, 10, 11].map((offset) => view.getUint8(hdlr.start + offset)),
    );
    if (handler !== 'vide' && handler !== 'soun') continue;
    const trackId = view.getUint32(tkhd.start + (view.getUint8(tkhd.start) === 1 ? 20 : 12));
    timescales.set(trackId, view.getUint32(mdhd.start + (view.getUint8(mdhd.start) === 1 ? 20 : 12)));
    // stsd is a full box with an entry count before its sample entries.
    const entry = boxes(view, stsd.start + 8, stsd.end)[0];
    const codec = entry && sampleCodec(view, entry);
    if (!codec) return null;
    (handler === 'vide' ? video : audio).push(codec);
  }
  const codecs = [...video, ...audio];
  if (!codecs.length) return null;
  return { mime: `${video.length ? 'video' : 'audio'}/mp4; codecs="${codecs.join(',')}"`, timescales };
}

/** Where a media segment's first fragment starts (its tfdt), in seconds, or null if unreadable. */
export function fragmentStart(bytes: ArrayBuffer, timescales: Map<number, number>): number | null {
  const view = new DataView(bytes);
  const moof = boxes(view, 0, view.byteLength).find((box) => box.type === 'moof');
  for (const traf of children(view, moof, 'traf')) {
    const tfhd = child(view, traf, 'tfhd');
    const tfdt = child(view, traf, 'tfdt');
    if (!tfhd || !tfdt) continue;
    const timescale = timescales.get(view.getUint32(tfhd.start + 4));
    if (!timescale) continue;
    const time =
      view.getUint8(tfdt.start) === 1 ? Number(view.getBigUint64(tfdt.start + 4)) : view.getUint32(tfdt.start + 4);
    return time / timescale;
  }
  return null;
}
