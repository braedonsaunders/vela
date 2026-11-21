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

test('a search placeholder is regular secondary text a step under the typed text', async () => {
  const { placeholderRows, placeholderSize } = await import('../src/widgets/search/placeholder-text');
  expect(placeholderSize(17)).toBe(15);
  expect(placeholderSize(16)).toBe(14);
  expect(placeholderSize(15)).toBe(14);
  expect(placeholderSize(13)).toBe(13);
  expect(placeholderSize(28)).toBe(25);
  const rows = { 'font-family': 'Fredoka', 'font-size': '17px', 'font-weight': '550', color: '#fff' };
  // A TV draws a px as 1.25 points: the 17px field is 21.25 points and its placeholder 15px.
  expect(placeholderRows(rows, 21.25, 1.25)).toEqual({
    rows: { 'font-family': 'Fredoka', 'font-size': '15px', 'font-weight': '400', color: '#fff' },
    fontSize: 18.75,
  });
});
