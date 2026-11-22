// Live events: the pure parts of following them. Merging pushed updates into what is known,
// combining every mounted view's interest into one stream query, the reconnect backoff, and the
// small readings views share (whose side is winning, what a probability series looks like).
import type * as V from '../wire';
import type { LiveStreamQuery } from '../adapter/capabilities';

/** Newer wins; an event with the same stamp replaces the known one only when its content differs.
 * Returns `current` itself when nothing changed, so selectors keep their identity. */
export function mergeEvents(current: Record<string, V.LiveEvent>, incoming: readonly V.LiveEvent[]): Record<string, V.LiveEvent> {
  let next: Record<string, V.LiveEvent> | undefined;
  for (const event of incoming) {
    if (!event || typeof event.id !== 'string') continue;
    const known = (next ?? current)[event.id];
    if (known && !isNewer(event, known)) continue;
    next ??= { ...current };
    next[event.id] = event;
  }
  return next ?? current;
}

/** Whether `event` should replace `known`: a later stamp, or the same stamp with other content
 * (a spoiler reveal changes content without a new stamp). An older stamp never wins. */
export function isNewer(event: V.LiveEvent, known: V.LiveEvent): boolean {
  const a = Date.parse(event.updatedAt), b = Date.parse(known.updatedAt);
  if (Number.isFinite(a) && Number.isFinite(b) && a !== b) return a > b;
  return JSON.stringify(event) !== JSON.stringify(known);
}

/** A detail keeps its tables and plays while its event fields follow the stream. */
export function withEvent(detail: V.LiveEventDetail, event: V.LiveEvent | undefined): V.LiveEventDetail {
  if (!event || event.id !== detail.id || !isNewer(event, detail)) return detail;
  return { ...detail, ...event, tables: detail.tables, plays: detail.plays, probabilitySeries: withPoint(detail.probabilitySeries, event), links: detail.links };
}

/** A pushed probability extends the series' last point until the next detail read brings the real one. */
function withPoint(series: V.LiveProbabilityPoint[], event: V.LiveEvent): V.LiveProbabilityPoint[] {
  const value = event.probability?.value;
  const last = series.at(-1);
  if (value === undefined || !last || last.value === value) return series;
  return [...series.slice(0, -1), { ...last, value }];
}

/** One view's interest in the stream. */
export interface LiveInterest { events?: readonly string[]; screens?: readonly string[]; alerts?: boolean }

/** Every mounted view's interest as one stream query, sorted so equal interest compares equal. */
export function streamQuery(interests: Iterable<LiveInterest>): LiveStreamQuery {
  const events = new Set<string>(), screens = new Set<string>();
  let alerts = false;
  for (const interest of interests) {
    for (const id of interest.events ?? []) if (id) events.add(id);
    for (const id of interest.screens ?? []) if (id) screens.add(id);
    alerts ||= interest.alerts === true;
  }
  return { events: [...events].sort(), screens: [...screens].sort(), alerts };
}

export const queryKey = (query: LiveStreamQuery) => JSON.stringify(query);
export const emptyQuery = (query: LiveStreamQuery) => !query.events.length && !query.screens.length && !query.alerts;

/** Reconnect delay after `failures` consecutive failures: 1 s doubling to 30 s, with up to 20% jitter. */
export function backoffMs(failures: number, jitter = Math.random()): number {
  const base = Math.min(30_000, 1000 * 2 ** Math.max(0, failures - 1));
  return Math.round(base * (1 + 0.2 * Math.min(1, Math.max(0, jitter))));
}

/** A server's event as Vela reads it: the lists a view walks are always lists. Ether omits
 * `competitors` for N-competitor events (golf, F1 carry `ranking` rows instead) and may omit other
 * optional lists; one missing array must never take a screen down. Anything without an id and a
 * status is not an event. */
export function normaliseEvent(value: unknown): V.LiveEvent | null {
  if (!value || typeof value !== 'object') return null;
  const event = value as Partial<V.LiveEvent>;
  if (typeof event.id !== 'string' || !event.status || typeof event.status.state !== 'string') return null;
  const list = <T>(items: T[] | undefined | null): T[] => Array.isArray(items) ? items : [];
  return {
    ...event,
    league: event.league ?? { id: '', name: '' },
    competitors: list(event.competitors),
    ...(event.ranking !== undefined ? { ranking: list(event.ranking) } : {}),
    ...(event.broadcasts !== undefined ? { broadcasts: list(event.broadcasts) } : {}),
    ...(event.watch !== undefined ? { watch: list(event.watch) } : {}),
  } as V.LiveEvent;
}

export function normaliseEvents(values: unknown): V.LiveEvent[] {
  return Array.isArray(values) ? values.map(normaliseEvent).filter((event): event is V.LiveEvent => !!event) : [];
}

/** A detail with every list a list (tables, plays, the probability series, links). */
export function normaliseDetail(value: unknown): V.LiveEventDetail | null {
  const event = normaliseEvent(value);
  if (!event) return null;
  const detail = value as Partial<V.LiveEventDetail>;
  const list = <T>(items: T[] | undefined | null): T[] => Array.isArray(items) ? items : [];
  return { ...event, tables: list(detail.tables), plays: list(detail.plays), probabilitySeries: list(detail.probabilitySeries), links: list(detail.links) };
}

