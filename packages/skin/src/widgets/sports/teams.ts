// The favourite-team picker's choices, one league at a time: which leagues it offers, which league
// it opens on, and that league's teams with the followed ones first. A screen may inline every
// team, only some, or none (then the picker reads `/live/entities?league=`). Pure and tested.
import type { LiveEntity, LiveLeague } from '@vela/core';

export const entityKey = (entity: LiveEntity) => entity.key ?? entity.id;

/** The leagues to pick teams from: the screen's league chips in their order, then any league the
 * inline teams name that the chips do not. */
export function pickerLeagues(leagues: readonly LiveLeague[], entities: readonly LiveEntity[]): LiveLeague[] {
  const out: LiveLeague[] = [...leagues];
  const known = new Set(leagues.map(league => league.id));
  for (const entity of entities) {
    if (!entity.league || known.has(entity.league)) continue;
    known.add(entity.league);
    out.push({ id: entity.league, name: entity.league.toUpperCase() });
  }
  return out;
}

/** The league the picker opens on: the screen's chosen league, else the league of a followed team,
 * else the first league that has teams inline, else the first league. */
export function openingLeague(leagues: readonly LiveLeague[], entities: readonly LiveEntity[], chosen: string, followed: (entity: LiveEntity) => boolean): string {
  if (chosen && leagues.some(league => league.id === chosen)) return chosen;
  const favourite = entities.find(entity => entity.league && followed(entity));
  if (favourite?.league) return favourite.league;
  const inline = leagues.find(league => entities.some(entity => entity.league === league.id));
  return inline?.id ?? leagues[0]?.id ?? '';
}

/** One league's teams, followed first then by name: the inline ones, else those read for it. */
export function leagueTeams(league: string, inline: readonly LiveEntity[], loaded: readonly LiveEntity[] | undefined, followed: (entity: LiveEntity) => boolean): { teams: LiveEntity[]; needsRead: boolean } {
  const mine = inline.filter(entity => !league || entity.league === league);
  // Inline lists may carry only the followed teams of a league; a read fills in the rest.
  const onlyFollowed = mine.length > 0 && mine.every(followed);
  const source = loaded?.length ? merge(mine, loaded) : mine;
  const teams = [...source].sort((a, b) => Number(followed(b)) - Number(followed(a)) || a.name.localeCompare(b.name));
  return { teams, needsRead: !!league && loaded === undefined && (mine.length === 0 || onlyFollowed) };
}

function merge(first: readonly LiveEntity[], second: readonly LiveEntity[]): LiveEntity[] {
  const seen = new Set(first.map(entityKey));
  return [...first, ...second.filter(entity => !seen.has(entityKey(entity)))];
}
