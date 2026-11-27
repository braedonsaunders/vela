// Guide grid geometry in points. Minutes become points at `minuteWidth` per minute: zoom 0, 1
// and 2 show about 4.5, 3 and 2 hours across a laptop panel; phones keep one scale.
import type { GuideChannel, GuideProgramme } from '@vela/core';

export type Zoom = 0 | 1 | 2;

export const RULER = 44;

/** A short landscape phone viewport leaves the guide more room with details beside it. */
export function isLandscapePhone(width: number, height: number, largeDevice = false): boolean {
  return !largeDevice && width > height && width <= 1000 && height > 0 && height < 500;
}

export function minuteWidth(small: boolean, zoom: Zoom): number {
  if (small) return 4;
  return zoom === 0 ? 4 : zoom === 2 ? 9 : 6;
}

export function rowHeight(small: boolean, tv = false): number {
  return tv ? 96 : small ? 68 : 72;
}

export function railWidth(small: boolean, tv = false): number {
  return tv ? 320 : small ? 84 : 288;
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

export const cellId = (programmeId: string, channelId: string) => `guide-programme-${encodeURIComponent(channelId)}|${encodeURIComponent(programmeId)}`;
export const railId = (channelId: string) => `guide-rail-${channelId}`;

/** A floating shell must clear navigation on every guide mode, including the grid. */
export function guideTop(flowHeader: boolean, small: boolean, insetTop: number): number {
  return flowHeader ? 0 : (small ? 108 : 68) + insetTop;
}

const STACKED_COPY = 120;

/** Cinematic's band uses the available route area, leaving controls and rows below it.
 * Portrait phones stack the picture above compact copy; short landscape uses two columns. */
export function guideBand(width: number, height: number, top: number, side: number) {
  const available = Math.max(0, height - top);
  const stacked = width < 640 && height > width;
  const bandHeight = Math.round(available * (stacked ? 0.46 : 0.38));
  const gap = stacked ? 8 : 16;
  // A stacked band keeps room under the picture for its copy (the live line, title, Start over and
  // episode line, about 112px): on a short phone (375x667) 88px let the picture cover the live line.
  const pictureHeight = Math.max(0, Math.min(
    stacked ? bandHeight - STACKED_COPY : bandHeight - gap * 2,
    (width - side * 2) * (stacked ? 1 : 0.46) * 9 / 16,
  ));
  return { height: bandHeight, pictureHeight, stacked, gap };
}

/** Only cells crossing the left viewport edge need a per-frame sliding label. */
export function labelFollows(at: number, span: number, visibleFrom: number): boolean {
  return at < visibleFrom + 30 && at + span > visibleFrom;
}

export function programmeOverlapping(channel: GuideChannel, minute: number): GuideProgramme | undefined {
  return channel.programmes.find(p => p.at <= minute && p.at + p.span > minute);
}

/** Empty time keeps its own geometry instead of moving focus to a distant programme. */
export function programmeGap(channel: GuideChannel, minute: number, minutes: number): { at: number; span: number } | undefined {
  let from = 0, to = minutes;
  for (const programme of channel.programmes) {
    const end = programme.at + programme.span;
    if (programme.at <= minute && end > minute) return undefined;
    if (end <= minute) from = Math.max(from, end);
    else if (programme.at > minute) { to = Math.min(to, programme.at); break; }
  }
  return to > from ? { at: from, span: to - from } : undefined;
}
export const gapId = (channelId: string, at: number) => `guide-gap-${encodeURIComponent(channelId)}|${at}`;

/** Keep the complete clock pill inside the visible ruler while its line stays at the real time. */
export function nowPillOffset(position: number, viewport: number, width: number): number {
  'worklet';
  return Math.max(4, Math.min(Math.max(4, viewport - width - 4), position - width / 2));
}

/** A ruler label is hidden while the now chip occupies the same horizontal space. */
export function rulerLabelVisible(labelLeft: number, labelWidth: number, pillLeft: number, pillWidth: number): boolean {
  'worklet';
  return labelLeft + labelWidth <= pillLeft - 4 || labelLeft >= pillLeft + pillWidth + 4;
}

/** Crop at time-window edges before lifting. A small gutter contains the shadow;
 * clamping the spring itself also keeps overshoot out of the channel layer. */
export function programmeFocusFrame(left: number, width: number, viewportLeft: number, viewportWidth: number, lift: number, shadowGutter = 6) {
  'worklet';
  const gutter = Math.min(shadowGutter, Math.max(0, viewportWidth / 4));
  const start = Math.max(left, viewportLeft + gutter);
  const end = Math.min(left + width, viewportLeft + viewportWidth - gutter);
  const visibleWidth = Math.max(0, end - start);
  const scale = Math.max(0.98, Math.min(1.045, lift));
  const scaleX = visibleWidth > 0 ? Math.min(scale, Math.max(1, (viewportWidth - 2 * gutter) / visibleWidth)) : 0;
  const half = visibleWidth * scaleX / 2;
  const centre = Math.max(viewportLeft + gutter + half, Math.min(viewportLeft + viewportWidth - gutter - half, (start + end) / 2));
  return { left: start, width: visibleWidth, scaleX, scaleY: scale, translateX: centre - (start + visibleWidth / 2) };
}
