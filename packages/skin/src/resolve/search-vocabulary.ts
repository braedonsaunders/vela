// Search's vocabulary (docs/skin-schema.md, "Search"): the bindings, collections and actions a
// document's routes.search may use. They are data for the renderer that draws search; the
// resolver accepts them after the shared vocabulary (vocabulary.ts).

/** Bindings: the title lane's state, each lane's size and state, and a live hit's fields. */
export const SEARCH_KEYS = [
  'env.search',
  'search.titleCount',
  'search.describing',
  'search.descriptiveState',
  'search.descriptiveCount',
  'search.canRetry',
  'search.aiState',
  'search.aiCount',
  'search.onNowCount',
  'search.comingUpCount',
  'hit.id',
  'hit.kind',
  'hit.ref',
  'hit.name',
  'hit.channelName',
  'hit.channelNumber',
  'hit.logo',
  'hit.artwork',
  'hit.episode',
  'hit.live',
  'hit.progressPct',
  'hit.detail',
  'hit.chip',
  'hit.navigable',
];

/** Collections: the three lanes of titles (card context) and the live hits (hit context). */
export const SEARCH_COLLECTIONS = ['search.titles', 'search.descriptive', 'search.ai', 'search.onNow', 'search.comingUp'];

/** Actions: open a live hit by its ref, and ask the descriptive lane again. */
export const SEARCH_ACTIONS = ['openHit', 'retryDescriptive'];
