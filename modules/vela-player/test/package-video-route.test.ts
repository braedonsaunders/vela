import { expect, test } from 'bun:test';
import { containerVideoCodec } from '../web/engine/core/demux/video-codec';
import { packageOutputFormat } from '../web/engine/core/decode/package-video';
import { conventionalColour } from '../web/engine/core/render/video-presenter';
import type { VideoTrack } from '../web/engine/core/types';

const track = (codec: string, description?: Uint8Array, size = { width: 1920, height: 1080 }): VideoTrack => ({
  id: 'video:1', kind: 'video', containerTrackId: 1, sourceIndex: 0, codec, language: 'und', ...size,
  rotation: 0, fieldOrder: 'progressive', color: {}, config: { codec, ...(description ? { description } : {}) },
});

test('codecs WebCodecs does not name reach their package by FFmpeg name', () => {
  expect(containerVideoCodec('avc', null, null)).toEqual({ codec: 'h264', extradata: null });
  expect(containerVideoCodec('mpeg2', 'V_MPEG2', null).codec).toBe('mpeg2video');
  const sequence = new Uint8Array([0, 0, 1, 0xb3, 1, 2]);
  expect(containerVideoCodec(null, 'V_MPEG2', sequence)).toEqual({ codec: 'mpeg2video', extradata: sequence });
  expect(containerVideoCodec(null, 'V_MPEG1', null).codec).toBe('mpeg1video');
  // VfW: the FourCC at offset 16 of the BITMAPINFOHEADER; extradata follows the 40-byte header.
  const bitmap = new Uint8Array(44);
  bitmap.set([...'WVC1'].map((c) => c.charCodeAt(0)), 16);
  bitmap.set([0x0f, 0xcb, 0x80, 0x01], 40);
  expect(containerVideoCodec(null, 'V_MS/VFW/FOURCC', bitmap)).toEqual({ codec: 'vc1', extradata: new Uint8Array([0x0f, 0xcb, 0x80, 0x01]) });
  bitmap.set([...'DIV3'].map((c) => c.charCodeAt(0)), 16);
  expect(containerVideoCodec(null, 'V_MS/VFW/FOURCC', bitmap.slice(0, 40))).toEqual({ codec: 'msmpeg4v3', extradata: null });
  bitmap.set([...'ABCD'].map((c) => c.charCodeAt(0)), 16);
  expect(containerVideoCodec(null, 'V_MS/VFW/FOURCC', bitmap).codec).toBe('unknown');
  expect(containerVideoCodec(null, 'V_THEORA', null).codec).toBe('unknown');
});

test('a package writes the frame format the configuration declares', () => {
  const hvcC = new Uint8Array(23);
  hvcC[0] = 1;
  hvcC[16] = 0xfc | 1;
  hvcC[17] = 0xf8 | 2;
  expect(packageOutputFormat(track('hevc', hvcC))).toBe('I420P10');
  hvcC[16] = 0xfc | 2;
  expect(packageOutputFormat(track('hevc', hvcC))).toBe('I422P10');
  expect(packageOutputFormat(track('hevc'))).toBeNull();
  // av1C byte 2: high_bitdepth, twelve_bit, monochrome, subsampling x, y.
  expect(packageOutputFormat(track('av1', new Uint8Array([0x81, 0x08, 0x4c, 0])))).toBe('I420P10');
  expect(packageOutputFormat(track('av1', new Uint8Array([0x81, 0x08, 0x08, 0])))).toBe('I422');
  expect(packageOutputFormat(track('av1', new Uint8Array([0x81, 0x08, 0x10 | 0x0c, 0])))).toBeNull();
  expect(packageOutputFormat(track('av1'))).toBeNull();
  for (const codec of ['mpeg2video', 'mpeg1video', 'mpeg4', 'msmpeg4v3', 'vc1', 'wmv3']) expect(packageOutputFormat(track(codec))).toBe('I420');
  expect(packageOutputFormat(track('vp9'))).toBeNull();
});

test('undeclared SDR colour follows the HD/SD convention', () => {
  expect(conventionalColour({ width: 1920, height: 1080 })).toEqual({ primaries: 'bt709', matrix: 'bt709' });
  expect(conventionalColour({ width: 1280, height: 720 }).primaries).toBe('bt709');
  expect(conventionalColour({ width: 720, height: 576 }).primaries).toBe('bt470bg');
  expect(conventionalColour({ width: 720, height: 480 }).primaries).toBe('smpte170m');
});
