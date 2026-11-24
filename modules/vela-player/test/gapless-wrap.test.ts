import { expect, test } from 'bun:test';
import { adtsHeader, flacStreamHeader } from '../web/gapless/wrap';

// Pages without WebCodecs decode batches of packets as small files of their own: FLAC frames behind the
// stream header, AAC frames behind ADTS headers.

test('an ADTS header carries the AAC-LC profile, rate, channels and frame length', () => {
  // AudioSpecificConfig 0x12 0x10: AAC-LC, 44.1 kHz (index 4), stereo.
  const header = adtsHeader(new Uint8Array([0x12, 0x10]), { sampleRate: 44100, numberOfChannels: 2 }, 371);
  expect([...header]).toEqual([0xff, 0xf1, 0x50, 0x80, 0x2f, 0x5f, 0xfc]);
  const length = ((header[3]! & 3) << 11) | (header[4]! << 3) | (header[5]! >> 5);
  expect(length).toBe(378);
  // Without a config, the declared rate and channels as AAC-LC.
  expect([...adtsHeader(null, { sampleRate: 48000, numberOfChannels: 1 }, 100)].slice(0, 4)).toEqual([0xff, 0xf1, 0x4c, 0x40]);
});

test('a FLAC header for part of a stream keeps STREAMINFO but clears its length and checksum', () => {
  const info = Uint8Array.from({ length: 34 }, (_, i) => i + 1);
  const description = new Uint8Array([0x66, 0x4c, 0x61, 0x43, 0x80, 0, 0, 34, ...info]);
  const header = flacStreamHeader(description);
  expect([...header.subarray(0, 8)]).toEqual([0x66, 0x4c, 0x61, 0x43, 0x80, 0, 0, 34]);
  // Block sizes, frame sizes, rate, channels and depth stay; the total sample count's low 36 bits and the MD5 go.
  expect([...header.subarray(8, 21)]).toEqual([...info.subarray(0, 13)]);
  expect(header[21]).toBe(info[13]! & 0xf0);
  expect([...header.subarray(22)]).toEqual(new Array(20).fill(0));
  expect([...flacStreamHeader(info)]).toEqual([...header]);
});
