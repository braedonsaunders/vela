import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type * as V from '../../packages/protocol/types';
import { launchMock, type RunningMock } from './launch';

const device: V.Device = { id: 'embed-device', name: 'Test', platform: 'web', appVersion: '0.1.0' };
let mock: RunningMock;
let headers: Record<string, string>;

beforeAll(async () => {
  mock = await launchMock({});
  const response = await fetch(`${mock.url}/vela/v0/auth/sign-in`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'demo', password: 'vela', device, idempotencyKey: 'embed-sign-in' }),
  });
  const tokens = await response.json() as V.Tokens;
  headers = { Authorization: `Bearer ${tokens.accessToken}`, 'X-Vela-Device-Id': device.id };
});
afterAll(async () => { await mock?.stop(); });

const admin = async (body: object) => (await fetch(`${mock.url}/__admin/trailer-embed`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})).json();
const capabilities = async () => (await (await fetch(`${mock.url}/vela/v0/capabilities`)).json()) as V.ServerCapabilities;
const extra = async (path = '/titles/title-1-2') => {
  const body = await (await fetch(`${mock.url}/vela/v0${path}`, { headers })).json() as V.TitleDetail | V.ExtrasResponse;
  return ('items' in body ? body.items : body.extras).find(item => item.id === 'extra-quiet-stars-trailer')!;
};

describe('mock server: YouTube trailers in the client embed', () => {
  test('advertises client embeds and sends clientPlayback beside the server option', async () => {
    await admin({ reset: true });
    expect((await capabilities()).features.trailerEmbed).toEqual({ available: true, mode: 'clientWhenPossible' });
    for (const path of ['/titles/title-1-2', '/titles/title-1-2/extras']) {
      expect(await extra(path)).toMatchObject({
        kind: 'trailer', availability: 'ready', source: 'youtube',
        clientPlayback: { provider: 'youtube', videoId: 'VelaMock001', embedUrl: 'https://www.youtube-nocookie.com/embed/VelaMock001' },
      });
    }
  });

  test('server mode keeps the source and drops clientPlayback; off is an older server', async () => {
    try {
      await admin({ mode: 'server' });
      expect((await capabilities()).features.trailerEmbed).toEqual({ available: true, mode: 'server' });
      const served = await extra();
      expect(served.source).toBe('youtube');
      expect(served.clientPlayback).toBeUndefined();
      await admin({ mode: 'off' });
      expect((await capabilities()).features.trailerEmbed).toBeUndefined();
      expect((await extra()).clientPlayback).toBeUndefined();
    } finally {
      await admin({ reset: true });
    }
  });

  test('the stand-in answers the embed message API to the requested origin only', async () => {
    const page = await fetch(`${mock.url}/embed/VelaMock001?autoplay=1&rel=0&enablejsapi=1&origin=http%3A%2F%2F127.0.0.1%3A1`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    const html = await page.text();
    expect(html).toContain('data-video="VelaMock001"');
    expect(html).toContain('"origin":"http://127.0.0.1:1"');
    expect(html).toContain('autoplay=1 · rel=0');
    expect(html).not.toMatch(/youtube\.com|ytimg|googlevideo/);
    expect((await fetch(`${mock.url}/embed/not-an-id`)).status).toBe(404);
    expect((await fetch(`${mock.url}/embed/VelaMock001/extra`)).status).toBe(404);
  });

  test('the player fault is set and restored through admin', async () => {
    expect(await admin({ player: 'error', errorCode: 101 })).toMatchObject({ player: 'error', errorCode: 101 });
    expect(await (await fetch(`${mock.url}/embed/VelaMock001?origin=x`)).text()).toContain('"player":"error","errorCode":101');
    expect(await admin({ player: 'nonsense' })).toMatchObject({ player: 'error' });
    expect(await admin({ reset: true })).toEqual({ mode: 'clientWhenPossible', player: 'play', errorCode: 150 });
  });
});
