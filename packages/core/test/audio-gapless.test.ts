import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Audio, initialAudio, preloadLead, type AudioEngine, type AudioEngineEvent, type AudioPreload, type AudioSound } from '../src/store/audio';
import { Playback, initialPlayback } from '../src/store/playback';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type { Card } from '../src/models';
import type { Loudness, PlaybackPlan } from '../src/wire';
import { DEFAULT_SOUND, withPreset } from '../src/audio/sound';

// Gapless playback: the next item's plan is asked for before the current item ends and handed to the
// engine, which goes straight on to it. The finished item's session reports its end once and stops;
// the prepared one becomes the playing session without another plan request.

const timers = new Map<number, { at: number; fire: () => unknown }>();
let now = 0, sequence = 0;
const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout, originalNow = Date.now;

beforeEach(() => {
  timers.clear(); now = 1_000_000; sequence = 0;
  globalThis.setTimeout = ((fire: () => unknown, ms = 0) => { const id = ++sequence; timers.set(id, { at: now + ms, fire }); return id; }) as never;
  globalThis.clearTimeout = ((id: number) => { timers.delete(id); }) as never;
  Date.now = () => now;
});
afterEach(() => { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; Date.now = originalNow; });

const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
async function advance(ms: number): Promise<void> {
  const end = now + ms;
  for (;;) {
    const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
    if (!due) break;
    timers.delete(due[0]); now = due[1].at; await due[1].fire(); await settle();
  }
  now = end;
}

const DURATION = 200;

