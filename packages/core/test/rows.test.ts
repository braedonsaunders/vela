import { describe, expect, test } from 'bun:test';
import type { Row, Card } from '../src/models';
import { canSeeAll, mergeRow, Rows } from '../src/store/rows';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
const card = (id: string) => ({ id, kind: 'movie' } as Card);
const row = (items = [card('1')]): Row => ({ id: 'r', name: 'Shelf', items, nextCursor: '', continuation: 'exhausted', receipt: '', previewOnFocus: false, presentation: '' });
describe('row See all', () => {
  test('offers only a continuation or a locally truncated list', () => {
    expect(canSeeAll(row())).toBe(false);
    expect(canSeeAll({ ...row(), continuation: 'unknown' })).toBe(false);
    expect(canSeeAll({ ...row(), continuation: 'more' })).toBe(true);
    expect(canSeeAll({ ...row(), nextCursor: 'next' })).toBe(true);
    expect(canSeeAll(row([card('1'), card('2')]), 1)).toBe(true);
  });
  test('merges pages in order, deduplicates, and rejects stalled cursors', () => {
    const first = { ...row(), nextCursor: 'a', continuation: 'more' as const };
    const result = mergeRow(first, row([card('1'), card('2'), card('2')]));
    expect(result.items.map(i => i.id)).toEqual(['1', '2']);
    expect(result.continuation).toBe('exhausted');
    expect(() => mergeRow(first, first)).toThrow('Invalid row continuation');
    expect(() => mergeRow(first, { ...first, nextCursor: '' })).toThrow();
  });
  test('seed is request-free, concurrent reads coalesce, reset drops late replies', async () => {
    const box = new StateBox({ rows: {} } as VelaState);
    let reset = () => {};
    let resolve!: (value: any) => void;
    let calls = 0;
    const session = { epoch: 0, onReset: (fn: () => void) => { reset = fn; }, ready: async () => ({ adapter: { row: () => { calls++; return new Promise(r => { resolve = r; }); } }, images: async () => undefined }) } as unknown as Session;
    const rows = new Rows(box, session, () => 320);
    rows.seed({ ...row(), continuation: 'more', nextCursor: 'a' });
    expect(calls).toBe(0);
    const read = rows.load('r', true);
    await Promise.resolve();
    await rows.load('r', true);
    expect(calls).toBe(1);
    session.epoch++; reset();
    resolve({ id: 'r', name: 'Shelf', receiptToken: '', items: [], continuation: 'exhausted' });
    await read;
    expect(box.get().rows).toEqual({});
  });
});
