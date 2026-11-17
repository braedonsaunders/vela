import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createVela } from '../src/store';
import type { VelaPlatform } from '../src/store/platform';
import { launchMock, type RunningMock } from '../../../mock-server/test/launch';
import { ServerRegistry } from '../src/session/servers';
import { MemoryStore } from './helpers';

let mock: RunningMock;
beforeAll(async () => { mock = await launchMock(); });
afterAll(async () => { await mock?.stop(); });
const device = { id: 'fixture-browser-device-123', name: 'Browser', platform: 'web', appVersion: '0.2.9' };
async function code(expired = false): Promise<string> {
  return (await (await fetch(`${mock.url}/__admin/web-code${expired ? '?expired=1' : ''}`, { method: 'POST' })).json()).code;
}
function app(secrets: MemoryStore, webCode: string) {
  return createVela({ etherOrigin: mock.url, secrets, device, appVersion: '0.2.9', rendererVersion: 17,
    media: { containers: [], videoCodecs: [], audioCodecs: [], subtitleFormats: [], hls: { native: false, fmp4: false, mpegTs: false } },
    page: { origin: mock.url, webCode }, artWidth: 640 } as VelaPlatform & { rendererVersion: number });
}

test('redeems once, replaces a stored viewer, and persists a valid stable device and normal tokens', async () => {
  const secret = new MemoryStore();
  secret.set('vela.device', 'old-id');
  secret.set('vela.session', JSON.stringify({ accessToken: 'old', refreshToken: 'old', expiresAt: '2099-01-01', viewer: { id: 'old-user', name: 'Old viewer', policyRevision: '1' } }));
  const registry = new ServerRegistry(secret, mock.url);
  registry.select(registry.add('jellyfin', 'Other server', 'http://127.0.0.1:1').id);
  const issued = await code(); expect(issued.length).toBe(43);
  const store = app(secret, issued);
  const first = store.auth.start(); expect(store.auth.start()).toBe(first); await first;
  expect(store.getState().auth.phase).toBe('signed-in');
  expect(store.getState().auth.serverId).toBe('ether');
  const tokens = JSON.parse(secret.get('vela.session')!);
  expect(tokens.viewer.id).toBe('viewer-demo');
  expect(tokens.accessToken).not.toBe('old');
  expect(secret.get('vela.device')!.length).toBeGreaterThanOrEqual(16);
  const deviceId = secret.get('vela.device');
  await store.auth.start(); expect(secret.get('vela.device')).toBe(deviceId);
  const replay = await fetch(`${mock.url}/vela/v0/auth/web-code/redeem`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), code: issued, device: { ...device, id: deviceId } }) });
  expect(replay.status).toBe(401);
});

test('expired links clear an old session and show the translated sign-in notice', async () => {
  const secret = new MemoryStore(); secret.set('vela.session', JSON.stringify({ accessToken: 'old', refreshToken: 'old', viewer: { id: 'old' } }));
  const store = app(secret, await code(true)); await store.auth.start();
  expect(store.getState().auth.phase).toBe('signed-out');
  expect(store.getState().auth.error).toBe('This sign-in link expired. Choose Watch in Ether again.');
  expect(secret.get('vela.session')).toBe('');
});

test('the mock rejects short device IDs without consuming the code', async () => {
  const issued = await code();
  const redeem = (id: string) => fetch(`${mock.url}/vela/v0/auth/web-code/redeem`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), code: issued, device: { ...device, id } }) });
  expect((await redeem('too-short')).status).toBe(401);
  expect((await redeem(device.id)).status).toBe(200);
});


test('a live handoff replaces an already-running session and drops the previous catalogue', async () => {
  const secret = new MemoryStore(), store = app(secret, await code());
  await store.auth.start(); await store.home.ensure();
  expect(store.getState().home.value).toBeDefined();
  const previous = JSON.parse(secret.get('vela.session')!).accessToken;
  expect(await store.auth.signInWithWebCode(await code())).toBe(true);
  expect(JSON.parse(secret.get('vela.session')!).accessToken).not.toBe(previous);
  expect(store.getState().home.value).toBeUndefined();
});


test('a newer live link wins over a pending older handoff', async () => {
  const secret = new MemoryStore(), store = app(secret, await code());
  await store.auth.start();
  const newer = await code();
  const old = store.auth.signInWithWebCode('expired-link');
  const latest = store.auth.signInWithWebCode(newer);
  expect(await old).toBe(false);
  expect(await latest).toBe(true);
  expect(store.getState().auth.phase).toBe('signed-in');
  expect(store.getState().auth.error).toBe('');
});
