// The mock's scrub thumbnails: offered on a fixture plan once generated, and each sheet served only
// to the owning session with the protocol's private, revalidated caching.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import type * as V from '../../packages/protocol/types';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { launchMock, type RunningMock } from './launch';
import { mediaRoot } from '../media';
import { trickplayDir } from '../trickplay';

// Needs the generated fixture and its sheets (scripts/make-media.ts, scripts/make-trickplay.ts); CI has neither.
const generated = existsSync(join(mediaRoot, 'master.m3u8')) && existsSync(join(trickplayDir, '0.jpg'));
const device: V.Device = { id: 'trickplay-device', name: 'Test', platform: 'web', appVersion: '0.1.0' };
let mock: RunningMock;
let keys = 0;
beforeAll(async () => { if (generated) mock = await launchMock(); });
afterAll(async () => { await mock?.stop(); });

const call = (path: string, init: RequestInit = {}) => fetch(`${mock.url}/vela/v0${path}`, init);
const post = (path: string, body: object, headers: Record<string, string> = {}) =>
  call(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ idempotencyKey: `tp-${++keys}`, ...body }) });

test.skipIf(!generated)('a fixture plan offers its thumbnails and the owner reads each sheet, revalidated by ETag', async () => {
  const tokens = await (await post('/auth/sign-in', { username: 'demo', password: 'vela', device })).json() as V.Tokens;
  const auth = { Authorization: `Bearer ${tokens.accessToken}`, 'X-Vela-Device-Id': device.id };
  const client = { device, protocolVersions: [0], containers: [], videoCodecs: [], audioCodecs: [], subtitleFormats: [], hls: true, mse: false };
  const plan = await (await post('/playback', { titleId: 'title-1-2', client }, auth)).json() as V.PlaybackPlan;
  try {
    expect(plan.trickplay).toEqual({ width: 320, height: 180, intervalMs: 1000, count: 180, cols: 10, rows: 10, coverageUntilMs: 180_000, revision: 1 });
    const path = `/sessions/${plan.sessionId}/trickplay/320`;
    const first = await call(`${path}/1.jpg`, { headers: auth });
    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toBe('image/jpeg');
    expect(first.headers.get('cache-control')).toBe('private, no-cache');
    const bytes = new Uint8Array(await first.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
    const etag = first.headers.get('etag')!;
    expect((await call(`${path}/1.jpg`, { headers: { ...auth, 'If-None-Match': etag } })).status).toBe(304);
    // Past the last sheet, another width, or without the session's credentials: nothing.
    expect((await call(`${path}/2.jpg`, { headers: auth })).status).toBe(404);
    expect((await call(`/sessions/${plan.sessionId}/trickplay/160/0.jpg`, { headers: auth })).status).toBe(404);
    expect((await call(`${path}/0.jpg`)).status).toBe(401);
  } finally {
    await post(`/sessions/${plan.sessionId}/commands`, { kind: 'stop', sourceGeneration: plan.sourceGeneration, seekGeneration: plan.seekGeneration }, auth);
  }
});
