import { readGuideWindow } from './bulk';
import { guideRetry, guideRetryable } from './retry';
import { guideWindows } from './window';
import { programmeCatchUp, type CatchUpKind } from './timeshift';
import { VelaError } from '../adapter/errors';
import { artworkURL, type Images } from '../discovery/artwork';
import { localeContext, minute, msg, number, time, withLocale } from '../i18n';
import type { ArtworkRef, Channel, GuideQuery, GuideResponse, GuideWindowRequest, GuideWindowResponse, Page, Programme } from '../wire';

/** A single bounded guide window. Times remain the server's original timestamps. */
export interface GuideApi {
  channels(cursor?: string, limit?: number): Promise<Page<Channel>>;
  guide(query: GuideQuery): Promise<GuideResponse>;
  guideWindow?(query: GuideWindowRequest): Promise<GuideWindowResponse | null>;
}

export interface GuideProgramme {
  id: string; name: string; summary: string; airing: boolean; ended: boolean; startsInLabel: string;
  startLabel: string; endLabel: string; leftId: string; rightId: string; upId: string; downId: string;
  /** Minutes from the window start, clamped to the window; the skin multiplies by its own scale. */
  at: number; span: number;
  /** Percent elapsed while airing, otherwise 0. */
  progress: number; remainingLabel: string; durationLabel: string;
  /** A future programme's start for people: minutes within the hour, else its clock time and day. */
  startsLabel: string;
  episode: string; rating: string; genre: string; tone: number; art: string;
  /** Plays from the channel's archive if the server offers catch-up: ended (catchUp), or on air from its
   * start (startOver); '' otherwise. Projected with the clock, so a cached page moves along. */
  replay: CatchUpKind | '';
}
export interface GuideChannel {
  id: string; number: string; listingsUnavailable?: boolean; name: string; favorite: boolean; logo: string; group: string; listed: boolean; listingsLoaded: boolean;
  /** The owner-defined Guides this channel belongs to, by id; empty when none or unknown. */
  guideIds: string[];
  now: string; next: string; nowId: string; nowProgress: number; nowRemaining: string; nextLabel: string;
  /** The airing programme's still, episode line and first genre (a live home shows them without the day's grid). */
  nowArt: string; nowEpisode: string; nowGenre: string;
  programmes: GuideProgramme[];
  /** Days of provider archive; 0 when none. */
  archiveDays: number;
  /** The programme on air can Start over (from the archive). */
  nowStartOver: boolean;
}
export interface GuideModel {
  /** Minutes from the start of the loaded timeline to each day. */
  dayStarts?: Record<number, number>;
  /** Completed listing coverage, in timeline minutes. */
  loadedRanges?: { from: number; to: number }[];
  retryAt?: number;
  /** End of locally retained now/next coverage (epoch milliseconds). */
  currentUntil?: number;
  /** Absolute timeline origin, so local midnight cannot displace programme focus. */
  startsAt?: number;
  day: number; dayLabel: string; fromLabel: string; untilLabel: string; minutes: number; nowMinute: number; nowLabel: string; landing: number;
  ticks: { id: string; label: string; minute: number; hour: boolean }[];
  days: { offset: number; label: string; date: string }[];
  groups: string[];
  /** Named Guides for tabs: first appearance in server channel order, one per id. */
  guides: { id: string; name: string }[];
  /** Channel ids in the server's own order, for choosing what a preview tunes to. */
  tuneOrder: string[];
  channels: GuideChannel[];
}

const MINUTE = 60000, HOUR = 3600000, DAY = 86400000;
/** The day picker reaches a week ahead; the server says what each day actually holds. */
const DAYS = 7;
/** Legacy validity for failed coverage; ready data only revalidates on open/resume. */
const FRESH = 5 * MINUTE;

async function readPages<T>(read: (cursor?: string) => Promise<Page<T>>): Promise<T[]> {
  const items: T[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await read(cursor);
    items.push(...page.items);
    if (page.continuation === 'exhausted') break;
    if (page.continuation === 'unknown') throw new Error('Guide pagination is incomplete');
    if (!page.nextCursor || cursors.has(page.nextCursor)) throw new Error('Invalid guide continuation');
    cursor = page.nextCursor;
    cursors.add(cursor);
  } while (true);
  return items;
}

