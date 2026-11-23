import { expect, test } from 'bun:test';
import type { PlaybackFormat, PlaybackPlan, Snapshot } from '@vela/player-api';
import { audioOutputLine, audioSourceLine, channelLabel, formatLines, frameRateLabel, videoOutputLine, videoSourceLine } from '../src/widgets/player/format';
import { present } from '../src/widgets/player/present';

test('a UHD Blu-ray remux reads source to output: Profile 7 converted to 8.1, TrueHD Atmos rendered to 7.1.4 over MAT', () => {
  const format: PlaybackFormat = {
    video: { codec: 'hevc', profile: 'Main 10', bitDepth: 10, width: 3840, height: 2160, frameRate: 24000 / 1001, range: 'dv', dvProfile: '7', dvLayer: 'fel' },
    videoOut: { range: 'dv', dvProfile: '8.1', dvConversion: 'p7-to-8.1', decoder: 'hardware', frameRateMatch: 'matched', rangeMatch: 'matched' },
    audio: { codec: 'truehd', profile: 'Dolby TrueHD + Dolby Atmos', channels: 8, layout: '7.1', sampleRate: 48000, bitDepth: 24, immersive: 'atmos' },
    audioOut: { delivery: 'rendered', codec: 'pcm', channels: 12, layout: '7.1.4', sampleRate: 48000, bitDepth: 24, lossless: false, immersive: 'atmos', carrier: 'mat', route: 'hdmi', objectsActive: 11 },
  };
  const lines = formatLines(format);
  expect(lines.video).toBe('HEVC Main 10 · 3840×2160 · 23.976 fps · Dolby Vision P7 FEL');
  expect(lines.videoOut).toBe('Dolby Vision 8.1 (from Profile 7) · Hardware · Matched');
  expect(lines.audio).toBe('TrueHD Atmos · 7.1 · 48 kHz / 24-bit');
  expect(lines.audioOut).toBe('Rendered PCM · 7.1.4 · 48 kHz / 24-bit · Lossy · Atmos · Dolby MAT · 11 objects · HDMI');
});

test('lossless decode, passthrough and an ARC conversion each say what reached the receiver', () => {
  expect(audioOutputLine({ delivery: 'decoded', codec: 'pcm', channels: 8, sampleRate: 96000, bitDepth: 24, lossless: true, route: 'hdmi' }))
    .toBe('PCM · 7.1 · 96 kHz / 24-bit · Lossless · HDMI');
  expect(audioOutputLine({ delivery: 'passthrough', codec: 'eac3', channels: 6, immersive: 'atmos', lossless: true }))
    .toBe('Passthrough · E-AC-3 · 5.1 · Atmos');
  expect(audioOutputLine({ delivery: 'transcoded', codec: 'eac3', channels: 6, sampleRate: 48000, lossless: false, downmixed: true, resampled: true }))
    .toBe('Converted · E-AC-3 · 5.1 · 48 kHz · Lossy · Downmixed · Resampled');
  expect(audioOutputLine({ delivery: 'passthrough', codec: 'truehd', carrier: 'iec61937', exclusive: true, route: 'hdmi-earc' }))
    .toBe('Passthrough · TrueHD · Bitstream · Exclusive · HDMI eARC');
});

test('DTS-HD Master Audio and DTS:X are named from the profile, not the bare codec', () => {
  expect(audioSourceLine({ codec: 'dts', profile: 'DTS-HD MA + DTS:X', channels: 8, immersive: 'dtsx' })).toBe('DTS-HD MA DTS:X · 7.1');
  expect(audioSourceLine({ codec: 'dts', profile: 'DTS', channels: 6 })).toBe('DTS · 5.1');
});

test('frame rates keep their exact value and layouts their names', () => {
  expect(frameRateLabel(24000 / 1001)).toBe('23.976 fps');
  expect(frameRateLabel(24)).toBe('24 fps');
  expect(frameRateLabel(60000 / 1001)).toBe('59.94 fps');
  expect(channelLabel(8)).toBe('7.1');
  expect(channelLabel(6, '5.1(side)')).toBe('5.1');
  expect(channelLabel(2)).toBe('Stereo');
  expect(channelLabel(12)).toBe('12 ch');
});

test('unknown facts stay out, and a base-layer or mismatched picture says so', () => {
  expect(formatLines(null)).toEqual({ video: '', videoOut: '', audio: '', audioOut: '' });
  expect(videoSourceLine({ codec: 'h264' })).toBe('H.264');
  expect(videoOutputLine({ range: 'hdr10', dvConversion: 'base-layer', frameRateMatch: 'off', rangeMatch: 'off' })).toBe('HDR10 (base layer) · Match off');
  expect(videoOutputLine({ range: 'hdr10', frameRateMatch: 'matched', rangeMatch: 'unmatched' })).toBe('HDR10 · Frame rate Matched · Range Not matched');
  expect(videoOutputLine({ range: 'sdr', toneMapped: true, frameRateMatch: 'unsupported', rangeMatch: 'unsupported' })).toBe('SDR · Tone-mapped');
});

test('the view lists the delivery choices the engine honours, in its order, with their values', () => {
  const plan = { sessionId: 's', sourceGeneration: 1, seekGeneration: 1, selectedPathId: 'p', paths: [], audioTracks: [], subtitleTracks: [] } as unknown as PlaybackPlan;
  const snapshot = {
    sessionId: 's', sourceGeneration: 1, seekGeneration: 1, throughputHistory: [], capabilities: { pip: false, fullscreen: false, audioSwitch: true },
    outputPreferences: { surround: 'lossless', immersive: 'on', speakerLayout: '7.1.4', dolbyVision: 'auto' },
    outputPreferencesAvailable: ['surround', 'immersive', 'speakerLayout'],
  } as unknown as Snapshot;
  expect(present(plan, snapshot).output).toEqual([
    { name: 'surround', value: 'lossless' }, { name: 'immersive', value: 'on' }, { name: 'speakerLayout', value: '7.1.4' },
  ]);
  expect(present(plan, null).output).toEqual([]);
});

test('the subtitle delay steps from where it is, resets to zero and stays within ten minutes', async () => {
  const { nextSubtitleOffset } = await import('../src/widgets/player/present');
  expect(nextSubtitleOffset(0, '+0.1')).toBe(0.1);
  expect(nextSubtitleOffset(0.3, '-0.5')).toBe(-0.2);
  expect(nextSubtitleOffset(-2.75, '0')).toBe(0);
  expect(nextSubtitleOffset(599.9, '+0.5')).toBe(600);
});

test("libavcodec's dca reads as DTS", () => {
  expect(audioSourceLine({ codec: 'dca', profile: 'DTS', channels: 6 })).toBe('DTS · 5.1');
  expect(audioSourceLine({ codec: 'dca', profile: 'DTS-HD MA', channels: 8 })).toBe('DTS-HD MA · 7.1');
});
