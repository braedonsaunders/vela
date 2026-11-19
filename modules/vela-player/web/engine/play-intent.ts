/** Browser media errors may cross realms; do not rely on instanceof DOMException. */
export function playErrorKind(error: unknown): 'cancelled' | 'blocked' | 'failure' {
  const name = error && typeof error === 'object' && 'name' in error ? error.name : undefined;
  return name === 'AbortError' ? 'cancelled' : name === 'NotAllowedError' ? 'blocked' : 'failure';
}

/** Coalesce commands while play is pending. Never interrupt play with an intent pause. */
export class PlayIntent {
  private desired = false;
  private retired = false;
  private pending?: Promise<boolean>;
  constructor(private play: () => Promise<void>, private pause: () => void) {}
  retire() { this.retired = true; this.desired = false; }
  set(playing: boolean): Promise<boolean> {
    this.desired = playing;
    if (this.pending) return this.pending;
    if (!playing || this.retired) { this.pause(); return Promise.resolve(false); }
    // Install the pending promise before invoking browser code (including synchronous throws).
    this.pending = Promise.resolve().then(async () => {
      if (this.retired || !this.desired) {
        if (!this.retired) this.pause();
        this.pending = undefined;
        return false;
      }
      try {
        await this.play();
      } catch (error) {
        if (this.retired || !this.desired || playErrorKind(error) === 'cancelled') return false;
        throw error;
      } finally {
        if (!this.retired && !this.desired) this.pause();
        this.pending = undefined;
      }
      return !this.retired && this.desired;
    });
    return this.pending;
  }
}
