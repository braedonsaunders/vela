// Live overlays (Sports), the pure parts: what a score bug says about an event, which side just
// scored, the ticker's items and its endless scroll, which alerts stand as toasts, and where an
// alert's Watch goes. Nothing here draws; score-bug.tsx, ticker.tsx and alerts.tsx do.
import { sides, teamColor, type LiveAlert, type LiveCompetitor, type LiveEvent, type WatchTarget } from '@vela/core';

/** How an event's status reads: on now, finished, still to come, or held up. */
export type BugTone = 'live' | 'final' | 'upcoming' | 'quiet';

export interface BugSide {
  id: string;
  abbr: string;
  name: string;
  logo?: string;
  /** `#rrggbb`, when the feed gives a usable one. */
  color?: string;
  /** Absent before the start and for a spoiler-free viewer. */
  score?: string;
  /** Finished and this side won / lost (the loser is drawn quieter). */
  winner: boolean;
  loser: boolean;
  /** The situation says this side has the ball. */
  possession: boolean;
}

export interface BugSituation { label: string; value: string }

interface BugBase {
  eventId: string;
  tone: BugTone;
  /** The status as it reads: "Q4 · 2:14", "71'", "Final", "7:30 PM". */
  status: string;
  /** The league's short name ("NFL"). */
  league: string;
  /** Scores are withheld until the viewer reveals them. */
  spoiler: boolean;
}

/** Two sides, away first as scores are written. */
export interface VersusBug extends BugBase {
  kind: 'versus';
  away: BugSide;
  home: BugSide;
  /** Up to two short label/value pairs for under the score ("Down 3rd & 6"), possession excluded. */
  situation: BugSituation[];
}

/** A field of N competitors (motorsport, golf): the event's name and who leads. */
export interface FieldBug extends BugBase {
  kind: 'field';
  title: string;
  /** "VER P1", or "" when the running order is withheld or unknown. */
  leader: string;
}

export type BugModel = VersusBug | FieldBug;

const HELD = new Set(['delayed', 'postponed', 'canceled']);

export function bugTone(event: LiveEvent): BugTone {
  switch (event.status?.state) {
    case 'in': return 'live';
    case 'post': return 'final';
    case 'pre': return 'upcoming';
    default: return 'quiet';
  }
}

function statusText(event: LiveEvent): string {
  const detail = event.status?.detail?.trim() ?? '';
  if (detail) return detail;
  const state = event.status?.state ?? '';
  if (HELD.has(state)) return state.charAt(0).toUpperCase() + state.slice(1);
  return '';
}