function harness(options: { gapless?: boolean; rejectEnd?: boolean; duration?: number; buffered?: () => number; queued?: boolean; handover?: number; loudness?: Record<string, Loudness> } = {}) {
  const gapless = options.gapless ?? true;
  const duration = options.duration ?? DURATION;
  const starts: string[] = [], stops: string[] = [], loads: string[] = [];
  const requests: { titleId: string; queued?: boolean; client?: unknown }[] = [];
  /** Reports and stops in the order the server receives them. */
  const wire: string[] = [];
  const preloads: (AudioPreload | null)[] = [];
  const reports: { sessionId: string; state: string; position: number }[] = [];
  const titles = new Map<string, string>();
  const plan = (id: string, titleId: string): PlaybackPlan => ({
    sessionId: id, revision: 1, sourceGeneration: 1, seekGeneration: 1, titleId, state: 'ready', media: 'audio', positionSeconds: 0, durationSeconds: duration,
    ...(options.loudness?.[titleId] ? { loudness: options.loudness[titleId] } : {}),
    paths: [{ id: 'direct', kind: 'direct', transport: 'file', url: `/media/${id}`, mimeType: 'audio/flac', readiness: 'ready', qualities: [], boundaries: [] }],
    selectedPathId: 'direct', audioTracks: [], subtitleTracks: [], selectedSubtitleTrackId: null,
  } as unknown as PlaybackPlan);
  const adapter = {
    startPlayback: async (request: { titleId: string; queued?: boolean; client?: unknown }) => {
      starts.push(request.titleId);
      requests.push(request);
      const id = `s${starts.length}`;
      titles.set(id, request.titleId);
      return plan(id, request.titleId);
    },
    sessionSnapshot: async (id: string) => ({ plan: plan(id, titles.get(id) ?? 'x') }),
    command: async (id: string, command: { kind: string }) => { if (command.kind === 'stop') { stops.push(id); wire.push(`stop ${id}`); } return plan(id, titles.get(id) ?? 'x'); },
    reportObservation: async (sessionId: string, observation: { state: string; positionSeconds: number }) => {
      reports.push({ sessionId, state: observation.state, position: observation.positionSeconds });
      // A report takes a moment to land; the wire records when it has.
      await new Promise(resolve => setTimeout(resolve, 40));
      wire.push(`${observation.state} ${sessionId}`);
      if (options.rejectEnd && observation.state === 'ended') throw new Error('End report failed');
      return { accepted: true };
    },
    detail: async (id: string) => ({ title: { id, watch: { positionSeconds: 0 } } }),
  };
  const session = { epoch: 0, features: options.queued || options.handover ? { queuedPlayback: { available: true, ...(options.handover ? { handoverSeconds: options.handover } : {}) } } : {}, onReset() {}, ready: async () => ({ adapter, plan: (p: PlaybackPlan) => p }), negotiate: async () => {}, key: () => 'key', client: { engine: 'video' }, audioClient: { engine: 'audio' } };
  const box = new StateBox({ playback: initialPlayback, audio: initialAudio, auth: { phase: 'signed-in' } } as unknown as VelaState);
  /** What each stop asked to reconcile: the title and the media class the queue gave it. */
  const reconciled: string[] = [];
  const playback = new Playback(box, session as unknown as Session, () => {}, (watched, media) => { reconciled.push(`${watched.titleId}:${media}`); });
  const audio = new Audio(box, session as unknown as Session, playback, () => 0);
  const listeners = new Set<(event: AudioEngineEvent) => void>();
  const emit = (event: AudioEngineEvent) => { for (const l of [...listeners]) l(event); };
  let position = 0, playing = false;
  let queued: AudioPreload | null = null;
  const sounds: AudioSound[] = [];
  const engine: AudioEngine = {
    setSound(sound) { sounds.push(sound); },
    load(url, start) { loads.push(url); position = start; queued = null; },
    play() { playing = true; emit('playing'); },
    pause() { if (!playing) return; playing = false; emit('paused'); },
    seek(seconds) { position = seconds; },
    setRate() {},
    unload() { playing = false; queued = null; },
    position: () => position,
    duration: () => duration,
    // Fully buffered unless the test says how far.
    buffered: () => [{ startSeconds: 0, endSeconds: options.buffered ? options.buffered() : duration }],
    error: () => '',
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    ...(gapless ? { preload(next: AudioPreload | null) { preloads.push(next); queued = next; } } : {}),
  };
  audio.attach(engine);
  /** The engine plays on for `seconds`, reporting time four times a second; at the end it moves on
   * to the preloaded item (gapless) or ends. */
  const play = async (seconds: number) => {
    for (let i = 0; i < seconds * 4; i++) {
      if (playing) {
        position += 0.25;
        // A crossfade hands over at its start, `at` seconds in; a gapless join at the end.
        if (queued?.crossfade && position >= queued.crossfade.at) { loads.push(`crossfade:${queued.url}@${queued.crossfade.at}/${queued.crossfade.seconds}`); position = queued.startSeconds; queued = null; emit('advanced'); }
        else if (position >= duration) {
          if (queued) { loads.push(`advanced:${queued.url}`); position = queued.startSeconds; queued = null; emit('advanced'); }
          else { playing = false; emit('ended'); }
        } else emit('time');
      }
      await advance(250);
    }
  };
  const seek = (seconds: number) => { position = seconds; };
  const fail = () => { playing = false; emit('error'); };
  return { audio, box, starts, stops, loads, preloads, reports, requests, wire, reconciled, play, seek, fail, sounds, held: () => queued, isPlaying: () => playing };
}

const track = (id: string, cls = 'music') => ({ id, kind: 'episode', name: id, durationSeconds: DURATION, media: { class: cls } } as unknown as Card);
const tracks = (...ids: string[]) => ids.map(id => track(id));
const at = (h: ReturnType<typeof harness>) => h.box.get().audio;

test("every item's request, the first and the ones prepared ahead, declares the audio engine", async () => {
  const h = harness();
  h.audio.play({ items: tracks('t1', 't2', 't3'), index: 0 });
  await settle();
  await h.play(DURATION * 2 + 5);
  expect(h.requests.map(request => request.titleId)).toEqual(['t1', 't2', 't3']);
  expect(h.requests.every(request => (request.client as { engine: string }).engine === 'audio')).toBe(true);
});

