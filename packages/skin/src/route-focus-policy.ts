/** Native touch screens must not move TV focus back over a newly focused input. */
export function restoreRouteFocus(platform: string, tv: boolean): boolean {
  return tv || platform === 'web';
}

/** The shared navigation keeps the focus it already owns when Android TV opens All books. */
export function readLibraryOpeningFocus(platform: string, tv: boolean, view: string | undefined): boolean {
  return !(tv && platform === 'android' && view === 'all-books');
}

/** The legacy Android TV series modal opens on its close button. */
export function readTitleOpeningFocus(platform: string, tv: boolean, page: 'book' | 'series'): 'close' | undefined {
  return tv && platform === 'android' && page === 'series' ? 'close' : undefined;
}

/** The pressed button if it is still drawn, else a drawn button that does the same. */
export function returnFocusTarget<T>(pressed: { target: T; does: string }, mounted: ReadonlyMap<T, string>): T | undefined {
  if (mounted.has(pressed.target)) return pressed.target;
  for (const [target, does] of mounted) if (does === pressed.does) return target;
  return undefined;
}
