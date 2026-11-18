import { afterEach, beforeEach, expect, jest, test } from 'bun:test';
import { Auth, initialAuth, SESSION_RESTORE_TIMEOUT_MS } from '../src/store/auth';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
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
  const description = { server: { name: 'Saved server' }, features: {}, secureOrigins: [] };
  const connection = { record: { id: 'saved', kind: 'plex', name: 'Saved server' },
    adapter: { describe: () => stage === 'description' ? pending.promise : Promise.resolve(description) } };
  const session = { epoch: 0, names: new Map(), onReset: () => {}, hasServer: () => true,
    servers: { standalone: true }, selected: () => connection, demoSignIn: () => false,
    tokens: () => stage === 'credentials' ? pending.promise : Promise.resolve(saved),
    validate: () => { validations++; return stage === 'validation' ? pending.promise : Promise.resolve(saved); } };
  const box = new StateBox({ auth: { ...initialAuth } } as VelaState);
  const auth = new Auth(box, session as unknown as Session, {} as VelaPlatform);
  return { auth, state: () => box.get().auth, pending, saved, validations: () => validations, description };
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
  expect(h.state()).toMatchObject({ phase: 'signed-in', viewer: h.saved.viewer.name });
  jest.advanceTimersByTime(SESSION_RESTORE_TIMEOUT_MS * 2);
  await settle();
  expect(h.state().phase).toBe('signed-in');
});
