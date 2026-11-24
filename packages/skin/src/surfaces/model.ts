// Plugin surfaces (docs/plugin-screens.md: Surfaces), the pure parts: which contributions apply to
// what the host is showing (`when`, evaluated here so an inapplicable surface costs no request),
// which player overlays stand and where (anchors, boxes, the chrome's bars), the context a surface
// reads, and the toast stack (which alerts stand, for how long). Nothing here draws.
import { SPOILER_DELAY_SECONDS } from '@vela/core';
import type { AlertFrame, SurfaceContext, SurfaceContribution } from '../../../protocol/screen';

export type Anchor = NonNullable<SurfaceContribution['anchor']>;

/** What the host knows, matched against a contribution's `when`. */
export interface SurfaceFacts {
  /** The playing kind (a live channel, a programme from the archive, a title). */
  kind?: SurfaceContext['kind'];
  /** The feed of the playing channel's live event (the session's liveEvent.feed). */
  eventFeed?: string;
  /** The plugin an alert comes from. */
  alertPlugin?: string;
  /** The kind of the title a title page shows. */
  titleKind?: string;
}

/** A feed matches when equal, or when one names the other's last segment ("org.ether.sports:sports" and "sports"). */
function sameFeed(want: string, have: string | undefined): boolean {
  if (!have) return false;
  if (want === have) return true;
  const tail = (s: string) => s.slice(s.lastIndexOf(':') + 1);
  return !want.includes(':') ? tail(have) === want : !have.includes(':') && tail(want) === have;
}

/** Whether a contribution applies to what the host shows: every condition its `when` names holds. */
export function surfaceApplies(surface: Pick<SurfaceContribution, 'when'>, facts: SurfaceFacts): boolean {
  const when = surface.when;
  if (!when) return true;
  if (when.kind && when.kind !== facts.kind) return false;
  if (when.event && !sameFeed(when.event.feed, facts.eventFeed)) return false;
  if (when.alert && when.alert.plugin !== facts.alertPlugin) return false;
  if (when.titleKind && when.titleKind !== facts.titleKind) return false;
  return true;
}

/** The viewer's switch for a surface: what they set here, else what Ether remembers, else its default (on without one). */
export function surfaceEnabled(surface: Pick<SurfaceContribution, 'id' | 'setting'>, local: Record<string, boolean> = {}): boolean {
  if (local[surface.id] !== undefined) return local[surface.id]!;
  const setting = surface.setting;
  if (!setting) return true;
  return setting.enabled ?? setting.default;
}

/** At most this many player overlays per anchor (Ether caps them too; the first ones win). */
export const OVERLAYS_PER_ANCHOR = 2;

/** The player overlays that apply here, in Ether's order, at most two per anchor; `switchable` is
 * every applicable one (the player menu offers a switch for each, on or off). */
export function playerOverlays(surfaces: readonly SurfaceContribution[], facts: SurfaceFacts, local: Record<string, boolean> = {}):
  { shown: SurfaceContribution[]; switchable: SurfaceContribution[] } {
  const switchable = surfaces.filter(s => s.presentation === 'playerOverlay' && surfaceApplies(s, facts));
  const counts = new Map<Anchor, number>();
  const shown: SurfaceContribution[] = [];
  for (const surface of switchable) {
    if (!surfaceEnabled(surface, local)) continue;
    const anchor = surface.anchor ?? 'topLeft';
    const n = counts.get(anchor) ?? 0;
    if (n >= OVERLAYS_PER_ANCHOR) continue;
    counts.set(anchor, n + 1);
    shown.push(surface);
  }
  return { shown, switchable: switchable.slice(0, OVERLAYS_PER_ANCHOR * 3) };
}

/** Whether an overlay draws now: `chrome` overlays only while the chrome stands. */
export function overlayVisible(surface: Pick<SurfaceContribution, 'visibility'>, chrome: boolean): boolean {
  return surface.visibility !== 'chrome' || chrome;
}

// Boxes

export interface OverlayBox {
  left?: number; right?: number; top?: number; bottom?: number;
  maxWidth: number; maxHeight: number;
  /** The corner's glide under the top bar while the chrome stands (translateY). */
  shift: number;
}

export interface OverlayFrame {
  width: number; height: number;
  /** A phone (under 640 px): tighter edges, and corners may take more of the narrow width. */
  small: boolean;
  /** The player's design size: (px) => points (look.size). */
  size(px: number): number;
  /** The chrome stands, and where its top bar ends. */
  chrome: boolean;
  top: number;
}

/** Corners take at most 34% x 22% of the picture (on a phone, where 34% is too narrow to read a
 * score, 80% of its width), the band 100% x 12%. */
export function overlayBox(anchor: Anchor, frame: OverlayFrame): OverlayBox {
  const edge = frame.small ? 18 : frame.size(30);
  const gutter = frame.small ? 16 : frame.size(40);
  if (anchor === 'bottom') return { left: 0, right: 0, bottom: 0, maxWidth: frame.width, maxHeight: Math.round(frame.height * 0.12), shift: 0 };
  const maxWidth = Math.round(frame.width * (frame.small ? 0.8 : 0.34));
  const maxHeight = Math.round(frame.height * 0.22);
  // Under the chrome's top bar while it stands, back to the edge as it hides (as the score bug moved).
  const shift = frame.chrome ? Math.max(0, frame.top - edge) : 0;
  return anchor === 'topLeft' ? { left: gutter, top: edge, maxWidth, maxHeight, shift } : { right: gutter, top: edge, maxWidth, maxHeight, shift };
}