const same = (a: string | undefined, b: string | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
/** Situation keys that name who has the ball, when their value is just a side. */
const POSSESSION = /^(possession|ball|serving|serve|batting|at bat)$/i;

/** Which side a possession entry names. A value that only mentions a side ("ARS 54%", "NYG 38") is
 * not possession: it must name the side and nothing else. */
function possessor(situation: Record<string, string> | undefined, pair: [LiveCompetitor, LiveCompetitor]): { id?: string; key?: string } {
  for (const [key, value] of Object.entries(situation ?? {})) {
    if (!POSSESSION.test(key.trim())) continue;
    const side = pair.find(c => [c.abbr, c.short, c.name, c.id].some(name => same(name, value)));
    if (side) return { id: side.id, key };
  }
  return {};
}

function side(competitor: LiveCompetitor, finished: boolean, other: LiveCompetitor, possession: string | undefined, spoiler: boolean): BugSide {
  const winner = finished && !spoiler && (competitor.winner === true || (competitor.winner === undefined && other.winner === undefined && beats(competitor.score, other.score)));
  const loser = finished && !spoiler && !winner && (other.winner === true || (other.winner === undefined && competitor.winner === undefined && beats(other.score, competitor.score)));
  return {
    id: competitor.id,
    abbr: (competitor.abbr || competitor.short || competitor.name || '').trim(),
    name: competitor.short || competitor.name || competitor.abbr || '',
    ...(competitor.logo ? { logo: competitor.logo } : {}),
    ...(teamColor(competitor.color) ? { color: teamColor(competitor.color) } : {}),
    ...(!spoiler && competitor.score !== undefined && competitor.score !== '' ? { score: competitor.score } : {}),
    winner,
    loser,
    possession: !finished && possession === competitor.id,
  };
}

/** Numeric scores only: "3-1 (sets)" and the like are never ranked here. */
function beats(a: string | undefined, b: string | undefined): boolean {
  const x = Number(a), y = Number(b);
  return a !== undefined && b !== undefined && a !== '' && b !== '' && Number.isFinite(x) && Number.isFinite(y) && x > y;
}

/** What the bug says about an event; null for one it cannot draw (no sides and no ranking). */
export function bugModel(event: LiveEvent | undefined | null, maxSituation = 2): BugModel | null {
  if (!event || typeof event.id !== 'string' || !event.status) return null;
  const spoiler = event.spoiler === true;
  const tone = bugTone(event);
  const base = { eventId: event.id, tone, status: statusText(event), league: event.league?.abbr || event.league?.name || '', spoiler };
  const pair = sides(event);
  if (pair) {
    const finished = event.status.state === 'post';
    const ball = spoiler ? {} : possessor(event.situation, pair);
    const situation = spoiler || tone !== 'live' ? [] : Object.entries(event.situation ?? {})
      .filter(([key, value]) => key !== ball.key && !!key.trim() && !!String(value ?? '').trim())
      .slice(0, maxSituation)
      .map(([label, value]) => ({ label: label.trim(), value: String(value).trim() }));
    return {
      ...base, kind: 'versus',
      away: side(pair[0], finished, pair[1], ball.id, spoiler),
      home: side(pair[1], finished, pair[0], ball.id, spoiler),
      situation,
    };
  }
  const title = event.title?.trim() || event.league?.name || '';
  if (!title && !event.ranking?.length) return null;
  const first = spoiler ? undefined : [...(event.ranking ?? [])].sort((a, b) => a.pos - b.pos)[0];
  const leader = first ? `${first.abbr || first.name} P${first.pos}` : '';
  return { ...base, kind: 'field', title, leader };
}

/** Which sides' scores changed from one look at an event to the next (a goal, a basket). Only a
 * change in the same event with both scores shown counts: a reveal or a new event is not a score. */
export function scoreChange(previous: BugModel | null | undefined, next: BugModel | null | undefined): { away: boolean; home: boolean } {
  const none = { away: false, home: false };
  if (!previous || !next || previous.kind !== 'versus' || next.kind !== 'versus' || previous.eventId !== next.eventId) return none;
  if (previous.spoiler || next.spoiler) return none;
  const moved = (a: string | undefined, b: string | undefined) => a !== undefined && b !== undefined && a !== b;
  return { away: moved(previous.away.score, next.away.score), home: moved(previous.home.score, next.home.score) };
}

// The player

/** What the live player overlays: nothing at all unless the server offers live events and a
 * channel is playing; then the bug for the event on air and the ticker when the viewer wants it. */
export function overlayShown(available: boolean, live: boolean, eventId: string | undefined, tickerOn: boolean): { available: boolean; eventId: string; ticker: boolean } {
  const on = available && live;
  return { available, eventId: on && eventId ? eventId : '', ticker: on && tickerOn };
}

// The ticker

export interface TickerItem {
  id: string;
  tone: BugTone;
  league: string;
  /** Two sides, or a field's title and leader. */
  bug: BugModel;
}

/** The ticker's events in the server's order (it ranks them), each once, those it can draw. */
export function tickerItems(ids: readonly string[] | undefined, events: Record<string, LiveEvent>): TickerItem[] {
  const seen = new Set<string>();
  const items: TickerItem[] = [];
  for (const id of ids ?? []) {
    if (seen.has(id)) continue;
    seen.add(id);
    const bug = bugModel(events[id], 0);
    if (bug && events[id]!.status.state !== 'canceled') items.push({ id, tone: bug.tone, league: bug.league, bug });
  }
  return items;
}

/** The ticker's run moves `offset` on by `speed` points a second for `ms`, wrapping at one copy's
 * width so the second copy takes over seamlessly. A changed width (a score got wider) keeps the
 * offset where it is, folded into the new width: the run never jumps back to the start. */
export function marqueeStep(offset: number, ms: number, speed: number, width: number): number {
  'worklet';
  if (!(width > 0) || !Number.isFinite(offset)) return 0;
  const next = offset + Math.max(0, ms) * speed / 1000;
  return next >= width ? next % width : next;
}

/** The run scrolls only when one copy of it is wider than the bar shows. */
export function marqueeScrolls(contentWidth: number, viewportWidth: number): boolean {
  return contentWidth > 0 && viewportWidth > 0 && contentWidth > viewportWidth;
}

// Alert toasts

/** At most this many toasts stand at once; the rest wait their turn. */
export const MAX_TOASTS = 2;
/** How long a toast stands untouched. */
export const TOAST_MS = 9000;

/** The alerts to show, oldest first: a newer alert about the same event replaces an older one
 * (a close game that went final says only "Final"). `superseded` are the ones it replaced. */
export function toastQueue(alerts: readonly LiveAlert[], max = MAX_TOASTS): { shown: LiveAlert[]; superseded: LiveAlert[] } {
  const latest = new Map<string, LiveAlert>();
  const superseded: LiveAlert[] = [];
  for (const alert of alerts) {
    const known = latest.get(alert.eventId);
    if (known) superseded.push(known);
    latest.set(alert.eventId, alert);
  }
  const queue = alerts.filter(alert => latest.get(alert.eventId) === alert);
  return { shown: queue.slice(0, Math.max(0, max)), superseded };
}

export interface AlertWatch {
  /** The channel to open, when one shows the event somewhere other than what is playing. */
  target?: WatchTarget & { channelId: string };
  /** The event is on the channel playing now. */
  onNow: boolean;
}

/** Where an alert's Watch goes: the most likely channel carrying the event, live ones first. A
 * target that is the channel already playing is no target ("on now"); a non-channel target
 * (an add-on) cannot be opened from a toast. */
export function alertWatch(targets: readonly WatchTarget[] | undefined, playingChannelId?: string): AlertWatch {
  const channels = (targets ?? []).filter((target): target is WatchTarget & { channelId: string } => !!target.channelId)
    .sort((a, b) => Number(b.live) - Number(a.live) || (b.confidence ?? 0) - (a.confidence ?? 0));
  const onNow = !!playingChannelId && channels.some(target => target.channelId === playingChannelId);
  if (onNow) return { onNow };
  const target = channels[0];
  return target ? { target, onNow } : { onNow };
}

/** A watch target's name as a button reads it: "FOX · 205". */
export function watchLabel(target: WatchTarget): string {
  return [target.name, target.number].filter(Boolean).join(' · ');
}
