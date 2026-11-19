import type { GuideChannel } from '@vela/core';
import { logoIdentity } from './logo';

/** Programme geometry crosses the bridge only for the retained time window. */
export function nativeGuideChannels(rows: GuideChannel[], from: number, to: number) {
  return rows.map(c => ({ id: c.id, name: c.name, number: c.number, logo: c.logo, logoKey: logoIdentity(c.id, c.logo), loaded: c.listingsLoaded,
    cells: c.programmes.filter(p => p.at + p.span > from && p.at < to).map(p => ({ id: p.id, at: p.at, span: p.span })) }));
}

/** Programme/cache updates must not resend the entire native channel rail. */
export function nativeGuideLineup(rows: GuideChannel[], previous: { id: string; name: string; number: string; logo: string; logoKey: string }[] = []) {
  if (rows.length === previous.length && rows.every((row, i) => {
    const old = previous[i]!;
    return row.id === old.id && row.name === old.name && row.number === old.number && row.logo === old.logo;
  })) return previous;
  return rows.map(c => ({ id: c.id, name: c.name, number: c.number, logo: c.logo, logoKey: logoIdentity(c.id, c.logo) }));
}
