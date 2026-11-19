import type { Row } from '../models';
import { feedRow } from '../discovery/models';
import type { VelaState } from './index';
import type { Session } from './session';
import { failed, loading, ready, type StateBox } from './state';

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

/** Full row pages are independent of shelves; opening one is the only trigger for reads. */
export class Rows {
  private cursors = new Map<string, Set<string>>();
  constructor(private box: StateBox<VelaState>, private session: Session, private width: () => number) {
    session.onReset(() => { this.cursors.clear(); box.update('rows', () => ({})); });
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
      const page = await connection.adapter.row(id, more ? value!.nextCursor : undefined, 60);
      if (page.id !== id) throw new Error('Wrong row returned');
      const mapped = feedRow(page, await connection.images(), this.width());
      if (epoch !== this.session.epoch) return;
      const seen = this.cursors.get(id) ?? new Set<string>();
      if (mapped.continuation === 'more' && (!mapped.nextCursor || (more && seen.has(mapped.nextCursor)))) throw new Error('Invalid row continuation');
      const result = more ? mergeRow(value!, mapped) : { ...mapped, name: value?.name || mapped.name };
      if (!more) seen.clear();
      if (mapped.nextCursor) seen.add(mapped.nextCursor);
      this.cursors.set(id, seen);
      this.box.update('rows', rows => ({ ...rows, [id]: ready(result) }));
    } catch (error) {
      if (epoch === this.session.epoch) this.box.update('rows', rows => ({ ...rows, [id]: failed(error, previous) }));
    }
  }
}
