import { expect, test } from 'bun:test';
import { cinematicDoc } from '../../protocol/fixtures/skins/cinematic';
import { resolveDocument } from '../src/resolve';

function placeholder(value: string) {
  const node = resolveDocument({ ...cinematicDoc,
    tokens: { ...cinematicDoc.tokens, placeholder: 'rgba(60, 60, 67, 0.3)' },
    ui: { ...cinematicDoc.ui, inkQuiet: '#665577' },
    routes: { home: { type: 'widget', widget: 'searchInput',
      params: { placeholderColor: value, label: 'Search $5 titles', placeholder: 'Find something' } } },
  }, 800).routes.home!;
  if (node.kind !== 'widget') throw Error('Expected search input');
  return node.params;
}

test('custom search fields receive concrete document and UI placeholder colours', () => {
  expect(placeholder('$placeholder').placeholderColor).toBe('rgba(60, 60, 67, 0.3)');
  expect(placeholder('$ui.inkQuiet').placeholderColor).toBe('#665577');
  expect(placeholder('#556677').placeholderColor).toBe('#556677');
  expect(placeholder('$placeholder').label).toBe('Search $5 titles');
});

test('an unknown placeholder colour token is rejected like a style token', () => {
  expect(() => placeholder('$missing')).toThrow('Unknown token $missing');
});
