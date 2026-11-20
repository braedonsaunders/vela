import { expect, test } from 'bun:test';
import { sessionFromPlan } from '../web/engine/protocol';
import type { PlaybackPlan } from '../../../packages/protocol/types';

const base = {
  sessionId: 's', revision: 1, sourceGeneration: 1, seekGeneration: 1, state: 'ready', positionSeconds: 0,
  paths: [{ id: 'primary', kind: 'remux', transport: 'hls', url: '/live/index.m3u8', mimeType: 'application/vnd.apple.mpegurl', readiness: 'ready', timelineOriginSeconds: 0, qualities: [], boundaries: [] }],
  selectedPathId: 'primary', audioTracks: [], subtitleTracks: [], chapters: [], fallback: { state: 'unsupported' },
} as unknown as PlaybackPlan;

test('a library live stream plays as live although it has no channel', () => {
  const session = sessionFromPlan({ ...base, libraryId: '6', liveItemId: 'cam-1', live: { mode: 'adaptive' } } as PlaybackPlan, 'https://server.test/vela/');
  expect(session.live).toBe(true);
  expect(session.mediaId).toBe('cam-1');
});

test('Live TV channels are live and on-demand titles are not', () => {
  expect(sessionFromPlan({ ...base, channelId: 'ch-1' } as PlaybackPlan, 'https://server.test/').live).toBe(true);
  expect(sessionFromPlan({ ...base, titleId: 't-1' } as PlaybackPlan, 'https://server.test/').live).toBe(false);
});
