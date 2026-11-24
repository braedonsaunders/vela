// The reconnect screen's status line and its way out, apart from its view so it can be tested without React Native.
import { msg } from '@vela/core';
import type { SessionAuth } from '../signed-out';

/** An attempt running now, or the countdown to the next one ('' when none is due). */
export function reconnectNote(auth: Pick<SessionAuth, 'restoring' | 'retryAt'>, now: number, busy = false): string {
  if (busy || auth.restoring) return msg('server.retryNow');
  if (!auth.retryAt) return '';
  return msg('server.retryIn', { seconds: String(Math.max(1, Math.ceil((auth.retryAt - now) / 1000))) });
}

/** Failed restore attempts in a row after which the reconnect screen also offers Sign in again. */
export const SIGN_IN_AGAIN_AFTER_FAILURES = 2;

/**
 * Whether the reconnect screen offers Sign in again beside Retry: once restoring has failed
 * repeatedly, so a session the server cannot restore never leaves the viewer with only Retry.
 */
export function offersSignInAgain(auth: Pick<SessionAuth, 'failures'>): boolean {
  return (auth.failures ?? 0) >= SIGN_IN_AGAIN_AFTER_FAILURES;
}