async function allPages<T>(read: (cursor?: string) => Promise<Page<T>>): Promise<T[]> {
  try { return await readPages(read); }
  catch (error) {
    if (error instanceof VelaError && error.status === 409 && error.detail.code === 'cursor_expired') return readPages(read);
    throw error;
  }
}

interface ChannelListings { programmes: Programme[]; ready: boolean; expires: number }
interface Listings { channels: Channel[]; programmes: Programme[]; loaded: Set<string>; unavailable: Set<string>; retryAt?: number }
const cache = new Map<string, { at: number; read?: object; value: Promise<Listings> }>();
// Viewport channel sets overlap. Reuse each channel's completed pages within
// the same window, so expanding the initial 30 channels to 48 does not reissue
// the first 30 channels' listings (and their image grants).
interface ListingEntry { at: number; expires: number; lastReady?: Programme[]; ready?: boolean; read?: object; value: Promise<ChannelListings> }
const channelListings = new Map<string, Map<string, ListingEntry>>();
function retainedListings(scope: string, id: string, from: number, until: number, read?: object): ChannelListings | undefined {
  const pieces: { from: number; until: number; row: ListingEntry }[] = [];
  for (const [key, rows] of channelListings) {
    if (!key.startsWith(`${scope}|`)) continue;
    const [a, b] = key.split('|').slice(-2).map(Number);
    const row = rows.get(id);
    if (a === undefined || b === undefined || !row?.ready || read && row.read !== read || b <= from || a >= until) continue;
    pieces.push({ from: a, until: b, row });
  }
  pieces.sort((a, b) => a.from - b.from || b.until - a.until);
  let covered = from;
  for (const piece of pieces) {
    if (piece.from > covered) return;
    covered = Math.max(covered, piece.until);
    if (covered >= until) {
      const programmes = [...new Map(pieces.sort((a, b) => a.row.at - b.row.at).flatMap(p => p.row.lastReady ?? [])
        .filter(p => Date.parse(p.end) > from && Date.parse(p.start) < until).map(p => [p.id, p])).values()].sort(byStart);
      return { programmes, ready: true, expires: Math.min(...pieces.map(p => p.row.expires)) };
    }
  }
}
/** Every page of one window, shared by the minute-by-minute re-projections of that window. */
function listings(api: GuideApi, scope: string, from: number, until: number, now: number, ids?: string[], read?: object): Promise<Listings> {
  const key = `${scope}|${from}|${until}|${ids?.join(",") ?? "*"}`;
  const hit = cache.get(key);
  if (ids === undefined && hit && (!read || hit.read === read)) return hit.value;
  const value = (async () => {
    const channels = await channelMetadata(api, scope, now, read);
    const requested = ids && ids.length === 0 ? [...channels].sort((a, b) => Number(b.favorite) - Number(a.favorite)).slice(0, 30).map(c => c.id) : ids && [...new Set(ids)];
    const windowKey = `${scope}|${from}|${until}`;
    let entries = channelListings.get(windowKey);
    if (!entries) {
      entries = new Map();
      channelListings.set(windowKey, entries);
      for (const old of channelListings.keys()) if (channelListings.size > 8 && old !== windowKey) channelListings.delete(old);
    }
    const wanted = requested ?? channels.map(channel => channel.id);
    for (const id of wanted) if (!entries.has(id)) {
      const retained = retainedListings(scope, id, from, until, read);
      if (retained) entries.set(id, { at: now, expires: retained.expires, lastReady: retained.programmes, ready: true, read, value: Promise.resolve(retained) });
    }
    const missing = wanted.filter(id => {
      const hit = entries.get(id);
      return !hit || Boolean(read && hit.read !== read) || hit.ready === false && now >= hit.expires;
    });
    const batches = Array.from({ length: Math.ceil(missing.length / 100) }, (_, i) => missing.slice(i * 100, (i + 1) * 100));
    // Preserve the server's unfiltered query when no channel filter was requested.
    const queries: (string[] | undefined)[] = requested === undefined && missing.length === wanted.length ? [undefined] : batches;
    const reads: Promise<Map<string, ChannelListings>>[] = [];
    for (const batch of queries) {
      const ids = batch ?? wanted;
      const page = (async () => {
        const fromISO = new Date(from).toISOString(), untilISO = new Date(until).toISOString();
        const bulk = batch && until - from <= 3 * HOUR ? await readGuideWindow(api, { channelIds: batch, from: fromISO, until: untilISO }) : null;
        if (bulk) return new Map(bulk.channels.map(row => [row.channelId, { programmes: row.programmes, ready: row.state === 'ready', expires: Date.parse(bulk.validUntil) }]));
        const programmes = await allPages(cursor => {
          if (process.env.EXPO_PUBLIC_VELA_GUIDE_DIAGNOSTICS === '1') {
            const root = globalThis as typeof globalThis & { __velaGuideQueries?: number };
            root.__velaGuideQueries = (root.__velaGuideQueries ?? 0) + 1;
          }
          return api.guide({ from: fromISO, until: untilISO, cursor, limit: 100, channelIds: batch });
        });
        return new Map(ids.map(id => [id, { programmes: programmes.filter(p => p.channelId === id), ready: true, expires: now + FRESH }]));
      })();
      reads.push(page);
      for (const id of ids) {
        const previous = entries.get(id);
        const value = page.then(rows => {
          const answer = rows.get(id);
          if (!answer) throw new Error('Missing channel in guide window');
          return answer.ready ? answer : { ...answer, programmes: previous?.lastReady ?? [] };
        });
        const entry = { at: now, expires: now + FRESH, lastReady: previous?.lastReady, read, value };
        entries.set(id, entry);
        value.then(answer => {
          if (entries.get(id) !== entry) return;
          entry.expires = answer.expires;
          Object.assign(entry, { ready: answer.ready });
          if (answer.ready) entry.lastReady = answer.programmes;
        }, () => { if (entries.get(id) === entry) entries.delete(id); });
      }
    }
    const pending = wanted.map(id => entries.get(id)!.value);
    // Keep scrolling caches bounded independently of the total channel count.
    for (const id of entries.keys()) if (entries.size > 256 && !wanted.includes(id)) entries.delete(id);
    await Promise.all(reads);
    const answers = await Promise.all(pending);
    // Moving the viewport must not blank rows already read in this same window.
    // Reuse only completed, allowed channel entries; an explicit revalidation's
    // read identity still isolates the previous session/policy's data.
    const retained = new Map(wanted.map((id, index) => [id, answers[index]!]));
    const allowed = new Set(channels.map(channel => channel.id));
    for (const [id, entry] of entries) {
      if (!retained.has(id) && allowed.has(id) && entry.ready && entry.lastReady && (!read || entry.read === read))
        retained.set(id, { programmes: entry.lastReady, ready: true, expires: entry.expires });
    }
    const retryAt = Math.min(...answers.filter(answer => !answer.ready).map(answer => answer.expires));
    return { channels, programmes: [...retained.values()].flatMap(answer => answer.programmes),
      loaded: new Set([...retained].filter(([, answer]) => answer.ready).map(([id]) => id)),
      unavailable: new Set(wanted.filter((_, index) => !answers[index]!.ready)),
      retryAt: Number.isFinite(retryAt) ? retryAt : undefined };
  })();
  cache.set(key, { at: now, read, value });
  value.catch(() => { if (cache.get(key)?.value === value) cache.delete(key); });
  for (const old of cache.keys()) if (cache.size > 8 && old !== key) cache.delete(old);
  return value;
}

