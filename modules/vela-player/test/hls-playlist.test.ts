import { expect, test } from 'bun:test';
import { parsePlaylist } from '../web/engine/hls';

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

test('master, encrypted, byte-range and TS playlists stay outside the pipeline', () => {
  const media = (...lines: string[]) => ['#EXTM3U', '#EXT-X-TARGETDURATION:4', ...lines].join('\n');
  expect(() => parsePlaylist(media('#EXT-X-STREAM-INF:BANDWIDTH=1', 'v.m3u8'), base)).toThrow();
  expect(() => parsePlaylist(media('#EXT-X-KEY:METHOD=AES-128,URI="k"', '#EXT-X-MAP:URI="a.mp4"', '#EXTINF:4,', '0.m4s'), base)).toThrow();
  expect(() => parsePlaylist(media('#EXT-X-MAP:URI="a.mp4"', '#EXT-X-BYTERANGE:10@0', '#EXTINF:4,', '0.m4s'), base)).toThrow();
  expect(() => parsePlaylist(media('#EXTINF:4,', '0.ts'), base)).toThrow();
  // A key of METHOD=NONE is clear media.
  expect(parsePlaylist(media('#EXT-X-KEY:METHOD=NONE', '#EXT-X-MAP:URI="a.mp4"', '#EXTINF:4,', '0.m4s'), base).segments).toHaveLength(1);
});
