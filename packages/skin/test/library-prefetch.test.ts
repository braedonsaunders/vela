import { expect, test } from 'bun:test';
import { firstView } from '../../../apps/vela/src/browse/prefetch';

const query = { sort: undefined, direction: undefined };
const tab = (kind: string, extra: object = {}) => ({ id: `${kind}-tab`, label: kind, kind, ...extra }) as never;

test('a library read ahead reads what its first tab shows, and never its collections', () => {
  expect(firstView(undefined, false, query)).toEqual({ query, recommendations: true });
  expect(firstView([tab('recommended'), tab('library')], false, query)).toEqual({ query, recommendations: true });
  expect(firstView([tab('library'), tab('recommended')], false, query)).toEqual({ query, recommendations: false });
  // Collections are read only when the viewer opens them: some servers take tens of seconds.
  expect(firstView([tab('collections')], false, query)).toEqual({ query, recommendations: false });
  expect(firstView([tab('people')], false, query)).toEqual({ query, recommendations: false });
  expect(firstView([tab('live'), tab('library')], true, query)).toBeNull();
  // A live tab the server cannot play is not shown, so the next tab is first.
  expect(firstView([tab('live'), tab('recommended')], false, query)).toEqual({ query, recommendations: true });
  expect(firstView([tab('view', { sort: 'added', direction: 'desc' })], false, query))
    .toEqual({ query: { tab: 'view-tab', sort: 'added', direction: 'desc' }, recommendations: false });
  expect(firstView([tab('library', { level: 'album' })], false, query)?.query.tab).toBe('library-tab');
});
