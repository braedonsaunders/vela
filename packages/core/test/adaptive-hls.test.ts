// A player's adaptive-HLS declaration reaches only a server that offers it (Ether 0.3.25 features.adaptiveHLS).
import { expect, test } from 'bun:test';
import { serverFeatures } from '../src/store/session';
import type { ClientCapabilities } from '../src/wire';

const client = { device: { id: 'd', name: 'TV', platform: 'android', appVersion: '1' }, protocolVersions: [0], containers: [], videoCodecs: [],
  audioCodecs: [], subtitleFormats: [], hls: true, mse: false, features: { adaptiveHLS: true } } as ClientCapabilities;

test('the server\'s adaptive-HLS feature survives advertising', async () => {
  const { advertise } = await import('../src/adapter/advertise');
  expect(advertise({} as never, { features: { adaptiveHLS: { available: true } } } as never).features.adaptiveHLS).toEqual({ available: true });
  expect(advertise({} as never, { features: {} } as never).features.adaptiveHLS).toBeUndefined();
});

test('the declaration goes to a server with features.adaptiveHLS, and nowhere else', () => {
  expect(serverFeatures(client, { adaptiveHLS: { available: true } } as never).features).toEqual({ adaptiveHLS: true });
  expect('features' in serverFeatures(client, { adaptiveHLS: { available: false } } as never)).toBe(false);
  expect('features' in serverFeatures(client, undefined)).toBe(false);
  const plain = { ...client, features: undefined };
  delete (plain as { features?: unknown }).features;
  expect(serverFeatures(plain, { adaptiveHLS: { available: true } } as never)).toBe(plain);
});

test('a watch deep-linked before Home reads the server features first, once, and declares adaptive HLS', async () => {
  const { Session } = await import('../src/store/session');
  const { Playback, initialPlayback } = await import('../src/store/playback');
  const { StateBox } = await import('../src/store/state');
  const { MemoryStore } = await import('./helpers');
  const media = { containers: ['mp4'], videoCodecs: ['h264'], audioCodecs: ['aac'], subtitleFormats: [], hls: true, mse: false, features: { adaptiveHLS: true } };
  const session = new Session({ secrets: new MemoryStore(), device: { name: 'TV', platform: 'android' }, appVersion: '1', media: Promise.resolve(media), artWidth: 1280 } as never);
  await session.declared();
  let described = 0;
  const requests: ClientCapabilities[] = [];
  const plan = { sessionId: 's1', sourceGeneration: 1, seekGeneration: 1, state: 'ready', paths: [], audioTracks: [], subtitleTracks: [] };
  const adapter = {
    describe: async () => { described++; return { features: { adaptiveHLS: { available: true } } }; },
    startPlayback: async (request: { client: ClientCapabilities }) => { requests.push(request.client); return plan; },
    sessionSnapshot: async () => ({ plan }), command: async () => plan, reportObservation: async () => ({ ok: true }),
  };
  // Home has not loaded: no features yet. The start must not depend on it.
  expect(session.features).toBeUndefined();
  Object.assign(session, { ready: async () => ({ adapter, credentials: { get: async () => null }, plan: (p: unknown) => p }), negotiate: async () => {} });
  const playback = new Playback(new StateBox({ playback: initialPlayback } as never), session, () => {}, () => {});
  await playback.start({ kind: 'title', id: 't1' });
  await playback.stop();
  await playback.start({ kind: 'title', id: 't2' });
  await playback.stop();
  expect(requests.map(client => client.features?.adaptiveHLS)).toEqual([true, true]);
  expect(described).toBe(1);
});
