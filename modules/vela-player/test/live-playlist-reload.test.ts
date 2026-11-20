import { expect, test } from 'bun:test';
import { LiveWindow } from '../web/engine/core/source/live-window';
import { livePlaylistReloadDelayMs } from '../web/engine/core/source/reload';

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
  window.update(playlist(2), { mediaSequence: 0, windowStartSeconds: 0 });
  expect(window.reloadDelayMs).toBe(2000);
  window.update(playlist(2));
  expect(window.reloadDelayMs).toBe(3000);
  window.update(playlist(3));
  expect(window.reloadDelayMs).toBe(2000);
});
