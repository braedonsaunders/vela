import { expect, test } from 'bun:test';
import type { PlayerCapabilities } from '@vela/player-api';
import { audioEngineCapabilities } from '../web/audio-capabilities';
import { completeStream } from '../web/gapless/length';
import { nativeAudioCapabilities } from '../src/audio';

// What audio requests declare, and when the gapless player may read a stream as a whole file.

test("the page's audio engine declares what either of its players plays, lossless included", () => {
  // Chromium's <audio> (as in the Electron shells): FLAC, MP3, AAC, Opus, Vorbis and WAV, no ALAC or Dolby.
  const chromium = new Set(['audio/flac', 'audio/mpeg', 'audio/mp4; codecs="mp4a.40.2"', 'audio/ogg; codecs="opus"', 'audio/ogg; codecs="vorbis"', 'audio/wav; codecs="1"']);
  const caps = audioEngineCapabilities(mime => chromium.has(mime), new Set(['flac', 'aac', 'mp3', 'opus']), false);
  expect(caps.audioCodecs).toEqual(['flac', 'pcm', 'aac', 'mp3', 'opus', 'vorbis']);
  expect(caps.containers).toEqual(['flac', 'wav', 'mp4', 'm4a', 'm4b', 'aac', 'mp3', 'ogg', 'webm']);
  expect(caps).toMatchObject({ videoCodecs: [], subtitleFormats: [], hls: false, mse: false });
});

test('a codec only WebCodecs decodes (the gapless player) is declared too', () => {
  const caps = audioEngineCapabilities(() => false, new Set(['flac']), false);
  expect(caps.audioCodecs).toEqual(['flac']);
  expect(caps.containers).toEqual(['flac']);
  // Nothing playable: nothing declared, so the server transcodes to what the engine plays.
  expect(audioEngineCapabilities(() => false, new Set(), true)).toMatchObject({ audioCodecs: [], containers: [], hls: true });
});

test('a device declares exactly what its native audio player opens, not the video decoders', () => {
  const aether: PlayerCapabilities = { containers: ['mp4', 'mkv'], videoCodecs: ['h264', 'hevc'], audioCodecs: ['aac', 'ac3', 'eac3', 'dts', 'truehd'], subtitleFormats: ['webvtt'], hls: true, mse: false };
  const ios = nativeAudioCapabilities(aether, 'ios');
  expect(ios.audioCodecs).toEqual(['aac', 'mp3', 'alac', 'flac', 'pcm']);
  expect(ios.containers).toContain('flac');
  expect(ios).toMatchObject({ videoCodecs: [], hls: true });
  expect(nativeAudioCapabilities(aether, 'android').audioCodecs).toContain('opus');
  expect(nativeAudioCapabilities(aether, 'web')).toBe(aether);
});

const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name.toLowerCase()] ?? null });

test("a transcode still being produced is not a complete file (Ether's live stream.m4a)", () => {
  // What Ether answered for Range: bytes=0- while transcoding: 200, chunked, no length, no ranges.
  expect(completeStream(200, headers({ 'content-type': 'audio/mp4', 'transfer-encoding': 'chunked', 'accept-ranges': 'none' }))).toBe(false);
  // A range of a resource whose total is not known yet.
  expect(completeStream(206, headers({ 'content-range': 'bytes 0-728/*' }))).toBe(false);
  expect(completeStream(200, headers({ 'content-length': 'soon' }))).toBe(false);
});

test('a file served whole or by range is complete, also when a cross-origin page cannot see Content-Range', () => {
  expect(completeStream(206, headers({ 'content-range': 'bytes 0-34943805/34943806', 'content-length': '34943806' }))).toBe(true);
  expect(completeStream(200, headers({ 'content-length': '8152230' }))).toBe(true);
  expect(completeStream(206, headers({ 'content-length': '65536' }))).toBe(true);
});
