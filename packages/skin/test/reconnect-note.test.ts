import { expect, test } from 'bun:test';
import { reconnectNote } from '../src/widgets/auth/connect/reconnect-note';

test('the reconnect screen counts down to the next attempt, rounding up and never showing 0', () => {
  const now = 1_000_000;
  expect(reconnectNote({ retryAt: now + 20_000, restoring: false }, now)).toBe('Trying again in 20 s.');
  expect(reconnectNote({ retryAt: now + 4_001, restoring: false }, now)).toBe('Trying again in 5 s.');
  expect(reconnectNote({ retryAt: now - 500, restoring: false }, now)).toBe('Trying again in 1 s.');
});

test('an attempt in flight, or a Retry the viewer just pressed, says so instead of a countdown', () => {
  expect(reconnectNote({ retryAt: 0, restoring: true }, 0)).toBe('Trying again now…');
  expect(reconnectNote({ retryAt: 50_000, restoring: false }, 0, true)).toBe('Trying again now…');
});

test('nothing is promised when no attempt is due', () => {
  expect(reconnectNote({ retryAt: 0, restoring: false }, 0)).toBe('');
  expect(reconnectNote({}, 0)).toBe('');
});
