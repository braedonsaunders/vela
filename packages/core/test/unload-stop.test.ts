import { afterEach, expect, test } from 'bun:test';
import { Playback, initialPlayback } from '../src/store/playback';
import { sendKeepalive, stopSessionsOnPageHide } from '../src/store/unload';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type { Generations, PlaybackPlan } from '../src/wire';
import type { UnloadRequest } from '../src/adapter/capabilities';
import { EtherAdapter } from '../src/adapter/ether';
import { PlexAdapter } from '../src/adapter/plex';
import { FakeCredentials, restoreFetch, routeFetch } from './helpers';

afterEach(restoreFetch);

const plan = (sessionId: string, more: Partial<PlaybackPlan> = {}) =>
  ({ sessionId, sourceGeneration: 0, seekGeneration: 0, state: 'playing', titleId: 't', paths: [], audioTracks: [], subtitleTracks: [], ...more }) as unknown as PlaybackPlan;

/** A store over a fake adapter that records what it is asked to stop on unload. */
function store(adapter: Record<string, unknown>) {
  const asked: [string, Generations][] = [];
  const full = { sessionSnapshot: async (id: string) => ({ plan: plan(id) }), unloadStop: (id: string, at: Generations) => {
    asked.push([id, at]);
    return [{ url: `https://server.example/stop/${id}`, method: 'POST' as const }];
  }, ...adapter };
  const session = { epoch: 0, onReset() {}, ready: async () => ({ adapter: full, plan: (p: PlaybackPlan) => p }), negotiate: async () => {}, client: {}, audioClient: {} };
  const box = new StateBox({ playback: initialPlayback } as VelaState);
  const playback = new Playback(box, session as unknown as Session, () => {}, () => {});
  return { playback, asked, box };
}

test('a page being unloaded stops, synchronously, the playing and prepared sessions this client opened', async () => {
  let started = 0;
  const { playback, asked } = store({
    startPlayback: async () => plan(started++ ? 'next' : 'playing'),
    command: async (id: string, c: Generations) => plan(id, { seekGeneration: c.seekGeneration + 1 }),
  });
  await playback.start({ kind: 'title', id: 't' });
  expect(await playback.prepare({ kind: 'title', id: 'u', audio: true })).toMatchObject({ sessionId: 'next' });
  // A seek moves the playing session's generations: the unload stop names the latest.
  await playback.command('playing', { kind: 'seek', positionSeconds: 9, sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'k' });
  const sent: UnloadRequest[] = [];
  expect(playback.stopOnUnload(r => sent.push(r))).toBe(2);
  expect(asked).toEqual([['playing', { sourceGeneration: 0, seekGeneration: 1 }], ['next', { sourceGeneration: 0, seekGeneration: 0 }]]);
  expect(sent.map(r => r.url)).toEqual(['https://server.example/stop/playing', 'https://server.example/stop/next']);
  // Each is stopped once.
  expect(playback.stopOnUnload(r => sent.push(r))).toBe(0);
});

test('a stop still waiting for its answer is sent again on unload; an answered one is not', async () => {
  const answers = new Map<string, (p: PlaybackPlan) => void>();
  let started = 0;
  const { playback, asked } = store({
    startPlayback: async () => plan(`s${++started}`),
    command: (id: string) => new Promise<PlaybackPlan>(r => { answers.set(id, r); }),
    detail: async () => ({ title: {} }),
  });
  await playback.start({ kind: 'title', id: 't' });
  void playback.stop();
  await new Promise(r => setTimeout(r, 0));
  expect(playback.stopOnUnload(() => {})).toBe(1);
  expect(asked.map(([id]) => id)).toEqual(['s1']);

  await playback.start({ kind: 'title', id: 't2' });
  const second = playback.stop();
  await new Promise(r => setTimeout(r, 0));
  answers.get('s2')!(plan('s2', { state: 'ended' }));
  await second;
  expect(playback.stopOnUnload(() => {})).toBe(0);
});

