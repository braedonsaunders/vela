import { describe, expect, test } from 'bun:test';
import type { VelaPlayerProps } from '@vela/player-api';
import { dolbyVisionProfile, mpvCapabilities, mpvPlaybackFormat, pixelBitDepth, type MpvFacts } from '../src/windows/mpv-format';
import { windowsSnapshot } from '../src/windows/snapshot';

type Plan = NonNullable<VelaPlayerProps['plan']>;
const plan = (originalVideo?: Record<string, unknown>): Plan => ({
  sessionId: 's1', revision: 1, sourceGeneration: 1, seekGeneration: 1, state: 'playing', positionSeconds: 0,
  paths: [{ id: 'direct', kind: 'direct', transport: 'file', original: true, mimeType: 'video/x-matroska', readiness: 'ready',
    url: 'https://ether.example/a.mkv', qualities: [], boundaries: [], originalVideo }],
  selectedPathId: 'direct', audioTracks: [], subtitleTracks: [], selectedSubtitleTrackId: null, chapters: [],
  fallback: { state: 'unsupported' },
}) as Plan;

const hevc = { codec: 'hevc', 'codec-profile': 'Main 10', 'demux-w': 3840, 'demux-h': 2160, decoder: 'hevc' };
const truehd = { codec: 'truehd', 'codec-profile': 'Dolby TrueHD + Dolby Atmos', 'demux-channel-count': 8, 'demux-channels': '7.1', 'demux-samplerate': 48000, decoder: 'truehd', lang: 'eng' };

describe('mpvPlaybackFormat video', () => {
  test('Dolby Vision 8.1 on an HDR display is reshaped by libplacebo and sent as HDR10', () => {
    const facts: MpvFacts = {
      videoTrack: { ...hevc, 'dolby-vision-profile': 8, 'dolby-vision-level': 6 },
      'video-params': { pixelformat: 'd3d11', 'hw-pixelformat': 'p010', gamma: 'pq', w: 3840, h: 2160 },
      'video-target-params': { gamma: 'pq', primaries: 'bt.2020' },
      'hwdec-current': 'd3d11va', 'container-fps': 24000 / 1001, 'deinterlace-active': false,
    };
    const format = mpvPlaybackFormat(facts, { display: { width: 3840, height: 2160, refreshRate: 23.976, hdr: true }, frameRateMatch: 'matched', rangeMatch: 'matched' },
      plan({ dvProfile: 8, dvBlSignalCompatibilityId: 1 }));
    expect(format?.video).toEqual({ codec: 'hevc', profile: 'Main 10', bitDepth: 10, width: 3840, height: 2160,
      frameRate: 24000 / 1001, range: 'dv', dvProfile: '8.1', dvLevel: 6 });
    expect(format?.videoOut).toEqual({ range: 'hdr10', dvConversion: 'reshaped', decoder: 'hardware', decoderName: 'd3d11va',
      width: 3840, height: 2160, refreshRate: 23.976, frameRateMatch: 'matched', rangeMatch: 'matched', toneMapped: false, deinterlaced: false });
  });

  test('HDR10+ tone-mapped for an SDR display, decoded in software', () => {
    const format = mpvPlaybackFormat({
      videoTrack: { ...hevc, decoder: 'hevc' },
      'video-params': { pixelformat: 'yuv420p10', gamma: 'pq', 'scene-max-r': 900 },
      'video-target-params': { gamma: 'bt.1886' }, 'hwdec-current': 'no',
    }, { frameRateMatch: 'off', rangeMatch: 'unsupported' });
    expect(format?.video?.range).toBe('hdr10+');
    expect(format?.videoOut).toMatchObject({ range: 'sdr', toneMapped: true, decoder: 'software', decoderName: 'hevc', rangeMatch: 'unsupported' });
    expect(format?.videoOut?.dvConversion).toBeUndefined();
  });

  test('unknown facts stay absent rather than guessed', () => {
    const format = mpvPlaybackFormat({ videoTrack: { codec: 'vc1' } }, null);
    expect(format?.video).toEqual({ codec: 'vc1' });
    expect(format?.videoOut).toEqual({});
    expect(format?.audio).toBeNull();
    expect(mpvPlaybackFormat({}, null)).toBeNull();
  });
});

