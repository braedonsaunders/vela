import { afterEach, expect, test } from 'bun:test';
import { avcDecodedPictureBufferFrames } from '../web/engine/core/decode/avc-buffer';
import { NativeVideoDecoder, nativeFrameBound, type NativeVideoFrame } from '../web/engine/core/decode/native-video';
import { VideoBuffer } from '../web/engine/core/buffer';
import type { VideoTrack } from '../web/engine/core/types';

function bytes(hex: string) {
  return new Uint8Array(hex.match(/../g)!.map((value) => Number.parseInt(value, 16)));
}

function configuration(spsHex: string): VideoDecoderConfig {
  const sps = bytes(spsHex);
  const description = new Uint8Array(8 + sps.length);
  description.set([1, sps[1]!, sps[2]!, sps[3]!, 0xff, 0xe1, sps.length >> 8, sps.length & 0xff]);
  description.set(sps, 8);
  return { codec: `avc1.${[1, 2, 3].map((index) => sps[index]!.toString(16).padStart(2, '0')).join('')}`, description };
}

// Ether's live tile renditions (High@L3.1, VUI without a bitstream restriction), from the lab.
const TILE_480 = configuration('2764001fac5680d83de7e6a040402040');
const TILE_720 = configuration('2764001fac56805005ba6a04040204');

test('a Level 3.1 852x480 rendition buffers eleven frames; 1280x720 five', () => {
  expect(avcDecodedPictureBufferFrames(TILE_480)).toBe(11);
  expect(avcDecodedPictureBufferFrames(TILE_720)).toBe(5);
});

test('only a stream whose decoder can hold more than the presentation frames gets a larger bound', () => {
  expect(nativeFrameBound(null)).toBe(8);
  expect(nativeFrameBound(5)).toBe(8);
  expect(nativeFrameBound(6)).toBe(8);
  expect(nativeFrameBound(11)).toBe(19);
  expect(nativeFrameBound(16)).toBe(24);
});

test('the presentation queue takes the bound it is resized to', () => {
  const buffer = new VideoBuffer(8);
  const frame = (timestampUs: number) => ({ epoch: 1, timestampUs, durationUs: 33_333, release() {} });
  buffer.resize(10);
  for (let index = 0; index < 10; index++) buffer.push(frame(index * 33_333), 1);
  expect(buffer.full).toBe(true);
  expect(() => buffer.push(frame(400_000), 1)).toThrow('presentation backpressure');
  expect(() => buffer.resize(0)).toThrow();
});

/** A WebCodecs decoder that keeps `window` frames for reordering before its first output, as
 * VideoToolbox does for an H.264 stream without a bitstream restriction. */
class ReorderingDecoder {
  static window = 11;
  static isConfigSupported = async () => ({ supported: true });
  state: 'unconfigured' | 'configured' | 'closed' = 'unconfigured';
  private queue: { timestamp: number; duration: number }[] = [];
  constructor(private readonly init: { output(frame: unknown): void; error(error: unknown): void }) {}
  configure() { this.state = 'configured'; }
  decode(chunk: { timestamp: number; duration: number }) {
    this.queue.push({ timestamp: chunk.timestamp, duration: chunk.duration });
    while (this.queue.length > ReorderingDecoder.window) {
      const next = this.queue.shift()!;
      this.init.output({ ...next, close() {} });
    }
  }
  async flush() {}
  close() { this.state = 'closed'; }
}

const original = (globalThis as { VideoDecoder?: unknown }).VideoDecoder;
const originalChunk = (globalThis as { EncodedVideoChunk?: unknown }).EncodedVideoChunk;
afterEach(() => {
  (globalThis as { VideoDecoder?: unknown }).VideoDecoder = original;
  (globalThis as { EncodedVideoChunk?: unknown }).EncodedVideoChunk = originalChunk;
});

test('an eleven-frame reordering decoder shows its first picture instead of waiting forever', async () => {
  (globalThis as { VideoDecoder?: unknown }).VideoDecoder = ReorderingDecoder;
  (globalThis as { EncodedVideoChunk?: unknown }).EncodedVideoChunk = class { constructor(init: object) { Object.assign(this, init); } };
  const outputs: NativeVideoFrame[] = [];
  const decoder = new NativeVideoDecoder((frame) => outputs.push(frame), (error) => { throw error; });
  const track = { kind: 'video', id: 'v', codec: 'avc', width: 852, height: 480, rotation: 0, config: TILE_480, color: {}, fieldOrder: null } as unknown as VideoTrack;
  const signal = new AbortController().signal;
  await decoder.configure(track, 1, signal);
  expect(decoder.frameBound).toBe(19);
  const packet = (index: number) => ({ trackId: 'v', timestampUs: index * 33_333, durationUs: 33_333, key: index === 0, data: new Uint8Array(4), epoch: 1 });
  // Twelve packets in: the decoder's eleven-frame window plus one, which brings the first frame out.
  const decoding = (async () => { for (let index = 0; index < 12; index++) await decoder.decode(packet(index), signal); })();
  const settled = await Promise.race([decoding.then(() => 'decoded'), new Promise((resolve) => setTimeout(() => resolve('stalled'), 200))]);
  expect(settled).toBe('decoded');
  expect(outputs.length).toBe(1);
  expect(outputs[0]!.timestampUs).toBe(0);
  decoder.dispose();
});
