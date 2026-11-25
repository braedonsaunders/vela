/** Native touch screens must not move TV focus back over a newly focused input. */
export function restoreRouteFocus(platform: string, tv: boolean): boolean {
  return tv || platform === 'web';
}

/** The pressed button if it is still drawn, else a drawn button that does the same. */
export function returnFocusTarget<T>(pressed: { target: T; does: string }, mounted: ReadonlyMap<T, string>): T | undefined {
  if (mounted.has(pressed.target)) return pressed.target;
  for (const [target, does] of mounted) if (does === pressed.does) return target;
  return undefined;
}
