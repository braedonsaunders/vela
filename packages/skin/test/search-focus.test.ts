import { expect, test } from 'bun:test';
import { searchDoneFocus, shouldRefocusSearch } from '../src/widgets/search/focus-policy';
import { searchResultPresses } from '../src/widgets/search/vocabulary';
import type { SearchView } from '../src/widgets/search/model';

test('the action and following press.focus do not blur a newly focused search field', () => {
  expect(shouldRefocusSearch(false, -Infinity, 1000)).toBe(false);
  expect(shouldRefocusSearch(true, 1000, 1016)).toBe(false);
});

test('a later header search can reopen a keyboard dismissed with Android Back', () => {
  expect(shouldRefocusSearch(true, 1000, 2000)).toBe(true);
  expect(shouldRefocusSearch(false, 1000, 2000)).toBe(false);
});

const card = (id: string, kind = 'movie') => ({ id, kind, receipt: `r-${id}` }) as never;
const answer = (query: string, state: SearchView['titles']['state'], items: never[] = [], live: Partial<Pick<SearchView['titles'], 'channels' | 'programmes'>> = {}): SearchView => ({
  query,
  titles: { state, items, channels: live.channels ?? [], programmes: live.programmes ?? [] },
  descriptive: { state: 'off', items: [], canRetry: false },
  ai: { state: 'off', items: [] },
});

test("Done on the TV keyboard waits for the answer to the text typed, then goes to the first result", () => {
  // Still answering, or the answer on show is for an earlier text.
  expect(searchDoneFocus('observ', undefined)).toEqual({ to: 'wait' });
  expect(searchDoneFocus('observ', answer('observ', 'loading'))).toEqual({ to: 'wait' });
  expect(searchDoneFocus('observ', answer('obse', 'ready', [card('t1')]))).toEqual({ to: 'wait' });
  // The first card first, as the renderer tracks its press (`select:<id>|<kind>|<receipt>`).
  const done = searchDoneFocus('observ', answer('observ', 'ready', [card('t1'), card('t2', 'show')]));
  expect(done).toEqual({ to: 'result', does: ['select:t1|movie|r-t1', 'select:t2|show|r-t2'] });
});

test('Done goes back to the field when nothing was typed or nothing was found, never the top bar', () => {
  expect(searchDoneFocus('   ', undefined)).toEqual({ to: 'field' });
  expect(searchDoneFocus('zzz', answer('zzz', 'ready'))).toEqual({ to: 'field' });
  expect(searchDoneFocus('zzz', answer('zzz', 'failed'))).toEqual({ to: 'field' });
});

test("a search's live hits follow its titles in the order they stand: on now, then coming up", () => {
  const channel = { id: 'ch-1' } as never;
  const later = { id: 'p-later', airing: false } as never;
  const now = { id: 'p-now', airing: true } as never;
  expect(searchResultPresses(answer('news', 'ready', [card('t1')], { channels: [channel], programmes: [later, now] }))).toEqual([
    'select:t1|movie|r-t1', 'openHit:channel|ch-1', 'openHit:programme|p-now', 'openHit:programme|p-later',
  ]);
  // Only live hits: Done lands on the channel.
  expect(searchDoneFocus('news', answer('news', 'ready', [], { channels: [channel] }))).toEqual({ to: 'result', does: ['openHit:channel|ch-1'] });
});
