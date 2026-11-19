import type { GuideChannel } from '@vela/core';
import { logoIdentity } from './logo';

/** Programme geometry crosses the bridge only for the retained time window. */
export function nativeGuideChannels(rows: GuideChannel[], from: number, to: number) {
  return rows.map(c => ({ id: c.id, name: c.name, number: c.number, logo: c.logo, logoKey: logoIdentity(c.id, c.logo),
    cells: c.programmes.filter(p => p.at + p.span > from && p.at < to).map(p => ({ id: p.id, at: p.at, span: p.span })) }));
}
