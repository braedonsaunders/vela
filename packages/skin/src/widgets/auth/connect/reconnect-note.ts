// The reconnect screen's status line, apart from its view so it can be tested without React Native.
import { msg } from '@vela/core';
import type { SessionAuth } from '../signed-out';

/** An attempt running now, or the countdown to the next one ('' when none is due). */
export function reconnectNote(auth: Pick<SessionAuth, 'restoring' | 'retryAt'>, now: number, busy = false): string {
  if (busy || auth.restoring) return msg('server.retryNow');
  if (!auth.retryAt) return '';
  return msg('server.retryIn', { seconds: String(Math.max(1, Math.ceil((auth.retryAt - now) / 1000))) });
}
