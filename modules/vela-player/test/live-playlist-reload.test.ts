import { expect, test } from 'bun:test';
import { LiveWindow } from '../web/engine/core/source/live-window';
import { livePlaylistReloadDelayMs } from '../web/engine/core/source/reload';
import { playlistChanged, parsePlaylist } from '../web/engine/hls';

test('changed live playlists follow the newest segment duration', () => {
  expect(livePlaylistReloadDelayMs(6, 2, true)).toBe(2000);
  expect(livePlaylistReloadDelayMs(6, null, true)).toBe(6000);
});

test('unchanged live playlists retry after half the target duration', () => {
  expect(livePlaylistReloadDelayMs(6, 2, false)).toBe(3000);
});

test('live playlist reload delays retain a storm floor and stale ceiling', () => {
  expect(livePlaylistReloadDelayMs(0.2, 0.1, true)).toBe(500);
  expect(livePlaylistReloadDelayMs(60, null, true)).toBe(60000);
});

test('live window detects publication advances independently of sliding overlap', () => {
  const playlist = (segments: number) =>
    [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:6',
      '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXT-X-MAP:URI="init.mp4"',
      ...Array.from({ length: segments }, (_, index) => [`#EXTINF:2,`, `segment-${index}.m4s`]).flat(),
    ].join('\n');
  const window = new LiveWindow();
  const first = window.update(playlist(2), { mediaSequence: 0, windowStartSeconds: 0 });
  expect(window.reloadDelayMs).toBe(2000);
  expect(first).toContain('#EXT-X-TARGETDURATION:2');
  const unchanged = window.update(playlist(2));
  expect(window.reloadDelayMs).toBe(3000);
  expect(unchanged).toContain('#EXT-X-TARGETDURATION:3');
  const advanced = window.update(playlist(3));
  expect(window.reloadDelayMs).toBe(2000);
  expect(advanced).toContain('#EXT-X-TARGETDURATION:2');
});

test('playlist changes include publication and segment metadata', () => {
  const playlist = (duration: number, extra = '') =>
    parsePlaylist(
      [
        '#EXTM3U',
        '#EXT-X-TARGETDURATION:4',
        '#EXT-X-MAP:URI="init.mp4"',
        `#EXTINF:${duration},`,
        '0.m4s',
        extra,
      ].join('\n'),
      'https://media.test/live/index.m3u8',
    );
  const initial = playlist(2);
  expect(playlistChanged(initial, playlist(2))).toBe(false);
  expect(playlistChanged(initial, playlist(2, '#EXTINF:2,\n1.m4s'))).toBe(true);
  expect(playlistChanged(initial, playlist(1.5))).toBe(true);
});

test('live-window updates leave playlist polling to the segment consumer', () => {
  const text = [
    '#EXTM3U',
    '#EXT-X-TARGETDURATION:1',
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-MAP:URI="init.mp4"',
    '#EXTINF:0.1,',
    '0.m4s',
    '#EXTINF:0.2,',
    '1.m4s',
  ].join('\n');
  const scheduled: number[] = [];
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: TimerHandler, delay?: number) => {
    scheduled.push(delay ?? 0);
    return 0;
  }) as typeof setTimeout;
  try {
    const window = new LiveWindow();
    window.update(text, { mediaSequence: 0, windowStartSeconds: 0 });
    window.update(text);
    expect(window.reloadDelayMs).toBe(500);
    expect(scheduled).toEqual([]);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});
