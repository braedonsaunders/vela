import { expect, test } from 'bun:test';
import { accessor, type Env } from '../src/vocabulary';

test('expanded rows and real collections have distinct page labels', () => {
  const read = accessor('collection.kindLabel')!;
  const context = { index: 0 };
  expect(read(context, { collection: { kind: 'row', moreLoading: false } } as Env)).toBe('See all');
  expect(read(context, { collection: { kind: 'collection', moreLoading: false } } as Env)).toBe('Collection');
});