test('the lead is twenty seconds, half a short item, never under four; six for spoken word', () => {
  expect(preloadLead(240)).toBe(20);
  expect(preloadLead(30)).toBe(15);
  expect(preloadLead(5)).toBe(4);
  expect(preloadLead(1800, true)).toBe(6);
});

// A server may keep one session per device and end the playing one when the next is asked for
// (Ether does): the next plan waits until the engine holds the rest of the playing item.
test('the next plan waits until the playing item is buffered to its end, or its last five seconds', async () => {
  let buffered = 150;
  const h = harness({ buffered: () => buffered });
  h.audio.play({ items: tracks('t1', 't2'), index: 0 });
  await settle();
  await h.play(185);
  expect(h.starts).toEqual(['t1']);
  buffered = 199.8;
  await h.play(1);
  expect(h.starts).toEqual(['t1', 't2']);

  let none = 0;
  const slow = harness({ buffered: () => none });
  slow.audio.play({ items: tracks('t1', 't2'), index: 0 });
  await settle();
  await slow.play(194);
  expect(slow.starts).toEqual(['t1']);
  await slow.play(2);
  expect(slow.starts).toEqual(['t1', 't2']);
});

test('the playing item reports where it is just before the next plan is asked for', async () => {
  const h = harness();
  h.audio.play({ items: tracks('t1', 't2'), index: 0 });
  await settle();
  await h.play(185);
  const before = h.reports.filter(r => r.sessionId === 's1');
  expect(before.at(-1)).toEqual({ sessionId: 's1', state: 'playing', position: 180 });
});

test('spoken word asks for the next part only in its last seconds', async () => {
  const h = harness();
  h.audio.play({ items: [track('p1', 'audiobook'), track('p2', 'audiobook')], index: 0 });
  await settle();
  await h.play(190);
  expect(h.starts).toEqual(['p1']);
  await h.play(5);
  expect(h.starts).toEqual(['p1', 'p2']);
  await h.play(10);
  expect(h.loads).toEqual(['/media/s1', 'advanced:/media/s2']);
});

test('an item that fails while the next is prepared plays on from where it was on a new session, once', async () => {
  const h = harness();
  h.audio.play({ items: tracks('t1', 't2'), index: 0 });
  await settle();
  await h.play(185);
  expect(h.starts).toEqual(['t1', 't2']);
  h.fail();
  await settle();
  // The prepared session goes back; t1 starts again at 180 s on a new session.
  expect(h.starts).toEqual(['t1', 't2', 't1']);
  expect(h.stops).toContain('s2');
  expect(h.loads.at(-1)).toBe('/media/s3');
  expect(at(h).phase).not.toBe('failed');
  await h.play(1);
  // Prepared again (buffered to the end), and a second failure on that session is shown.
  expect(h.starts).toEqual(['t1', 't2', 't1', 't2']);
  h.fail();
  await settle();
  expect(at(h).phase).toBe('failed');
});

test('the next item is planned twenty seconds before the end and played straight on', async () => {
  const h = harness();
  h.audio.play({ items: tracks('t1', 't2', 't3'), index: 0 });
  await settle();
  await h.play(170);
  expect(h.starts).toEqual(['t1']);
  await h.play(15);
  expect(h.starts).toEqual(['t1', 't2']);
  expect(h.held()).toEqual({ url: '/media/s2', startSeconds: 0 });
  await h.play(20);
  // Advanced: the queue moved, the prepared session plays, the finished one stopped once.
  expect(h.loads).toEqual(['/media/s1', 'advanced:/media/s2']);
  expect(at(h).queue?.at).toBe(1);
  expect(at(h).phase).toBe('playing');
  expect(h.box.get().playback.sessionId).toBe('s2');
  expect(h.starts).toEqual(['t1', 't2']);
  expect(h.stops).toEqual([]);
  // One end report for the finished item, at its end; nothing for it afterwards.
  const s1 = h.reports.filter(r => r.sessionId === 's1');
  expect(s1.filter(r => r.state === 'ended')).toEqual([{ sessionId: 's1', state: 'ended', position: DURATION }]);
  expect(s1.at(-1)?.state).toBe('ended');
  expect(h.reports.some(r => r.sessionId === 's2' && r.state === 'playing')).toBe(true);
  // The engine's position is now the new item's.
  expect(at(h).positionSeconds).toBeLessThan(10);
});

