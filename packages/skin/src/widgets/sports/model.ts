// What the Sports screen and game page say about an event, worked out once and drawn by every
// skin: the two sides in reading order, the score as shown (or withheld), the status line, where to
// watch, and the smooth path of a win-probability series. Pure, so it is tested without a renderer.
import { msg, probabilityFor, seriesPoints, sides, teamColor, time, type LiveCompetitor, type LiveEvent, type LiveProbabilityPoint, type WatchTarget } from '@vela/core';

export type Phase = 'live' | 'upcoming' | 'final' | 'off';

export function phaseOf(event: LiveEvent): Phase {
  switch (event.status.state) {
    case 'in': return 'live';
    case 'pre': case 'delayed': return 'upcoming';
    case 'post': return 'final';
    default: return 'off';
  }
}

export interface Side { id: string; name: string; short: string; abbr: string; logo: string; color: string; altColor: string; score: string; record: string; winner: boolean; loser: boolean; entityId: string }

function side(c: LiveCompetitor, other: LiveCompetitor, final: boolean): Side {
  const abbr = c.abbr || initials(c.short || c.name);
  const score = c.score ?? '';
  const lost = final && (c.winner === false && other.winner === true || (!c.winner && !other.winner && Number(score) < Number(other.score ?? '')));
  return { id: c.id, name: c.name, short: c.short || c.name, abbr, logo: c.logo ?? '', color: teamColor(c.color) ?? '', altColor: teamColor(c.altColor) ?? '',
    score, record: c.record ?? '', winner: final && (c.winner === true || !lost && Number(score) > Number(other.score ?? '')), loser: lost, entityId: c.entityId ?? '' };
}

/** Up to three letters for a crest with no abbreviation. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return words.slice(0, 3).map(w => w[0]!).join('').toUpperCase();
  return (words[0] ?? '').slice(0, 3).toUpperCase();
}

export interface Matchup {
  phase: Phase;
  /** Away then home; null for an N-competitor event (a race), which has `title` and `ranking`. */
  sides: [Side, Side] | null;
  /** Scores are shown: started, not withheld for a spoiler-free viewer, and present. */
  scored: boolean;
  spoiler: boolean;
  title: string;
  league: string;
  status: string;
  /** "3rd & 6 · PHI ball": the situation's values, briefly. */
  situation: string;
  close: boolean;
}

export function matchup(event: LiveEvent, now = Date.now()): Matchup {
  const phase = phaseOf(event);
  const pair = sides(event);
  const final = phase === 'final';
  const both = pair ? [side(pair[0], pair[1], final), side(pair[1], pair[0], final)] as [Side, Side] : null;
  const spoiler = event.spoiler === true;
  const scored = !!both && !spoiler && phase !== 'upcoming' && both.every(s => s.score !== '');
  return {
    phase, sides: both, scored, spoiler,
    title: event.title || (both ? `${both[0].short} ${msg('sports.at')} ${both[1].short}` : event.league.name),
    league: event.league.abbr || event.league.name,
    status: statusText(event, phase, now),
    situation: spoiler ? '' : Object.values(event.situation ?? {}).slice(0, 2).join(' · '),
    close: !spoiler && event.status.close === true,
  };
}

/** The status line: the clock while live, the start for an upcoming event, "Final" after. */
export function statusText(event: LiveEvent, phase = phaseOf(event), now = Date.now()): string {
  if (phase === 'upcoming') return startText(event.start, now) || event.status.detail;
  if (phase === 'final') return event.status.detail || msg('sports.final');
  if (event.spoiler && phase === 'live') return msg('sports.live');
  return event.status.detail || (phase === 'off' ? event.status.state : '');
}

/** "7:30 PM", "Tomorrow 7:00 PM", "Sat 7:00 PM" or a date, by how far off the start is. */
export function startText(start: string, now = Date.now()): string {
  const at = Date.parse(start);
  if (!Number.isFinite(at)) return '';
  const days = dayOffset(at, now);
  const clockText = time(at);
  if (days === 0) return clockText;
  if (days === 1) return msg('sports.tomorrowAt', { time: clockText });
  if (days === -1) return msg('sports.yesterdayAt', { time: clockText });
  const date = new Date(at);
  const weekday = date.toLocaleDateString(undefined, Math.abs(days) < 7 ? { weekday: 'short' } : { month: 'short', day: 'numeric' });
  return `${weekday} ${clockText}`;
}