const channelCache = new Map<string, { at: number; value: Promise<Channel[]>; last?: Channel[]; read?: object; dirty?: boolean }>();
function channelMetadata(api: GuideApi, scope: string, now: number, read?: object): Promise<Channel[]> {
  const hit = channelCache.get(scope);
  if (hit && !hit.dirty && (!read || hit.read === read)) return hit.value;
  // Ether revalidates each page with If-None-Match. An unchanged list keeps its
  // identity, and a transient revalidation failure cannot erase a usable lineup.
  const entry = { at: now, last: hit?.last, read, value: Promise.resolve([] as Channel[]) };
  entry.value = allPages(cursor => api.channels(cursor, 100)).then(channels => {
    const previous = hit?.last;
    entry.last = previous?.length === channels.length && channels.every((channel, index) => channel === previous[index]) ? previous : channels;
    return entry.last;
  }, error => {
    if (channelCache.get(scope) === entry) {
      if (hit?.last && guideRetryable(error)) channelCache.set(scope, { at: now - FRESH, value: Promise.resolve(hit.last), last: hit.last, dirty: true });
      else channelCache.delete(scope);
    }
    throw error;
  });
  channelCache.set(scope, entry);
  return entry.value;
}

const midnightCache = new Map<string, number>();
const zonedDates = new Map<string, Intl.DateTimeFormat>();
/** Local midnight in the viewer's zone, `days` after the day containing `ms`. */
function midnight(ms: number, days: number): number {
  const zone = localeContext().timeZone;
  const key = `${zone}|${ms}|${days}`;
  const cached = midnightCache.get(key);
  if (cached !== undefined) return cached;
  let formatter = zonedDates.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' });
    zonedDates.set(zone, formatter);
    if (zonedDates.size > 8) zonedDates.delete(zonedDates.keys().next().value!);
  }
  const parts = Object.fromEntries(formatter.formatToParts(ms).map(p => [p.type, Number(p.value)]));
  const wall = Date.UTC(parts.year!, parts.month! - 1, parts.day! + days);
  // The zone's offset at that wall-clock midnight, measured rather than assumed constant across DST.
  const offset = (at: number) => {
    const p = Object.fromEntries(formatter.formatToParts(at).map(q => [q.type, Number(q.value)]));
    return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) - at;
  };
  const guess = wall - offset(wall);
  const result = wall - offset(guess);
  midnightCache.set(key, result);
  if (midnightCache.size > 64) midnightCache.delete(midnightCache.keys().next().value!);
  return result;
}

