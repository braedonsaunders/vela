export type SectionRoute = { route: 'home' | 'library' | 'live'; entry: string };

/** Use the section navigator's active route, rather than a parent's pending pathname. */
export function sectionRoute(name: string | undefined, id: unknown): SectionRoute | null {
  if (name === 'index') return { route: 'home', entry: 'home' };
  if (name === 'live') return { route: 'live', entry: 'live' };
  if (name === 'library/[id]' && typeof id === 'string' && id) return { route: 'library', entry: id };
  return null;
}

/** Retained native navigators may still report focus under a fullscreen modal.
 * Section activity also follows the visible URL, on touch devices as on TV. */
export function sectionPathVisible(path: string): boolean {
  return path === '/' || path === '/live' || path.startsWith('/library/');
}

/** Touch sections are rendered directly rather than as navigator descriptors; their
 * visible path owns activity. TV still waits for native focus before taking focus. */
export function sectionIsActive(path: string, navigationFocused: boolean, tv: boolean): boolean {
  return sectionPathVisible(path) && (!tv || navigationFocused);
}
