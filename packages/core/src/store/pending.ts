// Following a partial title answer: while the server says parts of a title are still being made
// (`pending`: seasons, episodes, extras, the trailer) and the title is on screen, it is read again
// after the server's `refreshAfterMs`, backing off, at most five times. A complete answer, the
// title leaving the screen, or a session change ends the follow.
import type * as V from '../wire';

const MAX_READS = 5;
const DEFAULT_REFRESH_MS = 2000;
const BACKOFF = 1.5;

interface Follow {
  reads: number;
  timer?: ReturnType<typeof setTimeout>;
}

export class PendingTitles {
  private readonly viewers = new Map<string, number>();
  private readonly follows = new Map<string, Follow>();

  /** `reread` reads the title again in place and reports its answer back through `answered`. */
  constructor(private readonly reread: (id: string) => void) {}

  /** A title page is on screen; call the returned function when it leaves. */
  view(id: string): () => void {
    this.viewers.set(id, (this.viewers.get(id) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (this.viewers.get(id) ?? 1) - 1;
      if (left > 0) {
        this.viewers.set(id, left);
        return;
      }
      this.viewers.delete(id);
      this.stop(id);
    };
  }

  /** The server answered for a title: follow it while parts are pending and it is on screen. */
  answered(id: string, answer: V.PartialAnswer): void {
    const pending = answer.pending ?? [];
    if (pending.length === 0 || !this.viewers.has(id)) {
      this.stop(id);
      return;
    }
    const follow = this.follows.get(id) ?? { reads: 0 };
    if (follow.timer) clearTimeout(follow.timer);
    if (follow.reads >= MAX_READS) {
      this.follows.delete(id);
      return;
    }
    const base = Number.isFinite(answer.refreshAfterMs) && answer.refreshAfterMs! > 0 ? answer.refreshAfterMs! : DEFAULT_REFRESH_MS;
    const delay = base * BACKOFF ** follow.reads;
    follow.reads++;
    follow.timer = setTimeout(() => this.reread(id), delay);
    this.follows.set(id, follow);
  }

  /** The session changed: nothing read for it is followed. */
  clear(): void {
    for (const id of [...this.follows.keys()]) this.stop(id);
  }

  private stop(id: string): void {
    const follow = this.follows.get(id);
    if (follow?.timer) clearTimeout(follow.timer);
    this.follows.delete(id);
  }
}
