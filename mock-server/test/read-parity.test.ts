import { expect, test } from 'bun:test';
import type * as V from '../../packages/protocol/types';
import { launchMock } from './launch';

test('the frozen mock preserves the fixture locator and reading progress after a page turn', async () => {
  const now = '2026-11-26T15:00:00.000Z';
  const mock = await launchMock({ VELA_MOCK_READ_FREEZE: '1', VELA_MOCK_NOW: now });
  try {
    const path = (at: string) => mock.url + '/vela/v0' + at;
    const device: V.Device = { id: 'read-parity', name: 'Test', platform: 'web', appVersion: '0.2.72' };
    const login = await fetch(path('/auth/sign-in'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'demo', password: 'vela', device, idempotencyKey: 'read-parity-sign-in' }),
    });
    expect(login.status).toBe(200);
    const tokens = await login.json() as V.Tokens;
    const headers = { Authorization: `Bearer ${tokens.accessToken}`, 'X-Vela-Device-Id': device.id };
    const title = '/titles/book-harbour-of-bells';
    const detail = async () => (await (await fetch(path(title), { headers })).json() as V.TitleDetail).title.watch;
    const original = await detail();
    expect(original).toMatchObject({ played: false, reading: {
      fraction: 0.34, locator: 'epubcfi(/6/8!/4/2/10/1:20)', updatedAt: '2026-11-25T15:00:00.000Z',
    } });
    const changed = await fetch(path(`${title}/reading-progress`), {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ locator: 'finished', fraction: 0.99, idempotencyKey: 'read-parity-done' }),
    });
    expect(changed.status).toBe(200);
    expect(await changed.json()).toEqual({ accepted: true });
    expect(await detail()).toEqual(original);
  } finally {
    await mock.stop();
  }
});
