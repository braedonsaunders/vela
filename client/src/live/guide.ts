import { artworkURL } from '../discovery/artwork';
import { localeContext, minute, msg, number, time, withLocale } from '../../foundation/i18n';
import type { ArtworkRef, Channel, GuideQuery, GuideResponse, Page, Programme } from '../../wire/v0/types';

/** A single bounded guide window. Times remain the server's original timestamps. */
export interface GuideApi {
  channels(cursor?: string, limit?: number): Promise<Page<Channel>>;
  guide(query: GuideQuery): Promise<GuideResponse>;
}

export interface GuideProgramme {
  id: string; name: string; summary: string; airing: boolean; ended: boolean; startsInLabel: string;
  startLabel: string; endLabel: string; leftId: string; rightId: string; upId: string; downId: string;
  /** Minutes from the window start, clamped to the window; the skin multiplies by its own scale. */
  at: number; span: number;
  /** Percent elapsed while airing, otherwise 0. */
  progress: number; remainingLabel: string; durationLabel: string;
  episode: string; rating: string; genre: string; tone: number; art: string;
}
export interface GuideChannel {
  id: string; number: string; name: string; favorite: boolean; logo: string; group: string; listed: boolean;
  now: string; next: string; nowId: string; nowProgress: number; nowRemaining: string; nextLabel: string;
  programmes: GuideProgramme[];
}
export interface GuideModel {
  day: number; dayLabel: string; fromLabel: string; untilLabel: string; minutes: number; nowMinute: number; landing: number;
  ticks: { id: string; label: string; minute: number; hour: boolean }[];
  days: { offset: number; label: string; date: string }[];
  groups: string[];
  channels: GuideChannel[];
}

const MINUTE = 60000, HOUR = 3600000, DAY = 86400000;
/** The day picker reaches a week ahead; the server says what each day actually holds. */
const DAYS = 7;
/** Listings are re-read at most this often; the clock re-projects them every minute. */
const FRESH = 5 * MINUTE;

async function allPages<T>(read: (cursor?: string) => Promise<Page<T>>): Promise<T[]> {
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

interface Listings { channels: Channel[]; programmes: Programme[] }
const cache = new Map<string, { at: number; value: Promise<Listings> }>();
/** Every page of one window, shared by the minute-by-minute re-projections of that window. */
function listings(api: GuideApi, scope: string, from: number, until: number, now: number): Promise<Listings> {
  const key = `${scope}|${from}|${until}`;
  const hit = cache.get(key);
  if (hit && now >= hit.at && now - hit.at < FRESH) return hit.value;
  const value = (async () => {
    const channels = (await allPages(cursor => api.channels(cursor, 100))).sort((a, b) => Number(b.favorite) - Number(a.favorite));
    const programmes = await allPages(cursor => api.guide({ from: new Date(from).toISOString(), until: new Date(until).toISOString(), cursor, limit: 100 }));
    return { channels, programmes };
  })();
  cache.set(key, { at: now, value });
  value.catch(() => { if (cache.get(key)?.value === value) cache.delete(key); });
  for (const old of cache.keys()) if (cache.size > 4 && old !== key) cache.delete(old);
  return value;
}

/** Local midnight in the viewer's zone, `days` after the day containing `ms`. */
function midnight(ms: number, days: number): number {
  const zone = localeContext().timeZone;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' })
    .formatToParts(ms).map(p => [p.type, Number(p.value)]));
  const wall = Date.UTC(parts.year!, parts.month! - 1, parts.day! + days);
  // The zone's offset at that wall-clock midnight, measured rather than assumed constant across DST.
  const offset = (at: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' })
      .formatToParts(at).map(q => [q.type, Number(q.value)]));
    return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) - at;
  };
  const guess = wall - offset(wall);
  return wall - offset(guess);
}

const TONES = ['news', 'sport', 'movie', 'kid', 'documentar', 'drama', 'comedy', 'music', 'lifestyle'];
/** A stable palette slot for a server genre; unknown genres share one neutral slot. */
function tone(genre: string): number {
  if (!genre) return -1;
  const name = genre.toLowerCase();
  const known = TONES.findIndex(t => name.includes(t));
  return known >= 0 ? known : TONES.length;
}

const picture = (artwork: ArtworkRef[], kinds: ArtworkRef['kind'][], width: number, height: number, origin?: string) => {
  for (const kind of kinds) {
    const art = artwork.find(a => a.kind === kind);
    if (art) return artworkURL(art, width, height, origin) ?? '';
  }
  return '';
};

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

/**
 * One local day of listings, every page fetched; incomplete pages are never presented as complete.
 * `day` counts days from today. Airing state and progress are projected at `now`.
 */