const TONES = ['news', 'sport', 'movie', 'kid', 'documentar', 'drama', 'comedy', 'music', 'lifestyle'];
/** A stable palette slot for a server genre; unknown genres share one neutral slot. */
function tone(genre: string): number {
  if (!genre) return -1;
  const name = genre.toLowerCase();
  const known = TONES.findIndex(t => name.includes(t));
  return known >= 0 ? known : TONES.length;
}

const picture = (artwork: ArtworkRef[], kinds: ArtworkRef['kind'][], width: number, height: number, images?: Images) => {
  for (const kind of kinds) {
    const art = artwork.find(a => a.kind === kind);
    if (art) return artworkURL(art, width, height, images) ?? '';
  }
  return '';
};

// Channel objects are shared by the metadata cache. Keep image-provider variants separate.
const channelLogos = new WeakMap<Channel, Map<Images | undefined, string>>();
function channelLogo(channel: Channel, images?: Images): string {
  let variants = channelLogos.get(channel);
  if (!variants) { variants = new Map(); channelLogos.set(channel, variants); }
  if (!variants.has(images)) variants.set(images, picture(channel.artwork, ['logo', 'channel'], 160, 90, images));
  return variants.get(images)!;
}

interface Projection {
  channel: Channel; images: Images | undefined; locale: string; now: number; loaded: boolean;
  entries: Programme[]; live: Programme[]; value: GuideChannel;
}
const projections = new Map<string, Map<string, Projection>>();
const sameListings = (a: Programme[], b: Programme[]) => a.length === b.length && a.every((p, i) => p === b[i]);

const valid = (p: Programme) => {
  const a = Date.parse(p.start), b = Date.parse(p.end);
  return Number.isFinite(a) && Number.isFinite(b) && b > a;
};
const byStart = (a: Programme, b: Programme) => Date.parse(a.start) - Date.parse(b.start);

