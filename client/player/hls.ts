export interface Segment {
  sequence: number;
  url: string;
  start: number;
  duration: number;
  init: string;
  gap: boolean;
}
export interface Playlist {
  segments: Segment[];
  ended: boolean;
  targetDuration: number;
}
export function parsePlaylist(text: string, base: string): Playlist {
  if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('Invalid HLS playlist');
  if (/#EXT-X-(KEY|BYTERANGE|DISCONTINUITY|STREAM-INF)/m.test(text))
    throw new Error(
      'Requires clear, continuous fMP4 media playlist (not master/TS/encrypted/byte-range HLS)',
    );
  let sequence = 0,
    start = 0,
    duration = 0,
    init = '',
    targetDuration = 6;
  const segments: Segment[] = [];
  let gap = false;
  for (const line of text.split(/\r?\n/).map((l) => l.trim())) {
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) sequence = Number(line.split(':')[1]);
    else if (line.startsWith('#EXT-X-TARGETDURATION:')) targetDuration = Number(line.split(':')[1]);
    else if (line === '#EXT-X-GAP') gap = true;
    else if (line.startsWith('#EXT-X-MAP:')) {
      if (/BYTERANGE=/.test(line)) throw new Error('Byte-range initialization is unsupported');
      const uri = /URI="([^"]+)"/.exec(line)?.[1];
      if (!uri) throw new Error('Missing initialization URI');
      init = new URL(uri, base).href;
    } else if (line.startsWith('#EXTINF:')) duration = Number(line.slice(8).split(',')[0]);
    else if (line && !line.startsWith('#')) {
      if (!init || !Number.isFinite(duration) || duration <= 0) throw new Error('Invalid fMP4 segment');
      segments.push({ sequence: sequence++, url: new URL(line, base).href, start, duration, init, gap });
      start += duration;
      duration = 0;
      gap = false;
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
