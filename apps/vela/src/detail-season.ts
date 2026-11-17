import type { DetailModel } from '@vela/core';

/** Resolve both season tabs and context links to the same server id before choosing a load. */
export function detailSeason(detail: DetailModel | undefined, selection: string, read: (id: string) => DetailModel | undefined) {
  const selected = selection.startsWith('@number:')
    ? detail?.seasons.find(item => String(item.seasonNumber) === selection.slice(8))
    : detail?.seasons.find(item => item.id === selection);
  const season = selected?.id ?? detail?.seasons[0]?.id ?? '';
  const loaded = season ? read(season) : undefined;
  return {
    season,
    detail: detail && season ? {
      ...detail,
      // The shared binding filters the normalized ids. Do not pre-filter here as well.
      episodes: loaded?.episodes ?? detail.episodes,
      nextUp: loaded?.nextUp ?? detail.nextUp?.filter(item => item.seasonId === season),
    } : detail,
  };
}