test('a whole album plays through with one plan request per track and no reloads', async () => {
  const h = harness();
  h.audio.play({ items: tracks('t1', 't2', 't3'), index: 0 });
  await settle();
  await h.play(DURATION * 3 + 5);
  expect(h.starts).toEqual(['t1', 't2', 't3']);
  expect(h.loads).toEqual(['/media/s1', 'advanced:/media/s2', 'advanced:/media/s3']);
  expect(h.stops).toEqual(['s3']);
  for (const id of ['s1', 's2', 's3']) expect(h.reports.filter(r => r.sessionId === id && r.state === 'ended')).toHaveLength(1);
  expect(at(h).phase).toBe('ended');
});

test('each stop tells the store the item\'s media class, so tracks can leave Home alone and audiobook parts do not', async () => {
  const album = harness();
  album.audio.play({ items: tracks('t1', 't2', 't3'), index: 0 });
  await settle();
  await album.play(DURATION * 3 + 5);
  expect(album.reconciled).toEqual(['t1:music', 't2:music', 't3:music']);

  const book = harness();
  book.audio.play({ items: [track('p1', 'audiobook'), track('p2', 'audiobook')], index: 0 });
  await settle();
  await book.play(DURATION + 5);
  void book.audio.stop();
  for (let i = 0; i < 4; i++) { await advance(250); await settle(); }
  expect(book.reconciled).toEqual(['p1:audiobook', 'p2:audiobook']);
});

test('the last item with repeat off prepares nothing', async () => {
  const h = harness();
  h.audio.play({ items: tracks('t1'), index: 0 });
  await settle();
  await h.play(195);
  expect(h.starts).toEqual(['t1']);
  expect(h.preloads).toEqual([]);
});

test('play next while the next item is prepared re-plans it', async () => {
  const h = harness();
  h.audio.play({ items: tracks('t1', 't2'), index: 0 });
  await settle();
  await h.play(185);
  expect(h.held()?.url).toBe('/media/s2');
  h.audio.playNext([track('t9')]);
  await settle();
  // t2's session goes back to the server; t9 is planned and handed to the engine instead.
  expect(h.stops).toEqual(['s2']);
  expect(h.starts).toEqual(['t1', 't2', 't9']);
  expect(h.preloads).toEqual([{ url: '/media/s2', startSeconds: 0 }, null, { url: '/media/s3', startSeconds: 0 }]);
  await h.play(20);
  expect(at(h).queue && at(h).queue!.items[at(h).queue!.order[at(h).queue!.at]!]!.id).toBe('t9');
  expect(h.box.get().playback.sessionId).toBe('s3');
});

test('removing, moving and shuffling re-plan only when the next item changes', async () => {
  const h = harness();
  h.audio.play({ items: tracks('t1', 't2', 't3', 't4'), index: 0 });
  await settle();
  await h.play(185);
  expect(h.held()?.url).toBe('/media/s2');
  // Moving t4 ahead of t3 leaves t2 next.
  h.audio.move(3, 2);
  await settle();
  expect(h.held()?.url).toBe('/media/s2');
  // Removing t2 makes t4 next.
  h.audio.remove(1);
  await settle();
  expect(h.stops).toEqual(['s2']);
  expect(h.starts.at(-1)).toBe('t4');
  expect(h.held()?.url).toBe('/media/s3');
});

