export function shouldRotateHero({ onHome, heroCount, still, query, heroPreviewing, flags }: {
  onHome: boolean; heroCount: number; still: boolean; query: string; heroPreviewing: boolean; flags: string[];
}): boolean {
  return onHome && heroCount > 1 && !still && query === '' && !heroPreviewing
    && !flags.includes('hero-paused') && !flags.includes('hero-interacting');
}
