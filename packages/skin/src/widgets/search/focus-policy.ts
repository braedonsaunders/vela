import type { SearchView } from './model';
import { searchResultPresses } from './vocabulary';

/** A skin can request focus through both its action and press.focus on the next frame.
 * Only a later deliberate request should reopen an already focused Android field's IME. */
export function shouldRefocusSearch(focused: boolean, previous: number, now: number): boolean {
  return focused && now - previous >= 500;
}

/** Where focus goes once Vela's TV keyboard's Done has closed over a search: `wait` while the
 * answer to the text typed is still coming, then the first result (`does`, the presses of the
 * results in the order they stand, tried in turn), or the field itself when nothing was found or
 * nothing was typed. Never the shell's bar, which is where Android left it. */
export type SearchDoneFocus = { to: 'wait' } | { to: 'field' } | { to: 'result'; does: string[] };

export function searchDoneFocus(query: string, search: SearchView | undefined): SearchDoneFocus {
  if (query.trim() === '') return { to: 'field' };
  if (!search || search.query !== query || (!search.sections && search.titles.state === 'loading')) return { to: 'wait' };
  const does = searchResultPresses(search);
  return does.length ? { to: 'result', does } : { to: 'field' };
}
