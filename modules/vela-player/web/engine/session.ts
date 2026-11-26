export interface Generation {
  sessionId: string;
  source: number;
  seek: number;
  signal: AbortSignal;
}
/** All network and append continuations belong to one cancellable generation. */
export class SessionController {
  sessionId = '';
  source = 0;
  seek = 0;
  private abort = new AbortController();
  private supersede() {
    this.abort.abort();
    this.abort = new AbortController();
  }
  start(id: string, source = 0, seek = 0) {
    this.supersede();
    this.sessionId = id;
    this.source = source;
    this.seek = seek;
    return this.token();
  }
  changeSource(increment = true) {
    this.supersede();
    if (increment) this.source++;
    return this.token();
  }
  changeSeek() {
    this.supersede();
    this.seek++;
    return this.token();
  }
  /** A server-authorized seek using the same open playlist and producer. */
  keepSourceAtSeek(seek: number) {
    this.seek = seek;
    return this.token();
  }
  token(): Generation {
    return { sessionId: this.sessionId, source: this.source, seek: this.seek, signal: this.abort.signal };
  }
  current(t: Generation) {
    return (
      !t.signal.aborted && t.sessionId === this.sessionId && t.source === this.source && t.seek === this.seek
    );
  }
  cancel() {
    this.supersede();
  }
  stop() {
    this.supersede();
    this.sessionId = '';
    this.source++;
  }
}
export function cancelled(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Superseded playback work', 'AbortError');
}
export function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    cancelled(signal);
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
