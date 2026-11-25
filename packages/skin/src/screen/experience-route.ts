// Where an experience's address points (docs/experiences.md): the page of the experience a library
// shows and its params, from the address's `?m=` and back, so the legacy music links (`title:<id>`,
// `playlist:<id>`, `albums:<query>`, `liked`, …) open the same pages as documents. Pure.

/** The page an experience shows and its params. */
export interface ExperiencePlace { page: string; params: Record<string, string> }

export const HOME_PLACE: ExperiencePlace = Object.freeze({ page: 'home', params: Object.freeze({}) as Record<string, string> }) as ExperiencePlace;

/** Pages whose one address argument is a query, not an id. */
const QUERY_PAGES = new Set(['albums', 'search']);
const PAGE = /^[A-Za-z][\w-]{0,63}$/;

const primary = (page: string) => (QUERY_PAGES.has(page) ? 'query' : 'id');

/** `?m=` to a place: '' is home; `name` a page; `name:value` a page with its id (or query). Anything
 * else is home, as the music app read it. */
export function placeOfAddress(m: string | undefined): ExperiencePlace {
  const value = (m ?? '').trim();
  if (!value) return HOME_PLACE;
  const colon = value.indexOf(':');
  const page = colon < 0 ? value : value.slice(0, colon);
  if (!PAGE.test(page)) return HOME_PLACE;
  if (colon < 0) return { page, params: {} };
  const arg = value.slice(colon + 1);
  // `title:` with nothing after it is not a title.
  if (!arg.trim()) return HOME_PLACE;
  return { page, params: { [primary(page)]: arg } };
}

/** A place to `?m=` and the params the address carries beside it (home is ''). */
export function addressOfPlace(place: ExperiencePlace): { m: string; rest: Record<string, string> } {
  const key = primary(place.page);
  const { [key]: arg, ...rest } = place.params;
  if (place.page === 'home' && !arg) return { m: '', rest };
  return { m: arg ? `${place.page}:${arg}` : place.page, rest };
}

/** The key a place's page is drawn under (a new key starts a new page, at its top). */
export const placeKey = (place: ExperiencePlace): string =>
  `${place.page}?${Object.keys(place.params).sort().map(k => `${k}=${place.params[k]}`).join('&')}`;
