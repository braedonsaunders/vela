import type { Title } from '../wire';

/** Numbered seasons/episodes in order; season zero (specials) follows the regular run. */
export function seriesOrder(items: Title[]): Title[] {
  const season = (t: Title) => t.seasonNumber === 0 ? Infinity : t.seasonNumber ?? Infinity;
  return [...items].sort((a, b) => {
    const sa = season(a), sb = season(b);
    return (sa === sb ? 0 : sa < sb ? -1 : 1) || (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0);
  });
}
