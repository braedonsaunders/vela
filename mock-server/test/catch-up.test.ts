// Live TV catch-up and timeshift in the mock (Ether v0.3.22 spec section C): the capability, the
// channel archive and guide flags, archive plans, the C6 refusals and goLive.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type * as V from '../../packages/protocol/types';
import { launchMock, type RunningMock } from './launch';
import { mediaRoot } from '../media';

// Starting playback needs the generated HLS fixture (mock-server/scripts/make-media.ts); CI has none.
const mediaGenerated = existsSync(join(mediaRoot, 'master.m3u8'));
const device: V.Device = { id: 'catch-up-device', name: 'Test', platform: 'web', appVersion: '0.1.0' };
const client = { device, protocolVersions: [0], containers: ['mp4'], videoCodecs: ['h264'], audioCodecs: ['aac'], subtitleFormats: ['webvtt'], hls: true, mse: false };
let mock: RunningMock;
let tokens: V.Tokens;
let keys = 0;
const key = () => `catch-up-${++keys}`;

const call = (path: string, init: RequestInit = {}) => fetch(`${mock.url}/vela/v0${path}`, {
  ...init, headers: { 'Content-Type': 'application/json', ...(tokens ? { Authorization: `Bearer ${tokens.accessToken}`, 'X-Vela-Device-Id': device.id } : {}), ...init.headers } });
const post = (path: string, body: object) => call(path, { method: 'POST', body: JSON.stringify(body) });
const get = async <T>(path: string) => (await call(path)).json() as Promise<T>;
const errorOf = async (response: Response) => ((await response.json()) as V.ErrorResponse).error;

beforeAll(async () => {
  mock = await launchMock({ VELA_MOCK_CHANNELS: '12', VELA_MOCK_CATCHUP_UNAVAILABLE: 'channel-5' });
  tokens = await (await post('/auth/sign-in', { username: 'demo', password: 'vela', device, idempotencyKey: key() })).json() as V.Tokens;
});
afterAll(async () => { await mock?.stop(); });

/** The first of these channels with a programme on air now (the fixture guide has gaps), and its programmes. */
async function airingOn(ids: string[]) {
  for (const id of ids) {
    const found = await programmes(id);
    if (found.airing && found.ended) return { id, ...found };
  }
  throw new Error(`Nothing on air on ${ids.join(', ')}`);
}

/** An ended and an airing programme on a channel, from today's guide. */
async function programmes(channelId: string) {
  const now = Date.now();
  const window = `from=${new Date(now - 6 * 3600_000).toISOString()}&until=${new Date(now + 3600_000).toISOString()}`;
  const guide = await get<V.GuideResponse>(`/live/guide?${window}&channelIds=${channelId}&limit=100`);
  return {
    ended: guide.items.filter(p => Date.parse(p.end) <= now).at(-1)!,
    airing: guide.items.find(p => Date.parse(p.start) <= now && now < Date.parse(p.end))!,
  };
}

describe('catch-up capability and guide', () => {
  test('the capability offers the archive and an independent rewind window', async () => {
    const capabilities = await get<V.ServerCapabilities>('/capabilities');
    expect(capabilities.features.liveCatchUp).toEqual({ available: true, maxDays: 3, timeshift: { available: true, maxMinutes: 60 } });
  });

  test('two of every three channels keep an archive, and their programmes say what they can do', async () => {
    const channels = await get<V.Page<V.Channel>>('/live/channels?limit=6');
    expect(channels.items.map(c => c.archiveDays ?? 0)).toEqual([3, 3, 0, 3, 3, 0]);
    const { ended, airing } = await airingOn(['channel-1', 'channel-2', 'channel-5', 'channel-8']);
    expect(ended.catchUp).toBe(true);
    expect(ended.startOver).toBeUndefined();
    expect(airing.startOver).toBe(true);
    const none = await airingOn(['channel-3', 'channel-6', 'channel-9']);
    expect(none.ended.catchUp).toBeUndefined();
    expect(none.airing.startOver).toBeUndefined();
  });
});