test('an attached session stays its owner\'s; a live session started for an owner is held until the owner stops it', async () => {
  const { playback, asked } = store({ startPlayback: async () => plan('live'), command: async (id: string) => plan(id, { state: 'ended' }) });
  await playback.attach({ kind: 'channel', id: 'c' }, plan('owned-elsewhere'));
  expect(playback.stopOnUnload(() => {})).toBe(0);
  await playback.server.startPlayback({ channelId: 'c' } as never);
  expect(playback.stopOnUnload(() => {})).toBe(1);
  expect(asked.map(([id]) => id)).toEqual(['live']);
  await playback.server.startPlayback({ channelId: 'c' } as never);
  await playback.server.command('live', { kind: 'stop', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'x' });
  expect(playback.stopOnUnload(() => {})).toBe(0);
});

test('an ended session, or an adapter that cannot stop on unload, sends nothing and throws nothing', async () => {
  // The server answered a command with the session ended: nothing is left to stop.
  const ended = store({ startPlayback: async () => plan('s'), command: async () => plan('s', { state: 'ended' }) });
  await ended.playback.start({ kind: 'title', id: 't' });
  await ended.playback.command('s', { kind: 'pause', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'p' }).catch(() => {});
  expect(ended.playback.stopOnUnload(() => {})).toBe(0);
  expect(ended.asked).toEqual([]);
  const { playback } = store({ startPlayback: async () => plan('s'), command: async () => plan('s'), unloadStop: undefined });
  await playback.start({ kind: 'title', id: 't' });
  expect(playback.stopOnUnload(() => { throw new Error('unreachable'); })).toBe(0);
  const failing = store({ startPlayback: async () => plan('s'), command: async () => plan('s'), unloadStop: () => { throw new Error('no token'); } });
  await failing.playback.start({ kind: 'title', id: 't' });
  expect(failing.playback.stopOnUnload(() => {})).toBe(0);
});

test('only pagehide stops: a hidden page (another tab, a locked screen) plays on', () => {
  const page = new EventTarget();
  const calls: string[] = [];
  const playback = { stopOnUnload: (send: (r: UnloadRequest) => void) => { send({ url: 'u', method: 'POST' }); return 1; } };
  const remove = stopSessionsOnPageHide(page, playback, r => calls.push(r.url));
  page.dispatchEvent(new Event('visibilitychange'));
  page.dispatchEvent(new Event('freeze'));
  expect(calls).toEqual([]);
  page.dispatchEvent(new Event('pagehide'));
  expect(calls).toEqual(['u']);
  remove();
  page.dispatchEvent(new Event('pagehide'));
  expect(calls).toEqual(['u']);
});

test('an unload request is fired with keepalive and never throws', () => {
  const seen: [string, RequestInit][] = [];
  sendKeepalive({ url: 'https://s.example/a', method: 'POST', headers: { Authorization: 'Bearer t' }, body: '{}' }, async (url, init) => { seen.push([url, init]); });
  expect(seen).toEqual([['https://s.example/a', { method: 'POST', headers: { Authorization: 'Bearer t' }, body: '{}', keepalive: true, credentials: 'omit', redirect: 'error', cache: 'no-store' }]]);
  expect(() => sendKeepalive({ url: 'u', method: 'GET' }, () => { throw new TypeError('blocked'); })).not.toThrow();
  expect(() => sendKeepalive({ url: 'u', method: 'GET' }, () => Promise.reject(new TypeError('offline')))).not.toThrow();
});

