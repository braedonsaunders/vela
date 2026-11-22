// What the Sports screen and game page say about an event, worked out once and drawn by every
// skin: the two sides in reading order, the score as shown (or withheld), the status line, where to
// watch, and the smooth path of a win-probability series. Pure, so it is tested without a renderer.
import { msg, probabilityFor, seriesPoints, sides, teamColor, time, type LiveCompetitor, type LiveEvent, type LivePlay, type LiveProbabilityPoint, type LiveRankingRow, type WatchTarget } from '@vela/core';

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
    league: leagueLabel(event.league),
    status: statusText(event, phase, now),
    situation: spoiler ? '' : situationEntries(event).slice(0, 2).map(([, value]) => value).join(' · '),
    close: !spoiler && event.status.close === true,
  };
}

/** The situation's label/value pairs, less any that only repeat the status (a "Clock" equal to the
 * clock already shown). */
export function situationEntries(event: LiveEvent): [string, string][] {
  const shown = new Set([event.status.detail, event.status.clock].filter(Boolean).map(text => String(text).trim()));
  return Object.entries(event.situation ?? {}).filter(([, value]) => typeof value === 'string' && value.trim() !== '' && !shown.has(value.trim()));
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

/** Whether a target can be tuned here (a Live TV channel). Only these are actions: a broadcast or
 * a target with nothing to tune is information and never opens anything. */
export const tunable = (target: WatchTarget | undefined): target is WatchTarget & { channelId: string } => !!target?.channelId && target.available !== false;

/** The best target that can be tuned, if any. */
export function watchTarget(event: LiveEvent): (WatchTarget & { channelId: string }) | undefined {
  const target = bestWatch({ ...event, watch: (event.watch ?? []).filter(tunable) });
  return tunable(target) ? target : undefined;
}

/** A target's name as a button says it: "FOX · 205", or the name alone. */
export function targetLabel(target: WatchTarget): string {
  return target.number ? msg('sports.onChannel', { name: target.name, number: target.number }) : target.name;
}

/** Where the event is on, as information: a target that cannot be tuned here, else the broadcasts
 * (TV before streaming before radio), at most two names. Empty when nothing is known. */
export function airingText(event: LiveEvent): string {
  // An add-on that carries it names a place; a plugin's target is a web link (the page lists those).
  const untunable = (event.watch ?? []).filter(target => !tunable(target) && target.kind === 'addon').map(target => target.name);
  // A channel Ether knows cannot play now is named, greyed in words, never offered as a button.
  const unavailable = (event.watch ?? []).filter(target => target.channelId && target.available === false)
    .map(target => msg('sports.unavailableNow', { name: target.number ? msg('sports.onChannel', { name: target.name, number: target.number }) : target.name }));
  const rank = { tv: 0, stream: 1, radio: 2 } as const;
  const broadcasts = [...(event.broadcasts ?? [])].sort((a, b) => (rank[a.kind] ?? 3) - (rank[b.kind] ?? 3)).map(b => b.name);
  // A broadcast that is the channel a Watch button already names is not said twice.
  const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9+]/g, '');
  const tuned = new Set((event.watch ?? []).filter(tunable).map(target => key(target.name)));
  const names = [...new Set([...unavailable, ...untunable, ...broadcasts].map(name => name.trim()).filter(name => name && !tuned.has(key(name))))];
  return names.slice(0, 2).join(' · ');
}

/** Where to watch, briefly, for a card's corner: the channel to tune ("FOX · 205"), else where it airs. */
export function watchLabel(event: LiveEvent): string {
  const target = watchTarget(event);
  return target ? targetLabel(target) : airingText(event);
}

/** Plays newest first. Ether sends them oldest first; a list whose periods already fall is left as it is. */
export function newestFirst(plays: readonly LivePlay[]): LivePlay[] {
  if (plays.length < 2) return [...plays];
  const first = plays[0]!.period, last = plays.at(-1)!.period;
  if (first !== undefined && last !== undefined && first > last) return [...plays];
  return [...plays].reverse();
}

/** A card's last line: what pressing leads to (accent) or where it airs (quiet, not an action). */
export interface CardLine { glyph: string; text: string; action: boolean }
export function cardLine(event: LiveEvent, m: Pick<Matchup, 'spoiler' | 'phase'>): CardLine | null {
  if (m.spoiler) return { glyph: 'eye-off', text: msg('sports.spoilersHidden'), action: false };
  const target = watchTarget(event);
  if (target && (m.phase === 'live' || m.phase === 'upcoming')) {
    return m.phase === 'live' ? { glyph: 'play-fill', text: msg('sports.watchOn', { name: targetLabel(target) }), action: true } : { glyph: 'calendar', text: targetLabel(target), action: true };
  }
  if (m.phase === 'final') return { glyph: 'forward-chevron', text: msg('sports.recap'), action: true };
  const airing = airingText(event);
  if (airing && (m.phase === 'live' || m.phase === 'upcoming')) return { glyph: 'tv', text: msg('sports.onBroadcast', { name: airing }), action: false };
  return null;
}

/**
 * A league as a chip names it: the abbreviation when it is the name's own start ("PGA" of "PGA
 * Tour") or an initialism that saves real room ("NFL", "MLS", "F1" of "Formula 1"), the name when
 * it is short enough to read whole ("La Liga", "Ligue 1", "Serie A", "Bundesliga"), else the
 * abbreviation ("EPL" for "Premier League").
 */
export function leagueLabel(league: { name: string; abbr?: string }): string {
  const name = league.name.trim(), abbr = (league.abbr ?? '').trim();
  if (!abbr || !name || abbr.toLowerCase() === name.toLowerCase()) return name || abbr;
  const words = name.split(/\s+/);
  if (words[0]!.toLowerCase() === abbr.toLowerCase()) return abbr;
  const initials = words.map(word => /^\d+$/.test(word) ? word : word[0]!).join('');
  if (initials.toLowerCase() === abbr.toLowerCase() && (abbr.length >= 3 || name.length > 8)) return abbr;
  if (name.length <= 12) return name;
  return abbr;
}

/** A ranking row as drawn: its place ("T3" when shared), name, headline value and quieter context. */
export interface RankRow { place: string; pos: number; name: string; detail: string; secondary: string; entityId: string }
export function rankRows(rows: readonly LiveRankingRow[] | undefined): RankRow[] {
  const list = (rows ?? []).filter(row => row && typeof row.name === 'string');
  const counts = new Map<number, number>();
  for (const row of list) counts.set(row.pos, (counts.get(row.pos) ?? 0) + 1);
  return list.map(row => ({
    place: Number.isFinite(row.pos) ? `${(counts.get(row.pos) ?? 0) > 1 ? 'T' : ''}${row.pos}` : '',
    pos: row.pos, name: row.name, detail: (row.detail ?? '').trim(), secondary: (row.secondary ?? '').trim(), entityId: row.entityId ?? '',
  }));
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