test('repeat-one loops the item seamlessly on a new session', async () => {
  const h = harness();
  h.audio.play({ items: tracks('t1', 't2'), index: 0 });
  await settle();
  h.audio.cycleRepeat(); h.audio.cycleRepeat();
  expect(at(h).queue?.repeat).toBe('one');
  await h.play(DURATION + 2);
  expect(h.starts).toEqual(['t1', 't1']);
  expect(h.loads).toEqual(['/media/s1', 'advanced:/media/s2']);
  expect(at(h).queue?.at).toBe(0);
  expect(h.stops).toEqual([]);
});

test('turning repeat-one on near the end swaps the prepared item for the same one', async () => {
  const h = harness();
  h.audio.play({ items: tracks('t1', 't2'), index: 0 });
  await settle();
  await h.play(185);
  h.audio.cycleRepeat(); // all: t2 still next
  await settle();
  expect(h.held()?.url).toBe('/media/s2');
  h.audio.cycleRepeat(); // one: t1 again
  await settle();
  expect(h.stops).toEqual(['s2']);
  expect(h.starts).toEqual(['t1', 't2', 't1']);
  expect(h.held()?.url).toBe('/media/s3');
});

test('a sleep timer set for the end of the item prepares nothing and forgets what was prepared', async () => {
  const h = harness();
  h.audio.play({ items: tracks('t1', 't2'), index: 0 });
  await settle();
  await h.play(185);
  expect(h.held()?.url).toBe('/media/s2');
  h.audio.setSleep('item');
  await settle();
  expect(h.held()).toBeNull();
  expect(h.stops).toEqual(['s2']);
  await h.play(20);
  expect(at(h).phase).toBe('paused');
  expect(h.starts).toEqual(['t1', 't2']);
});

test('seeking far back gives the prepared session back; seeking near the end prepares at once', async () => {
  const h = harness();
  h.audio.play({ items: tracks('t1', 't2'), index: 0 });
  await settle();
  await h.play(185);
  expect(h.starts).toEqual(['t1', 't2']);
  h.seek(10); h.audio.seek(10);
  await settle();
  expect(h.stops).toEqual(['s2']);
  expect(h.held()).toBeNull();
  h.seek(195); h.audio.seek(195);
  await settle();
  expect(h.starts).toEqual(['t1', 't2', 't2']);
  expect(h.held()?.url).toBe('/media/s3');
  // A small seek back inside the window keeps it.
  h.seek(170); h.audio.seek(170);
  await settle();
  expect(h.held()?.url).toBe('/media/s3');
});

test('next while the next item is prepared plays it on its prepared session', async () => {
  const h = harness();
  h.audio.play({ items: tracks('t1', 't2'), index: 0 });
  await settle();
  await h.play(185);
  h.audio.next();
  await settle();
  expect(h.starts).toEqual(['t1', 't2']);
  expect(h.loads).toEqual(['/media/s1', '/media/s2']);
  expect(h.stops).toEqual(['s1']);
  expect(h.box.get().playback.sessionId).toBe('s2');
  expect(h.isPlaying()).toBe(true);
  // A skip is not a finish.
  expect(h.reports.some(r => r.sessionId === 's1' && r.state === 'ended')).toBe(false);
});

test('an engine without gapless playback still starts the next item on its prepared session', async () => {
  const h = harness({ gapless: false });
  h.audio.play({ items: tracks('t1', 't2'), index: 0 });
  await settle();
  await h.play(DURATION + 1);
  expect(h.starts).toEqual(['t1', 't2']);
  expect(h.loads).toEqual(['/media/s1', '/media/s2']);
  expect(h.stops).toEqual([]);
  expect(h.reports.filter(r => r.sessionId === 's1' && r.state === 'ended')).toHaveLength(1);
  expect(at(h).queue?.at).toBe(1);
});

