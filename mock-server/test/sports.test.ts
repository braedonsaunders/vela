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

/** Reads named server events from a stream until `enough` says stop. */
async function readStream(path: string, enough: (events: { event: string; data: any }[]) => boolean): Promise<{ event: string; data: any }[]> {
  const controller = new AbortController();
  const response = await fetch(`${mock.url}/vela/v0${path}`, { headers: headers(), signal: controller.signal });
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const events: { event: string; data: any }[] = [];
  let buffer = '';
  try {
    while (!enough(events)) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const name = /^event: (.*)$/m.exec(block)?.[1] ?? 'message';
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (data) events.push({ event: name, data: JSON.parse(data) });
      }
    }
  } finally { controller.abort(); }
  return events;
}

describe('mock server: sports', () => {
  test('capabilities and bootstrap navigation announce the sports screen', async () => {
    const capabilities = await (await fetch(`${mock.url}/vela/v0/capabilities`)).json() as V.ServerCapabilities;
    expect(capabilities.features.liveEvents?.available).toBe(true);
    expect(capabilities.features.multiview).toEqual({ available: true, maxTiles: 4 });
    // Hard cut: only a client that says its renderer gets the screen (as a document; screens.test.ts).
    expect((await (await get('/bootstrap')).json() as V.Bootstrap).navigation).toBeUndefined();
    const bootstrap = await (await fetch(`${mock.url}/vela/v0/bootstrap`, { headers: { ...headers(), 'X-Vela-Screen-Renderer': '19' } })).json() as V.Bootstrap;
    expect(bootstrap.navigation).toMatchObject([{ kind: 'screen', id: 'sports', title: 'Sports', icon: 'sports', page: 'index' }]);
  });

  test('the sports screen resolves every section type with events', async () => {
    const screen = await (await get('/screens/sports')).json() as V.Screen;
    expect(screen.sections.map(section => section.type)).toEqual(['hero', 'leagues', 'events', 'events', 'schedule', 'table', 'entities']);
    const hero = screen.sections[0] as V.HeroSection;
    expect(hero.event?.status.state).toBe('in');
    expect(hero.event?.competitors).toHaveLength(2);
    expect(hero.event?.watch?.[0]).toMatchObject({ kind: 'channel', live: true });
    const schedule = screen.sections.find(section => section.type === 'schedule') as V.ScheduleSection;
    expect(schedule.next).toBeTruthy();
    const next = await (await get(`/screens/sports?date=${schedule.next}`)).json() as V.Screen;
    expect((next.sections.find(section => section.type === 'schedule') as V.ScheduleSection).date).toBe(schedule.next!);
    const nhl = await (await get('/screens/sports?league=nhl')).json() as V.Screen;
    const live = nhl.sections.find(section => section.id === 'live') as V.EventsSection;
    expect(live.events.every(event => event.league.id === 'nhl')).toBe(true);
    expect((await get('/screens/nope')).status).toBe(404);
  });

  test('a game detail carries tables, plays and a probability series; an F1 event ranks drivers', async () => {
    const detail = await (await get(`/live/events/${encodeURIComponent(NFL)}`)).json() as V.LiveEventDetail;
    expect(detail.tables[0]!.columns).toEqual(['Team', 'Q1', 'Q2', 'Q3', 'Q4', 'T']);
    expect(detail.plays.some(play => play.emphasis === 'score')).toBe(true);
    expect(detail.probabilitySeries.length).toBeGreaterThan(5);
    const f1 = await (await get('/live/events?ids=sports:sports:f1-las-vegas')).json() as V.LiveEventsResponse;
    expect(f1.events[0]!.competitors).toEqual([]);
    expect(f1.events[0]!.ranking![0]!.pos).toBe(1);
  });

  test('a spoiler-free event withholds scores until revealed', async () => {
    const id = encodeURIComponent('sports:sports:epl-che-mci');
    const hidden = await (await get(`/live/events/${id}`)).json() as V.LiveEventDetail;
    expect(hidden.spoiler).toBe(true);
    expect(hidden.competitors.every(c => c.score === undefined && c.winner === undefined)).toBe(true);
    expect(hidden.plays).toEqual([]);
    const revealed = await (await send('POST', `/live/events/${id}/reveal`)).json() as V.LiveEventDetail;
    expect(revealed.spoiler).toBeUndefined();
    expect(revealed.competitors.map(c => c.score)).toEqual(['1', '3']);
  });

  test('the live stream pushes changed events for what it subscribes to', async () => {
    const events = await readStream(`/live/stream?events=${encodeURIComponent(NFL)}`, seen => seen.filter(e => e.event === 'update').length >= 3);
    const updates = events.filter(event => event.event === 'update').map(event => event.data as V.LiveStreamUpdate);
    expect(updates.every(update => update.events.every(event => event.id === NFL))).toBe(true);
    const stamps = new Set(updates.flatMap(update => update.events.map(event => event.updatedAt)));
    expect(stamps.size).toBeGreaterThan(1);
  });

  test('alerts reach a stream that asks for them', async () => {
    const reading = readStream('/live/stream?alerts=1', seen => seen.some(e => e.event === 'alert'));
    await Bun.sleep(100);
    await fetch(`${mock.url}/__admin/sports`, { method: 'POST', body: JSON.stringify({ alert: { kind: 'close', eventId: 'sports:sports:nhl-tor-mtl' } }) });
    const alert = (await reading).find(e => e.event === 'alert')!.data as V.LiveAlert;
    expect(alert).toMatchObject({ kind: 'close', eventId: 'sports:sports:nhl-tor-mtl', title: 'Close game' });
  });

  test('entity favourites are kept per viewer', async () => {
    const before = await (await get('/live/entities?league=nba')).json() as V.LiveEntitiesResponse;
    const celtics = before.entities.find(entity => entity.abbr === 'BOS')!;
    expect(celtics.favorite).toBe(false);
    expect((await send('PUT', `/favorites/entities/${encodeURIComponent(celtics.key!)}`)).status).toBe(200);
    const after = await (await get('/live/entities?league=nba&q=celt')).json() as V.LiveEntitiesResponse;
    expect(after.entities).toHaveLength(1);
    expect(after.entities[0]!.favorite).toBe(true);
    expect((await send('DELETE', `/favorites/entities/${encodeURIComponent(celtics.key!)}`)).status).toBe(200);
  });

  test('the ticker lists live events', async () => {
    const ticker = await (await get('/live/ticker?screen=sports')).json() as V.LiveEventsResponse;
    expect(ticker.events.some(event => event.status.state === 'in')).toBe(true);
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