describe.skipIf(!mediaGenerated)('catch-up playback', () => {
  test('an ended programme plays as on-demand media named only in catchUp', async () => {
    const { ended } = await programmes('channel-1');
    const plan = await (await post('/playback', { channelId: 'channel-1', programmeId: ended.id, client, idempotencyKey: key() })).json() as V.PlaybackPlan;
    expect(plan.channelId).toBeUndefined();
    expect(plan.live).toBeUndefined();
    expect(plan.title).toBe(ended.name);
    expect(plan.catchUp).toMatchObject({ channelId: 'channel-1', programmeId: ended.id, startAt: ended.start, endAt: ended.end });
    const length = (Date.parse(ended.end) - Date.parse(ended.start)) / 1000;
    expect(Math.abs(plan.durationSeconds! - length)).toBeLessThanOrEqual(8);
    const playlist = await (await fetch(`${mock.url}${plan.paths[0]!.qualities[0]!.url}`)).text();
    expect(playlist).toContain('#EXT-X-ENDLIST');
    const goLive = await post(`/sessions/${plan.sessionId}/commands`, { kind: 'goLive', sourceGeneration: plan.sourceGeneration, seekGeneration: plan.seekGeneration, idempotencyKey: key() });
    expect((await errorOf(goLive)).code).toBe('invalid_command');
  });

  test('Start over plays the programme on air from its start, growing, and goLive makes it the live channel', async () => {
    const { id: channelId, airing } = await airingOn(['channel-2', 'channel-1', 'channel-8', 'channel-10']);
    const plan = await (await post('/playback', { channelId, programmeId: airing.id, from: 'start', client, idempotencyKey: key() })).json() as V.PlaybackPlan;
    expect(plan.channelId).toBeUndefined();
    expect(plan.durationSeconds).toBeUndefined();
    expect(plan.live).toMatchObject({ mode: 'startOver', windowStartSeconds: 0 });
    const elapsed = (Date.now() - Date.parse(airing.start)) / 1000;
    expect(Math.abs(plan.live!.liveEdgeSeconds! - elapsed)).toBeLessThanOrEqual(12);
    const playlist = await (await fetch(`${mock.url}${plan.paths[0]!.qualities[0]!.url}`)).text();
    expect(playlist).toContain('#EXT-X-PLAYLIST-TYPE:EVENT');
    expect(playlist).not.toContain('#EXT-X-ENDLIST');
    const live = await (await post(`/sessions/${plan.sessionId}/commands`, { kind: 'goLive', sourceGeneration: plan.sourceGeneration, seekGeneration: plan.seekGeneration, idempotencyKey: key() })).json() as V.PlaybackPlan;
    expect(live.channelId).toBe(channelId);
    expect(live.catchUp).toBeUndefined();
    expect(live.live?.mode).toBe('adaptive');
  });

  test('refusals: no archive, outside the archive, the provider has nothing', async () => {
    const none = await programmes('channel-3');
    expect((await errorOf(await post('/playback', { channelId: 'channel-3', programmeId: none.ended.id, client, idempotencyKey: key() }))).code).toBe('catchup_not_supported');
    const old = await post('/playback', { channelId: 'channel-1', startAt: new Date(Date.now() - 5 * 86_400_000).toISOString(), durationSeconds: 1800, client, idempotencyKey: key() });
    const outside = await errorOf(old);
    expect(outside.code).toBe('catchup_outside_archive');
    expect(outside.archiveDays).toBe(3);
    const refused = await programmes('channel-5');
    const unavailable = await errorOf(await post('/playback', { channelId: 'channel-5', programmeId: refused.ended.id, client, idempotencyKey: key() }));
    expect(unavailable.code).toBe('catchup_unavailable');
    expect(unavailable.retry.allowed).toBe(true);
  });

  test('a live channel carries its rewind window; seeks outside it are refused, goLive moves to the edge', async () => {
    const plan = await (await post('/playback', { channelId: 'channel-1', client, idempotencyKey: key() })).json() as V.PlaybackPlan;
    expect(plan.live?.timeshift).toEqual({ maxMinutes: 60 });
    expect(plan.live!.liveEdgeSeconds! - plan.live!.windowStartSeconds!).toBeGreaterThan(15 * 60);
    expect(Date.parse(plan.live!.edgeAt!)).toBeGreaterThan(Date.now() - 60_000);
    const generations = { sourceGeneration: plan.sourceGeneration, seekGeneration: plan.seekGeneration };
    const outside = await errorOf(await post(`/sessions/${plan.sessionId}/commands`, { kind: 'seek', positionSeconds: plan.live!.liveEdgeSeconds! + 600, ...generations, idempotencyKey: key() }));
    expect(outside.code).toBe('timeshift_outside_window');
    expect(outside.liveEdgeSeconds).toBeGreaterThan(0);
    const back = await (await post(`/sessions/${plan.sessionId}/commands`, { kind: 'seek', positionSeconds: plan.live!.windowStartSeconds! + 60, ...generations, idempotencyKey: key() })).json() as V.PlaybackPlan;
    expect(back.live!.behindLiveSeconds).toBeGreaterThan(60);
    const live = await (await post(`/sessions/${plan.sessionId}/commands`, { kind: 'goLive', sourceGeneration: back.sourceGeneration, seekGeneration: back.seekGeneration, idempotencyKey: key() })).json() as V.PlaybackPlan;
    expect(live.positionSeconds).toBe(live.live!.liveEdgeSeconds!);
    expect(live.live!.behindLiveSeconds).toBe(0);
  });
});
