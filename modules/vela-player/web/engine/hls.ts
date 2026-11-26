export interface Segment {
  sequence: number;
  url: string;
  start: number;
  duration: number;
  init: string;
  gap: boolean;
  /** An EXT-X-DISCONTINUITY precedes it: its media timestamps need not follow the previous segment's. */
  discontinuity: boolean;
}
export interface Playlist {
  segments: Segment[];
  ended: boolean;
  targetDuration: number;
}
export function playlistChanged(previous: Playlist, current: Playlist): boolean {
  if (previous.ended !== current.ended || previous.targetDuration !== current.targetDuration) return true;
  if (previous.segments.length !== current.segments.length) return true;
  return previous.segments.some((segment, index) => {
    const next = current.segments[index];
    return (
      !next ||
      segment.sequence !== next.sequence ||
      segment.url !== next.url ||
      segment.init !== next.init ||
      segment.duration !== next.duration ||
      segment.gap !== next.gap ||
      segment.discontinuity !== next.discontinuity
    );
  });
}

/** Pick a master's default variant without sending media requests outside its origin. */
export function defaultHlsVariant(text: string, base: string): string | undefined {
  if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('Invalid HLS manifest');
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const first = lines.findIndex((line) => line.startsWith('#EXT-X-STREAM-INF:'));
  if (first < 0) return;
  const uri = lines.slice(first + 1).find((line) => line && (!line.startsWith('#') || line.startsWith('#EXT')));
  if (!uri || uri.startsWith('#')) throw new Error('HLS default variant is missing');
  const variant = new URL(uri, base);
  if (variant.origin !== new URL(base).origin || variant.username || variant.password)
    throw new Error('HLS variant outside broker origin');
  return variant.href;
}

export function parsePlaylist(text: string, base: string): Playlist {
  if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('Invalid HLS playlist');
  // EXT-X-DISCONTINUITY-SEQUENCE only numbers discontinuities; a METHOD=NONE key is clear media.
  if (/^\s*#EXT-X-(?:KEY:(?!METHOD=NONE\b)|BYTERANGE|STREAM-INF)/m.test(text))
    throw new Error('Requires a clear fMP4 media playlist (not master/TS/encrypted/byte-range HLS)');
  let sequence = 0,
    start = 0,
    duration = 0,
    init = '',
    targetDuration = 6;
  const segments: Segment[] = [];
  let gap = false,
    discontinuity = false;
  for (const line of text.split(/\r?\n/).map((l) => l.trim())) {
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) sequence = Number(line.split(':')[1]);
    else if (line.startsWith('#EXT-X-TARGETDURATION:')) targetDuration = Number(line.split(':')[1]);
    else if (line === '#EXT-X-GAP') gap = true;
    else if (line === '#EXT-X-DISCONTINUITY') discontinuity = true;
    else if (line.startsWith('#EXT-X-MAP:')) {
      if (/BYTERANGE=/.test(line)) throw new Error('Byte-range initialization is unsupported');
      const uri = /URI="([^"]+)"/.exec(line)?.[1];
      if (!uri) throw new Error('Missing initialization URI');
      init = new URL(uri, base).href;
    } else if (line.startsWith('#EXTINF:')) duration = Number(line.slice(8).split(',')[0]);
    else if (line && !line.startsWith('#')) {
      if (!init || !Number.isFinite(duration) || duration <= 0) throw new Error('Invalid fMP4 segment');
      segments.push({ sequence: sequence++, url: new URL(line, base).href, start, duration, init, gap, discontinuity });
      start += duration;
      duration = 0;
      gap = false;
      discontinuity = false;
    }
  }
  if (
    !Number.isFinite(sequence) ||
    !Number.isFinite(targetDuration) ||
    targetDuration <= 0 ||
    !segments.length
  )
    throw new Error('Empty/invalid playlist');
  return { segments, ended: text.includes('#EXT-X-ENDLIST'), targetDuration };
}
