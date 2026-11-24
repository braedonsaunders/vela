// What stays of live events in core after the hard cut: the stream's backoff, plugin screens in
// bootstrap navigation, and the session's live-event reference.
import { expect, test } from 'bun:test';
import type * as V from '../src/wire';
import { backoffMs } from '../src/live/events';
import { screenNavigation } from '../src/discovery/models';
import { liveEventRef } from '../src/protocol/events';

test('reconnection backs off from one second to thirty, with bounded jitter', () => {
  expect(backoffMs(1, 0)).toBe(1000);
  expect(backoffMs(2, 0)).toBe(2000);
  expect(backoffMs(4, 0)).toBe(8000);
  expect(backoffMs(20, 0)).toBe(30000);
  expect(backoffMs(20, 1)).toBe(36000);
});

test('navigation lists each plugin screen once, with its document, and skips what it does not know', () => {
  const document = { href: '/vela/v0/screens/sports/pages/index/document?v=1&r=19&l=en', renderer: 19 };
  expect(screenNavigation([{ kind: 'screen', id: 'sports', title: 'Sports', icon: 'sports', page: 'index', document }, { kind: 'screen', id: 'sports', title: 'Again', page: 'index', document },
    { kind: 'other' as 'screen', id: 'x', title: 'X' } as never])).toEqual([{ id: 'sports', title: 'Sports', icon: 'sports', page: 'index', document }]);
  // Hard cut: an entry without a document (an Ether before plugin screens) is not offered.
  expect(screenNavigation([{ kind: 'screen', id: 'sports', title: 'Sports', icon: 'sports' } as never])).toEqual([]);
  expect(screenNavigation(undefined)).toEqual([]);
});

test('a session liveEvent reference is validated', () => {
  expect(liveEventRef({ id: 'a', feed: 'sports' })).toEqual({ id: 'a', feed: 'sports' });
  expect(liveEventRef(null)).toBeNull();
  expect(liveEventRef({ id: 3 })).toBeNull();
});

test('following a session hands the live event on air from the snapshot and the stream', async () => {
  const { followSession } = await import('../src/protocol/events');
  const plan = { sessionId: 's1', revision: 1 } as V.PlaybackPlan;
  const seen: (V.LiveEventRef | null)[] = [];
  const api = {
    sessionSnapshot: async () => ({ cursor: '1', revision: 1, plan, publishedRanges: [], liveEvent: { id: 'a', feed: 'sports' } }),
    streamSession: async (_id: string, _cursor: string, onEvent: (event: { event: string; id: string; data: string }) => Promise<void> | void) => {
      await onEvent({ event: 'liveEvent', id: '', data: JSON.stringify({ liveEvent: null }) });
      await onEvent({ event: 'liveEvent', id: '', data: JSON.stringify({ liveEvent: { id: 'b', feed: 'sports' } }) });
    },
  };
  await followSession(api as never, value => value, 's1', () => {}, undefined, ref => seen.push(ref));
  expect(seen).toEqual([{ id: 'a', feed: 'sports' }, null, { id: 'b', feed: 'sports' }]);
});
