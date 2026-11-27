export type SectionRoute = { route: 'home' | 'library' | 'live' | 'screen'; entry: string };

/** Use the section navigator's active route, rather than a parent's pending pathname. */
export function sectionRoute(name: string | undefined, id: unknown): SectionRoute | null {
  if (name === 'index') return { route: 'home', entry: 'home' };
  if (name === 'live') return { route: 'live', entry: 'live' };
  if (name === 'library/[id]' && typeof id === 'string' && id) return { route: 'library', entry: id };
  if (name === 'screen/[id]' && typeof id === 'string' && id) return { route: 'screen', entry: id };
  return null;
}

/** Retained native navigators may still report focus under a fullscreen modal.
 * Section activity also follows the visible URL, on touch devices as on TV. */
export function sectionPathVisible(path: string): boolean {
  return path === '/' || path === '/live' || path.startsWith('/library/') || /^\/screen\/[^/]+\/?$/.test(path);
}

/** Touch sections are rendered directly rather than as navigator descriptors; their
 * visible path owns activity. TV still waits for native focus before taking focus. */
export function sectionIsActive(path: string, navigationFocused: boolean, tv: boolean): boolean {
  return sectionPathVisible(path) && (!tv || navigationFocused);
}

/**
 * Where tvOS's Menu goes from the section on top of the navigator's history when nothing open holds
 * it, as Back goes on Android TV: a page inside the section (an album, a collection) goes back to the
 * page under it, the root of any section but Home goes to Home, and Home leaves the app (null).
 */
export function sectionBack(routes: readonly { name: string; params?: object }[], index: number): 'back' | 'home' | null {
  const id = (route: { params?: object } | undefined) => (route?.params as { id?: unknown } | undefined)?.id;
  const top = routes[index];
  const section = sectionRoute(top?.name, id(top));
  if (!section || section.route === 'home') return null;
  const below = index > 0 ? sectionRoute(routes[index - 1]?.name, id(routes[index - 1])) : null;
  return below?.route === section.route && below.entry === section.entry ? 'back' : 'home';
}
