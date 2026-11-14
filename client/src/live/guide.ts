import { artworkURL } from '../discovery/artwork';
import { msg, number, time } from '../../foundation/i18n';
import type { Channel, GuideQuery, GuideResponse, Page, Programme } from '../../wire/v0/types';

/** A single bounded guide window. Times remain the server's original timestamps. */
export interface GuideApi {
  channels(cursor?: string, limit?: number): Promise<Page<Channel>>;
  guide(query: GuideQuery): Promise<GuideResponse>;
}

export interface GuideProgramme {
  id: string; name: string; summary: string; start: string; end: string; airing: boolean; ended: boolean; startsIn: number; startsInLabel: string;
  leftId: string; rightId: string; upId: string; downId: string;
  startLabel: string; endLabel: string; offset: number; width: number;
}
export interface GuideChannel {
  id: string; number: string; name: string; favorite: boolean; logo: string;
  now: string; next: string; programmes: GuideProgramme[];
}
export interface GuideModel {
  from: string; until: string; fromLabel: string; untilLabel: string; nowOffset: number; showNow: boolean; ticks: { id: string; label: string; offset: number }[]; channels: GuideChannel[];
}

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

/** Fetch all pages for one window; incomplete pages are never presented as complete. */
export async function loadGuide(api: GuideApi, from: string, until: string, now: number, origin?: string): Promise<GuideModel> {
  const start = Date.parse(from), end = Date.parse(until);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 86400000)
    throw new Error('Invalid guide window');
  const channels = (await allPages(cursor => api.channels(cursor, 100))).sort((a, b) => Number(b.favorite) - Number(a.favorite));
  const programmes = await allPages(cursor => api.guide({ from, until, cursor, limit: 100 }));
  // Mobile now/next stays current even while the grid browses another window.
  const currentStart = Math.floor(now / 1800000) * 1800000;
  const currentEnd = currentStart + 7200000;
  const currentProgrammes = start <= currentStart && end >= currentEnd ? programmes : await allPages(cursor => api.guide({
    from: new Date(currentStart).toISOString(), until: new Date(currentEnd).toISOString(), cursor, limit: 100,
  }));
  const currentByChannel = new Map<string, Programme[]>();
  for (const programme of currentProgrammes) {
    if (!currentByChannel.has(programme.channelId)) currentByChannel.set(programme.channelId, []);
    currentByChannel.get(programme.channelId)!.push(programme);
  }
  const grouped = new Map<string, Programme[]>();
  for (const programme of programmes) {
    if (!grouped.has(programme.channelId)) grouped.set(programme.channelId, []);
    grouped.get(programme.channelId)!.push(programme);
  }
  const label = (value: number) => time(value);
  const model: GuideModel = {
    from, until, fromLabel: label(start), untilLabel: label(end), nowOffset: Math.max(0, Math.min(100, (now - start) / (end - start) * 100)),
    showNow: now >= start && now < end,
    ticks: Array.from({ length: Math.floor((end - start) / 1800000) + 1 }, (_, n) => {
      const t = start + n * 1800000;
      return { id: String(t), label: label(t), offset: n * 1800000 / (end - start) * 100 };
    }),
    channels: channels.map(channel => {
      const entries = (grouped.get(channel.id) ?? []).filter(p => {
        const a = Date.parse(p.start), b = Date.parse(p.end);
        return Number.isFinite(a) && Number.isFinite(b) && b > a && a < end && b > start;
      }).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
      const currentEntries = (currentByChannel.get(channel.id) ?? []).filter(p => {
        const a = Date.parse(p.start), b = Date.parse(p.end);
        return Number.isFinite(a) && Number.isFinite(b) && b > a;
      }).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
      const current = currentEntries.find(p => Date.parse(p.start) <= now && now < Date.parse(p.end));
      const next = currentEntries.find(p => Date.parse(p.start) > now);
      return { id: channel.id, number: channel.number, name: channel.name, favorite: channel.favorite, logo: (() => { const art = channel.artwork.find(a => a.kind === 'logo' || a.kind === 'channel'); return art ? artworkURL(art, 80, 45, origin) ?? '' : ''; })(),
        now: current?.name ?? '', next: next?.name ?? '',
        programmes: entries.map(p => {
          const a = Date.parse(p.start), b = Date.parse(p.end);
          return { leftId: '', rightId: '', upId: '', downId: '', airing: a <= now && now < b, ended: b <= now, startsIn: Math.max(0, Math.ceil((a - now) / 60000)), startsInLabel: number(Math.max(0, Math.ceil((a - now) / 60000))), id: p.id, name: p.name, summary: p.summary, start: p.start, end: p.end,
            startLabel: label(a), endLabel: label(b), offset: (Math.max(a, start) - start) / (end - start) * 100,
            width: (Math.min(b, end) - Math.max(a, start)) / (end - start) * 100 };
        }) };
    }),
  };
  const cellId = (id: string) => `guide-${id}`;
  model.channels.forEach((channel, row) => channel.programmes.forEach((p, col) => {
    p.leftId = col > 0 ? cellId(channel.programmes[col - 1].id) : '';
    p.rightId = col + 1 < channel.programmes.length ? cellId(channel.programmes[col + 1].id) : '';
    const time = Math.max(start, Date.parse(p.start));
    const vertical = (index: number) => {
      const entries = model.channels[index]?.programmes ?? [];
      const target = entries.find(q => Date.parse(q.start) <= time && Date.parse(q.end) > time)
        ?? entries.reduce<GuideProgramme | undefined>((best, q) => !best || Math.abs(Date.parse(q.start) - time) < Math.abs(Date.parse(best.start) - time) ? q : best, undefined);
      return target ? cellId(target.id) : '';
    };
    p.upId = vertical(row - 1); p.downId = vertical(row + 1);
  }));
  return model;
}

export async function liveIdentity(api: GuideApi, channelId: string, now: number) {
  const channel = (await allPages(cursor => api.channels(cursor, 100))).find(c => c.id === channelId);
  if (!channel) return { title: msg('ui.liveTelevisionTitle') };
  const programmes = await allPages(cursor => api.guide({ from: new Date(now).toISOString(), until: new Date(now + 60000).toISOString(), channelIds: [channelId], cursor, limit: 100 }));
  const current = programmes.find(p => Date.parse(p.start) <= now && now < Date.parse(p.end));
  return { title: current ? `${channel.name} · ${current.name}` : channel.name };
}
