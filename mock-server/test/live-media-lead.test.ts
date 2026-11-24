// The live fault mediaLeadSeconds: a segment's media starts that much later than its playlist time,
// the way a lab relay starting from its backlog published it. Players must not park in front of it.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type * as V from '../../packages/protocol/types';
import { launchMock, type RunningMock } from './launch';
import { mediaRoot } from '../media';

// Starting playback needs the generated HLS fixture (mock-server/scripts/make-media.ts); CI has none.
const mediaGenerated = existsSync(join(mediaRoot, 'master.m3u8'));
const device: V.Device = { id: 'media-lead-device', name: 'Test', platform: 'web', appVersion: '0.1.0' };
const client = { device, protocolVersions: [0], containers: ['mp4'], videoCodecs: ['h264'], audioCodecs: ['aac'], subtitleFormats: ['webvtt'], hls: true, mse: true };
let mock: RunningMock;
let tokens: V.Tokens;

const call = (path: string, init: RequestInit = {}) => fetch(`${mock.url}/vela/v0${path}`, {
  ...init, headers: { 'Content-Type': 'application/json', ...(tokens ? { Authorization: `Bearer ${tokens.accessToken}`, 'X-Vela-Device-Id': device.id } : {}), ...init.headers } });
const post = (path: string, body: object) => call(path, { method: 'POST', body: JSON.stringify(body) });

beforeAll(async () => {
  mock = await launchMock();
  tokens = await (await post('/auth/sign-in', { username: 'demo', password: 'vela', device, idempotencyKey: 'lead-sign-in' })).json() as V.Tokens;
});
afterAll(async () => { await mock?.stop(); });

/** Decode time of the first fragment's first track, in seconds, given the init's timescales. */
function firstDecodeSeconds(init: Uint8Array, segment: Uint8Array): number {
  const scales = new Map<number, number>();
  const find = (bytes: Uint8Array, type: string, from = 0) => {
    for (let i = from; i + 4 <= bytes.length; i++) if (String.fromCharCode(...bytes.subarray(i, i + 4)) === type) return i;
    return -1;
  };
  const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = find(init, 'tkhd'); at >= 0; at = find(init, 'tkhd', at + 4)) {
    const v = init[at + 4], id = view(init).getUint32(at + (v === 1 ? 24 : 16));
    const mdhd = find(init, 'mdhd', at), mv = init[mdhd + 4];
    scales.set(id, view(init).getUint32(mdhd + (mv === 1 ? 24 : 16)));
  }
  const tfhd = find(segment, 'tfhd'), track = view(segment).getUint32(tfhd + 8);
  const tfdt = find(segment, 'tfdt'), version = segment[tfdt + 4];
  const time = version === 1 ? Number(view(segment).getBigUint64(tfdt + 8)) : view(segment).getUint32(tfdt + 8);
  return time / scales.get(track)!;
}

test.skipIf(!mediaGenerated)('mediaLeadSeconds starts every live segment that much later than its playlist time', async () => {
  const channels = await (await call('/live/channels?limit=1')).json() as V.Page<V.Channel>;
  const plan = await (await post('/playback', { channelId: channels.items[0]!.id, client, idempotencyKey: 'lead-tune' })).json() as V.PlaybackPlan;
  const live = new URL(plan.paths[0]!.url ?? '', mock.url);
  const variant = new URL('v360/index.m3u8', live);
  const playlist = await (await fetch(variant)).text();
  const segment = new URL(playlist.trim().split('\n').at(-1)!, variant);
  const init = new Uint8Array(await (await fetch(new URL('init.mp4', variant))).arrayBuffer());
  const decodeAt = async () => firstDecodeSeconds(init, new Uint8Array(await (await fetch(segment)).arrayBuffer()));
  const faults = (body: object) => fetch(`${mock.url}/__admin/live-faults`, { method: 'POST', body: JSON.stringify(body) });

  const onTime = await decodeAt();
  await faults({ mediaLeadSeconds: 5 });
  try {
    expect(await decodeAt()).toBeCloseTo(onTime + 5, 2);
    // The playlist itself is unchanged: it still says the segment starts where it did.
    expect(await (await fetch(variant)).text()).toContain(segment.pathname.split('/').at(-1)!);
  } finally {
    await faults({ mediaLeadSeconds: 0 });
  }
  expect(await decodeAt()).toBeCloseTo(onTime, 2);
});
