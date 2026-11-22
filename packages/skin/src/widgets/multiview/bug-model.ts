// What a score bug prints, from a live event (spec A2): away first, as broadcasters print it
// ("NYG 24–27 PHI"); no score while the event has not started or the viewer is spoiler-free.
import type { LiveCompetitor, LiveEvent } from '../../../../protocol/live-events';

export type BugEvent = Pick<LiveEvent, 'status' | 'competitors' | 'ranking' | 'spoiler' | 'title' | 'league'>;

const label = (competitor: LiveCompetitor) => competitor.abbr || competitor.short || competitor.name;

export function bugSides(event: BugEvent): { left: string; right: string; score: string } | null {
  if (event.competitors.length !== 2) return null;
  const [a, b] = event.competitors;
  const away = a!.home && !b!.home ? b! : a!;
  const home = away === a ? b! : a!;
  const scored = !event.spoiler && event.status.state !== 'pre' && (!!away.score || !!home.score);
  return { left: label(away), right: label(home), score: scored ? `${away.score ?? '0'}–${home.score ?? '0'}` : '' };
}

/** The title an N-competitor event (a race, a round) shows instead of two sides. */
export function bugTitle(event: BugEvent): string {
  return event.title || event.league.abbr || event.league.name;
}

/** The leader's line for a ranking event ("VER P1"), hidden for a spoiler-free viewer. */
export function bugLeader(event: BugEvent): string {
  const leader = event.ranking?.[0];
  return leader && !event.spoiler ? `${leader.abbr || leader.name} P${leader.pos}` : '';
}
