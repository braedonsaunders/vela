import { describe, expect, test } from 'bun:test';
import type { AlertFrame, SurfaceContribution } from '../../protocol/screen';
import {
  bandLift, overlayBox, overlayContext, overlayVisible, playerOverlays, surfaceApplies, surfaceEnabled, toastBox, toastContext,
  toastRemaining, toastSeconds, toastStack, toastSurface,
} from '../src/surfaces/model';

const doc = { href: '/vela/v0/surfaces/x/document', renderer: 19 };
const scorebug: SurfaceContribution = { id: 'sports.scorebug', presentation: 'playerOverlay', anchor: 'topLeft', when: { event: { feed: 'org.ether.sports:sports' } },
  visibility: 'always', setting: { id: 'scorebug', label: 'Score', default: true, enabled: true }, document: doc };
const ticker: SurfaceContribution = { id: 'sports.ticker', presentation: 'playerOverlay', anchor: 'bottom', when: { kind: 'channel' },
  visibility: 'toggle', setting: { id: 'ticker', label: 'Scores ticker', default: false }, document: doc };
const toast: SurfaceContribution = { id: 'sports.alert', presentation: 'toast', when: { alert: { plugin: 'org.ether.sports' } }, ttl: 12, document: doc };
const corner = (id: string, anchor: SurfaceContribution['anchor'] = 'topLeft'): SurfaceContribution =>
  ({ id, presentation: 'playerOverlay', anchor, visibility: 'always', setting: { id, label: id, default: true }, document: doc });

describe('when', () => {
  test('a surface applies only when every condition its when names holds', () => {
    expect(surfaceApplies(scorebug, { kind: 'channel', eventFeed: 'org.ether.sports:sports' })).toBe(true);
    expect(surfaceApplies(scorebug, { kind: 'channel' })).toBe(false);
    expect(surfaceApplies(scorebug, { kind: 'channel', eventFeed: 'org.ether.news:headlines' })).toBe(false);
    expect(surfaceApplies(ticker, { kind: 'channel' })).toBe(true);
    expect(surfaceApplies(ticker, { kind: 'title' })).toBe(false);
    expect(surfaceApplies(toast, { alertPlugin: 'org.ether.sports' })).toBe(true);
    expect(surfaceApplies(toast, { alertPlugin: 'org.ether.news' })).toBe(false);
    expect(surfaceApplies({ when: { titleKind: 'podcast' } }, { titleKind: 'podcast' })).toBe(true);
    expect(surfaceApplies({ when: { titleKind: 'podcast' } }, { titleKind: 'movie' })).toBe(false);
    expect(surfaceApplies({}, {})).toBe(true);
  });

  test('a feed matches qualified or by its last segment', () => {
    expect(surfaceApplies({ when: { event: { feed: 'sports' } } }, { eventFeed: 'org.ether.sports:sports' })).toBe(true);
    expect(surfaceApplies({ when: { event: { feed: 'org.ether.sports:sports' } } }, { eventFeed: 'sports' })).toBe(true);
    expect(surfaceApplies({ when: { event: { feed: 'org.a:sports' } } }, { eventFeed: 'org.b:sports' })).toBe(false);
  });
});

describe('player overlays', () => {
  test('switches: what the viewer set here wins, then Ether, then the default', () => {
    expect(surfaceEnabled(scorebug)).toBe(true);
    expect(surfaceEnabled(ticker)).toBe(false);
    expect(surfaceEnabled(ticker, { 'sports.ticker': true })).toBe(true);
    expect(surfaceEnabled({ id: 'x', setting: { id: 'x', label: 'X', default: true, enabled: false } })).toBe(false);
    expect(surfaceEnabled({ id: 'x' })).toBe(true);
  });

  test('the ones that apply and are on stand, at most two per anchor, in Ether order; every applicable one has a switch', () => {
    const facts = { kind: 'channel' as const, eventFeed: 'sports' };
    const all = [scorebug, ticker, corner('a'), corner('b'), corner('c', 'topRight')];
    const { shown, switchable } = playerOverlays(all, facts);
    expect(shown.map(s => s.id)).toEqual(['sports.scorebug', 'a', 'c']);
    expect(switchable.map(s => s.id)).toEqual(['sports.scorebug', 'sports.ticker', 'a', 'b', 'c']);
    expect(playerOverlays(all, facts, { 'sports.scorebug': false, 'sports.ticker': true }).shown.map(s => s.id)).toEqual(['sports.ticker', 'a', 'b', 'c']);
    expect(playerOverlays([scorebug, ticker, toast], { kind: 'title' }).shown).toEqual([]);
  });

  test('a chrome overlay draws only while the chrome stands', () => {
    expect(overlayVisible({ visibility: 'chrome' }, false)).toBe(false);
    expect(overlayVisible({ visibility: 'chrome' }, true)).toBe(true);
    expect(overlayVisible({ visibility: 'always' }, false)).toBe(true);
  });
});