/** A screen whose sections all carry their lists, events normalised and unreadable ones dropped. */
export function normaliseScreen(screen: V.Screen): V.Screen {
  const list = <T>(items: T[] | undefined | null): T[] => Array.isArray(items) ? items : [];
  return {
    ...screen,
    sections: list(screen.sections).map(section => {
      const raw = section as unknown as Record<string, unknown>;
      switch (section.type) {
        case 'hero': return { ...section, event: normaliseEvent(raw.event) ?? undefined, also: normaliseEvents(raw.also) } as V.ScreenSection;
        case 'events': case 'schedule': return { ...section, events: normaliseEvents(raw.events) } as V.ScreenSection;
        case 'table': return { ...section, tables: list(raw.tables as V.LiveTable[]) } as V.ScreenSection;
        case 'leagues': return { ...section, leagues: list(raw.leagues as never[]) } as V.ScreenSection;
        case 'entities': return { ...section, entities: list(raw.entities as never[]) } as V.ScreenSection;
        default: return section;
      }
    }),
  };
}

/** A pushed stream event, validated: updates, alerts and heartbeats; anything else is ignored. */
export type LiveStreamMessage = { kind: 'update'; events: V.LiveEvent[] } | { kind: 'alert'; alert: V.LiveAlert } | { kind: 'heartbeat' } | { kind: 'ignored' };
export function readLiveMessage(name: string, data: string): LiveStreamMessage {
  if (name === 'heartbeat') return { kind: 'heartbeat' };
  if (name !== 'update' && name !== 'alert') return { kind: 'ignored' };
  let value: unknown;
  try { value = JSON.parse(data); } catch { return { kind: 'ignored' }; }
  if (name === 'update') {
    const events = (value as { events?: unknown })?.events;
    return Array.isArray(events) ? { kind: 'update', events: normaliseEvents(events) } : { kind: 'ignored' };
  }
  const alert = value as V.LiveAlert;
  return alert && typeof alert.id === 'string' && typeof alert.eventId === 'string' && ['started', 'close', 'final'].includes(alert.kind)
    ? { kind: 'alert', alert } : { kind: 'ignored' };
}

/** Every event a screen shows. */
export function screenEvents(screen: V.Screen): V.LiveEvent[] {
  return screen.sections.flatMap(section => {
    switch (section.type) {
      case 'hero': return [...(section.event ? [section.event] : []), ...(section.also ?? [])];
      case 'events': case 'schedule': return section.events;
      default: return [];
    }
  });
}

/** The away and home sides in reading order (away first, as scores are written), else as given. */
export function sides(event: V.LiveEvent): [V.LiveCompetitor, V.LiveCompetitor] | null {
  const [a, b] = event.competitors;
  if (!a || !b || event.competitors.length !== 2) return null;
  return a.home && !b.home ? [b, a] : [a, b];
}

/** The share for one side (0..1) by `probability.competitorId`; the other side gets the rest. */
export function probabilityFor(event: V.LiveEvent, competitorId: string): number | undefined {
  const p = event.probability;
  if (!p || !Number.isFinite(p.value)) return undefined;
  const value = Math.min(1, Math.max(0, p.value));
  const subject = p.competitorId ?? event.competitors[0]?.id;
  return subject === competitorId ? value : 1 - value;
}

/** A series as points in a unit box: x by `t` (numbers or timestamps) across its range, y = 1 - value. */
export function seriesPoints(series: readonly V.LiveProbabilityPoint[]): { x: number; y: number }[] {
  const ts = series.map(point => typeof point.t === 'number' ? point.t : Date.parse(point.t));
  const usable = series.map((point, n) => ({ t: ts[n]!, value: point.value })).filter(point => Number.isFinite(point.t) && Number.isFinite(point.value));
  if (!usable.length) return [];
  const t0 = usable[0]!.t, t1 = usable.at(-1)!.t;
  // A fractional series (0..1) runs across the whole game; others across the time they cover.
  const fractional = usable.every(point => point.t >= 0 && point.t <= 1);
  const from = fractional ? 0 : t0, to = fractional ? 1 : t1;
  const span = to - from;
  return usable.map((point, n) => ({
    x: span > 0 ? (point.t - from) / span : usable.length > 1 ? n / (usable.length - 1) : 0,
    y: 1 - Math.min(1, Math.max(0, point.value)),
  }));
}

/** A colour from a wire value ("#rrggbb" or "rrggbb"), or undefined when it is not one. */
export function teamColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const hex = value.startsWith('#') ? value.slice(1) : value;
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : undefined;
}

/** A venue's display text. */
export function venueText(venue: V.LiveEvent['venue']): string {
  if (!venue) return '';
  return typeof venue === 'string' ? venue : [venue.name, venue.city].filter(Boolean).join(', ');
}

/** Whether a competitor is one of the viewer's favourites, by entity key or entity id. */
export function isFavoriteCompetitor(competitor: V.LiveCompetitor, favorites: ReadonlySet<string>): boolean {
  const id = competitor.entityId;
  if (!id) return false;
  if (favorites.has(id)) return true;
  for (const key of favorites) if (key.endsWith(`:${id}`)) return true;
  return false;
}
