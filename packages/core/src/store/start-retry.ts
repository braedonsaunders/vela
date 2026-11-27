// When a refused playback start is asked again: only when the server allows it, on its terms
// (retry.afterSeconds, Retry-After, retry.maxAttempts), within a bounded number of attempts and
// never more than a minute away. Anything else is final: the viewer is told, not kept waiting.
// Shared by core's playback slice and the live preview tile, which tunes channels itself.
import { catchUpErrorMessage } from '../live/timeshift';
import { VelaError } from '../adapter/errors';
import { unreleasedMessage } from '../release-date';
import { msg } from '../i18n';

/** Total attempts (the first included) when the server does not say. */
const DEFAULT_ATTEMPTS = 3;
/** However many the server allows, a start is not asked for more often than this. */
const MAX_ATTEMPTS = 5;
/** A retry further away than this is not waited for behind a spinner. */
const MAX_WAIT_SECONDS = 60;
/**
 * Ether's `preparing`: still finding a source, or a download service is fetching the release. That
 * is a wait, not a failure: the server's own attempt count is honoured up to this bound, and each
 * attempt waits what the server asked (no more than MAX_WAIT_SECONDS) rather than ending the start.
 */
const MAX_PREPARING_ATTEMPTS = 120;

/** Whether a refused start is Ether still preparing the title (`preparing`), a wait rather than a failure. */
export function stillPreparing(error: unknown): boolean {
  return error instanceof VelaError && error.detail.code === 'preparing' && error.detail.retry?.allowed === true;
}

/**
 * Seconds to wait before asking again after `retries` earlier retries of this start, or 0 when
 * the refusal is final (not retryable, out of attempts, or too far away).
 */
export function startRetry(error: unknown, retries: number): number {
  if (!(error instanceof VelaError) || error.detail.code === 'title_unreleased') return 0;
  const retry = error.detail.retry;
  if (retry?.allowed !== true) return 0;
  const header = Number(error.retryAfter ?? NaN);
  const hint = Number.isFinite(retry.afterSeconds) ? Math.max(0, retry.afterSeconds!) : 0;
  if (stillPreparing(error)) {
    const asked = Math.ceil(Math.max(1, hint, Number.isFinite(header) ? header : 0));
    const allowed = Number.isFinite(retry.maxAttempts) ? Math.min(MAX_PREPARING_ATTEMPTS, Math.floor(retry.maxAttempts!)) : DEFAULT_ATTEMPTS;
    return retries < Math.max(0, allowed - 1) ? Math.min(asked, MAX_WAIT_SECONDS) : 0;
  }
  const minimum = error.detail.code === 'catchup_unavailable' ? 30 : 1;
  const seconds = Math.ceil(Math.max(2 ** Math.min(retries, 5), hint, Number.isFinite(header) ? header : 0, minimum));
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
  if (!(error instanceof VelaError)) return false;
  if (error.detail.code === 'title_unreleased') return true;
  if (error.detail.retry?.allowed === true) return false;
  return error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
}

/**
 * The server itself answered and refused, in its own words (a v0 error class other than
 * `transient`): Ether's 503 `source`/`timeout` when a channel's provider does not respond, for
 * example. A restart is not kept waiting behind a spinner for that, though it waits out no answer,
 * a gateway in the way or a server restarting (Ether reports those bodiless 5xx as `transient`).
 */
export function serverRefused(error: unknown): boolean {
  return error instanceof VelaError && error.detail.class !== 'transient';
}

/** A refused start in the words the server gave, for the viewer. */
export interface StartRefusal {
  message: string;
  code: string;
  /** The v0 error class (`capacity`, `source`, `auth`, …), or '' for a failure without one. */
  errorClass: string;
}

/**
 * The viewer's words for a refusal whose code says more than the server's own message. Ether words
 * many refusals as nothing but the code spelt out (`not_available` → "not available"), so those
 * known codes get a sentence here; '' for any other code.
 */
export function refusalWords(code: string | undefined): string {
  switch (code) {
    // Ether: no copy of the title on the server, and none it could find (frontends/vela, ErrNotAvailable).
    case 'not_available': return msg('playback.refused.notAvailable');
    case 'not_playable': return msg('playback.refused.notPlayable');
    case 'source_unavailable': return msg('playback.refused.sourceUnavailable');
    case 'version_unavailable': return msg('playback.refused.versionUnavailable');
    case 'forbidden': return msg('playback.refused.forbidden');
    case 'playback_capacity': return msg('playback.refused.capacity');
    default: return '';
  }
}

/** A server message that is only its error code spelt out ("not available", "playback capacity"):
 * a diagnostic, not words for the viewer. */
export function codeOnlyMessage(message: string, code: string): boolean {
  const spelt = (text: string) => text.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  return !spelt(message) || (!!code && spelt(message) === spelt(code));
}

/** Whether a refused start means the server has no copy of this title it can play: none in the
 * library and none found (`not_available`), not a playable item, or no source it could reach
 * (Ether's 502 `source_unavailable`, its answer once preparing found nothing). Another item of a
 * queue may still play. */
export function noPlayableCopy(code: string | undefined): boolean {
  return code === 'not_available' || code === 'not_playable' || code === 'source_unavailable';
}

export function startRefusal(error: unknown, fallback = '', airDate?: string): StartRefusal {
  if (error instanceof VelaError) {
    const { code, class: errorClass } = error.detail;
    const own = codeOnlyMessage(error.message, code) ? '' : error.message;
    const message = code === 'title_unreleased' ? unreleasedMessage(airDate) : catchUpErrorMessage(code) || refusalWords(code) || own || fallback;
    return { message, code, errorClass };
  }
  return { message: error instanceof Error && error.message ? error.message : fallback, code: '', errorClass: '' };
}
