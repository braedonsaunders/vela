import { VelaError } from '../adapter/errors';
import type { GuideApi } from './guide';

const BASE = 30000, MAX = 10 * 60000;

export function guideRetryable(error: unknown): boolean {
  return !(error instanceof VelaError) || error.status >= 500 || error.status === 429 || error.detail.class === 'capacity';
}

/** Retry-After is a minimum deadline, including when it exceeds our ten-minute cap. */
export function guideRetryDelay(error: unknown, attempt: number, now: number): number {
  if (error instanceof VelaError && error.retryAfter !== null) {
    const raw = error.retryAfter.trim();
    const delay = /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - now;
    if (Number.isFinite(delay) && delay >= 0) return Math.max(1000, delay);
  }
  return Math.min(MAX, BASE * 2 ** Math.min(20, Math.max(0, attempt)));
}

/** One server/viewer's deadline survives route changes and gates every guide request. */
export class GuideRetry {
  private attempts = 0;
  private until = 0;
  private error: unknown;
  private readers = 0;
  private failedWave = false;
  private successfulRequest = false;

  remaining(now: number): number { return Math.max(0, this.until - now); }
  get deadline(): number { return this.until; }
  check(now: number): void { if (this.remaining(now)) throw this.error; }

  fail(error: unknown, now: number): void {
    if (!guideRetryable(error)) return;
    this.failedWave = true;
    if (this.remaining(now)) return; // Rejected waiters cannot extend or multiply a failure.
    this.error = error;
    this.until = now + guideRetryDelay(error, this.attempts++, now);
  }

  async run<T>(api: GuideApi, clock: () => number, read: (guarded: GuideApi) => Promise<T>): Promise<T> {
    this.check(clock());
    if (!this.readers++) { this.failedWave = false; this.successfulRequest = false; }
    let complete = false;
    const request = async <R>(call: () => Promise<R>) => {
      this.check(clock());
      try { const answer = await call(); this.successfulRequest = true; return answer; }
      catch (error) { this.fail(error, clock()); throw error; }
    };
    const guarded: GuideApi = {
      channels: (cursor, limit) => request(() => api.channels(cursor, limit)),
      guide: query => request(() => api.guide(query)),
      ...(api.guideWindow ? { guideWindow: (query: Parameters<NonNullable<GuideApi['guideWindow']>>[0]) => request(() => api.guideWindow!(query)) } : {}),
    };
    try { const result = await read(guarded); complete = true; return result; }
    catch (error) { this.failedWave = true; this.fail(error, clock()); throw error; }
    finally {
      if (!--this.readers && complete && !this.failedWave && this.successfulRequest) { this.attempts = 0; this.until = 0; this.error = undefined; }
    }
  }
}

const retries = new Map<string, GuideRetry>();
export function guideRetry(scope: string): GuideRetry {
  let retry = retries.get(scope);
  if (!retry) { retry = new GuideRetry(); retries.set(scope, retry); }
  return retry;
}
