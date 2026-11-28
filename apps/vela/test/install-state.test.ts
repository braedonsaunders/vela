import { expect, test } from 'bun:test';
import { initializeAppleInstall, INSTALL_MARKER } from '../src/data/install-state';

// Independent list so the wipe test notices a key omitted from the implementation.
const INITIAL_KEYS = ['vela.servers', 'vela.server-sessions', 'vela.session', 'vela.plex-accounts', 'vela.device'];

function fixture(containerCreatedAt: number, updatedAt: number) {
  const defaults = new Map<string, string>();
  const entries = new Map(INITIAL_KEYS.map(key => [key, key === 'vela.servers'
    ? JSON.stringify({ selectedId: 'old', servers: [{ id: 'old', name: 'Old server' }] })
    : 'stored']));
  const removed: string[] = [];
  return {
    entries,
    removed,
    preferences: {
      get: (key: string) => defaults.get(key) ?? null,
      set: (key: string, value: string) => { defaults.set(key, value); },
    },
    secrets: {
      containerCreatedAt: () => containerCreatedAt,
      secretUpdatedAt: (key: string) => entries.has(key) ? updatedAt : null,
      removeSecret: (key: string) => {
        removed.push(key);
        entries.delete(key);
      },
    },
  };
}

test('a legacy upgrade keeps saved servers and credentials and marks the existing container', () => {
  const { preferences, secrets, entries, removed } = fixture(100, 200);
  initializeAppleInstall(preferences, secrets);
  expect(preferences.get(INSTALL_MARKER)).toBe('1');
  expect([...entries.keys()]).toEqual(INITIAL_KEYS);
  expect(removed).toEqual([]);
});

test('a reinstall wipes every legacy authentication key even with a non-empty registry', () => {
  const { preferences, secrets, entries, removed } = fixture(300, 200);
  initializeAppleInstall(preferences, secrets);
  expect(removed).toEqual(INITIAL_KEYS);
  expect(entries.size).toBe(0);
  expect(preferences.get(INSTALL_MARKER)).toBe('1');
});

test('an empty fresh install gets a marker and future launches skip migration', () => {
  const { preferences, secrets, entries, removed } = fixture(300, 200);
  entries.clear();
  initializeAppleInstall(preferences, secrets);
  expect(preferences.get(INSTALL_MARKER)).toBe('1');
  expect(removed).toEqual(INITIAL_KEYS);
  entries.set('vela.device', 'new-device');
  initializeAppleInstall(preferences, { ...secrets, containerCreatedAt: () => { throw new Error('Already initialized'); } });
  expect(entries.get('vela.device')).toBe('new-device');
});

test('failed deletion leaves the marker unset so a subsequent launch can retry', () => {
  const { preferences, secrets, entries } = fixture(300, 200);
  expect(() => initializeAppleInstall(preferences, {
    ...secrets,
    removeSecret: key => {
      if (key === 'vela.session') throw new Error('Keychain unavailable');
      secrets.removeSecret(key);
    },
  })).toThrow('Keychain unavailable');
  expect(preferences.get(INSTALL_MARKER)).toBeNull();
  initializeAppleInstall(preferences, secrets);
  expect(entries.size).toBe(0);
  expect(preferences.get(INSTALL_MARKER)).toBe('1');
});
