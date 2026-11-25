import type { Row } from '../models';
import { feedRow } from '../discovery/models';
import type { VelaState } from './index';
import type { Session } from './session';
import { failed, loading, ready, type StateBox } from './state';
import { supersededRow } from '../adapter/errors';

/** A bounded shelf may also hold a complete, locally available list. */
export function canSeeAll(row: Pick<Row, 'items' | 'nextCursor' | 'continuation'>, visible = row.items.length): boolean {
  return row.continuation === 'more' || !!row.nextCursor || row.items.length > visible;
}
export function mergeRow(previous: Row, page: Row): Row {
  if (page.continuation === 'more' && (!page.nextCursor || page.nextCursor === previous.nextCursor)) throw new Error('Invalid row continuation');
  const seen = new Set(previous.items.map(item => `${item.kind}:${item.id}`));
  return { ...previous, nextCursor: page.nextCursor, continuation: page.continuation,
    items: [...previous.items, ...page.items.filter(item => {
      const key = `${item.kind}:${item.id}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    })] };
}

/**
 * After a row id answered 404/409, how long to wait before each further read of Home when the
 * fresh Home still lists that same id (about two minutes in all): Ether 0.3.21 kept serving a
 * cached bootstrap body naming row ids /rows had already expired, for up to two minutes.
 */
export const RENEW_WAITS_MS = [3_000, 10_000, 30_000, 60_000];

/**
 * Full row pages are independent of shelves; opening one is the only trigger for reads. A page is
 * kept under the id it was opened with. When the server no longer knows that id (404, 409: it
 * re-minted the row after playback), the row is found again in Home read afresh (`resolve`) and
 * the page reads the fresh id from then on, before any error is shown. While the fresh Home still
 * lists the refused id, the page stays loading and Home is read again (RENEW_WAITS_MS); an id the
 * server refused is never read again, so Try again goes straight to a fresh Home read.
 */
export class Rows {
  private cursors = new Map<string, Set<string>>();
  /** The fresh id a page opened as an id the server has since re-minted reads. */
  private resolved = new Map<string, string>();
  /** Ids the server refused as superseded (404, 409), with the refusal. */
  private expired = new Map<string, unknown>();
  /** The row a page was last found by, for a page whose first read failed. */
  private shown = new Map<string, Row>();
  private resets = new AbortController();
  constructor(private box: StateBox<VelaState>, private session: Session, private width: () => number,
    private resolve: (row: Row) => Promise<Row | undefined> = async () => undefined,
    private sleep: (ms: number, signal: AbortSignal) => Promise<void> = wait) {
    session.onReset(() => {
      this.cursors.clear(); this.resolved.clear(); this.expired.clear(); this.shown.clear();
      this.resets.abort(); this.resets = new AbortController();
      box.update('rows', () => ({}));
    });
  }
  seed(row: Row): void {
    if (!this.box.get().rows[row.id]) this.box.update('rows', rows => ({ ...rows, [row.id]: ready(row) }));
  }
  async load(id: string, more = false): Promise<void> {
    const previous = this.box.get().rows[id];
    if (previous?.load === 'loading') return;
    const value = previous?.value;
    if (more && (!value || !value.nextCursor || value.continuation === 'exhausted')) return;
    const epoch = this.session.epoch;
    this.box.update('rows', rows => ({ ...rows, [id]: loading(previous) }));
    try {
      const connection = await this.session.ready();
      const read = async (wire: string, cursor?: string) => {
        const page = await connection.adapter.row(wire, cursor, 60);
        if (page.id !== wire) throw new Error('Wrong row returned');
        return feedRow(page, await connection.images(), this.width());
      };
      let wire = this.resolved.get(id) ?? id;
      let mapped: Row;
      let renewed = false;
      try {
        // An id the server already refused is not asked again (Try again after that refusal).
        if (this.expired.has(wire)) throw this.expired.get(wire);
        mapped = await read(wire, more ? value!.nextCursor : undefined);
      } catch (error) {
        // The row as last drawn (this page, else Home) is found again in Home read afresh.
        const shown = value ?? this.box.get().home.value?.rows.find(row => row.id === wire) ?? this.shown.get(id);
        if (!supersededRow(error) || !shown) throw error;
        this.expired.set(wire, error);
        this.shown.set(id, shown);
        const fresh = await this.renew(shown, epoch);
        if (!fresh) throw error;
        if (epoch !== this.session.epoch) return;
        wire = fresh.id;
        this.resolved.set(id, wire);
        // The old cursor belonged to the old id: the fresh row reads from its start, and a page
        // asking for more keeps what it shows, with what is new after it.
        mapped = await read(wire);
        renewed = true;
      }
      if (epoch !== this.session.epoch) return;
      const seen = renewed ? new Set<string>() : this.cursors.get(id) ?? new Set<string>();
      if (mapped.continuation === 'more' && (!mapped.nextCursor || (more && seen.has(mapped.nextCursor)))) throw new Error('Invalid row continuation');
      const result = more ? mergeRow(renewed ? { ...value!, id: mapped.id, ...(mapped.key ? { key: mapped.key } : {}) } : value!, mapped) : { ...mapped, name: value?.name || mapped.name };
      if (!more) seen.clear();
      if (mapped.nextCursor) seen.add(mapped.nextCursor);
      this.cursors.set(id, seen);
      this.box.update('rows', rows => ({ ...rows, [id]: ready(result) }));
    } catch (error) {
      if (epoch === this.session.epoch) this.box.update('rows', rows => ({ ...rows, [id]: failed(error, previous) }));
    }
  }

  /**
   * The row `shown` under an id the server has not refused, from Home read afresh: read again
   * after each of RENEW_WAITS_MS while the server still lists a refused id. Undefined when the
   * fresh Home has no such row, the waits run out, or the session ended.
   */
  private async renew(shown: Row, epoch: number): Promise<Row | undefined> {
    const signal = this.resets.signal;
    for (let attempt = 0; ; attempt++) {
      const fresh = await this.resolve(shown);
      if (!fresh || epoch !== this.session.epoch) return undefined;
      if (!this.expired.has(fresh.id)) return fresh;
      const delay = RENEW_WAITS_MS[attempt];
      if (delay === undefined) return undefined;
      try { await this.sleep(delay, signal); } catch { return undefined; }
      if (epoch !== this.session.epoch) return undefined;
    }
  }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
  });
}
