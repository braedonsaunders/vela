// Search's one result list. The fast lane (titles by name, fuzzy and franchise matches) answers
// first; a description match ("a slow-burn heist in Lisbon") stands in for it only when the
// fast lane finds no titles for a phrase, or when the query reads as a description and no title
// is named by it. A single word is a name: a description search answers anything with its nearest
// matches, so a word naming nothing ("zxqvjk") gets the empty answer instead. The list never shows both lanes at once, and it stays loading until the lane it will show
// has answered, so a fallback replaces the loading state instead of moving a list already shown.
// A unified-search server ranks the list itself (state.match): its answer is the list as-is.
import type { Card } from '../models';
import type { SearchLane, SearchState } from './search';

/** Words that make even a short query read as a description: what it is about, or how it feels. */
const STRONG = new Set([
  'about', 'where', 'whose', 'featuring', 'involving', 'starring', 'something', 'anything', 'like',
  'similar', 'vibe', 'vibes', 'mood', 'moody', 'feel', 'feels', 'feeling', 'set',
]);
/** Ordinary sentence words that read as a description in a longer query. */
const WEAK = new Set(['a', 'an', 'in', 'on', 'with', 'that', 'who', 'which', 'some', 'during', 'while', 'without', 'for', 'after', 'before', 'from']);

/** Lower case, without accents or punctuation, single-spaced. */
export function normalizeQuery(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * The query reads as a description rather than a name: three or more words with a strong cue
 * ("something about…", "films like…", "set in…") or a question, four or more with an ordinary
 * sentence word ("a heist in Lisbon"), or six or more words at all. A title that happens to read
 * this way ("The Man with the Golden Gun") is still found: {@link namesTitle} keeps it a title search.
 */
export function readsAsDescription(query: string): boolean {
  const words = normalizeQuery(query).split(' ').filter(Boolean);
  if (words.length < 3) return false;
  if (words.length >= 6) return true;
  if (query.includes('?') || words.some(w => STRONG.has(w))) return true;
  return words.length >= 4 && words.some(w => WEAK.has(w));
}

/** Some title's name contains the whole query: the query names that title. */
export function namesTitle(query: string, items: readonly Pick<Card, 'name'>[]): boolean {
  const q = normalizeQuery(query);
  return q !== '' && items.some(item => ` ${normalizeQuery(item.name)} `.includes(` ${q} `));
}

const words = (query: string) => normalizeQuery(query).split(' ').filter(Boolean).length;

/**
 * The fast lane's answer calls for a description search: it found no titles for a phrase of two or
 * more words, or the query reads as
 * a description and none of its titles is the one named. Before the fast lane answers, a query that
 * reads as a description already asks (so the slower search starts early); `undefined` means not
 * yet known.
 */
export function wantsDescription(query: string, fast: Pick<SearchLane, 'status' | 'items'>): boolean | undefined {
  if (fast.status === 'ready') {
    if (fast.items.length === 0) return words(query) > 1;
    return readsAsDescription(query) && !namesTitle(query, fast.items);
  }
  if (fast.status === 'failed') return false;
  return readsAsDescription(query) ? true : undefined;
}

/** The one list a search shows, and how the description side contributed to it. */
export interface SearchList {
  /** `loading` until the lane the list comes from has answered; `failed` when titles could not be searched. */
  state: 'loading' | 'failed' | 'ready';
  items: Card[];
  /** The list matches a description (or, when empty, the query asked for one). */
  byDescription: boolean;
  /** The description search, as far as the list depends on it: `off` when it plays no part. */
  description: 'off' | 'loading' | 'failed' | 'ready';
  /** The failed description search may be asked again now. */
  canRetry: boolean;
  /** The lane whose next page continues the list, if it has one. */
  more?: 'fast' | 'descriptive';
}

/** The server is still working on a description, and will be asked again. */
const WORKING = ['pending', 'busy', 'indexing'];

function describedState(lane: SearchState['descriptive']): SearchList['description'] {
  if (lane.status === 'unavailable') return 'off';
  if (lane.status === 'failed' || (WORKING.includes(lane.status) && !lane.canRetry)) return 'failed';
  // `idle`: wanted but not started yet (typing has not paused); it will start.
  if (lane.status === 'idle' || lane.status === 'loading' || WORKING.includes(lane.status)) return 'loading';
  return 'ready';
}

const pages = (lane: SearchLane, name: 'fast' | 'descriptive') => (lane.nextCursor && !lane.loadingMore ? name : undefined);

/** The open query's one list, from the lanes' raw state. */
export function searchList(state: Pick<SearchState, 'query' | 'fast' | 'descriptive' | 'match'>): SearchList {
  const { query, fast, descriptive, match } = state;
  const none = { items: [], byDescription: false, description: 'off' as const, canRetry: false };
  if (fast.status === 'failed') return { ...none, state: 'failed' };
  if (fast.status !== 'ready') return { ...none, state: 'loading', byDescription: readsAsDescription(query) };
  const titles: SearchList = { ...none, state: 'ready', items: fast.items, more: pages(fast, 'fast') };
  if (match !== undefined) {
    // The server's one ranked list; the note only when description matches make it up.
    const description = descriptive.status === 'unavailable' ? 'off' : describedState(descriptive);
    const byDescription = match === 'description' || (fast.items.length === 0 && readsAsDescription(query));
    return { ...titles, byDescription, description, canRetry: description === 'failed' && descriptive.canRetry };
  }
  if (descriptive.status === 'unavailable' || !wantsDescription(query, fast)) return titles;

  const description = describedState(descriptive);
  const canRetry = description === 'failed' && descriptive.canRetry;
  if (description === 'loading') return { ...none, state: 'loading', byDescription: true, description };
  // A failed description search keeps whatever it found before failing.
  if (descriptive.items.length > 0) {
    return { state: 'ready', items: descriptive.items, byDescription: true, description, canRetry, more: pages(descriptive, 'descriptive') };
  }
  // Nothing by description: the titles the fast lane did find, or an empty answer about the words.
  const byDescription = fast.items.length === 0 && readsAsDescription(query);
  return { ...titles, byDescription, description, canRetry };
}