export async function loadGuide(api: GuideApi, day: number, now: number, scope: string, origin?: string, localeJSON?: string): Promise<GuideModel> {
  if (!Number.isInteger(day) || day < 0 || day >= DAYS) throw new Error('Invalid guide day');
  const { start, end } = withLocale(localeJSON, () => {
    const start = midnight(now, day);
    // A DST day can run 25 hours; the protocol's window is at most 24.
    return { start, end: Math.min(midnight(now, day + 1), start + DAY) };
  });
  const window = await listings(api, scope, start, end, now);
  // Mobile now/next and the channel column stay current even while the grid browses another day.
  const currentStart = Math.floor(now / 1800000) * 1800000;
  const current = day === 0 ? window : await listings(api, scope, currentStart, currentStart + 2 * HOUR, now);
  const grouped = group(window.programmes.filter(p => Date.parse(p.start) < end && Date.parse(p.end) > start));
  const currentByChannel = group(current.programmes);
  return withLocale(localeJSON, () => {
    const minutes = Math.round((end - start) / MINUTE);
    const span = (a: number, b: number) => msg('ui.startEnd', { start: time(a), end: time(b) });
    const left = (ms: number) => msg('live.minutesLeft', { minutes: number(Math.max(1, Math.ceil(ms / MINUTE))) });
    const weekday = new Intl.DateTimeFormat(localeContext().formatLocale, { timeZone: localeContext().timeZone, weekday: 'short' });
    const date = new Intl.DateTimeFormat(localeContext().formatLocale, { timeZone: localeContext().timeZone, month: 'short', day: 'numeric' });
    const long = new Intl.DateTimeFormat(localeContext().formatLocale, { timeZone: localeContext().timeZone, weekday: 'long', month: 'long', day: 'numeric' });
    const dayName = (offset: number, at: number) => offset === 0 ? msg('live.today') : offset === 1 ? msg('live.tomorrow') : weekday.format(at);
    const nowMinute = now >= start && now < end ? (now - start) / MINUTE : -1;
    const groups: string[] = [];
    const channels: GuideChannel[] = window.channels.map(channel => {
      if (channel.group && !groups.includes(channel.group)) groups.push(channel.group);
      const entries = grouped.get(channel.id) ?? [];
      const live = (currentByChannel.get(channel.id) ?? []);
      const airing = live.find(p => Date.parse(p.start) <= now && now < Date.parse(p.end));
      const next = live.find(p => Date.parse(p.start) > now);
      const airingEnd = airing ? Date.parse(airing.end) : 0, airingStart = airing ? Date.parse(airing.start) : 0;
      return {
        id: channel.id, number: channel.number, name: channel.name, favorite: channel.favorite, group: channel.group ?? '',
        logo: picture(channel.artwork, ['logo', 'channel'], 160, 90, origin), listed: entries.length > 0,
        now: airing?.name ?? '', next: next?.name ?? '', nowId: airing?.id ?? '',
        nowProgress: airing ? Math.round((now - airingStart) / (airingEnd - airingStart) * 1000) / 10 : 0,
        nowRemaining: airing ? left(airingEnd - now) : '',
        nextLabel: next ? msg('live.nextAt', { time: time(Date.parse(next.start)), programme: next.name }) : '',
        programmes: entries.map(p => {
          const a = Date.parse(p.start), b = Date.parse(p.end);
          const onAir = a <= now && now < b;
          const genre = p.genres?.[0] ?? '';
          const episode = [p.seasonNumber && p.episodeNumber ? msg('live.seasonEpisode', { season: number(p.seasonNumber), episode: number(p.episodeNumber) }) : '', p.episodeTitle ?? '']
            .filter(Boolean).join(' · ');
          return {
            id: p.id, name: p.name, summary: p.summary, airing: onAir, ended: b <= now,
            startsInLabel: number(Math.max(0, Math.ceil((a - now) / MINUTE))), startLabel: time(a), endLabel: time(b),
            leftId: '', rightId: '', upId: '', downId: '',
            at: (Math.max(a, start) - start) / MINUTE, span: (Math.min(b, end) - Math.max(a, start)) / MINUTE,
            progress: onAir ? Math.round((now - a) / (b - a) * 1000) / 10 : 0,
            remainingLabel: onAir ? left(b - now) : '', durationLabel: minute(Math.round((b - a) / MINUTE)),
            episode, rating: p.rating ?? '', genre, tone: tone(genre),
            art: picture(p.artwork, ['still', 'backdrop', 'poster'], 640, 360, origin),
          };
        }),
      };
    });
    const model: GuideModel = {
      day, dayLabel: day === 0 ? msg('live.today') : long.format(start), fromLabel: time(start), untilLabel: time(end), minutes, nowMinute,
      // Land half an hour before now, or at this time of day on a later day.
      landing: Math.max(0, Math.min(minutes - 180, ((now - midnight(now, 0)) / MINUTE) - 30)),
      ticks: Array.from({ length: Math.floor(minutes / 30) }, (_, n) => ({ id: String(start + n * 1800000), label: time(start + n * 1800000), minute: n * 30, hour: n % 2 === 0 })),
      days: Array.from({ length: DAYS }, (_, offset) => { const at = midnight(now, offset) + 12 * HOUR; return { offset, label: dayName(offset, at), date: date.format(at) }; }),
      groups,
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
    return model;
  });
}

export async function liveIdentity(api: GuideApi, channelId: string, now: number, localeJSON?: string) {
  const channel = (await allPages(cursor => api.channels(cursor, 100))).find(c => c.id === channelId);
  if (!channel) return withLocale(localeJSON, () => ({ title: msg('ui.liveTelevisionTitle') }));
  const programmes = await allPages(cursor => api.guide({ from: new Date(now).toISOString(), until: new Date(now + 60000).toISOString(), channelIds: [channelId], cursor, limit: 100 }));
  const current = programmes.find(p => Date.parse(p.start) <= now && now < Date.parse(p.end));
  return { title: current ? `${channel.name} · ${current.name}` : channel.name };
}
