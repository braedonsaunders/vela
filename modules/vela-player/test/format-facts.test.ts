import { expect, test } from 'bun:test';
import { dolbyVisionRoute } from '../web/engine/core/dolby-vision';
import {
  audioSourceFormat,
  channelLayoutName,
  videoCodecFacts,
  videoOutputFormat,
  videoSourceFormat,
} from '../web/engine/core/format';
import { av1BitDepth } from '../web/engine/core/decode/av1';
import { audioOutputFacts } from '../web/engine/universal/audio/output-facts';
import type { AudioTrack, VideoTrack } from '../web/engine/core/types';

const hvcC = (profile: number, bitDepthMinus8: number) => {
  const record = new Uint8Array(23);
  record[0] = 1;
  record[1] = profile;
  record[17] = 0xf8 | bitDepthMinus8;
  return record;
};

function video(overrides: Partial<VideoTrack> = {}): VideoTrack {
  return {
    id: 'video:1',
    kind: 'video',
    containerTrackId: 1,
    sourceIndex: 0,
    codec: 'hevc',
    language: 'und',
    width: 3840,
    height: 2160,
    rotation: 0,
    fieldOrder: 'progressive',
    // Mediabunny reports these H.273 names, which the DOM typings predate.
    color: { primaries: 'bt2020', transfer: 'pq', matrix: 'bt2020-ncl', fullRange: false } as unknown as VideoColorSpaceInit,
    config: { codec: 'hvc1.2.4.L153.B0', description: hvcC(2, 2) },
    ...overrides,
  };
}

test('Dolby Vision 8.1, 8.4 and 8.2 play their compatible base layer; 5 and 7 are refused', () => {
  expect(dolbyVisionRoute({})).toEqual({ kind: 'none' });
  expect(dolbyVisionRoute({ dvProfile: 8, dvBlSignalCompatibilityId: 1, colorTransfer: 'smpte2084' })).toEqual({
    kind: 'base-layer',
    profile: '8.1',
    base: 'hdr10',
  });
  expect(dolbyVisionRoute({ dvProfile: 8, dvBlSignalCompatibilityId: 4, colorTransfer: 'arib-std-b67' })).toEqual({
    kind: 'base-layer',
    profile: '8.4',
    base: 'hlg',
  });
  expect(dolbyVisionRoute({ dvProfile: 8, dvBlSignalCompatibilityId: 2 })).toMatchObject({ base: 'sdr' });
  // AV1 profile 10 carries the same compatibility ids.
  expect(dolbyVisionRoute({ dvProfile: 10, dvBlSignalCompatibilityId: 1 })).toMatchObject({ profile: '10.1' });
  expect(dolbyVisionRoute({ dvProfile: 5, dvBlSignalCompatibilityId: 0 }).kind).toBe('refuse');
  expect(dolbyVisionRoute({ dvProfile: 7, dvBlSignalCompatibilityId: 6 }).kind).toBe('refuse');
  expect(dolbyVisionRoute({ dvProfile: 8, dvBlSignalCompatibilityId: 0 }).kind).toBe('refuse');
  // A base that declares another transfer than its compatibility id would be shown wrongly.
  expect(dolbyVisionRoute({ dvProfile: 8, dvBlSignalCompatibilityId: 1, colorTransfer: 'bt709' }).kind).toBe('refuse');
});

test('codec facts come from the configuration the stream carries', () => {
  expect(videoCodecFacts('hevc', { codec: 'hvc1.2.4.L153.B0', description: hvcC(2, 2) })).toEqual({
    profile: 'Main 10',
    bitDepth: 10,
  });
  expect(videoCodecFacts('h264', { codec: 'avc1.640028' })).toEqual({ profile: 'High', bitDepth: 8 });
  expect(videoCodecFacts('h264', { codec: 'avc1.42E01E' })).toEqual({ profile: 'Constrained Baseline', bitDepth: 8 });
  expect(videoCodecFacts('h264', { codec: 'avc1.6E0028' })).toEqual({ profile: 'High 10' });
  expect(videoCodecFacts('av1', { codec: 'av01.0.05M.10.0.110.09.16.09.0' })).toEqual({ profile: 'Main', bitDepth: 10 });
  expect(videoCodecFacts('vp9', { codec: 'vp09.02.10.10.01.09.16.09.00' })).toEqual({ profile: 'Profile 2', bitDepth: 10 });
  expect(videoCodecFacts('mpeg2video', null)).toEqual({});
});

test('av1C bit depth reads high_bitdepth and twelve_bit', () => {
  expect(av1BitDepth(new Uint8Array([0x81, 0x08, 0x0c, 0x00]))).toBe(8);
  expect(av1BitDepth(new Uint8Array([0x81, 0x08, 0x4c, 0x00]))).toBe(10);
  expect(av1BitDepth(new Uint8Array([0x81, 0x48, 0x6c, 0x00]))).toBe(12);
  expect(av1BitDepth(new Uint8Array([0x00, 0x08, 0x4c, 0x00]))).toBeNull();
});

test('a Dolby Vision 8.1 title reports DV in, its HDR10 base tone-mapped out', () => {
  const route = dolbyVisionRoute({ dvProfile: 8, dvBlSignalCompatibilityId: 1, colorTransfer: 'smpte2084' });
  const source = videoSourceFormat(video(), { frameRate: 24000 / 1001, dvLevel: 6 }, route);
  expect(source).toEqual({
    codec: 'hevc',
    profile: 'Main 10',
    bitDepth: 10,
    width: 3840,
    height: 2160,
    frameRate: 24000 / 1001,
    range: 'dv',
    dvProfile: '8.1',
    dvLevel: 6,
    interlaced: false,
  });
  expect(videoOutputFormat(source, route, { decoder: 'hardware', decoderName: 'WebCodecs' }, false)).toEqual({
    range: 'sdr',
    dvConversion: 'base-layer',
    decoder: 'hardware',
    decoderName: 'WebCodecs',
    frameRateMatch: 'unsupported',
    rangeMatch: 'unsupported',
    toneMapped: true,
    deinterlaced: false,
  });
  expect(videoOutputFormat(source, route, null, true)).toMatchObject({ range: 'hdr10', toneMapped: false });
});

