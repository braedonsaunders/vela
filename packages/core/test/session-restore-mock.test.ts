// Restoring a stored session against the mock server while its refresh fails: a transient failure
// keeps the session and says so, Retry asks the server again (the app recovers without a
// relaunch), and a refused session goes to sign-in with the reason.
import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { createVela } from '../src/store';
import type { VelaPlatform } from '../src/store/platform';
import { launchMock, type RunningMock } from '../../../mock-server/test/launch';
import { MemoryStore } from './helpers';
import { refreshIdempotencyKey } from '../src/adapter/ether/transport';

let mock: RunningMock;
beforeAll(async () => { mock = await launchMock(); });
afterAll(async () => { await mock?.stop(); });
beforeEach(() => faults({ refreshFailSeconds: 0, refreshFailStatus: 500, refreshStallMs: 0, refreshAbandonMs: 0 }));

const device = { id: 'fixture-restore-device-123', name: 'Browser', platform: 'web', appVersion: '0.2.9' };
async function faults(change: Record<string, number>) {
  await fetch(`${mock.url}/__admin/faults`, { method: 'POST', body: JSON.stringify(change) });
}
/** One launch of the app over `secrets` (a relaunch is a new store over the same secrets). */
function launch(secrets: MemoryStore) {
  return createVela({ etherOrigin: mock.url, secrets, device, appVersion: '0.2.9', rendererVersion: 17,
    media: { containers: [], videoCodecs: [], audioCodecs: [], subtitleFormats: [], hls: { native: false, fmp4: false, mpegTs: false }, mse: false } as never,
    artWidth: 640 } as VelaPlatform & { rendererVersion: number });
}
async function signedIn(): Promise<MemoryStore> {
  const secrets = new MemoryStore();
  const store = launch(secrets);
  await store.auth.start();
  expect(await store.auth.signIn('demo', 'vela')).toBe(true);
  expect(JSON.parse(secrets.get('vela.session')!).viewer.name).toBe('Demo Viewer');
  return secrets;
}

test('a refresh the server fails keeps the session offline, and Retry signs in once it answers', async () => {
  const secrets = await signedIn();
  const saved = secrets.get('vela.session');
  await faults({ refreshFailSeconds: 600, refreshFailStatus: 500 });
  const store = launch(secrets);
  await store.auth.start();
  expect(store.getState().auth).toMatchObject({ phase: 'offline', restoring: false });
  expect(store.getState().auth.error).toContain('database is locked');
  expect(store.getState().auth.retryAt).toBeGreaterThan(Date.now());
  expect(secrets.get('vela.session')).toBe(saved);
  // Still failing: Retry really asks (and fails again) rather than answering from memory.
  await store.auth.retry();
  expect(store.getState().auth.phase).toBe('offline');
  await faults({ refreshFailSeconds: 0 });
  await store.auth.retry();
  expect(store.getState().auth).toMatchObject({ phase: 'signed-in', error: '', retryAt: 0, viewer: 'Demo Viewer' });
  expect(JSON.parse(secrets.get('vela.session')!).refreshToken).not.toBe(JSON.parse(saved!).refreshToken);
  store.auth.signOut();
});

test('a busy server (503 with Retry-After) is waited for at least as long as it asked', async () => {
  const secrets = await signedIn();
  await faults({ refreshFailSeconds: 600, refreshFailStatus: 503 });
  const store = launch(secrets);
  const before = Date.now();
  await store.auth.start();
  expect(store.getState().auth.phase).toBe('offline');
  expect(store.getState().auth.error).toContain('briefly unavailable');
  expect(store.getState().auth.retryAt - before).toBeGreaterThanOrEqual(5000);
  await faults({ refreshFailSeconds: 0 });
  await store.auth.retry();
  expect(store.getState().auth.phase).toBe('signed-in');
});

test('a refresh token the server refuses ends the session with a clear sign-in message', async () => {
  const secrets = await signedIn();
  const tokens = JSON.parse(secrets.get('vela.session')!);
  secrets.set('vela.session', JSON.stringify({ ...tokens, refreshToken: 'revoked-on-the-server' }));
  const store = launch(secrets);
  await store.auth.start();
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(store.getState().auth).toMatchObject({ phase: 'signed-out', error: 'Your session has ended. Sign in again.' });
  expect(secrets.get('vela.session')).toBeFalsy();
});

test('a refresh the server abandoned (409 outcome unknown for its key) is asked again under a new key and restores', async () => {
  const secrets = await signedIn();
  const saved = JSON.parse(secrets.get('vela.session')!);
  await faults({ refreshAbandonMs: 200 });
  const store = launch(secrets);
  await store.auth.start();
  expect(store.getState().auth).toMatchObject({ phase: 'signed-in', error: '', viewer: 'Demo Viewer' });
  expect(JSON.parse(secrets.get('vela.session')!).refreshToken).not.toBe(saved.refreshToken);
  // The first key is dead on the server: asking under it again answers the same 409 at once.
  const again = await fetch(`${mock.url}/vela/v0/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: saved.refreshToken, device: { ...device, id: secrets.get('vela.device') }, idempotencyKey: refreshIdempotencyKey(saved.refreshToken) }) });
  expect(again.status).toBe(409);
  expect((await again.json()).error).toMatchObject({ code: 'mutation_outcome_unknown', retry: { allowed: false } });
  store.auth.signOut();
});
