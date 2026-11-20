import { expect, test } from 'bun:test';
import type { Node } from '../../protocol/skin';
import kids from '../../protocol/fixtures/skins/kids/document';
import { relatedRow, row } from '../src/resolve/vela-base/cards';

function collect(node: Node, predicate: (candidate: Node) => boolean): Node[] {
  const found = predicate(node) ? [node] : [];
  if (node.type === 'box') for (const child of node.children ?? []) found.push(...collect(child, predicate));
  if (node.type === 'repeat') found.push(...collect(node.item, predicate));
  return found;
}

test('paged Vela shelves provide scroll regions and previous/next controls', () => {
  expect(collect(row, candidate => candidate.type === 'box' && !!candidate.pager)).toHaveLength(2);
  expect(collect(row, candidate => candidate.type === 'box' && candidate.press?.action === 'pagePrev')).toHaveLength(1);
  expect(collect(row, candidate => candidate.type === 'box' && candidate.press?.action === 'pageNext')).toHaveLength(1);
  expect(collect(relatedRow, candidate => candidate.type === 'box' && !!candidate.pager)).toHaveLength(0);
});

test('the Kids row keeps the shared pager contract in its custom presentation', () => {
  const kidsRow = kids.templates?.row;
  expect(kidsRow).toBeDefined();
  expect(collect(kidsRow!, candidate => candidate.type === 'box' && !!candidate.pager)).toHaveLength(1);
  expect(collect(kidsRow!, candidate => candidate.type === 'box' && candidate.press?.action === 'pagePrev')).toHaveLength(1);
  expect(collect(kidsRow!, candidate => candidate.type === 'box' && candidate.press?.action === 'pageNext')).toHaveLength(1);
});
