// VELA_MOCK_SPORTS_FREEZE=1: the Sports state every parity capture compares must not move.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type * as V from '../../packages/protocol/types';
import { launchMock, type RunningMock } from './launch';
import { frozenNow } from '../sports';

const NOW = '2026-11-24T20:00:00.000Z';
const device: V.Device = { id: 'sports-freeze-device', name: 'Test', platform: 'web', appVersion: '0.2.0' };
let mock: RunningMock;
let tokens: V.Tokens;

beforeAll(async () => {
  mock = await launchMock({ VELA_MOCK_SPORTS_FREEZE: '1', VELA_MOCK_SPORTS_NOW: NOW, VELA_MOCK_LIVE_TICK_MS: '20' });
  const response = await fetch(`${mock.url}/vela/v0/auth/sign-in`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'demo', password: 'vela', device, idempotencyKey: 'freeze-sign-in' }) });
  tokens = await response.json() as V.Tokens;
});
afterAll(async () => { await mock?.stop(); });

const get = (path: string) => fetch(`${mock.url}/vela/v0${path}`, { headers: { Authorization: `Bearer ${tokens.accessToken}`, 'X-Vela-Device-Id': device.id } });
const admin = (body: object) => fetch(`${mock.url}/__admin/sports`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());

describe('frozenNow', () => {
  test('is off unless the freeze is asked for', () => {
    expect(frozenNow({})).toBeUndefined();
    expect(frozenNow({ VELA_MOCK_SPORTS_FREEZE: '0', VELA_MOCK_SPORTS_NOW: NOW })).toBeUndefined();
  });
  test('takes the given instant, else 15:00 local on the starting day', () => {
    expect(frozenNow({ VELA_MOCK_SPORTS_FREEZE: '1', VELA_MOCK_SPORTS_NOW: NOW })).toBe(Date.parse(NOW));
    const started = new Date(2026, 10, 24, 9, 41).getTime();
    expect(frozenNow({ VELA_MOCK_SPORTS_FREEZE: '1' }, started)).toBe(new Date(2026, 10, 24, 15, 0).getTime());
    expect(frozenNow({ VELA_MOCK_SPORTS_FREEZE: '1', VELA_MOCK_SPORTS_NOW: 'soon' }, started)).toBe(new Date(2026, 10, 24, 15, 0).getTime());
  });
});

describe('mock server: frozen sports', () => {
  test('the screen and a live game read the same however long apart', async () => {
    const first = await (await get('/screens/sports')).text();
    const game = await (await get('/live/events/sports:sports:nfl-nyg-phi')).text();
    await Bun.sleep(300); // fifteen ticks, were the clock running
    expect(await (await get('/screens/sports')).text()).toBe(first);
    expect(await (await get('/live/events/sports:sports:nfl-nyg-phi')).text()).toBe(game);
    const live = JSON.parse(game) as V.LiveEventDetail;
    expect(live.status.detail).toBe('Q4 · 2:14');
    expect(live.updatedAt).toBe(NOW);
  });

  test('admin reports the frozen instant and can delay or fail the reads', async () => {
    expect(await admin({})).toMatchObject({ now: NOW, frozen: true, screenDelayMs: 0, screenFail: false });
    await admin({ screenFail: true });
    expect((await get('/screens/sports')).status).toBe(503);
    expect((await get('/live/events/sports:sports:nfl-nyg-phi')).status).toBe(503);
    await admin({ screenFail: false, screenDelayMs: 250 });
    const started = Date.now();
    expect((await get('/screens/sports')).status).toBe(200);
    expect(Date.now() - started).toBeGreaterThanOrEqual(240);
    await admin({ screenDelayMs: 0 });
  });
});
