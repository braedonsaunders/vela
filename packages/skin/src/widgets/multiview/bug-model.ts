// What a score bug prints, from a live event (spec A2).
/** The parts of a live event (spec A2) a bug shows. */
export interface BugEvent {
  title?: string;
  status: { state: string; detail: string };
  competitors: { abbr: string; score: string; home?: boolean; color?: string }[];
  ranking?: { pos: number; abbr: string; detail?: string }[];
  spoiler?: boolean;
}

/** Away first, as broadcasters print it ("NYG 24–27 PHI"). */
export function bugSides(event: BugEvent): { left: string; right: string; score: string } | null {
  if (event.competitors.length !== 2) return null;
  const [a, b] = event.competitors;
  const away = a!.home && !b!.home ? b! : a!;
  const home = away === a ? b! : a!;
  const scored = !event.spoiler && event.status.state !== 'pre' && (away.score !== '' || home.score !== '');
  return { left: away.abbr, right: home.abbr, score: scored ? `${away.score}–${home.score}` : '' };
}
