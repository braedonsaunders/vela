// A player's adaptive-HLS declaration reaches only a server that offers it (Ether 0.3.25 features.adaptiveHLS).
import { expect, test } from 'bun:test';
import { serverFeatures } from '../src/store/session';
import type { ClientCapabilities } from '../src/wire';

const client = { device: { id: 'd', name: 'TV', platform: 'android', appVersion: '1' }, protocolVersions: [0], containers: [], videoCodecs: [],
  audioCodecs: [], subtitleFormats: [], hls: true, mse: false, features: { adaptiveHLS: true } } as ClientCapabilities;

test('the declaration goes to a server with features.adaptiveHLS, and nowhere else', () => {
  expect(serverFeatures(client, { adaptiveHLS: { available: true } } as never).features).toEqual({ adaptiveHLS: true });
  expect('features' in serverFeatures(client, { adaptiveHLS: { available: false } } as never)).toBe(false);
  expect('features' in serverFeatures(client, undefined)).toBe(false);
  const plain = { ...client, features: undefined };
  delete (plain as { features?: unknown }).features;
  expect(serverFeatures(plain, { adaptiveHLS: { available: true } } as never)).toBe(plain);
});
