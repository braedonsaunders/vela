/** A single interruption has a wall-clock budget, including time spent opening. */
export class ReadRetryBudget {
  private started: number | undefined;
  private attempt = 0;
  private progressingSince: number | undefined;
  progress(now: number) {
    this.progressingSince ??= now;
    if (now - this.progressingSince >= 10000) { this.started = undefined; this.attempt = 0; }
  }
  constructor(readonly key: string) {}
  next(now: number): number | null {
    this.progressingSince = undefined;
    this.started ??= now;
    const wait = [1000, 2000, 4000, 8000, 15000, 15000, 15000][this.attempt++];
    return wait !== undefined && now - this.started + wait <= 60000 ? wait : null;
  }
}
export function transientReadFailure(message: string, kind?: string): boolean {
  if (/\b(?:401|403)\b|unauthori[sz]ed|forbidden|unsupported|decode(?!mux)|codec/i.test(message)) return false;
  const status = /\bHTTP\s+(\d{3})\b/i.exec(message);
  if (status) return [408, 429].includes(Number(status[1])) || Number(status[1]) >= 500;
  return kind === 'network' || /MEDIA_ERR_NETWORK|PIPELINE_ERROR_READ|data[ -]source error|stalled|failed to fetch|network|timed? ?out|connection reset/i.test(message);
}
