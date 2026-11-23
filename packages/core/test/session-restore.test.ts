import { afterEach, beforeEach, expect, jest, test } from 'bun:test';
import { VelaError } from '../src/adapter/errors';
import { Auth, initialAuth, SESSION_RESTORE_TIMEOUT_MS } from '../src/store/auth';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import { Session } from '../src/store/session';
import type { VelaPlatform } from '../src/store/platform';
import { tokens } from './helpers';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
function harness(stage: 'credentials' | 'validation' | 'description') {
  const pending = deferred<any>();
  const saved = tokens();
  let validations = 0;
  const description = { server: { name: 'Saved server', version: '1.40.2' }, features: {}, secureOrigins: [] };
  let unreachable = false;
  const connection = { record: { id: 'saved', kind: 'plex', name: 'Saved server' },
    adapter: { describe: () => unreachable ? Promise.reject(new Error('down')) : stage === 'description' ? pending.promise : Promise.resolve(description) } };
  const session = { epoch: 0, names: new Map(), onReset: () => {}, hasServer: () => true,
    servers: { standalone: true }, selected: () => connection, demoSignIn: () => false,
    tokens: () => stage === 'credentials' ? pending.promise : Promise.resolve(saved),
    validate: () => { validations++; return stage === 'validation' ? pending.promise : Promise.resolve(saved); } };
  const box = new StateBox({ auth: { ...initialAuth } } as VelaState);
  const auth = new Auth(box, session as unknown as Session, {} as VelaPlatform);
  return { auth, state: () => box.get().auth, pending, saved, validations: () => validations, description, down: () => { unreachable = true; } };
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

for (const stage of ['credentials', 'validation', 'description'] as const) {
  test(`a stalled ${stage} read leaves startup within its deadline and ignores its late answer`, async () => {
    const h = harness(stage);
    const starting = h.auth.start();
    expect(h.auth.start()).toBe(starting);
    await settle();
    jest.advanceTimersByTime(SESSION_RESTORE_TIMEOUT_MS);
    await starting;
    expect(h.state()).toMatchObject({ phase: 'offline', serverId: 'saved', serverKind: 'plex' });
    expect(h.state().error).not.toBe('');
    h.pending.resolve(stage === 'description' ? h.description : h.saved);
    await settle();
    expect(h.state().phase).toBe('offline');
    if (stage === 'credentials') expect(h.validations()).toBe(0);
  });
}

test('a responsive restore settles normally and stays signed in past the deadline', async () => {
  const h = harness('description');
  const starting = h.auth.start();
  h.pending.resolve(h.description);
  await starting;
  expect(h.state()).toMatchObject({ phase: 'signed-in', viewer: h.saved.viewer.name, serverVersion: '1.40.2' });
  jest.advanceTimersByTime(SESSION_RESTORE_TIMEOUT_MS * 2);
  await settle();
  expect(h.state().phase).toBe('signed-in');
});

test('a server that stops answering keeps the version it last stated (the About line)', async () => {
  const h = harness('description');
  const starting = h.auth.start();
  h.pending.resolve(h.description);
  await starting;
  h.down();
  await h.auth.refresh();
  expect(h.state()).toMatchObject({ phase: 'offline', serverName: 'Saved server', serverVersion: '1.40.2' });
});

test('retry revalidates a timed-out session and coalesces repeated attempts', async () => {
  const h = harness('validation');
  const starting = h.auth.start();
  await settle();
  jest.advanceTimersByTime(SESSION_RESTORE_TIMEOUT_MS);
  await starting;
  h.pending.resolve(h.saved);
  await settle();
  expect(h.state().phase).toBe('offline');
  const retry = h.auth.retry();
  expect(h.auth.retry()).toBe(retry);
  await retry;
  expect(h.state()).toMatchObject({ phase: 'signed-in', viewer: h.saved.viewer.name, error: '' });
  expect(h.validations()).toBe(2);
});

test('an unsuccessful retry remains bounded and ignores late answers', async () => {
  const h = harness('credentials');
  const starting = h.auth.start();
  await settle();
  jest.advanceTimersByTime(SESSION_RESTORE_TIMEOUT_MS);
  await starting;
  const retry = h.auth.retry();
  await settle();
  jest.advanceTimersByTime(SESSION_RESTORE_TIMEOUT_MS);
  await retry;
  expect(h.state().phase).toBe('offline');
  h.pending.resolve(h.saved);
  await settle();
  expect(h.state().phase).toBe('offline');
  expect(h.validations()).toBe(0);
});

test('an unreadable saved server leaves startup even when recovery cannot read it either', async () => {
  const box = new StateBox({ auth: { ...initialAuth } } as VelaState);
  const session = { epoch: 0, onReset: () => {}, hasServer: () => { throw new Error('Stored server unavailable'); },
    selected: () => { throw new Error('Stored server unavailable'); } };
  const auth = new Auth(box, session as unknown as Session, {} as VelaPlatform);
  await auth.start();
  expect(box.get().auth).toMatchObject({ phase: 'offline', error: 'Stored server unavailable' });
});

function reconnectHarness() {
  let available = false, rejected = false, saved: ReturnType<typeof tokens> | null = tokens();
  let validations = 0, selected = 'saved';
  const listeners: ((kind: 'session' | 'server') => void)[] = [];
  const connection = { record: { id: 'saved', kind: 'plex', name: 'Saved server' },
    credentials: { set: async (value: typeof saved) => { saved = value; } },
    adapter: { describe: async () => { if (!available) throw new Error('Offline'); return { server: { name: 'Saved server' }, features: {} }; },
      revokeSession: async () => {} } };
  const session = { epoch: 0, names: new Map(), onReset: (listener: typeof listeners[number]) => listeners.push(listener),
    hasServer: () => true, servers: { standalone: true }, selected: () => ({ ...connection, record: { ...connection.record, id: selected } }),
    demoSignIn: () => false, key: () => 'key', tokens: async () => saved,
    resetSession: () => { session.epoch++; listeners.forEach(listener => listener('session')); },
    validate: async (target: typeof connection) => { if (target.record.id === 'saved') validations++; if (rejected) { saved = null; throw new VelaError({ class: 'auth', code: 'invalid', message: 'Rejected', retry: { allowed: false } }, 401); } if (!available) throw new Error('Offline'); return saved; } };
  const box = new StateBox({ auth: { ...initialAuth } } as VelaState);
  const auth = new Auth(box, session as unknown as Session, {} as VelaPlatform);
  return { auth, state: () => box.get().auth, validations: () => validations, saved: () => saved,
    online: () => { available = true; }, reject: () => { rejected = true; },
    switch: () => { selected = 'other'; listeners.forEach(listener => listener('server')); } };
}

test('offline restoration retries validation with capped backoff, retaining credentials until recovery', async () => {
  const h = reconnectHarness();
  await h.auth.start();
  expect(h.state().phase).toBe('offline');
  for (const delay of [5000, 10000, 20000, 40000, 60000, 60000]) {
    const before = h.validations();
    jest.advanceTimersByTime(delay - 1); await settle();
    expect(h.validations()).toBe(before);
    jest.advanceTimersByTime(1); await settle();
    expect(h.validations()).toBe(before + 1);
    expect(h.state().phase).toBe('offline');
    expect(h.saved()).not.toBeNull();
  }
  h.online(); jest.advanceTimersByTime(60000); await settle();
  expect(h.state().phase).toBe('signed-in');
  const count = h.validations();
  jest.advanceTimersByTime(120000); await settle();
  expect(h.validations()).toBe(count);
});

test('foreground/manual retry runs immediately and resets the backoff', async () => {
  const h = reconnectHarness(); await h.auth.start();
  jest.advanceTimersByTime(5000); await settle();
  await h.auth.retry();
  const count = h.validations();
  jest.advanceTimersByTime(5000); await settle();
  expect(h.validations()).toBe(count + 1);
});

test('sign-out cancels pending restoration', async () => {
  const h = reconnectHarness(); await h.auth.start(); await h.auth.signOut(); await settle();
  const count = h.validations();
  jest.advanceTimersByTime(120000); await settle();
  expect(h.validations()).toBe(count);
  expect(h.state().phase).toBe('signed-out');
});

test('server switch cancels the previous server restore', async () => {
  const h = reconnectHarness(); await h.auth.start(); h.switch(); await settle();
  const count = h.validations(); jest.advanceTimersByTime(5000); await settle();
  expect(h.validations()).toBe(count);
});

test('an explicit rejection during retry still signs out', async () => {
  const h = reconnectHarness(); await h.auth.start(); h.online(); h.reject(); await h.auth.retry();
  expect(h.state().phase).toBe('signed-out'); expect(h.saved()).toBeNull();
});


test('session validation contacts the server again after a transient failure', async () => {
  const session = Object.create(Session.prototype) as Session;
  const saved = tokens();
  let calls = 0;
  const connection = { record: { id: 'saved' }, adapter: { validateSession: async () => {
    if (++calls === 1) throw new Error('Offline');
    return saved;
  } } } as unknown as Parameters<Session['validate']>[0];
  await expect(session.validate(connection, saved)).rejects.toThrow('Offline');
  expect(await session.validate(connection, saved)).toBe(saved);
  expect(await session.validate(connection, saved)).toBe(saved);
  expect(calls).toBe(2);
});
