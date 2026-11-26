import { expect, test } from 'bun:test';
import { NOW_PLAYING_PLAY, nowPlayingDockFocus, nowPlayingFirstFocus } from '../src/widgets/media/now-playing-focus';

test('a TV opening prefers Play immediately and requests focus after layout', () => {
  const opening = { tv: true, open: true, entered: false };
  expect(nowPlayingFirstFocus({ ...opening, laidOut: false })).toEqual({ preferPlay: true, requestTarget: undefined });
  expect(nowPlayingFirstFocus({ ...opening, laidOut: true })).toEqual({ preferPlay: true, requestTarget: NOW_PLAYING_PLAY });
});

test('closed and non-TV players do not request focus', () => {
  const ready = { laidOut: true, entered: false };
  const idle = { preferPlay: false, requestTarget: undefined };
  expect(nowPlayingFirstFocus({ ...ready, tv: true, open: false })).toEqual(idle);
  expect(nowPlayingFirstFocus({ ...ready, tv: false, open: true })).toEqual(idle);
});

test('a later layout leaves focus alone until the next opening', () => {
  const laidOut = { tv: true, laidOut: true };
  expect(nowPlayingFirstFocus({ ...laidOut, open: true, entered: true })).toEqual({ preferPlay: false, requestTarget: undefined });
  expect(nowPlayingFirstFocus({ ...laidOut, open: true, entered: false }).requestTarget).toBe(NOW_PLAYING_PLAY);
});

test.each(['ios', 'android'])('the open TV dock excludes the covered route on %s until it closes', os => {
  const tvDock = { tv: true, os, fullscreen: false };
  expect(nowPlayingDockFocus({ ...tvDock, open: false }).routeActive).toBe(true);
  expect(nowPlayingDockFocus({ ...tvDock, open: true }).routeActive).toBe(false);
  expect(nowPlayingDockFocus({ ...tvDock, open: true, fullscreen: true }).routeActive).toBe(false);
});

test('the Apple TV entry guide requests focus once Play attaches and clears when Play is hidden or the dock closes', () => {
  const appleDock = { tv: true, os: 'ios', open: true, fullscreen: false };
  expect(nowPlayingDockFocus(appleDock)).toEqual({
    routeActive: false, appleTV: true, guideTarget: undefined, guideAction: 'clear',
  });
  expect(nowPlayingDockFocus({ ...appleDock, playTag: 42 })).toEqual({
    routeActive: false, appleTV: true, guideTarget: 42, guideAction: 'request',
  });
  expect(nowPlayingDockFocus({ ...appleDock, playTag: 42, fullscreen: true })).toEqual({
    routeActive: false, appleTV: true, guideTarget: undefined, guideAction: 'clear',
  });
  expect(nowPlayingDockFocus({ ...appleDock, playTag: 42, open: false })).toEqual({
    routeActive: true, appleTV: true, guideTarget: 42, guideAction: 'clear',
  });
});

test('Android TV uses the Play control directly and touch devices leave the route active', () => {
  const openDock = { open: true, fullscreen: false, playTag: 42 };
  const noGuide = { appleTV: false, guideTarget: undefined, guideAction: undefined };
  expect(nowPlayingDockFocus({ ...openDock, tv: true, os: 'android' })).toEqual({ ...noGuide, routeActive: false });
  expect(nowPlayingDockFocus({ ...openDock, tv: false, os: 'ios' })).toEqual({ ...noGuide, routeActive: true });
});
