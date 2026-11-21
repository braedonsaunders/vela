// Shelves and their cards keyed by identity (vocabulary.ts itemKey, identity-keys.ts).
import { expect, test } from 'bun:test';
test('shelves and their cards are keyed by identity, so a reordered Continue row moves its cards', async () => {
  const { collection, itemKey } = await import('../src/vocabulary');
  const card = (id: string) => ({ id }) as never;
  const row = { id: 'continue', items: [card('a'), card('b'), card('a')] } as never;
  const before = collection('row.items', { index: 0, row }, {} as never, 10).map(c => itemKey(c, 'row.items'));
  expect(before).toEqual(['card:a', 'card:b', 'card:a#2']);
  const moved = collection('row.items', { index: 0, row: { id: 'continue', items: [card('b'), card('a')] } as never }, {} as never, 10).map(c => itemKey(c, 'row.items'));
  expect(moved).toEqual(['card:b', 'card:a']);
  const rows = collection('home.rows', { index: 0 }, { home: { rows: [{ id: 'r1', items: [] }, { id: 'r2', items: [] }] } } as never, 10).map(c => itemKey(c, 'home.rows'));
  expect(rows).toEqual(['row:r1', 'row:r2']);
});
