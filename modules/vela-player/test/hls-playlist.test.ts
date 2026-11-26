import { expect, test } from 'bun:test';
import { defaultHlsVariant, parsePlaylist } from '../web/engine/hls';

const base = 'http://192.168.68.65:32550/sessions/media/S/G/live/index.m3u8';

test("Ether's live playlist (a discontinuity sequence, a start offset, programme dates) is the pipeline's", () => {
  const list = parsePlaylist(
    [
      '#EXTM3U',
      '#EXT-X-VERSION:7',
      '#EXT-X-TARGETDURATION:5',
      '#EXT-X-START:TIME-OFFSET=-5.000,PRECISE=NO',
      '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXT-X-DISCONTINUITY-SEQUENCE:0',
      '#EXT-X-MAP:URI="resource/om-24a4.mp4?X-Ether-Stream-Token=T"',
      '#EXT-X-PROGRAM-DATE-TIME:2026-11-24T04:13:04.692Z',
      '#EXTINF:5.000000000,',
      'relay/0.m4s?X-Ether-Stream-Token=T',
      '#EXTINF:5.000000000,',
      'relay/1.m4s?X-Ether-Stream-Token=T',
    ].join('\n'),
    base,
  );
  expect(list.segments.map((s) => [s.sequence, s.start, s.discontinuity])).toEqual([[0, 0, false], [1, 5, false]]);
  expect(list.segments[0].init).toBe('http://192.168.68.65:32550/sessions/media/S/G/live/resource/om-24a4.mp4?X-Ether-Stream-Token=T');
  expect(list.ended).toBe(false);
});

test('a discontinuity marks the segment after it, with its new initialization', () => {
  const list = parsePlaylist(
    ['#EXTM3U', '#EXT-X-TARGETDURATION:4', '#EXT-X-MAP:URI="a.mp4"', '#EXTINF:4,', '0.m4s',
      '#EXT-X-DISCONTINUITY', '#EXT-X-MAP:URI="b.mp4"', '#EXTINF:4,', '1.m4s', '#EXTINF:4,', '2.m4s'].join('\n'),
    base,
  );
  expect(list.segments.map((s) => s.discontinuity)).toEqual([false, true, false]);
  expect(list.segments.map((s) => s.init.split('/').at(-1))).toEqual(['a.mp4', 'b.mp4', 'b.mp4']);
});

test('a Plex HLS master resolves its default variant relative to the master', () => {
  const master = [
    '#EXTM3U',
    '#EXT-X-STREAM-INF:BANDWIDTH=12768000,CODECS="avc1.640028,ec-3"',
    'session/vela-id/base/index.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=1800000,CODECS="avc1.64001e,ec-3"',
    'session/vela-id/low/index.m3u8',
  ].join('\r\n');
  const origin = 'https://lab.example';
  const variant = defaultHlsVariant(master, `${origin}/video/:/transcode/universal/start.m3u8?session=vela-id`);
  expect(variant).toBe(`${origin}/video/:/transcode/universal/session/vela-id/base/index.m3u8`);
  const media = '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4,\n0.m4s';
  expect(defaultHlsVariant(media, variant!)).toBeUndefined();
  expect(parsePlaylist(media, variant!).segments[0].init).toBe(`${origin}/video/:/transcode/universal/session/vela-id/base/init.mp4`);
});

test('master resolution rejects a missing URI and an off-origin variant', () => {
  const stream = '#EXT-X-STREAM-INF:BANDWIDTH=1';
  expect(() => defaultHlsVariant(`#EXTM3U\n${stream}\n${stream}\nnext.m3u8`, base)).toThrow('HLS default variant is missing');
  expect(() => defaultHlsVariant(`#EXTM3U\n${stream}\nhttps://other.example/media.m3u8`, base)).toThrow('HLS variant outside broker origin');
});

test('the fMP4 media parser rejects master, encrypted, byte-range and TS playlists', () => {
  const media = (...lines: string[]) => ['#EXTM3U', '#EXT-X-TARGETDURATION:4', ...lines].join('\n');
  expect(() => parsePlaylist(media('#EXT-X-STREAM-INF:BANDWIDTH=1', 'v.m3u8'), base)).toThrow();
  expect(() => parsePlaylist(media('#EXT-X-KEY:METHOD=AES-128,URI="k"', '#EXT-X-MAP:URI="a.mp4"', '#EXTINF:4,', '0.m4s'), base)).toThrow();
  expect(() => parsePlaylist(media('#EXT-X-MAP:URI="a.mp4"', '#EXT-X-BYTERANGE:10@0', '#EXTINF:4,', '0.m4s'), base)).toThrow();
  expect(() => parsePlaylist(media('#EXTINF:4,', '0.ts'), base)).toThrow();
  // A key of METHOD=NONE is clear media.
  expect(parsePlaylist(media('#EXT-X-KEY:METHOD=NONE', '#EXT-X-MAP:URI="a.mp4"', '#EXTINF:4,', '0.m4s'), base).segments).toHaveLength(1);
});
