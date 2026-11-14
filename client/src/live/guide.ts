import type { Channel, GuideQuery, GuideResponse, Page, Programme } from '../../wire/v0/types';

/** A single bounded guide window. Times remain the server's original timestamps. */
export interface GuideApi {
  channels(cursor?: string, limit?: number): Promise<Page<Channel>>;
  guide(query: GuideQuery): Promise<GuideResponse>;
}

export interface GuideProgramme {
  id: string; name: string; summary: string; start: string; end: string;
  startLabel: string; endLabel: string; offset: number; width: number;
}
export interface GuideChannel {
  id: string; number: string; name: string; favorite: boolean;
  now: string; next: string; programmes: GuideProgramme[];
}
export interface GuideModel {
  from: string; until: string; fromLabel: string; untilLabel: string; nowOffset: number; showNow: boolean; channels: GuideChannel[];
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
export async function loadGuide(api: GuideApi, from: string, until: string, now: number): Promise<GuideModel> {
  const start = Date.parse(from), end = Date.parse(until);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 86400000)
    throw new Error('Invalid guide window');
  const channels = await allPages(cursor => api.channels(cursor, 100));
  const programmes = await allPages(cursor => api.guide({ from, until, cursor, limit: 100 }));
  const grouped = new Map<string, Programme[]>();
  for (const programme of programmes) {
    if (!grouped.has(programme.channelId)) grouped.set(programme.channelId, []);
    grouped.get(programme.channelId)!.push(programme);
  }
  const label = (value: number) => new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return {
    from, until, fromLabel: label(start), untilLabel: label(end), nowOffset: Math.max(0, Math.min(100, (now - start) / (end - start) * 100)),
    showNow: now >= start && now < end,
    channels: channels.map(channel => {
      const entries = (grouped.get(channel.id) ?? []).filter(p => {
        const a = Date.parse(p.start), b = Date.parse(p.end);
        return Number.isFinite(a) && Number.isFinite(b) && b > a && a < end && b > start;
      }).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
      const current = entries.find(p => Date.parse(p.start) <= now && now < Date.parse(p.end));
      const next = entries.find(p => Date.parse(p.start) > now);
      return { id: channel.id, number: channel.number, name: channel.name, favorite: channel.favorite,
        now: current?.name ?? '', next: next?.name ?? '',
        programmes: entries.map(p => {
          const a = Date.parse(p.start), b = Date.parse(p.end);
          return { id: p.id, name: p.name, summary: p.summary, start: p.start, end: p.end,
            startLabel: label(a), endLabel: label(b), offset: (Math.max(a, start) - start) / (end - start) * 100,
            width: (Math.min(b, end) - Math.max(a, start)) / (end - start) * 100 };
        }) };
    }),
  };
}
