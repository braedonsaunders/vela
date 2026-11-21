// The featured titles' pager on the web: its segments are one tab stop (the title on show), and
// the arrow keys, Home and End move among them, choosing the title as focus arrives, as a WAI
// carousel's tabbed picker does. TV focus engines move among them natively.

/** Whether a press is one of the pager's per-title segments: a pickHero naming its own item. */
export function isHeroSegment(action: string | undefined, arg: string, itemIndex: number, inHeroes: boolean): boolean {
  return action === 'pickHero' && inHeroes && arg === String(itemIndex);
}

/** Whether a press drives the hero's rotation (a segment, previous or next, or the pause control). */
export function isHeroControl(action: string | undefined, arg: string): boolean {
  return action === 'pickHero' || (action === 'toggle' && arg === 'hero-paused');
}

/** The title a key moves the pager to from `index` of `count`, wrapping round; null for other keys. */
export function heroSegmentDestination(key: string, index: number, count: number): number | null {
  if (count < 2) return null;
  switch (key) {
    case 'ArrowLeft': return (index - 1 + count) % count;
    case 'ArrowRight': return (index + 1) % count;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return null;
  }
}