/** How far what sits on the picture's bottom edge (the bottom bar, the live notice, subtitles) lifts
 * for the bottom band: its drawn height, never more than its box. */
export function bandLift(drawnHeight: number, frame: Pick<OverlayFrame, 'height'>): number {
  if (!(drawnHeight > 0)) return 0;
  return Math.min(Math.round(drawnHeight), Math.round(frame.height * 0.12));
}

// Context

export interface PlayerFacts {
  /** The live channel playing ('' for none). */
  channelId: string;
  /** Its event on air ('' for none) and that event's feed. */
  eventId: string;
  feed?: string;
  kind?: SurfaceContext['kind'];
  /** The title playing, for a film or an episode. */
  titleId?: string;
  chrome: boolean;
  /** How far the picture trails live, and the wall-clock time of the frame on screen. */
  behindSeconds: number;
  pictureAt: number;
}

const key = (prefix: string, id: string | undefined) => (id ? (id.startsWith(`${prefix}:`) ? id : `${prefix}:${id}`) : undefined);

/** A player overlay's context: what Ether reads (record keys, the kind) and what stays here (the
 * chrome, the picture's time behind live). Close to live the picture is live: no time, no delay. */
export function overlayContext(facts: PlayerFacts): { server: SurfaceContext; local: SurfaceContext } {
  const server: SurfaceContext = {
    ...(key('channel', facts.channelId) ? { channel: key('channel', facts.channelId) } : {}),
    ...(key('event', facts.eventId) ? { event: key('event', facts.eventId) } : {}),
    ...(key('item', facts.titleId) ? { title: key('item', facts.titleId) } : {}),
    ...(facts.kind ? { kind: facts.kind } : {}),
  };
  const delayed = facts.behindSeconds > SPOILER_DELAY_SECONDS;
  // The picture moves a second at a time; asOf only needs the second it shows.
  const local: SurfaceContext = { chrome: facts.chrome, ...(delayed ? { delayed: true, pictureTime: new Date(Math.floor(facts.pictureAt / 1000) * 1000).toISOString() } : {}) };
  return { server, local };
}

/** A toast's context: the alert (its ref is what Ether reads); the channel playing under it stays here. */
export function toastContext(alert: AlertFrame, playingChannelId?: string): { server: SurfaceContext; local: SurfaceContext } {
  const { surface: _surface, ...rest } = alert;
  return { server: { alert: rest }, local: key('channel', playingChannelId) ? { channel: key('channel', playingChannelId) } : {} };
}

// Toasts

/** At most this many toasts stand at once; the rest wait their turn. */
export const MAX_TOASTS = 3;
/** A toast stands 8 to 30 seconds (the contribution's ttl); 12 without one. */
export function toastSeconds(ttl: number | undefined): number {
  return Math.max(8, Math.min(30, typeof ttl === 'number' && Number.isFinite(ttl) ? ttl : 12));
}
/** Design size of one toast, a quarter larger on TV. The design's 120 px height is the toast's
 * usual size; its box allows 168 px, because a toast with Watch and Add to multiview stacked (today's
 * Sports alert) is 149 px tall, and a phone's, its buttons wrapped, may take 220. */
export const TOAST_BOX = { width: 360, height: 120, maxHeight: 168 } as const;
export function toastBox(tv: boolean, small: boolean, width: number, gutter: number): { width: number; maxHeight: number } {
  const scale = tv ? 1.25 : 1;
  return small ? { width: width - gutter * 2, maxHeight: 220 } : { width: TOAST_BOX.width * scale, maxHeight: TOAST_BOX.maxHeight * scale };
}

/** The toast surface an alert draws with: the one it names, else the toast its plugin contributes. */
export function toastSurface(alert: AlertFrame, surfaces: readonly SurfaceContribution[]): SurfaceContribution | undefined {
  const toasts = surfaces.filter(s => s.presentation === 'toast');
  if (alert.surface) {
    const named = toasts.find(s => s.id === alert.surface);
    if (named) return named;
  }
  return toasts.find(s => surfaceApplies(s, { alertPlugin: alert.plugin }) && !!s.when?.alert);
}

/** The alerts to show, oldest first, at most `max`: a newer alert about the same event replaces an
 * older one (a close game that went final says only "Final"); `superseded` are the ones replaced. */
export function toastStack(alerts: readonly AlertFrame[], max = MAX_TOASTS): { shown: AlertFrame[]; superseded: AlertFrame[] } {
  const latest = new Map<string, AlertFrame>();
  const superseded: AlertFrame[] = [];
  for (const alert of alerts) {
    const about = alert.ref ?? alert.id;
    const known = latest.get(about);
    if (known) superseded.push(known);
    latest.set(about, alert);
  }
  const queue = alerts.filter(alert => latest.get(alert.ref ?? alert.id) === alert);
  return { shown: queue.slice(0, Math.max(0, max)), superseded };
}

/** A toast's time left after it ran `ranMs` unheld: it resumes where it stopped, with at least a beat left. */
export function toastRemaining(totalMs: number, ranMs: number): number {
  return Math.max(1200, totalMs - Math.max(0, ranMs));
}