function group(programmes: Programme[]) {
  const grouped = new Map<string, Programme[]>();
  for (const programme of programmes) {
    if (!valid(programme)) continue;
    if (!grouped.has(programme.channelId)) grouped.set(programme.channelId, []);
    grouped.get(programme.channelId)!.push(programme);
  }
  for (const list of grouped.values()) list.sort(byStart);
  return grouped;
}

export interface GuideReadOptions {
  clock?: () => number;
  /** One shared identity per explicit open/resume revalidation, never a timer tick. */
  revalidate?: object;
  /** Retain now/next data through this epoch time, for one ahead-of-clock window. */
  currentUntil?: number;
  /** The server offers catch-up from channel archives (features.liveCatchUp): programmes carry `replay`. */
  archive?: boolean;
}
const clockModels = new WeakMap<GuideModel, { at: number; project(now: number): GuideModel }>();
/** Recompute labels/progress from retained listings without reaching the adapter. */
export function advanceGuideClock(model: GuideModel, now: number): GuideModel {
  const clock = clockModels.get(model);
  return !clock || clock.at === now ? model : clock.project(now);
}

/**
 * One local day of listings, every page fetched; incomplete pages are never presented as complete.
 * `day` counts days from today. Airing state and progress are projected at `now`.
 */
export async function loadGuide(api: GuideApi, day: number, now: number, scope: string, images?: Images, localeJSON?: string, channelIds?: string[], range?: { from: number; to: number }, options?: GuideReadOptions): Promise<GuideModel> {
  const started = Date.now();
  return guideRetry(scope).run(api, options?.clock ?? (() => now + Date.now() - started),
    guarded => projectGuide(guarded, day, now, scope, images, localeJSON, channelIds, range, options));
}

