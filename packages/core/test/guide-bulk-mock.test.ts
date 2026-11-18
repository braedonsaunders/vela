import { expect, test } from 'bun:test';
import { launchMock } from '../../../mock-server/test/launch';
import { EtherAdapter } from '../src/adapter/ether';
import { loadGuide } from '../src/live/guide';
import { FakeCredentials } from './helpers';

test('advertised complete windows work end to end and distinguish unavailable dense rows', async () => {
  const mock = await launchMock({ VELA_MOCK_GUIDE_SCALE: '1000', VELA_MOCK_GUIDE_WINDOW: '1', VELA_MOCK_GUIDE_UNAVAILABLE: 'scale-999' });
  try {
    const credentials = new FakeCredentials(null);
    const adapter = new EtherAdapter(mock.url, credentials, 'test-client');
    credentials.current = await adapter.signInWithPassword({ username: 'demo', password: 'vela', device: credentials.device, idempotencyKey: 'bulk-test' });
    expect((await adapter.describe()).liveGuideWindow).toEqual({ maxChannels: 128, maxWindowMinutes: 180 });
    const now = Date.now();
    const model = await loadGuide(adapter, 0, now, 'bulk-mock', undefined, undefined, ['scale-0', 'scale-999'], { from: -1, to: 0 });
    expect(model.channels).toHaveLength(1000);
    expect(model.channels[0]).toMatchObject({ id: 'scale-0', listingsLoaded: true, listed: true });
    expect(model.channels[999]).toMatchObject({ id: 'scale-999', listingsLoaded: false, listingsUnavailable: true });
    expect(model.retryAt).toBeGreaterThan(now);
    expect(model.retryAt!).toBeLessThanOrEqual(now + 65000);
  } finally { await mock.stop(); }
});
