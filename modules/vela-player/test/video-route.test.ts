import { expect, test } from 'bun:test';
import { packageOutputFormat, packageRoute } from '../web/engine/core/decode/codec-config';
import type { VideoTrack } from '../web/engine/core/types';

const accepts = (value: VideoTrack) => packageOutputFormat(value) !== null;

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
  expect(accepts(track('hevc', hvcC))).toBe(true);
  expect(accepts(track('hevc'))).toBe(false);
  expect(accepts(track('hevc', new Uint8Array([0, 0, 0, 1])))).toBe(false);
  expect(accepts(track('av1', new Uint8Array([0x81, 0, 0x0c, 0])))).toBe(true);
  expect(accepts(track('av1'))).toBe(false);
  expect(accepts(track('mpeg2video', new Uint8Array(32)))).toBe(true);
  expect(accepts(track('vp9'))).toBe(false);
});

test('a profile 7 access unit keeps its base layer and drops the enhancement layer and RPU', async () => {
  const { baseLayerFilter } = await import('../web/engine/core/decode/base-layer');
  const hvcC = new Uint8Array(23);
  hvcC[0] = 1;
  hvcC[21] = 3; // four-byte NAL lengths
  const filter = baseLayerFilter(track('hevc', hvcC))!;
  const nal = (type: number, layer: number, payload: number[]) => {
    const body = [(type << 1) | (layer >> 5), ((layer & 31) << 3) | 1, ...payload];
    return [0, 0, 0, body.length, ...body];
  };
  const base = nal(1, 0, [0xaa, 0xbb]); // TRAIL_R slice
  const unit = new Uint8Array([...nal(35, 0, [0x10]), ...base, ...nal(63, 0, [0x02, 0x01, 0xcc]), ...nal(62, 0, [0x19, 0x08]), ...nal(1, 1, [0xdd])]);
  expect([...filter(unit)!]).toEqual([...nal(35, 0, [0x10]), ...base]);
  expect(baseLayerFilter(track('av1'))).toBeNull();
});

test('AV1 and MPEG-1/2 packages are used only in Chromium', async () => {
  const av1 = track('av1', new Uint8Array([0x81, 0x08, 0x4c, 0]));
  expect(packageRoute(av1, true)).toBe(true);
  expect(packageRoute(av1, false)).toBe(false);
  expect(packageRoute(track('mpeg2video'), false)).toBe(false);
  expect(packageRoute(track('mpeg4'), false)).toBe(true);
  const hvcC = new Uint8Array(23);
  hvcC[0] = 1;
  expect(packageRoute(track('hevc', hvcC), false)).toBe(true);
});