describe('mpvPlaybackFormat audio', () => {
  test('TrueHD Atmos passthrough keeps its objects in a MAT bitstream', () => {
    const format = mpvPlaybackFormat({
      audioTrack: truehd,
      'audio-params': { format: 's32', samplerate: 48000, 'channel-count': 8 },
      'audio-out-params': { format: 'spdif-truehd', samplerate: 192000, 'channel-count': 8 },
    }, { route: 'hdmi' });
    expect(format?.audio).toEqual({ codec: 'truehd', profile: 'Dolby TrueHD + Dolby Atmos', channels: 8, layout: '7.1',
      sampleRate: 48000, immersive: 'atmos', language: 'eng' });
    expect(format?.audioOut).toEqual({ delivery: 'passthrough', codec: 'truehd', lossless: true, carrier: 'mat',
      exclusive: true, immersive: 'atmos', route: 'hdmi' });
  });

  test('DTS-HD MA decoded to exclusive 7.1 LPCM is lossless; objects are not claimed', () => {
    const format = mpvPlaybackFormat({
      audioTrack: { codec: 'dts', 'codec-profile': 'DTS-HD MA + DTS:X', 'demux-channel-count': 8, 'demux-samplerate': 48000, decoder: 'dca' },
      'audio-params': { format: 's32', samplerate: 48000, 'channel-count': 8 },
      'audio-out-params': { format: 's32', samplerate: 48000, 'channel-count': 8, 'hr-channels': '7.1' },
      volume: 100, speed: 1,
    }, { exclusive: true });
    expect(format?.audio?.immersive).toBe('dtsx');
    expect(format?.audioOut).toEqual({ delivery: 'decoded', codec: 'pcm', carrier: 'lpcm', channels: 8, layout: '7.1',
      sampleRate: 48000, bitDepth: 32, downmixed: false, resampled: false, decoderName: 'FFmpeg dca', lossless: true, exclusive: true });
  });

  test('a downmix, a resample or a volume change is not lossless', () => {
    const base = { audioTrack: truehd, 'audio-params': { format: 's32', samplerate: 48000, 'channel-count': 8 } };
    const downmix = mpvPlaybackFormat({ ...base, 'audio-out-params': { format: 'float', samplerate: 48000, 'channel-count': 2 } }, null);
    expect(downmix?.audioOut).toMatchObject({ downmixed: true, lossless: false });
    expect(downmix?.audioOut?.bitDepth).toBeUndefined();
    const resample = mpvPlaybackFormat({ ...base, 'audio-out-params': { format: 's32', samplerate: 44100, 'channel-count': 8 } }, null);
    expect(resample?.audioOut).toMatchObject({ resampled: true, lossless: false });
    const quiet = mpvPlaybackFormat({ ...base, volume: 80, 'audio-out-params': { format: 's32', samplerate: 48000, 'channel-count': 8 } }, null);
    expect(quiet?.audioOut?.lossless).toBe(false);
  });

  test('lossy sources are never lossless and a 16-bit decode proves a 16-bit source', () => {
    const format = mpvPlaybackFormat({
      audioTrack: { codec: 'eac3', 'codec-profile': 'Dolby Digital Plus + Dolby Atmos', 'demux-channel-count': 6 },
      'audio-params': { format: 'floatp', samplerate: 48000 },
      'audio-out-params': { format: 'float', samplerate: 48000, 'channel-count': 6 },
    }, null);
    expect(format?.audio).toMatchObject({ immersive: 'atmos' });
    expect(format?.audio?.bitDepth).toBeUndefined();
    expect(format?.audioOut).toMatchObject({ delivery: 'decoded', lossless: false });
    const cd = mpvPlaybackFormat({ audioTrack: { codec: 'flac' }, 'audio-params': { format: 's16' }, 'audio-out-params': { format: 's16', 'channel-count': 2 } }, null);
    expect(cd?.audio?.bitDepth).toBe(16);
    expect(cd?.audioOut?.lossless).toBe(true);
  });
});