test('an SDR title is not tone-mapped and an unknown colour stays unknown', () => {
  const sdr = videoSourceFormat(
    video({ codec: 'h264', color: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709' }, config: { codec: 'avc1.640028' } }),
    undefined,
    { kind: 'none' },
  );
  expect(sdr.range).toBe('sdr');
  expect(videoOutputFormat(sdr, { kind: 'none' }, null, false)).toMatchObject({ range: 'sdr', toneMapped: false });
  const unknown = videoSourceFormat(video({ color: {} }), undefined, { kind: 'none' });
  expect(unknown.range).toBeUndefined();
  expect(videoOutputFormat(unknown, { kind: 'none' }, null, false).toneMapped).toBeUndefined();
});

test('channel layouts are named as FFmpeg names them', () => {
  expect(channelLayoutName(0x60f, 6)).toBe('5.1(side)');
  expect(channelLayoutName(0x3f, 6)).toBe('5.1');
  expect(channelLayoutName(0x63f, 8)).toBe('7.1');
  expect(channelLayoutName(0x2d63f, 12)).toBe('7.1.4');
  expect(channelLayoutName(0x3, 2)).toBe('stereo');
  expect(channelLayoutName(0x13, 3)).toBe('FL+FR+BL');
  expect(channelLayoutName(null, 2)).toBe('stereo');
  expect(channelLayoutName(null, 6)).toBeUndefined();
  const track: AudioTrack = {
    id: 'audio:2',
    kind: 'audio',
    containerTrackId: 2,
    sourceIndex: 1,
    codec: 'truehd',
    language: 'eng',
    sampleRate: 48000,
    channels: 8,
    channelMask: 0x63f,
    config: null,
    internalCodecId: 'A_TRUEHD',
  };
  expect(audioSourceFormat(track)).toEqual({ codec: 'truehd', channels: 8, layout: '7.1', sampleRate: 48000, language: 'eng' });
  expect(audioSourceFormat(track, 12).immersive).toBe('atmos');
  expect(audioSourceFormat({ ...track, codec: 'flac' }, 12).immersive).toBeUndefined();
});

test('decoded audio is lossless only when nothing was folded or resampled', () => {
  const route = { codec: 'truehd', sourceChannels: 8, sourceSampleRate: 48000, outputChannels: 8, layout: '7.1' as const, outputSampleRate: 48000, decoder: 'truehd' };
  expect(audioOutputFacts(route)).toEqual({
    delivery: 'decoded',
    codec: 'pcm',
    channels: 8,
    layout: '7.1',
    sampleRate: 48000,
    bitDepth: 32,
    lossless: true,
    decoderName: 'WASM FFmpeg truehd',
    downmixed: false,
    resampled: false,
  });
  expect(audioOutputFacts({ ...route, outputChannels: 2, layout: 'stereo' })).toMatchObject({ lossless: false, downmixed: true });
  expect(audioOutputFacts({ ...route, codec: 'flac', sourceSampleRate: 96000, decoder: 'webcodecs' })).toMatchObject({
    lossless: false,
    resampled: true,
    decoderName: 'WebCodecs flac',
  });
  // A lossy source makes no lossless claim; DTS is unclaimed because XLL presence is not known.
  expect(audioOutputFacts({ ...route, codec: 'eac3', decoder: 'eac3' }).lossless).toBeUndefined();
  expect(audioOutputFacts({ ...route, codec: 'dts', decoder: 'dts' }).lossless).toBeUndefined();
});

test('the browser video element reports only what the rendition declared', async () => {
  const { browserFormat } = await import('../web/engine/host/telemetry');
  expect(browserFormat({ codec: 'h264', width: 1920, height: 1080, dynamicRange: 'sdr' }, { id: 'a', label: 'English', codec: 'aac', channels: 2, language: 'en' })).toEqual({
    video: { codec: 'h264', width: 1920, height: 1080, range: 'sdr' },
    videoOut: { frameRateMatch: 'unsupported', rangeMatch: 'unsupported' },
    audio: { codec: 'aac', channels: 2, language: 'en' },
    audioOut: { delivery: 'system' },
  });
  expect(browserFormat(null, undefined)).toBeNull();
  expect(browserFormat({ codec: '', width: 1, height: 1, dynamicRange: null }, undefined)).toBeNull();
});

test('interlaced video is reported deinterlaced only on the package route that deinterlaces it', () => {
  const interlaced = videoSourceFormat(
    video({ codec: 'mpeg2video', fieldOrder: 'tt', width: 720, height: 480, color: {}, config: { codec: 'mpeg2video' } }),
    undefined,
    { kind: 'none' },
  );
  expect(interlaced.interlaced).toBe(true);
  expect(videoOutputFormat(interlaced, { kind: 'none' }, { decoder: 'software', decoderName: 'WebGPU mpeg2 package', deinterlaces: true }, false).deinterlaced).toBe(true);
  expect(videoOutputFormat(interlaced, { kind: 'none' }, { decoder: 'hardware', decoderName: 'WebCodecs' }, false).deinterlaced).toBe(false);
});
