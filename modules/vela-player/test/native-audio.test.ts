import { expect, test } from 'bun:test';
import type { PlayerCapabilities } from '@vela/player-api';
import {
  audioEvents, createNativeAudioEngine, extrapolatedPosition, withAudioPlayback,
  type AudioEngineEvent, type NativeAudioBridge, type NativeAudioEvent, type NativeAudioState,
} from '../src/audio';

function fakeBridge() {
  const calls: unknown[][] = [];
  let listener: ((event: NativeAudioEvent) => void) | undefined;
  const bridge: NativeAudioBridge = {
    load: request => calls.push(['load', request]),
    play: () => calls.push(['play']),
    pause: () => calls.push(['pause']),
    seek: seconds => calls.push(['seek', seconds]),
    setRate: rate => calls.push(['setRate', rate]),
    unload: () => calls.push(['unload']),
    nowPlaying: info => calls.push(['nowPlaying', info]),
    subscribe(next) { listener = next; return () => { listener = undefined; }; },
  };
  return { bridge, calls, send: (event: NativeAudioEvent) => listener?.(event) };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const status = (id: number, state: NativeAudioState, position = 0, duration = 0) => ({ id, type: 'status' as const, state, position, duration });

test('native states become the store events the web element fires', () => {
  const at = (state: NativeAudioState, position = 0, duration = 0) => ({ state, position, duration });
  expect(audioEvents(at('loading'), at('playing', 0, 200))).toEqual(['duration', 'playing', 'time']);
  expect(audioEvents(at('playing', 1, 200), at('playing', 1.5, 200))).toEqual(['time']);
  expect(audioEvents(at('playing', 3, 200), at('paused', 3, 200))).toEqual(['paused']);
  expect(audioEvents(at('playing', 3, 200), at('buffering', 3, 200))).toEqual(['waiting']);
  expect(audioEvents(at('playing', 199, 200), at('ended', 200, 200))).toEqual(['ended']);
  expect(audioEvents(at('playing', 9, 200), at('failed', 9, 200))).toEqual(['error']);
  // A seek while paused moves the clock without starting it.
  expect(audioEvents(at('paused', 3, 200), at('paused', 60, 200))).toEqual(['time']);
  // Loading reports no transition of its own (the store already shows it).
  expect(audioEvents(at('idle'), at('loading'))).toEqual([]);
});

test('the position moves at the rate between reports while playing, and stops at the end', () => {
  const base = { state: 'playing' as const, position: 10, duration: 100, rate: 1.5, at: 1000 };
  expect(extrapolatedPosition(base, 2000)).toBe(11.5);
  expect(extrapolatedPosition({ ...base, state: 'paused' }, 3000)).toBe(10);
  expect(extrapolatedPosition({ ...base, position: 99 }, 2000)).toBe(100);
  expect(extrapolatedPosition({ ...base, duration: 0 }, 2000)).toBe(11.5);
  // At most a second and a half past the last report (the native players report twice a second),
  // and not at all before the clock was seen moving.
  expect(extrapolatedPosition(base, 9000)).toBe(12.25);
  expect(extrapolatedPosition({ ...base, moving: false }, 2000)).toBe(10);
});

test('a load waits for its authorization, and play follows it in order', async () => {
  const { bridge, calls } = fakeBridge();
  let grant: (value: { origin: string; pathPrefix: string; headers: Record<string, string> } | null) => void = () => {};
  const engine = createNativeAudioEngine(bridge, { authorize: () => new Promise(resolve => { grant = resolve; }) });
  engine.load('https://jf.example/Audio/1/stream', 42, 1.25);
  engine.play();
  await flush();
  expect(calls).toEqual([]);
  // Until the native player reports, the store sees where the item starts.
  expect(engine.position()).toBe(42);
  grant({ origin: 'https://jf.example', pathPrefix: '/', headers: { 'X-Emby-Token': 't' } });
  await flush();
  expect(calls).toEqual([
    ['load', { id: 1, url: 'https://jf.example/Audio/1/stream', access: { origin: 'https://jf.example', pathPrefix: '/', headers: { 'X-Emby-Token': 't' } }, start: 42, rate: 1.25 }],
    ['play'],
  ]);
});

test('a superseded load never reaches the native player, and its late events are ignored', async () => {
  const { bridge, calls, send } = fakeBridge();
  const engine = createNativeAudioEngine(bridge);
  const events: AudioEngineEvent[] = [];
  engine.subscribe(event => events.push(event));
  engine.load('https://ether.example/a.flac', 0, 1);
  engine.unload();
  engine.load('https://ether.example/b.mp3', 0, 1);
  await flush();
  const loads = calls.filter(call => call[0] === 'load').map(call => call[1] as { url: string; id: number });
  expect(loads.map(load => load.url)).toEqual(['https://ether.example/b.mp3']);
  send(status(1, 'ended', 180, 180));
  expect(events).toEqual([]);
  send(status(loads[0]!.id, 'playing', 0.5, 200));
  expect(events).toEqual(['duration', 'playing', 'time']);
  expect(engine.duration()).toBe(200);
});

test('after unload nothing the native player says reaches the store', async () => {
  const { bridge, send } = fakeBridge();
  const engine = createNativeAudioEngine(bridge);
  const events: AudioEngineEvent[] = [];
  engine.subscribe(event => events.push(event));
  engine.load('https://ether.example/a.flac', 0, 1);
  await flush();
  engine.unload();
  send(status(1, 'paused', 3, 100));
  expect(events).toEqual([]);
  expect(engine.position()).toBe(0);
});

test('a failed status carries its reason; a build without the native player fails like any playback error', async () => {
  const { bridge, send } = fakeBridge();
  const engine = createNativeAudioEngine(bridge);
  const events: AudioEngineEvent[] = [];
  engine.subscribe(event => events.push(event));
  engine.load('https://ether.example/a.flac', 0, 1);
  await flush();
  send({ ...status(1, 'failed'), error: 'This audio format cannot be played on this device.' });
  expect(events).toEqual(['error']);
  expect(engine.error()).toBe('This audio format cannot be played on this device.');

  const missing = createNativeAudioEngine({ ...bridge, load: () => { throw new Error('Audio playback is unavailable in this build of Vela'); } });
  const failures: AudioEngineEvent[] = [];
  missing.subscribe(event => failures.push(event));
  missing.load('https://ether.example/a.flac', 0, 1);
  await flush();
  expect(failures).toEqual(['error']);
  expect(missing.error()).toBe('Audio playback is unavailable in this build of Vela');
});

test("the system's media commands go to the remote handler, whatever load they name", () => {
  const { bridge, send } = fakeBridge();
  const remote: unknown[] = [];
  createNativeAudioEngine(bridge, { onRemote: (command, seconds) => remote.push([command, seconds]) });
  send({ id: 7, type: 'remote', command: 'next' });
  send({ id: 0, type: 'remote', command: 'skip', seconds: -15 });
  expect(remote).toEqual([['next', undefined], ['skip', -15]]);
});

test('a seek and a speed change move the clock at once', async () => {
  const { bridge, calls, send } = fakeBridge();
  let now = 0;
  const engine = createNativeAudioEngine(bridge, { now: () => now });
  engine.load('https://ether.example/book.m4b', 0, 1);
  await flush();
  send(status(1, 'playing', 10, 3600));
  now = 1000;
  expect(engine.position()).toBe(11);
  engine.setRate(2);
  now = 2000;
  expect(engine.position()).toBe(13);
  engine.seek(600);
  expect(engine.position()).toBe(600);
  await flush();
  expect(calls.slice(-2)).toEqual([['setRate', 2], ['seek', 600]]);
});

const base: PlayerCapabilities = { containers: ['mp4'], videoCodecs: ['h264'], audioCodecs: ['aac', 'ac3', 'eac3'], subtitleFormats: [], hls: true, mse: false };

test('Apple declares what AVPlayer opens, lossless included, and leaves Ogg to the server', () => {
  const apple = withAudioPlayback(base, 'ios');
  expect(apple.audioCodecs).toEqual(['aac', 'ac3', 'eac3', 'mp3', 'alac', 'flac', 'pcm']);
  expect(apple.containers).toEqual(['mp4', 'mp3', 'aac', 'm4a', 'm4b', 'flac', 'wav']);
  expect(apple.audioCodecs).not.toContain('opus');
  expect(apple.audioCodecs).not.toContain('vorbis');
  expect(apple.containers).not.toContain('ogg');
  // Video declarations are untouched.
  expect(apple.videoCodecs).toEqual(['h264']);
  expect(apple.hls).toBe(true);
});

test('Android declares what Media3 and its FFmpeg extension open, Ogg and WebM included', () => {
  const android = withAudioPlayback(base, 'android');
  for (const codec of ['mp3', 'aac', 'alac', 'flac', 'opus', 'vorbis', 'pcm']) expect(android.audioCodecs).toContain(codec);
  for (const container of ['mp3', 'm4a', 'm4b', 'flac', 'ogg', 'webm', 'wav']) expect(android.containers).toContain(container);
  expect(new Set(android.audioCodecs).size).toBe(android.audioCodecs.length);
});

test('other platforms keep their declarations', () => {
  expect(withAudioPlayback(base, 'web')).toBe(base);
  expect(withAudioPlayback(base, 'windows')).toBe(base);
});

function gaplessBridge() {
  const fake = fakeBridge();
  const bridge: NativeAudioBridge = { ...fake.bridge, preload: request => fake.calls.push(['preload', request]) };
  return { ...fake, bridge };
}

test('a preload reaches the native player after its load, with its own id and authorization', async () => {
  const { bridge, calls } = gaplessBridge();
  const engine = createNativeAudioEngine(bridge, { authorize: async url => (url.includes('jf') ? { origin: 'https://jf.example', pathPrefix: '/', headers: { 'X-Emby-Token': 't' } } : null) });
  engine.load('https://jf.example/Audio/1/stream', 0, 1);
  engine.preload({ url: 'https://jf.example/Audio/2/stream', startSeconds: 0 });
  await flush();
  expect(calls).toEqual([
    ['load', { id: 1, url: 'https://jf.example/Audio/1/stream', access: { origin: 'https://jf.example', pathPrefix: '/', headers: { 'X-Emby-Token': 't' } }, start: 0, rate: 1 }],
    ['preload', { id: 2, url: 'https://jf.example/Audio/2/stream', access: { origin: 'https://jf.example', pathPrefix: '/', headers: { 'X-Emby-Token': 't' } }, start: 0 }],
  ]);
  engine.preload(null);
  await flush();
  expect(calls.at(-1)).toEqual(['preload', null]);
});

test('an advance switches the engine to the preloaded item: its events reach the store, the old ones no longer', async () => {
  const { bridge, send } = gaplessBridge();
  let now = 0;
  const engine = createNativeAudioEngine(bridge, { now: () => now });
  const events: AudioEngineEvent[] = [];
  engine.subscribe(event => events.push(event));
  engine.load('https://ether.example/1.flac', 0, 1);
  engine.preload({ url: 'https://ether.example/2.flac', startSeconds: 0 });
  await flush();
  send(status(1, 'playing', 199.5, 200));
  events.length = 0;
  send({ id: 2, type: 'advanced', position: 0.02, duration: 240 });
  expect(events).toEqual(['advanced']);
  expect(engine.duration()).toBe(240);
  // The new item's clock stands still for a moment after it takes over: the position waits for it.
  now = 1000;
  expect(engine.position()).toBeCloseTo(0.02, 5);
  // A late report from the finished item is not the new one's.
  send(status(1, 'ended', 200, 200));
  expect(events).toEqual(['advanced']);
  send(status(2, 'playing', 0.42, 240));
  expect(events).toEqual(['advanced', 'time']);
  expect(engine.position()).toBeCloseTo(0.42, 5);
  // Moving now: it runs on between reports.
  now = 1500;
  expect(engine.position()).toBeCloseTo(0.92, 5);
});

test('the position never runs ahead of a clock that stands still, and never goes back while playing', async () => {
  const { bridge, send } = gaplessBridge();
  let now = 0;
  const engine = createNativeAudioEngine(bridge, { now: () => now });
  engine.load('https://ether.example/1.flac', 0, 1);
  engine.preload({ url: 'https://ether.example/2.flac', startSeconds: 0 });
  await flush();
  send(status(1, 'playing', 199.5, 200));
  // The advance as iOS and tvOS played it: the clock stood at 0 for about a second.
  send({ id: 2, type: 'advanced', position: 0, duration: 240 });
  const seen: number[] = [];
  for (; now <= 1600; now += 100) {
    if (now === 600) send(status(2, 'playing', 0, 240));
    if (now === 1400) send(status(2, 'playing', 0.42, 240));
    seen.push(engine.position());
  }
  for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
  expect(Math.max(...seen)).toBeLessThan(0.7);
  // Reports a little behind what was shown (the extrapolation a touch ahead) do not move it back.
  send(status(2, 'playing', 0.9, 240));
  now += 400;
  const shown = engine.position();
  send(status(2, 'playing', shown - 0.2, 240));
  expect(engine.position()).toBeGreaterThanOrEqual(shown);
  // A clock that stops without saying so is extrapolated for a moment only.
  now += 10_000;
  expect(engine.position()).toBeLessThan(shown + 2);
  // Paused, the report is the position.
  send(status(2, 'paused', 3, 240));
  expect(engine.position()).toBe(3);
});

test("a status naming the preloaded item before its advance is the advance", async () => {
  const { bridge, send } = gaplessBridge();
  const engine = createNativeAudioEngine(bridge);
  const events: AudioEngineEvent[] = [];
  engine.subscribe(event => events.push(event));
  engine.load('https://ether.example/1.flac', 0, 1);
  engine.preload({ url: 'https://ether.example/2.flac', startSeconds: 0 });
  await flush();
  send(status(2, 'playing', 0.4, 180));
  expect(events).toEqual(['advanced', 'time']);
  expect(engine.duration()).toBe(180);
  send({ id: 2, type: 'advanced' });
  expect(events).toEqual(['advanced', 'time']);
});

test('a dropped or replaced preload never advances, and a load forgets it', async () => {
  const { bridge, calls, send } = gaplessBridge();
  const engine = createNativeAudioEngine(bridge);
  const events: AudioEngineEvent[] = [];
  engine.subscribe(event => events.push(event));
  engine.load('https://ether.example/1.flac', 0, 1);
  engine.preload({ url: 'https://ether.example/2.flac', startSeconds: 0 });
  engine.preload({ url: 'https://ether.example/9.flac', startSeconds: 0 });
  await flush();
  // The replaced one never reached the native player.
  expect(calls.filter(call => call[0] === 'preload').map(call => (call[1] as { id: number }).id)).toEqual([3]);
  send({ id: 2, type: 'advanced' });
  expect(events).toEqual([]);
  engine.load('https://ether.example/5.flac', 0, 1);
  await flush();
  send({ id: 3, type: 'advanced' });
  expect(events).toEqual([]);
});

test('a native player without preload takes none', async () => {
  const { bridge, calls } = fakeBridge();
  const engine = createNativeAudioEngine(bridge);
  engine.load('https://ether.example/1.flac', 0, 1);
  engine.preload({ url: 'https://ether.example/2.flac', startSeconds: 0 });
  await flush();
  expect(calls.map(call => call[0])).toEqual(['load']);
});
