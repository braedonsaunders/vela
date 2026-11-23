// When a refused playback start is asked again: only when the server allows it, on its terms
// (retry.afterSeconds, Retry-After, retry.maxAttempts), within a bounded number of attempts and
// never more than a minute away. Anything else is final: the viewer is told, not kept waiting.
// Shared by core's playback slice and the live preview tile, which tunes channels itself.
import { VelaError } from '../adapter/errors';

/** Total attempts (the first included) when the server does not say. */
const DEFAULT_ATTEMPTS = 3;
/** However many the server allows, a start is not asked for more often than this. */
const MAX_ATTEMPTS = 5;
/** A retry further away than this is not waited for behind a spinner. */
const MAX_WAIT_SECONDS = 60;

/**
 * Seconds to wait before asking again after `retries` earlier retries of this start, or 0 when
 * the refusal is final (not retryable, out of attempts, or too far away).
 */
export function startRetry(error: unknown, retries: number): number {
  if (!(error instanceof VelaError)) return 0;
  const retry = error.detail.retry;
  if (retry?.allowed !== true) return 0;
  const header = Number(error.retryAfter ?? NaN);
  const hint = Number.isFinite(retry.afterSeconds) ? Math.max(0, retry.afterSeconds!) : 0;
  const seconds = Math.ceil(Math.max(2 ** Math.min(retries, 5), hint, Number.isFinite(header) ? header : 0, 1));
  const attempts = Number.isFinite(retry.maxAttempts) ? Math.floor(retry.maxAttempts!) : DEFAULT_ATTEMPTS;
  const limit = Math.max(0, Math.min(MAX_ATTEMPTS, attempts) - 1);
  return seconds <= MAX_WAIT_SECONDS && retries < limit ? seconds : 0;
}

/**
 * The server answered and refused for good: a 4xx it does not allow retrying (Ether's 409
 * `not_available` for a title with no source, a 404, a policy refusal). No retry or recovery asks
 * again. A request that never reached the server, a 5xx, a timeout (408) or a rate limit (429)
 * is not final: a session being recovered waits those out.
 */
export function finalRefusal(error: unknown): boolean {
  if (!(error instanceof VelaError) || error.detail.retry?.allowed === true) return false;
  return error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
}

/** A refused start in the words the server gave, for the viewer. */
export interface StartRefusal {
  message: string;
  code: string;
  /** The v0 error class (`capacity`, `source`, `auth`, …), or '' for a failure without one. */
  errorClass: string;
}

export function startRefusal(error: unknown, fallback = ''): StartRefusal {
  if (error instanceof VelaError) return { message: error.message || fallback, code: error.detail.code, errorClass: error.detail.class };
  return { message: error instanceof Error && error.message ? error.message : fallback, code: '', errorClass: '' };
}
