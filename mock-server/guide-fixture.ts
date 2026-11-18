import type { Channel, Programme } from '../packages/protocol/types';

/** Opt-in dense lineup, generated only for the requested channels and time window. */
export function scaleGuide(count: 1000 | 10000) {
  const channels: Channel[] = Array.from({ length: count }, (_, i) => ({
    id: `scale-${i}`, number: String(i + 1), name: `Scale ${String(i + 1).padStart(5, '0')}`,
    kind: 'tv', group: 'Scale', guides: [], artwork: [], favorite: i < 6,
  }));
  const byId = new Map(channels.map(c => [c.id, c]));
  return { channels, guide(from: number, until: number, ids: string[]): Programme[] {
    const selected = ids.length ? ids.map(id => byId.get(id)).filter((c): c is Channel => !!c) : channels;
    return selected.flatMap(channel => {
      const index = Number(channel.id.slice('scale-'.length));
      const step = (5 + index % 4 * 5) * 60000;
      const programmes: Programme[] = [];
      for (let at = Math.floor(from / step) * step; at < until; at += step) programmes.push({
        id: `${channel.id}:${at}`, channelId: channel.id, name: `${channel.name} · ${new Date(at).toISOString().slice(11, 16)}`,
        start: new Date(at).toISOString(), end: new Date(at + step).toISOString(),
        summary: 'Dense guide navigation fixture', genres: ['Sports'], artwork: [],
      });
      return programmes;
    });
  } };
}
