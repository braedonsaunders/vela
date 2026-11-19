import { expect, test } from 'bun:test';
import { cachedSecretStore } from '../src/session/cached-store';

test('repeated playback preferences do not repeat synchronous secure writes', () => {
  const writes: string[] = [];
  const store = cachedSecretStore({ get: () => 'saved', set: (key, value) => { writes.push(`${key}:${value}`); } });
  store.set('channel', 'a');
  for (let i = 0; i < 100; i++) store.set('channel', 'a');
  store.set('channel', 'b');
  expect(store.get('existing')).toBe('saved');
  store.set('existing', 'saved');
  expect(writes).toEqual(['channel:a', 'channel:b']);
});

test('native secure reads are cached per key, including absent values', () => {
  const reads: string[] = [];
  const store = cachedSecretStore({ get: key => { reads.push(key); return key === 'session' ? 'token' : null; }, set() {} });
  expect(store.get('session')).toBe('token');
  expect(store.get('session')).toBe('token');
  expect(store.get('missing')).toBeNull();
  expect(store.get('missing')).toBeNull();
  expect(reads).toEqual(['session', 'missing']);
});

test('writes persist before the cache changes, including sign-out', () => {
  let persisted = 'old';
  let fail = false;
  const store = cachedSecretStore({ get: () => persisted, set: (_, value) => {
    if (fail) throw Error('write failed');
    persisted = value;
  } });
  expect(store.get('session')).toBe('old');
  store.set('session', 'new');
  expect(persisted).toBe('new');
  expect(store.get('session')).toBe('new');
  fail = true;
  expect(() => store.set('session', 'bad')).toThrow('write failed');
  expect(store.get('session')).toBe('new');
  fail = false;
  store.set('session', '');
  expect(store.get('session')).toBe('');
  expect(persisted).toBe('');
});

test('a failed read is retried rather than cached as an absent credential', () => {
  let reads = 0;
  const store = cachedSecretStore({ get() { if (++reads === 1) throw Error('locked'); return 'unlocked'; }, set() {} });
  expect(() => store.get('session')).toThrow('locked');
  expect(store.get('session')).toBe('unlocked');
  expect(reads).toBe(2);
});