describe('boxes', () => {
  const desk = { width: 1440, height: 900, small: false, size: (px: number) => px, chrome: false, top: 108 };
  test('corners: 34% x 22% at the edges; the band 100% x 12% along the bottom', () => {
    expect(overlayBox('topLeft', desk)).toEqual({ left: 40, top: 30, maxWidth: 490, maxHeight: 198, shift: 0 });
    expect(overlayBox('topRight', desk)).toEqual({ right: 40, top: 30, maxWidth: 490, maxHeight: 198, shift: 0 });
    expect(overlayBox('bottom', desk)).toEqual({ left: 0, right: 0, bottom: 0, maxWidth: 1440, maxHeight: 108, shift: 0 });
  });
  test('corners glide under the top bar while the chrome stands; the band stays', () => {
    expect(overlayBox('topLeft', { ...desk, chrome: true }).shift).toBe(78);
    expect(overlayBox('bottom', { ...desk, chrome: true }).shift).toBe(0);
  });
  test('a phone keeps tight edges and lets a corner take 80% of its narrow width', () => {
    expect(overlayBox('topLeft', { ...desk, width: 390, height: 844, small: true, chrome: true, top: 76 })).toEqual({ left: 16, top: 18, maxWidth: 312, maxHeight: 186, shift: 58 });
  });
  test('TV sizes follow the player look', () => {
    expect(overlayBox('topLeft', { ...desk, width: 1920, height: 1080, size: px => Math.round(px * 1.4) }).left).toBe(56);
  });
  test('the band lifts the bottom edge by its drawn height, never past its box', () => {
    expect(bandLift(36, { height: 900 })).toBe(36);
    expect(bandLift(0, { height: 900 })).toBe(0);
    expect(bandLift(400, { height: 900 })).toBe(108);
  });
});

describe('context', () => {
  test('Ether reads record keys and the kind; chrome stays here, and the picture time only behind live', () => {
    const live = overlayContext({ channelId: 'ch-7', eventId: 'sports:nfl', kind: 'channel', chrome: true, behindSeconds: 3, pictureAt: 1_000_500 });
    expect(live).toEqual({ server: { channel: 'channel:ch-7', event: 'event:sports:nfl', kind: 'channel' }, local: { chrome: true } });
    const behind = overlayContext({ channelId: 'channel:ch-7', eventId: '', kind: 'channel', chrome: false, behindSeconds: 120, pictureAt: Date.parse('2026-11-24T20:00:00.750Z') });
    expect(behind.server).toEqual({ channel: 'channel:ch-7', kind: 'channel' });
    expect(behind.local).toEqual({ chrome: false, delayed: true, pictureTime: '2026-11-24T20:00:00.000Z' });
  });
  test('a toast reads its alert; the channel under it stays here', () => {
    const alert: AlertFrame = { id: 'a1', kind: 'close', title: 'Close game', body: 'x', at: '2026-11-24T20:00:00Z', ref: 'event:e1', plugin: 'sports', surface: 'sports.alert' };
    expect(toastContext(alert, 'ch-7')).toEqual({ server: { alert: { id: 'a1', kind: 'close', title: 'Close game', body: 'x', at: '2026-11-24T20:00:00Z', ref: 'event:e1', plugin: 'sports' } },
      local: { channel: 'channel:ch-7' } });
    expect(toastContext(alert).local).toEqual({});
  });
});

describe('toasts', () => {
  const frame = (id: string, ref: string, extra: Partial<AlertFrame> = {}): AlertFrame => ({ id, kind: 'close', title: 't', body: 'b', at: '', ref, plugin: 'org.ether.sports', ...extra });
  test('at most three stand, oldest first; a newer alert about the same event replaces the older', () => {
    const { shown, superseded } = toastStack([frame('1', 'event:a'), frame('2', 'event:b'), frame('3', 'event:a'), frame('4', 'event:c'), frame('5', 'event:d')]);
    expect(shown.map(a => a.id)).toEqual(['2', '3', '4']);
    expect(superseded.map(a => a.id)).toEqual(['1']);
  });
  test('ttl is 8 to 30 seconds, 12 without one; held time resumes with at least a beat left', () => {
    expect(toastSeconds(undefined)).toBe(12);
    expect(toastSeconds(3)).toBe(8);
    expect(toastSeconds(60)).toBe(30);
    expect(toastSeconds(15)).toBe(15);
    expect(toastRemaining(12_000, 5_000)).toBe(7_000);
    expect(toastRemaining(12_000, 11_900)).toBe(1_200);
  });
  test('the toast box: 360 wide, a quarter larger on TV, a phone spans its width', () => {
    expect(toastBox(false, false, 1440, 40).width).toBe(360);
    expect(toastBox(true, false, 1920, 56).width).toBe(450);
    expect(toastBox(false, true, 390, 16).width).toBe(358);
    expect(toastBox(false, false, 1440, 40).maxHeight).toBe(168);
  });
  test('an alert draws with the surface it names, else its plugin\'s toast', () => {
    const other: SurfaceContribution = { ...toast, id: 'news.alert', when: { alert: { plugin: 'org.ether.news' } } };
    expect(toastSurface(frame('1', 'e', { surface: 'news.alert' }), [toast, other])?.id).toBe('news.alert');
    expect(toastSurface(frame('1', 'e'), [other, toast])?.id).toBe('sports.alert');
    expect(toastSurface(frame('1', 'e', { plugin: 'org.x' }), [toast])).toBeUndefined();
  });
});
