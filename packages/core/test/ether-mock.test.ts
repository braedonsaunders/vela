// The Ether adapter and the live guide end to end against the fixture-backed mock server.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { EtherAdapter } from '../src/adapter/ether';
import { loadGuide } from '../src/live/guide';
import { launchMock, type RunningMock } from '../../../mock-server/test/launch';
import { FakeCredentials } from './helpers';

const CHANNELS = 40;
let mock: RunningMock;
let credentials: FakeCredentials;
let adapter: EtherAdapter;

beforeAll(async () => {
  mock = await launchMock({ VELA_MOCK_CHANNELS: String(CHANNELS) });
  credentials = new FakeCredentials(null);
  adapter = new EtherAdapter(mock.url, credentials, 'test-client');
  credentials.current = await adapter.signInWithPassword({ username: 'demo', password: 'vela', device: credentials.device, idempotencyKey: 'sign-in' });
});
afterAll(async () => { await mock?.stop(); });

describe('EtherAdapter against the mock server', () => {
  test('describes the server and reads home', async () => {
    const description = await adapter.describe();
    expect(description.server.id).toBe('ether-mock');
    const home = await adapter.home();
    expect(home.viewer.id).toBe('viewer-demo');
    expect(home.rows.length).toBeGreaterThan(0);
  });

  test('validating a session rotates it', async () => {
    const before = credentials.current!;
    const after = await adapter.validateSession();
    expect(after?.accessToken).not.toBe(before.accessToken);
    expect(credentials.current).toEqual(after);
    expect((await adapter.libraries({})).items.length).toBeGreaterThan(0);
  });

  test('loads a whole guide day across pages', async () => {
    const now = Date.now();
    const model = await loadGuide(adapter, 0, now, 'mock-day');
    expect(model.channels).toHaveLength(CHANNELS);
    // Favourites (the first six fixture channels) come first.
    expect(model.channels.slice(0, 6).every(c => c.favorite)).toBe(true);
    // Every fourth fixture channel has no listings.
    expect(model.channels.find(c => c.id === 'channel-4')?.listed).toBe(false);
    const listed = model.channels.find(c => c.id === 'channel-3')!;
    expect(listed.listed).toBe(true);
    expect(listed.now).not.toBe('');
    for (const p of listed.programmes) {
      expect(p.at).toBeGreaterThanOrEqual(0);
      expect(p.at + p.span).toBeLessThanOrEqual(model.minutes);
    }
    expect(listed.programmes.filter(p => p.airing)).toHaveLength(1);
  });

  test('loads only the requested channels\' listings', async () => {
    const model = await loadGuide(adapter, 1, Date.now(), 'mock-selected', undefined, undefined, ['channel-2', 'channel-7']);
    expect(model.channels.filter(c => c.listed).map(c => c.id).sort()).toEqual(['channel-2', 'channel-7']);
    expect(model.channels.filter(c => c.listingsLoaded).map(c => c.id).sort()).toEqual(['channel-2', 'channel-7']);
  });

  test('fast search returns live channels', async () => {
    const result = await adapter.search({ query: 'world news', generation: 1, idempotencyKey: 'search-1' });
    expect(result.live?.channels.map(c => c.id)).toEqual(['channel-1']);
  });
});