test('stop releases the prepared session with the playing one', async () => {
  const h = harness();
  h.audio.play({ items: tracks('t1', 't2'), index: 0 });
  await settle();
  await h.play(185);
  const stopped = h.audio.stop();
  await settle();
  await advance(100);
  await stopped;
  await settle();
  expect([...h.stops].sort()).toEqual(['s1', 's2']);
  await advance(60_000);
  expect(h.starts).toEqual(['t1', 't2']);
});

test('short tracks prepare at half their length', async () => {
  const h = harness({ duration: 12 });
  h.audio.play({ items: tracks('t1', 't2', 't3'), index: 0 });
  await settle();
  await h.play(5);
  expect(h.starts).toEqual(['t1']);
  await h.play(2);
  expect(h.starts).toEqual(['t1', 't2']);
  await h.play(30);
  expect(h.loads).toEqual(['/media/s1', 'advanced:/media/s2', 'advanced:/media/s3']);
});

test('a server with queued sessions gets the next plan as queued, twenty seconds out, buffered or not', async () => {
  const h = harness({ queued: true, buffered: () => 30 });
  h.audio.play({ items: [track('p1', 'audiobook'), track('p2', 'audiobook')], index: 0 });
  await settle();
  await h.play(185);
  expect(h.starts).toEqual(['p1', 'p2']);
  expect(h.requests.map(r => !!r.queued)).toEqual([false, true]);
  await h.play(20);
  // Its first report once it plays is what takes the device over.
  expect(h.reports.find(r => r.sessionId === 's2')?.state).toBe('playing');
  // A server without them never sees the field.
  const plain = harness();
  plain.audio.play({ items: tracks('t1', 't2'), index: 0 });
  await settle();
  await plain.play(185);
  expect(plain.requests.every(r => r.queued === undefined)).toBe(true);
});

test("an accepted end report retires the finished session without a second stop", async () => {
  const h = harness({ queued: true });
  h.audio.play({ items: tracks('t1', 't2'), index: 0 });
  await settle();
  await h.play(DURATION + 1);
  const s1 = h.wire.filter(line => / s1$/.test(line));
  expect(s1.at(-1)).toBe('ended s1');
  expect(h.stops).toEqual([]);
  expect(h.wire).toContain('playing s2');
});

test('a failed end report still releases the outgoing session on handover', async () => {
  const h = harness({ queued: true, rejectEnd: true });
  h.audio.play({ items: tracks('t1', 't2'), index: 0 });
  await settle();
  await h.play(DURATION + 1);
  expect(h.wire.filter(line => line.endsWith(' s1')).slice(-2)).toEqual(['ended s1', 'stop s1']);
  expect(h.box.get().playback.sessionId).toBe('s2');
});

// Sound (docs/sound.md): levelling, the EQ and AutoMix's crossfade reach the engine.

const measured = (trackGainDb: number, fadeOutStartMs = 192_000): Loudness => ({ trackGainDb, trackPeak: 0.5, lufs: -18 - trackGainDb, reference: -18, source: 'measured',
  trim: { startMs: 300, endMs: 199_000, fadeInEndMs: 1000, fadeOutStartMs } });

test('the playing item is levelled by its plan loudness, and the EQ goes with it; a settings change applies at once', async () => {
  const h = harness({ loudness: { t1: measured(-6) } });
  h.audio.play({ items: tracks('t1', 't2'), index: 0 });
  await settle();
  expect(h.sounds.at(-1)!.gain).toBeCloseTo(10 ** (-6 / 20), 9);
  expect(h.sounds.at(-1)!.eq).toBeNull();
  h.audio.setSound(withPreset({ ...DEFAULT_SOUND, levelling: { ...DEFAULT_SOUND.levelling, mode: 'off' } }, 'rock'));
  expect(h.sounds.at(-1)!.gain).toBe(1);
  expect(h.sounds.at(-1)!.eq?.filters).toHaveLength(10);
});

