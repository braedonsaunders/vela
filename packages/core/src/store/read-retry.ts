// A catalogue read the server refused for now (a 503 `preparation_pending` while a library view
// is still being prepared, say) is asked again on the server's terms: only when it says the retry
// is allowed, after the wait it names (retry.afterSeconds, Retry-After), within the attempts it
// allows and a short bound of our own. The caller stays in its loading state meanwhile; anything
// else, and the last refusal, reaches it as the error it was.
import { VelaError } from '../adapter/errors';

/** Total attempts (the first included) when the server does not say, and the most we ever make. */
const MAX_ATTEMPTS = 3;
/** A retry further away than this is not waited for behind a loading state. */
const MAX_WAIT_SECONDS = 30;

/** Milliseconds to wait before attempt `attempt + 1` after `error` on attempt `attempt` (0-based),
 * or undefined when the refusal is final. */
export function readRetryDelay(error: unknown, attempt: number): number | undefined {
  if (!(error instanceof VelaError) || error.detail.retry?.allowed !== true) return undefined;
  const retry = error.detail.retry;
  const allowed = Number.isFinite(retry.maxAttempts) ? Math.max(1, Math.floor(retry.maxAttempts!)) : MAX_ATTEMPTS;
  if (attempt + 1 >= Math.min(MAX_ATTEMPTS, allowed)) return undefined;
  const header = Number(error.retryAfter);
  const hinted = Number.isFinite(retry.afterSeconds) ? Math.max(0, retry.afterSeconds!) : 0;
  const seconds = Math.max(1, 2 ** attempt, hinted, Number.isFinite(header) ? header : 0);
  return seconds <= MAX_WAIT_SECONDS ? seconds * 1000 : undefined;
}

export interface ReadRetryOptions {
  /** Aborted when the reader no longer wants the answer (it navigated away): no further attempt. */
  signal?: AbortSignal;
  /** False once the answer can no longer be used (the session changed): no further attempt. */
  wanted?: () => boolean;
  /** Waits `ms`, or rejects when `signal` aborts. Injected by tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** `read`, asked again while the server declares its refusal temporary (readRetryDelay). */
export async function withReadRetry<T>(read: () => Promise<T>, options: ReadRetryOptions = {}): Promise<T> {
  const { signal, wanted = () => true, sleep = wait } = options;
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try {
      return await read();
    } catch (error) {
      const delay = readRetryDelay(error, attempt);
      if (delay === undefined || signal?.aborted || !wanted()) throw error;
      await sleep(delay, signal);
      if (!wanted()) throw error;
    }
  }
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); reject(signal!.reason); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}
