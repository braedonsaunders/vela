import type { Title, TitleDetail } from '../wire';

/** Numbered seasons/episodes in order; season zero (specials) follows the regular run. */
export function seriesOrder(items: Title[]): Title[] {
  const season = (t: Title) => t.seasonNumber === 0 ? Infinity : t.seasonNumber ?? Infinity;
  return [...items].sort((a, b) => {
    const sa = season(a), sb = season(b);
    return (sa === sb ? 0 : sa < sb ? -1 : 1) || (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0);
  });
}

/** An episode as far as finding the one after it needs: itself, its show and its season. */
export interface EpisodeRef { id: string; showId?: string; seasonId?: string; seasonNumber?: number }

/** Seasons after the episode's own that are read for a first episode before giving up (empty ones are skipped). */
const SEASONS_AHEAD = 3;

/**
 * The episode after `episode` in its series, in series order, or null: the last one, or a series
 * that cannot be read. A season's detail lists all of its episodes; a show's may list only some
 * (a default season), so the episode's season is read first, then the show's own list, then the
 * seasons that follow it, for their first episode.
 */
export async function episodeAfter(episode: EpisodeRef, detail: (id: string) => Promise<TitleDetail>): Promise<Title | null> {
  const read = (id: string) => detail(id).catch(() => null);
  const after = (list: Title[] | undefined): Title | null | undefined => {
    const ordered = seriesOrder((list ?? []).filter(t => t.kind === 'episode'));
    const at = ordered.findIndex(t => t.id === episode.id);
    return at < 0 ? undefined : ordered[at + 1] ?? null;
  };
  // undefined: not listed here; null: listed last.
  let found = episode.seasonId ? after((await read(episode.seasonId))?.episodes) : undefined;
  if (found) return found;
  if (!episode.showId) return null;
  const show = await read(episode.showId);
  if (!show) return null;
  if (found === undefined) {
    found = after(show.episodes);
    if (found) return found;
  }
  // The last of its season (or not listed at all): the first episode of a season after it.
  const seasons = seriesOrder((show.seasons ?? []).filter(t => t.kind === 'season'));
  const own = seasons.findIndex(s => episode.seasonId ? s.id === episode.seasonId : episode.seasonNumber !== undefined && s.seasonNumber === episode.seasonNumber);
  if (own < 0) return null;
  for (const season of seasons.slice(own + 1, own + 1 + SEASONS_AHEAD)) {
    const first = seriesOrder(((await read(season.id))?.episodes ?? []).filter(t => t.kind === 'episode'))[0];
    if (first) return first;
  }
  return null;
}
