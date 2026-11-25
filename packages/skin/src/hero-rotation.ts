/** Set while a TV's hero is scrolled wholly off the screen (the hero preview widget reports it):
 * turning titles nobody sees redrew the hero and decoded new artwork every few seconds while the
 * viewer browsed the rows below. A `keep-` flag, so menus closing do not clear it. */
export const HERO_OFFSCREEN = 'keep-hero-offscreen';

export function shouldRotateHero({ onHome, heroCount, still, query, heroPreviewing, flags }: {
  onHome: boolean; heroCount: number; still: boolean; query: string; heroPreviewing: boolean; flags: string[];
}): boolean {
  return onHome && heroCount > 1 && !still && query === '' && !heroPreviewing
    && !flags.includes('hero-paused') && !flags.includes('hero-interacting') && !flags.includes(HERO_OFFSCREEN);
}
