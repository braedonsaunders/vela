export type SectionRoute = { route: 'home' | 'library' | 'live'; entry: string };

/** Use the section navigator's active route, rather than a parent's pending pathname. */
export function sectionRoute(name: string | undefined, id: unknown): SectionRoute | null {
  if (name === 'index') return { route: 'home', entry: 'home' };
  if (name === 'live') return { route: 'live', entry: 'live' };
  if (name === 'library/[id]' && typeof id === 'string' && id) return { route: 'library', entry: id };
  return null;
}
