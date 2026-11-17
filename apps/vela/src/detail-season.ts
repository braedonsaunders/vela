import type { Card, DetailModel } from '@vela/core';

/** Pick before exposing rows. Partial episode metadata cannot decide the viewer's season. */
export function selectedDetailSeason(detail: DetailModel | undefined, selection: string, resume?: Card): string {
  if (!detail) return '';
  const match = (key: string) => key.startsWith('@number:')
    ? detail.seasons.find(s => String(s.seasonNumber) === key.slice(8))
    : detail.seasons.find(s => s.id === key);
  const explicit = match(selection);
  if (explicit) return explicit.id;
  const next = detail.nextUp?.[0];
  const resumed = detail.episodes.find(e => e.progressSeconds > 0 && !e.played);
  const candidate = next ?? resume ?? resumed;
  const candidateSeason = candidate && (match(candidate.seasonId) ?? detail.seasons.find(s => s.seasonNumber === candidate.seasonNumber));
  if ((next || resume) && candidateSeason) return candidateSeason.id;
  if (detail.pending.includes('seasons') || detail.pending.includes('episodes')) return '';
  return candidateSeason?.id ?? detail.seasons[0]?.id ?? '';
}

/** Resolve tab/context keys once, and expose only the selected season while it loads. */
export function detailSeason(detail: DetailModel | undefined, selection: string, read: (id: string) => DetailModel | undefined) {
  const season = selectedDetailSeason(detail, selection);
  const loaded = season ? read(season) : undefined;
  const episodes = (loaded?.episodes ?? detail?.episodes ?? []).filter(e => e.seasonId === season || (!e.seasonId && e.seasonNumber === detail?.seasons.find(s => s.id === season)?.seasonNumber));
  const pending = !!detail && (!season && detail.seasons.length > 0 || !!season && episodes.length === 0 && (!loaded || loaded.pending.includes('episodes')));
  return { season, detail: detail ? {
    ...detail, episodes: season ? episodes : [],
    pending: pending ? [...new Set([...detail.pending, 'episodes' as const])] : loaded ? detail.pending.filter(p => p !== 'episodes') : detail.pending,
    nextUp: loaded?.nextUp ?? detail.nextUp?.filter(item => item.seasonId === season),
  } : detail };
}