test('the prepared item is handed with its own gain; a gapless join without AutoMix', async () => {
  const h = harness({ loudness: { t1: measured(-6), t2: measured(-9) } });
  h.audio.play({ items: tracks('t1', 't2'), index: 0 });
  await settle();
  await h.play(185);
  const handed = h.held()!;
  expect(handed.gain).toBeCloseTo(10 ** (-9 / 20), 9);
  expect(handed.crossfade).toBeUndefined();
});

test('AutoMix with a server that keeps the outgoing session: a crossfade at the fade-out, played out, then stopped', async () => {
  const h = harness({ handover: 15, buffered: () => 120, loudness: { t1: measured(-6), t2: measured(-6) } });
  h.audio.setSound({ ...DEFAULT_SOUND, automix: { ...DEFAULT_SOUND.automix, on: true } });
  h.audio.play({ items: tracks('t1', 't2'), index: 0 });
  await settle();
  await h.play(185);
  // The fade-out runs 192 to 199 s: seven seconds, from the incoming song's first sound (0.3 s).
  expect(h.held()).toMatchObject({ startSeconds: 0.3, crossfade: { seconds: 7, at: 192 } });
  await h.play(8);
  expect(h.loads.at(-1)).toBe('crossfade:/media/s2@192/7');
  expect(at(h).queue?.at).toBe(1);
  // The outgoing session's last report is where it was, playing: the takeover counts it as played.
  expect(h.reports.filter(r => r.sessionId === 's1').at(-1)).toMatchObject({ state: 'playing', position: 192 });
  expect(h.reports.some(r => r.sessionId === 's1' && r.state === 'ended')).toBe(false);
  // It plays out under the fade and stops once the fade is over.
  expect(h.stops).not.toContain('s1');
  await h.play(8);
  expect(h.stops).toContain('s1');
});

test('AutoMix without the handover crossfades only when the outgoing item is all in the engine, and ends it as gapless does', async () => {
  let buffered = 120;
  const partly = harness({ queued: true, buffered: () => buffered, loudness: { t1: measured(-6) } });
  partly.audio.setSound({ ...DEFAULT_SOUND, automix: { ...DEFAULT_SOUND.automix, on: true } });
  partly.audio.play({ items: tracks('t1', 't2'), index: 0 });
  await settle();
  await partly.play(185);
  expect(partly.held()?.crossfade).toBeUndefined();

  // Once it is all there, the crossfade is handed after all.
  buffered = 200;
  await partly.play(1);
  expect(partly.held()?.crossfade).toEqual({ seconds: 7, at: 192 });

  const whole = harness({ queued: true, loudness: { t1: measured(-6) } });
  whole.audio.setSound({ ...DEFAULT_SOUND, automix: { ...DEFAULT_SOUND.automix, on: true } });
  whole.audio.play({ items: tracks('t1', 't2'), index: 0 });
  await settle();
  await whole.play(185);
  expect(whole.held()?.crossfade).toEqual({ seconds: 7, at: 192 });
  await whole.play(8);
  expect(whole.reports.filter(r => r.sessionId === 's1').at(-1)).toMatchObject({ state: 'ended', position: DURATION });
  expect(whole.stops).not.toContain('s1');
});

test('an album played in order stays gapless with AutoMix on', async () => {
  const album = (id: string, index: number) => ({ ...track(id), media: { class: 'music', index, parents: [{ id: 'a1', name: 'A', role: 'album' }] } } as unknown as Card);
  const h = harness({ handover: 15, loudness: { t1: measured(-6) } });
  h.audio.setSound({ ...DEFAULT_SOUND, automix: { ...DEFAULT_SOUND.automix, on: true } });
  h.audio.play({ items: [album('t1', 1), album('t2', 2)], index: 0, source: { id: 'a1', name: 'A', kind: 'title' } });
  await settle();
  await h.play(185);
  expect(h.held()?.crossfade).toBeUndefined();
});
