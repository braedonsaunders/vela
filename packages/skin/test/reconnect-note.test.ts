import { expect, test } from 'bun:test';
import { offersSignInAgain, reconnectNote, SIGN_IN_AGAIN_AFTER_FAILURES } from '../src/widgets/auth/connect/reconnect-note';

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

test('Sign in again joins Retry once restoring has failed repeatedly, never on the first failure', () => {
  expect(SIGN_IN_AGAIN_AFTER_FAILURES).toBe(2);
  expect(offersSignInAgain({})).toBe(false);
  expect(offersSignInAgain({ failures: 1 })).toBe(false);
  expect(offersSignInAgain({ failures: 2 })).toBe(true);
  expect(offersSignInAgain({ failures: 9 })).toBe(true);
});
