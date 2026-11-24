import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type * as V from '../../packages/protocol/types';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { launchMock, type RunningMock } from './launch';
import { mediaRoot } from '../media';

const mediaGenerated = existsSync(join(mediaRoot, 'master.m3u8'));
const device: V.Device = { id: 'sports-test-device', name: 'Test', platform: 'web', appVersion: '0.2.0' };
const NFL = 'sports:sports:nfl-nyg-phi';
let mock: RunningMock;
let tokens: V.Tokens;
let keys = 0;
const key = () => `sports-${++keys}`;

beforeAll(async () => {
  mock = await launchMock({ VELA_MOCK_LIVE_TICK_MS: '150', VELA_MOCK_PROVIDER_CAP: '2' });
  const response = await fetch(`${mock.url}/vela/v0/auth/sign-in`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'demo', password: 'vela', device, idempotencyKey: key() }) });
  tokens = await response.json() as V.Tokens;
});
afterAll(async () => { await mock?.stop(); });

const headers = () => ({ Authorization: `Bearer ${tokens.accessToken}`, 'X-Vela-Device-Id': device.id, 'Content-Type': 'application/json' });
const get = (path: string) => fetch(`${mock.url}/vela/v0${path}`, { headers: headers() });
const send = (method: string, path: string, body: object = {}) =>
  fetch(`${mock.url}/vela/v0${path}`, { method, headers: headers(), body: JSON.stringify({ idempotencyKey: key(), ...body }) });

describe('mock server: sports', () => {
  test('capabilities announce multiview, and bootstrap the sports screen to a client that draws it', async () => {
    const capabilities = await (await fetch(`${mock.url}/vela/v0/capabilities`)).json() as V.ServerCapabilities;
    expect(capabilities.features.multiview).toEqual({ available: true, maxTiles: 4 });
    // Hard cut: only a client that says its renderer gets the screen (as a document; screens.test.ts).
    expect((await (await get('/bootstrap')).json() as V.Bootstrap).navigation).toBeUndefined();
    const bootstrap = await (await fetch(`${mock.url}/vela/v0/bootstrap`, { headers: { ...headers(), 'X-Vela-Screen-Renderer': '19' } })).json() as V.Bootstrap;
    expect(bootstrap.navigation).toMatchObject([{ kind: 'screen', id: 'sports', title: 'Sports', icon: 'sports', page: 'index' }]);
  });

  test.skipIf(!mediaGenerated)('multiview tiles share a provider cap; a tuned game carries its live event', async () => {
    const group = await (await send('POST', '/multiview', { device })).json() as V.MultiviewGroup;
    expect(group.maxTiles).toBe(4);
    const client = { device, protocolVersions: [0], containers: ['mp4'], videoCodecs: ['h264'], audioCodecs: ['aac'], subtitleFormats: ['webvtt'], hls: true, mse: false };
    const play = (channelId: string, tile: number) => send('POST', '/playback', { channelId, client, multiview: { groupId: group.groupId, tile } });
    const first = await (await play('channel-7', 0)).json() as V.PlaybackPlan;
    expect((await play('channel-7', 1)).status).toBe(200);
    expect((await play('channel-8', 2)).status).toBe(200);
    const refused = await play('channel-9', 3);
    expect(refused.status).toBe(409);
    const error = (await refused.json() as V.ErrorResponse).error;
    expect(error).toMatchObject({ class: 'capacity', code: 'provider_connection_cap', details: { max: 2, inUse: 2 }, retry: { allowed: false } });
    const snapshot = await (await get(`/sessions/${first.sessionId}`)).json() as V.SessionSnapshot;
    expect(snapshot.liveEvent).toEqual({ id: NFL, feed: 'sports' });
    expect((await send('DELETE', `/multiview/${group.groupId}`)).status).toBe(200);
  });

  test.skipIf(!mediaGenerated)('a tile declares its drawn height and its plan is capped at it', async () => {
    const group = await (await send('POST', '/multiview', { device })).json() as V.MultiviewGroup;
    const client = { device, protocolVersions: [0], containers: ['mp4'], videoCodecs: ['h264'], audioCodecs: ['aac'], subtitleFormats: ['webvtt'], hls: true, mse: false };
    const play = (maxHeight: number, tile: number) => send('POST', '/playback', { channelId: 'channel-7', client, multiview: { groupId: group.groupId, tile, maxHeight } });
    const small = await (await play(480, 0)).json() as V.PlaybackPlan;
    expect(small.paths[0]!.qualities.map(quality => quality.height)).toEqual([360]);
    const full = await (await play(2160, 1)).json() as V.PlaybackPlan;
    expect(full.paths[0]!.qualities.map(quality => quality.height)).toEqual([360, 540, 720]);
    expect((await play(0, 2)).status).toBe(400);
    expect((await send('DELETE', `/multiview/${group.groupId}`)).status).toBe(200);
  });

  test.skipIf(!mediaGenerated)('a tile replans at a new height in the same session, unchanged once at the top', async () => {
    const group = await (await send('POST', '/multiview', { device })).json() as V.MultiviewGroup;
    const client = { device, protocolVersions: [0], containers: ['mp4'], videoCodecs: ['h264'], audioCodecs: ['aac'], subtitleFormats: ['webvtt'], hls: true, mse: false };
    const small = await (await send('POST', '/playback', { channelId: 'channel-7', client, multiview: { groupId: group.groupId, tile: 0, maxHeight: 480 } })).json() as V.PlaybackPlan;
    const replan = (plan: V.PlaybackPlan, maxHeight: number) => send('POST', `/sessions/${plan.sessionId}/commands`,
      { kind: 'replan', maxHeight, sourceGeneration: plan.sourceGeneration, seekGeneration: plan.seekGeneration, idempotencyKey: crypto.randomUUID() });
    const big = await (await replan(small, 2160)).json() as V.PlaybackPlan;
    expect(big.sessionId).toBe(small.sessionId);
    expect(big.revision).toBe(small.revision + 1);
    expect(big.paths[0]!.qualities.map(quality => quality.height)).toEqual([360, 540, 720]);
    const again = await (await replan(big, 2160)).json() as V.PlaybackPlan;
    expect(again.revision).toBe(big.revision);
    expect((await replan(big, 0)).status).toBe(400);
    expect((await send('DELETE', `/multiview/${group.groupId}`)).status).toBe(200);
  });
});