async function projectGuide(api: GuideApi, day: number, now: number, scope: string, images?: Images, localeJSON?: string, channelIds?: string[], range?: { from: number; to: number }, options?: GuideReadOptions): Promise<GuideModel> {
  if (!Number.isInteger(day) || day < 0 || day >= DAYS) throw new Error('Invalid guide day');
  const { start, end } = withLocale(localeJSON, () => {
    const start = midnight(now, day);
    // A DST day can run 25 hours; the protocol's window is at most 24.
    return { start, end: Math.min(midnight(now, day + 1), start + DAY) };
  });
  const initialMinute = Math.max(0, (now - withLocale(localeJSON, () => midnight(now, 0))) / MINUTE);
  if (range && range.from === -1) range = { from: Math.max(0, initialMinute - 150), to: initialMinute + 240 };
  const from = range ? Math.max(start, start + Math.floor(range.from / 30) * 30 * MINUTE) : start;
  const until = range ? Math.min(end, start + Math.ceil(range.to / 30) * 30 * MINUTE) : end;
  const windows = range ? await Promise.all(guideWindows(from, until, start, end).map(window =>
    listings(api, scope, window.from, window.until, now, channelIds, options?.revalidate))) : [await listings(api, scope, from, Math.max(from + MINUTE, until), now, channelIds, options?.revalidate)];
  const window = { channels: windows[0]?.channels ?? await channelMetadata(api, scope, now, options?.revalidate),
    programmes: [...new Map(windows.flatMap(window => window.programmes).map(p => [p.id, p])).values()],
    loaded: new Set((windows[0]?.channels ?? []).filter(c => windows.every(w => w.loaded.has(c.id))).map(c => c.id)),
    unavailable: new Set(windows.flatMap(w => [...w.unavailable])),
    retryAt: Math.min(...windows.map(w => w.retryAt ?? Infinity)) };
  // Mobile now/next and the channel column stay current even while the grid browses another day.
  const currentStart = options?.currentUntil
    ? options.currentUntil - Math.ceil((options.currentUntil - now) / (3 * HOUR)) * 3 * HOUR
    : withLocale(localeJSON, () => midnight(now, 0));
  const desiredEnd = options?.currentUntil && options.currentUntil > now ? options.currentUntil : now + 2 * HOUR;
  const currentEnd = currentStart + Math.ceil((desiredEnd - currentStart) / (3 * HOUR)) * 3 * HOUR;
  const currentWindows = guideWindows(now, desiredEnd, currentStart, currentEnd);
  const currentParts = !range && day === 0 ? [window] : await Promise.all(currentWindows.map(w => listings(api, scope, w.from, w.until, now, channelIds, options?.revalidate)));
  const current = { programmes: currentParts.flatMap(part => part.programmes), retryAt: Math.min(...currentParts.map(part => part.retryAt ?? Infinity)) };
  const coverageEnd = !range && day === 0 ? end : currentWindows.at(-1)?.until ?? now;
  const grouped = group(window.programmes.filter(p => Date.parse(p.start) < end && Date.parse(p.end) > start));
  const currentByChannel = group([...new Map([...window.programmes, ...current.programmes].map(p => [p.id, p])).values()].sort(byStart));
  const project = (now: number): GuideModel => withLocale(localeJSON, () => {
    const day = Math.round((start - midnight(now, 0)) / DAY);
    const minutes = Math.round((end - start) / MINUTE);
    const span = (a: number, b: number) => msg('ui.startEnd', { start: time(a), end: time(b) });
    const episodeLine = (p: { seasonNumber?: number; episodeNumber?: number; episodeTitle?: string }) =>
      [p.seasonNumber && p.episodeNumber ? msg('live.seasonEpisode', { season: number(p.seasonNumber), episode: number(p.episodeNumber) }) : '', p.episodeTitle ?? ''].filter(Boolean).join(' · ');
    const left = (ms: number) => msg('live.minutesLeft', { minutes: number(Math.max(1, Math.ceil(ms / MINUTE))) });
    const weekday = new Intl.DateTimeFormat(localeContext().formatLocale, { timeZone: localeContext().timeZone, weekday: 'short' });
    const date = new Intl.DateTimeFormat(localeContext().formatLocale, { timeZone: localeContext().timeZone, month: 'short', day: 'numeric' });
    const long = new Intl.DateTimeFormat(localeContext().formatLocale, { timeZone: localeContext().timeZone, weekday: 'long', month: 'long', day: 'numeric' });
    const dayName = (offset: number, at: number) => offset === 0 ? msg('live.today') : offset === 1 ? msg('live.tomorrow') : weekday.format(at);
    // Computing a zoned midnight constructs several Intl formatters; do it once per
    // projection, not once per programme in a potentially very large lineup.
    const tomorrow = midnight(now, 1), dayAfterTomorrow = midnight(now, 2);
    const nowMinute = now >= start && now < end ? (now - start) / MINUTE : -1;
    const groups: string[] = [];
    const groupSet = new Set<string>();
    const guideSet = new Set<string>();
    const loadedIds = window.loaded;
    const guides: { id: string; name: string }[] = [];
    for (const channel of window.channels) for (const g of channel.guides ?? []) if (!guideSet.has(g.id)) { guideSet.add(g.id); guides.push({ id: g.id, name: g.name }); }
    const projectionKey = `${scope}|${start}`;
    let projected = projections.get(projectionKey);
    if (!projected) {
      projected = new Map(); projections.set(projectionKey, projected);
      for (const key of projections.keys()) if (projections.size > 8 && key !== projectionKey) projections.delete(key);
    }
    const projectionLocale = JSON.stringify(localeContext());
    const offer = { archive: !!options?.archive, timeshift: false };
    const channels: GuideChannel[] = [...window.channels].sort((a, b) => Number(b.favorite) - Number(a.favorite)).map(channel => {
      if (channel.group && !groupSet.has(channel.group)) { groupSet.add(channel.group); groups.push(channel.group); }
      const entries = grouped.get(channel.id) ?? [];
      const live = (currentByChannel.get(channel.id) ?? []);
      const loaded = !loadedIds || loadedIds.has(channel.id);
      const previous = projected.get(channel.id);
      if (previous && previous.channel === channel && previous.images === images && previous.locale === projectionLocale
        && previous.loaded === loaded && previous.value.listingsUnavailable === window.unavailable.has(channel.id) && (!loaded || previous.now === now)
        && sameListings(previous.entries, entries) && sameListings(previous.live, live)) return previous.value;
      const airing = live.find(p => Date.parse(p.start) <= now && now < Date.parse(p.end));
      const next = live.find(p => Date.parse(p.start) > now);
      const airingEnd = airing ? Date.parse(airing.end) : 0, airingStart = airing ? Date.parse(airing.start) : 0;
      const value: GuideChannel = {
        id: channel.id, number: channel.number, name: channel.name, favorite: channel.favorite, group: channel.group ?? '',
        guideIds: [...new Set((channel.guides ?? []).map(g => g.id))],
        logo: channelLogo(channel, images), listingsUnavailable: window.unavailable.has(channel.id), listed: entries.length > 0, listingsLoaded: !loadedIds || loadedIds.has(channel.id),
        now: airing?.name ?? '', next: next?.name ?? '', nowId: airing?.id ?? '',
        nowProgress: airing ? Math.round((now - airingStart) / (airingEnd - airingStart) * 1000) / 10 : 0,
        nowRemaining: airing ? left(airingEnd - now) : '',
        nextLabel: next ? msg('live.nextAt', { time: time(Date.parse(next.start)), programme: next.name }) : '',
        nowArt: airing ? picture(airing.artwork, ['still', 'backdrop', 'poster'], 640, 360, images) : '',
        nowEpisode: airing ? episodeLine(airing) : '', nowGenre: airing?.genres?.[0] ?? '',
        archiveDays: channel.archiveDays ?? 0,
        nowStartOver: !!airing && programmeCatchUp(airing, channel.archiveDays, now, offer) === 'startOver',
        programmes: entries.map(p => {
          const a = Date.parse(p.start), b = Date.parse(p.end);
          const onAir = a <= now && now < b;
          const genre = p.genres?.[0] ?? '';
          const episode = episodeLine(p);
          return {
            id: p.id, name: p.name, summary: p.summary, airing: onAir, ended: b <= now,
            startsInLabel: number(Math.max(0, Math.ceil((a - now) / MINUTE))), startLabel: time(a), endLabel: time(b),
            leftId: '', rightId: '', upId: '', downId: '',
            at: (Math.max(a, start) - start) / MINUTE, span: (Math.min(b, end) - Math.max(a, start)) / MINUTE,
            progress: onAir ? Math.round((now - a) / (b - a) * 1000) / 10 : 0,
            remainingLabel: onAir ? left(b - now) : '', durationLabel: minute(Math.round((b - a) / MINUTE)),
            startsLabel: a <= now ? '' : a - now < HOUR ? msg('live.startsIn', { minutes: number(Math.ceil((a - now) / MINUTE)) })
              : a < tomorrow ? msg('live.startsAt', { time: time(a) }) : a < dayAfterTomorrow ? msg('live.startsTomorrow', { time: time(a) }) : msg('live.startsOn', { day: weekday.format(a), time: time(a) }),
            episode, rating: p.rating ?? '', genre, tone: tone(genre),
            art: picture(p.artwork, ['still', 'backdrop', 'poster'], 640, 360, images),
            replay: programmeCatchUp(p, channel.archiveDays, now, offer) ?? '',
          };
        }),
      };
      projected.set(channel.id, { channel, images, locale: projectionLocale, now, loaded, entries, live, value });
      return value;
    });
    const retryAt = Math.min(window.retryAt ?? Infinity, current.retryAt ?? Infinity);
    const model: GuideModel = {
      retryAt: Number.isFinite(retryAt) ? retryAt : undefined, currentUntil: coverageEnd, startsAt: start,
      loadedRanges: range ? guideWindows(from, until, start, end).map(w => ({ from: (w.from - start) / MINUTE, to: (w.until - start) / MINUTE })) : [{ from: 0, to: minutes }],
      day, dayLabel: day === 0 ? msg('live.today') : long.format(start), fromLabel: time(start), untilLabel: time(end), minutes, nowMinute, nowLabel: time(now),
      // The time of day to land on: now today, the same clock time on a later day. The skin places it.
      landing: Math.max(0, Math.min(minutes, (now - midnight(now, 0)) / MINUTE)),
      ticks: Array.from({ length: Math.floor(minutes / 30) }, (_, n) => ({ id: String(start + n * 1800000), label: time(start + n * 1800000), minute: n * 30, hour: n % 2 === 0 })),
      days: Array.from({ length: DAYS }, (_, offset) => { const at = midnight(now, offset) + 12 * HOUR; return { offset, label: dayName(offset, at), date: date.format(at) }; }),
      groups,
      guides,
      tuneOrder: window.channels.map(c => c.id),
      channels,
    };
    const cellId = (id: string) => `guide-${id}`;
    model.channels.forEach((channel, row) => channel.programmes.forEach((p, col) => {
      p.leftId = col > 0 ? cellId(channel.programmes[col - 1]!.id) : '';
      p.rightId = col + 1 < channel.programmes.length ? cellId(channel.programmes[col + 1]!.id) : '';
      const vertical = (index: number) => {
        const entries = model.channels[index]?.programmes ?? [];
        const target = entries.find(q => q.at <= p.at && q.at + q.span > p.at)
          ?? entries.reduce<GuideProgramme | undefined>((best, q) => !best || Math.abs(q.at - p.at) < Math.abs(best.at - p.at) ? q : best, undefined);
        return target ? cellId(target.id) : '';
      };
      p.upId = vertical(row - 1); p.downId = vertical(row + 1);
    }));
    clockModels.set(model, { at: now, project });
    return model;
  });
  return project(now);
}

