import { expect, test } from 'bun:test';
import { acrossWindows, refreshIdempotencyKey } from '../src/adapter/ether/transport';

test('rotating one refresh token always uses the same idempotency key, and different tokens differ', () => {
  const a = refreshIdempotencyKey('rt-abc123');
  expect(refreshIdempotencyKey('rt-abc123')).toBe(a);
  expect(refreshIdempotencyKey('rt-abc124')).not.toBe(a);
  expect(a).toMatch(/^refresh-[0-9a-f]{32}$/);
  expect(a).not.toContain('abc123');
});

test('refresh is serialised across windows when Web Locks exist, and simply runs where they do not', async () => {
  const held: string[] = [];
  const nav = (globalThis as { navigator?: unknown }).navigator;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: async (name: string, run: () => Promise<unknown>) => { held.push(name); return run(); } } } });
  try {
    expect(await acrossWindows('vela-refresh:https://ether', async () => 7)).toBe(7);
    expect(held).toEqual(['vela-refresh:https://ether']);
  } finally {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: nav });
  }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  try {
    expect(await acrossWindows('x', async () => 'ran')).toBe('ran');
  } finally {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: nav });
  }
});
