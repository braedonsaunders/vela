/** Native touch screens must not move TV focus back over a newly focused input. */
export function restoreRouteFocus(platform: string, tv: boolean): boolean {
  return tv || platform === 'web';
}

/** The shared navigation keeps the focus it already owns when a TV opens All books. */
export function readLibraryOpeningFocus(tv: boolean, view: string | undefined): boolean {
  return !(tv && view === 'all-books');
}

const CONTENT_ACTIONS = new Set(['select', 'playExtra', 'navigate', 'plugin', 'setParam', 'stop']);

/** A primary title action can replace provisional focus while its details are arriving. */
export function openingFocusPriority(action: string, titlePrimary = false): number {
  if (titlePrimary) return 3;
  if (action === 'play') return 2;
  return CONTENT_ACTIONS.has(action) ? 1 : 0;
}

export function takesOpeningFocus(priority: number, current: number, viewerMoved: boolean): boolean {
  return !viewerMoved && priority > current;
}

/** The pressed button if it is still drawn, else a drawn button that does the same. */
export function returnFocusTarget<T>(pressed: { target: T; does: string }, mounted: ReadonlyMap<T, string>): T | undefined {
  if (mounted.has(pressed.target)) return pressed.target;
  for (const [target, does] of mounted) if (does === pressed.does) return target;
  return undefined;
}
