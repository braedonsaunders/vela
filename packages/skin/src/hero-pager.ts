// Featured-title indicators remain pointer/touch conveniences but never enter directional focus.

/** Whether a press is one of the pager's per-title segments: a pickHero naming its own item. */
export function isHeroSegment(action: string | undefined, arg: string, itemIndex: number, inHeroes: boolean): boolean {
  return action === 'pickHero' && inHeroes && arg === String(itemIndex);
}

/** Whether a press drives the hero's rotation (a segment, previous or next, or the pause control). */
export function isHeroControl(action: string | undefined, arg: string): boolean {
  return action === 'pickHero' || (action === 'toggle' && arg === 'hero-paused');
}