test('Ether stops on unload with the stop command, authorised as its last request was', async () => {
  const ORIGIN = 'https://ether.example';
  const adapter = new EtherAdapter(ORIGIN, new FakeCredentials(), 'test');
  expect(adapter.unloadStop('s1', { sourceGeneration: 1, seekGeneration: 2 })).toEqual([]);
  routeFetch({ 'GET /vela/v0/sessions/s1': { plan: plan('s1') } });
  await adapter.sessionSnapshot('s1');
  expect(adapter.unloadStop('s1', { sourceGeneration: 1, seekGeneration: 2 })).toEqual([{
    url: `${ORIGIN}/vela/v0/sessions/s1/commands`, method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-1', 'X-Vela-Device-Id': 'device-test' },
    body: JSON.stringify({ kind: 'stop', sourceGeneration: 1, seekGeneration: 2, idempotencyKey: 'unload-s1-1-2' }),
  }]);
});

test('Plex stops on unload with the timeline stopped and the transcode stop, its token in the query', async () => {
  const ORIGIN = 'https://plex.example:32400';
  const plex = new PlexAdapter({ origin: ORIGIN, credentials: new FakeCredentials(), clientIdentifier: 'client-1' });
  const movie = { ratingKey: '5', type: 'movie', title: 'One', duration: 60000, Media: [{ id: 1, container: 'mp4', videoCodec: 'h264', audioCodec: 'aac',
    Part: [{ id: 11, key: '/library/parts/11/1/file.mp4', size: 10 }] }] };
  const track = { ratingKey: '9', type: 'track', title: 'Opening', duration: 25051, Media: [{ id: 5, container: 'mp3', audioCodec: 'mp3', Part: [{ id: 6, key: '/library/parts/6/1/file.mp3' }] }] };
  routeFetch({ 'GET /library/sections': { MediaContainer: { Directory: [{ key: 1, type: 'movie', title: 'Movies' }, { key: 2, type: 'artist', title: 'Music' }] } },
    'GET /library/metadata/5': { MediaContainer: { librarySectionID: 1, Metadata: [movie] } }, 'GET /library/metadata/9': { MediaContainer: { librarySectionID: 2, Metadata: [track] } } });
  const client = { device: { id: 'd', name: 'd', platform: 'web', appVersion: '1' }, containers: ['mp4', 'mp3'], videoCodecs: ['h264'], audioCodecs: ['aac', 'mp3'], subtitleFormats: [], hls: false, mse: false } as never;
  expect(plex.unloadStop('nothing', { sourceGeneration: 0, seekGeneration: 0 })).toEqual([]);
  const video = await plex.startPlayback({ titleId: '5', client, idempotencyKey: 'v', positionSeconds: 12 } as never) as PlaybackPlan;
  const requests = plex.unloadStop(video.sessionId, video);
  expect(requests.map(r => [r.method, new URL(r.url).pathname, r.headers, r.body])).toEqual([
    ['POST', '/:/timeline', undefined, undefined], ['GET', '/video/:/transcode/universal/stop', undefined, undefined]]);
  const [timeline, transcode] = requests.map(r => new URL(r.url).searchParams);
  expect([timeline!.get('state'), timeline!.get('ratingKey'), timeline!.get('time'), timeline!.get('session'), timeline!.get('X-Plex-Token'), timeline!.get('X-Plex-Client-Identifier')])
    .toEqual(['stopped', '5', '12000', video.sessionId, 'token-1', 'client-1']);
  expect([transcode!.get('session'), transcode!.get('X-Plex-Token')]).toEqual([video.sessionId, 'token-1']);
  // The session ended here too: a page brought back reports nothing more for it.
  expect(plex.unloadStop(video.sessionId, video)).toEqual([]);
  expect(await plex.reportObservation(video.sessionId, { sequence: 1, positionSeconds: 13, state: 'playing', sourceGeneration: 0, seekGeneration: 0 } as never)).toMatchObject({ accepted: true });
  const audio = await plex.startPlayback({ titleId: '9', client, idempotencyKey: 'a' } as never) as PlaybackPlan;
  expect(plex.unloadStop(audio.sessionId, audio).map(r => new URL(r.url).pathname)).toEqual(['/:/timeline', '/music/:/transcode/universal/stop']);
});