/** Whole local days from `now` to `at`. */
export function dayOffset(at: number, now: number): number {
  const a = new Date(at), b = new Date(now);
  a.setHours(0, 0, 0, 0); b.setHours(0, 0, 0, 0);
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

/** The best place to watch: a live channel first, then any channel, then anything with the highest confidence. */
export function bestWatch(event: LiveEvent): WatchTarget | undefined {
  const targets = [...(event.watch ?? [])];
  const score = (t: WatchTarget) => (t.live ? 2 : 0) + (t.kind === 'channel' && t.channelId ? 1 : 0) + t.confidence;
  return targets.sort((a, b) => score(b) - score(a))[0];
}

/** Whether a target can be tuned here (a Live TV channel). */
export const tunable = (target: WatchTarget | undefined): target is WatchTarget & { channelId: string } => !!target?.channelId;

/** "FOX · 205" for a channel, the add-on's name otherwise; else the first broadcast. */
export function watchLabel(event: LiveEvent): string {
  const target = bestWatch(event);
  if (target) return target.number ? msg('sports.onChannel', { name: target.name, number: target.number }) : target.name;
  return event.broadcasts?.[0]?.name ?? '';
}

/** The home side's chance (or the event's subject's) as a whole percentage, with whose it is. */
export function probabilityLead(event: LiveEvent, pair: [Side, Side] | null): { abbr: string; share: number; home: number } | undefined {
  if (!pair || event.spoiler) return undefined;
  const home = probabilityFor(event, pair[1].id);
  if (home === undefined) return undefined;
  const leader = home >= 0.5 ? pair[1] : pair[0];
  return { abbr: leader.abbr, share: Math.round(Math.max(home, 1 - home) * 100), home };
}

/**
 * A smooth line through a probability series in a width × height box: Catmull-Rom through the
 * points as cubic Béziers, clamped so it never overshoots the box. Also the area under it.
 */
export function probabilityPath(series: readonly LiveProbabilityPoint[], width: number, height: number): { line: string; area: string; end?: { x: number; y: number } } {
  const points = seriesPoints(series).map(p => ({ x: p.x * width, y: p.y * height }));
  if (!points.length) return { line: '', area: '' };
  const r = (n: number) => Math.round(n * 100) / 100;
  if (points.length === 1) {
    const p = points[0]!;
    return { line: `M${r(p.x)},${r(p.y)}`, area: '', end: p };
  }
  let line = `M${r(points[0]!.x)},${r(points[0]!.y)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!, p1 = points[i]!, p2 = points[i + 1]!, p3 = points[Math.min(points.length - 1, i + 2)]!;
    const clampY = (y: number) => Math.min(height, Math.max(0, y));
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: clampY(p1.y + (p2.y - p0.y) / 6) };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: clampY(p2.y - (p3.y - p1.y) / 6) };
    line += ` C${r(c1.x)},${r(c1.y)} ${r(c2.x)},${r(c2.y)} ${r(p2.x)},${r(p2.y)}`;
  }
  const last = points.at(-1)!, first = points[0]!;
  return { line, area: `${line} L${r(last.x)},${height} L${r(first.x)},${height} Z`, end: last };
}

/** A path's drawn length, approximately (the polyline through its points), for the draw-on motion. */
export function pathLength(series: readonly LiveProbabilityPoint[], width: number, height: number): number {
  const points = seriesPoints(series).map(p => ({ x: p.x * width, y: p.y * height }));
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  return Math.ceil(length * 1.08) + 4;
}

/** A crest's fill: the team colour, or one made from its name so crests still differ. */
export function crestColor(s: Pick<Side, 'color' | 'name'>): string {
  if (s.color) return s.color;
  let h = 0;
  for (const ch of s.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360}, 45%, 34%)`;
}

/** Dark enough to carry white text: the colour, or the alternate if the colour is too light. */
export function heroTint(s: Pick<Side, 'color' | 'altColor'>): string {
  const pick = [s.color, s.altColor].find(c => c && luminance(c) < 0.45);
  return pick || s.color || '#1d2a44';
}

export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0.5;
  const n = parseInt(m[1]!, 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

/** A table's numeric columns align right; its first (names) left. */
export function numericColumn(rows: readonly (readonly string[])[], column: number): boolean {
  if (column === 0) return false;
  const cells = rows.map(row => row[column] ?? '').filter(cell => cell !== '' && cell !== '–' && cell !== '-');
  return cells.length > 0 && cells.every(cell => /^[+\-−]?[\d.:%/–-]+[a-zA-Z]{0,3}$/.test(cell));
}