/**
 * Where a server timestamp falls in the guide: its local day offset from today (-1 outside
 * the guide's week or unparseable) and its minute from that day's local midnight.
 */
export function guideFocus(at: string, now: number, localeJSON?: string) {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return { day: -1, minute: 0 };
  return withLocale(localeJSON, () => {
    const start = midnight(ms, 0), day = Math.round((start - midnight(now, 0)) / DAY);
    return { day: day >= 0 && day < DAYS ? day : -1, minute: (ms - start) / MINUTE };
  });
}

export async function liveIdentity(api: GuideApi, channelId: string, now: number, localeJSON?: string, scope?: string) {
  if (scope) {
    const started = Date.now();
    return guideRetry(scope).run(api, () => now + Date.now() - started, guarded => identity(guarded, channelId, now, localeJSON, scope));
  }
  return identity(api, channelId, now, localeJSON);
}

async function identity(api: GuideApi, channelId: string, now: number, localeJSON?: string, scope?: string) {
  const known = scope && channelCache.get(scope)?.last?.find(channel => channel.id === channelId);
  if (known && scope) {
    for (const [key, entries] of channelListings) {
      if (!key.startsWith(`${scope}|`)) continue;
      const [until, from] = key.split('|').slice(-2).reverse().map(Number);
      const row = entries.get(channelId);
      if (!row?.ready || from === undefined || until === undefined || now < from || now >= until) continue;
      const programme = row.lastReady?.find(p => Date.parse(p.start) <= now && now < Date.parse(p.end));
      return { title: programme ? `${known.name} · ${programme.name}` : known.name };
    }
  }
  const channels = scope ? await channelMetadata(api, scope, now) : await allPages(cursor => api.channels(cursor, 100));
  const channel = channels.find(c => c.id === channelId);
  if (!channel) return withLocale(localeJSON, () => ({ title: msg('ui.liveTelevisionTitle') }));
  const programmes = await allPages(cursor => api.guide({ from: new Date(now).toISOString(), until: new Date(now + 60000).toISOString(), channelIds: [channelId], cursor, limit: 100 }));
  const current = programmes.find(p => Date.parse(p.start) <= now && now < Date.parse(p.end));
  return { title: current ? `${channel.name} · ${current.name}` : channel.name };
}