describe('format helpers', () => {
  test('pixel formats', () => {
    expect(pixelBitDepth('yuv420p10')).toBe(10);
    expect(pixelBitDepth('yuv420p10le')).toBe(10);
    expect(pixelBitDepth('yuv420p12')).toBe(12);
    expect(pixelBitDepth('p010')).toBe(10);
    expect(pixelBitDepth('p016')).toBe(16);
    expect(pixelBitDepth('nv12')).toBe(8);
    expect(pixelBitDepth('yuv420p')).toBe(8);
    expect(pixelBitDepth('d3d11')).toBeUndefined();
  });
  test('Dolby Vision profile names', () => {
    expect(dolbyVisionProfile(8, 1)).toBe('8.1');
    expect(dolbyVisionProfile(8, 4)).toBe('8.4');
    expect(dolbyVisionProfile(5, 0)).toBe('5');
    expect(dolbyVisionProfile(7, 6)).toBe('7');
    expect(dolbyVisionProfile(8, undefined)).toBe('8');
    expect(dolbyVisionProfile(undefined, 1)).toBeUndefined();
  });
});

describe('mpvCapabilities', () => {
  test('an HDR display and a TrueHD/DTS-HD receiver', () => {
    const caps = mpvCapabilities({ hdrDisplay: true, passthrough: ['ac3', 'eac3', 'dts', 'dts-hd', 'truehd', 'bogus'], maxChannels: 8, maxSampleRate: 192000, hardwareVideo: ['hevc'] });
    expect(caps.hdr).toEqual(['hdr10', 'hdr10+', 'hlg']);
    expect(caps.hdr).not.toContain('dv');
    expect(caps.dolbyVisionReshape).toContain('5');
    expect(caps.audioOutput).toEqual({ passthrough: ['ac3', 'eac3', 'dts', 'dts-hd', 'truehd', 'eac3-joc'],
      immersive: ['eac3-joc', 'truehd-atmos', 'dtsx'], maxChannels: 8, maxSampleRate: 192000, lossless: true });
    expect(caps.originalPlayback?.demuxContainers).toEqual(expect.arrayContaining(['mkv', 'mp4', 'mpegts', 'avi', 'mov']));
    expect(caps.originalPlayback?.audioDecoders).toEqual(expect.arrayContaining(['truehd', 'dts', 'flac', 'pcm_bluray']));
    expect(caps.originalPlayback?.videoDecoders).toEqual(expect.arrayContaining(['hevc', 'av1', 'vc1', 'mpeg2video']));
  });
  test('SDR display and stereo PCM output: no HDR, nothing passed through, still lossless decode', () => {
    const caps = mpvCapabilities({ hdrDisplay: false, passthrough: [], maxChannels: 2 });
    expect(caps.hdr).toEqual([]);
    expect(caps.audioOutput).toEqual({ passthrough: [], immersive: [], maxChannels: 2, lossless: true });
  });
});

describe('windowsSnapshot with mpv facts', () => {
  test('format is mapped and subtitle appearance becomes available', () => {
    const subtitles = { subtitleSize: 'large', subtitleBackground: 'box', subtitleColor: 'yellow', subtitlePosition: 'raised', offsetSeconds: 0 } as const;
    const snapshot = windowsSnapshot({ state: 'playing', mpv: { videoTrack: { codec: 'h264' } } }, { plan: plan() }, subtitles);
    expect(snapshot.format?.video).toEqual({ codec: 'h264' });
    expect(snapshot.subtitleStyleAvailable).toBe(true);
    expect(snapshot.subtitleStyle).toEqual(subtitles);
    const legacy = windowsSnapshot({ state: 'playing' }, { plan: plan() });
    expect(legacy.format).toBeNull();
    expect(legacy.subtitleStyleAvailable).toBe(false);
  });
});
