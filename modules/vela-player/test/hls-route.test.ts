import { expect, test } from 'bun:test';
import { hlsBackend, type HlsRouteFacts } from '../web/engine/hls-route';

// Chrome on https or localhost, with the core payload: the packet runtime plays live and on-demand HLS.
const secureChrome: HlsRouteFacts = {
  packetOffered: true,
  packetCapable: true,
  packetFailed: false,
  segmentsFailed: false,
  mediaSource: true,
  nativeHls: true,
  apple: false,
  managedMediaSource: false,
  renditions: [],
};
// The same Chrome on a plain-http LAN address: no WebCodecs or WebGPU, MSE still there.
const insecureChrome: HlsRouteFacts = { ...secureChrome, packetCapable: false };
const ladder = [{ known: true, supported: true }];

test('a secure page plays HLS through the packet runtime', () => {
  expect(hlsBackend(secureChrome)).toBe('packet');
  expect(hlsBackend({ ...secureChrome, renditions: ladder })).toBe('packet');
});

test("a plain-http page plays Ether's ladder-less live through the segment pipeline, not Chrome's HLS", () => {
  expect(hlsBackend(insecureChrome)).toBe('mse');
  expect(hlsBackend({ ...insecureChrome, renditions: ladder })).toBe('mse');
  // Codecs the server has not verified yet are still the pipeline's (it waits for them).
  expect(hlsBackend({ ...insecureChrome, renditions: [{ known: false, supported: false }] })).toBe('mse');
});

test('the packet runtime failing moves a route to the pipeline, and the pipeline failing to native HLS', () => {
  expect(hlsBackend({ ...secureChrome, packetFailed: true })).toBe('mse');
  expect(hlsBackend({ ...secureChrome, packetFailed: true, segmentsFailed: true })).toBe('native');
  expect(hlsBackend({ ...insecureChrome, segmentsFailed: true, renditions: ladder })).toBe('native');
  // Firefox has no HLS of its own: nothing is left.
  expect(hlsBackend({ ...insecureChrome, nativeHls: false, segmentsFailed: true })).toBeNull();
});

test('codecs MSE cannot take go to native HLS where the browser has it', () => {
  const unsupported = [{ known: true, supported: false }];
  expect(hlsBackend({ ...insecureChrome, renditions: unsupported })).toBe('native');
  expect(hlsBackend({ ...insecureChrome, nativeHls: false, renditions: unsupported })).toBeNull();
});

test("Safari keeps its own HLS where the pipeline adds nothing", () => {
  const safari: HlsRouteFacts = { ...insecureChrome, apple: true };
  expect(hlsBackend(safari)).toBe('native');
  expect(hlsBackend({ ...safari, renditions: ladder })).toBe('native');
  // With ManagedMediaSource and a ladder, Vela's quality control is worth it.
  expect(hlsBackend({ ...safari, managedMediaSource: true, renditions: ladder })).toBe('mse');
  // A secure Safari with WebGPU still plays through the packet runtime.
  expect(hlsBackend({ ...safari, packetCapable: true })).toBe('packet');
});

test('a bundle without the packet runtime, or a browser without MSE', () => {
  expect(hlsBackend({ ...secureChrome, packetOffered: false })).toBe('mse');
  expect(hlsBackend({ ...insecureChrome, mediaSource: false })).toBe('native');
  expect(hlsBackend({ ...insecureChrome, mediaSource: false, nativeHls: false })).toBeNull();
});
