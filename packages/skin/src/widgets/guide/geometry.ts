// Guide grid geometry in points. Minutes become points at `minuteWidth` per minute: zoom 0, 1
// and 2 show about 4.5, 3 and 2 hours across a laptop panel; phones keep one scale.
import type { GuideChannel, GuideProgramme } from '@vela/core';

export type Zoom = 0 | 1 | 2;

export const RULER = 44;

export function minuteWidth(small: boolean, zoom: Zoom): number {
  if (small) return 4;
  return zoom === 0 ? 4 : zoom === 2 ? 9 : 6;
}

export function rowHeight(small: boolean): number {
  return small ? 68 : 72;
}

export function railWidth(small: boolean): number {
  return small ? 84 : 264;
}

/** The page gutter: 16 on phones, else 4% of the width, at least 28. */
export function gutter(small: boolean, width: number): number {
  return small ? 16 : Math.max(28, width * 0.04);
}

/** The minute to show at the panel's left edge so `minute` sits a third of the way across. */
export function leftFor(minute: number, visibleMinutes: number, dayMinutes: number): number {
  return Math.max(0, Math.min(dayMinutes - visibleMinutes, minute - visibleMinutes / 3));
}

/** The programme under `minute` in a row, else the next one, else the last. */
export function programmeAt(channel: GuideChannel, minute: number): GuideProgramme | undefined {
  const list = channel.programmes;
  return list.find(p => p.at + p.span > minute) ?? list[list.length - 1];
}

export type ChannelFilter = 'all' | 'favourites' | 'listed' | `group:${string}`;

export function keeps(channel: GuideChannel, filter: ChannelFilter, tab: string): boolean {
  if (tab && !channel.guideIds.includes(tab)) return false;
  if (filter === 'favourites') return channel.favorite;
  if (filter === 'listed') return !channel.listingsLoaded || channel.listed;
  if (filter.startsWith('group:')) return channel.group === filter.slice(6);
  return true;
}

/** A channel's two-letter monogram, for a channel without a logo. */
export function monogram(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

export const cellId = (programmeId: string) => `guide-${programmeId}`;
export const railId = (channelId: string) => `guide-rail-${channelId}`;
