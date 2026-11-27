// The Vela base's About line is a reading stop on TV. The stop is the line of text alone: the rule
// above it belongs to the box around it, so the focus ring goes around the text, not the rule.
import { expect, mock, test } from 'bun:test';

mock.module('react-native', () => ({ Platform: { OS: 'web' } }));
mock.module('react-native-reanimated', () => ({ cubicBezier: (...values: number[]) => values }));
mock.module('../src/fonts', () => ({ fontFace: (name: string) => name }));
const { resolveDocument } = await import('../src/resolve');
const { cinematicDoc } = await import('../../protocol/fixtures/skins/cinematic');
type RNode = import('../src/resolve').RNode;

function find(node: RNode | undefined, testId: string, parent?: RNode): { node: RNode; parent?: RNode } | undefined {
  if (!node) return undefined;
  if (node.kind === 'box' && node.testId === testId) return { node, parent };
  if (node.kind !== 'box') return undefined;
  for (const child of node.children) {
    const found = find(child, testId, node);
    if (found) return found;
  }
  return undefined;
}

test('the About line stop holds only its text, below the rule', () => {
  const found = find(resolveDocument(cinematicDoc, 1920, 'en').shell, 'about-line');
  expect(found).toBeDefined();
  const { node, parent } = found!;
  if (node.kind !== 'box' || parent?.kind !== 'box') throw new Error('about-line is not a box in a box');
  expect(node.readingStop).toBe(true);
  expect(node.base.style['border-top-width']).toBeUndefined();
  expect(node.base.style['padding-top']).toBeUndefined();
  expect(parent.base.style['border-top-width']).toBe('1px');
  expect(parent.readingStop).toBeUndefined();
  expect(node.children.map(child => child.kind)).toEqual(['text']);
});
