import { expect, test } from 'bun:test';
import { PackageVideoDecoder } from '../web/engine/core/decode/package-video';
import type { VideoTrack } from '../web/engine/core/types';

const track = (codec: string, description?: Uint8Array): VideoTrack => ({
  id: 'video:1',
  kind: 'video',
  containerTrackId: 1,
  sourceIndex: 0,
  codec,
  language: 'und',
  width: 1920,
  height: 1080,
  rotation: 0,
  fieldOrder: 'progressive',
  color: {},
  config: { codec, ...(description ? { description } : {}) },
});

test('a package route needs a configuration it can size its frame pool from', () => {
  const hvcC = new Uint8Array(23);
  hvcC[0] = 1;
  expect(PackageVideoDecoder.accepts(track('hevc', hvcC))).toBe(true);
  expect(PackageVideoDecoder.accepts(track('hevc'))).toBe(false);
  expect(PackageVideoDecoder.accepts(track('hevc', new Uint8Array([0, 0, 0, 1])))).toBe(false);
  expect(PackageVideoDecoder.accepts(track('av1', new Uint8Array([0x81, 0, 0x0c, 0])))).toBe(true);
  expect(PackageVideoDecoder.accepts(track('av1'))).toBe(false);
  expect(PackageVideoDecoder.accepts(track('mpeg2video', new Uint8Array(32)))).toBe(true);
  expect(PackageVideoDecoder.accepts(track('vp9'))).toBe(false);
});
