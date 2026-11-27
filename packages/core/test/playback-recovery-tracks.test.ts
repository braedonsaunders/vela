import { expect, test } from 'bun:test';
import { VelaError } from '../src/adapter/errors';
import { Playback, initialPlayback } from '../src/store/playback';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type { PlaybackPlan, Track } from '../src/wire';
import type { SeriesTrackPreference } from '../src/series-tracks';
import type { SeriesTracks } from '../src/store/series-tracks';

const audio = (id: string, language: string, more: Partial<Track> = {}): Track => ({ id, kind: 'audio', language, name: '', codec: 'aac', ...more });
const subtitle = (id: string, language: string, more: Partial<Track> = {}): Track => ({ id, kind: 'subtitle', language, name: '', codec: 'srt', ...more });

/** `ether`: as on Ether, a track command must name the file's current generations and advances both. `unavailable`: the plan shows
 * its version as `version_unavailable`. */
interface File { source?: string; version?: string; generation?: number; seek?: number; revision?: number; position?: number; ether?: boolean; transcode?: boolean; unavailable?: boolean; audioTracks: Track[]; subtitleTracks: Track[]; selectedAudioTrackId?: string; selectedSubtitleTrackId?: string | null }

const stale = (file: File) => new VelaError({ class: 'conflict', code: 'stale_generation', message: 'stale generation',
  currentGenerations: { sourceGeneration: file.generation ?? 0, seekGeneration: file.seek ?? 0 }, retry: { allowed: false } } as never, 409);

const planOf = (sessionId: string, file: File): PlaybackPlan => ({
  sessionId, revision: file.revision ?? 1, state: 'playing', positionSeconds: file.position ?? 0, sourceGeneration: file.generation ?? 0, seekGeneration: file.seek ?? 0, chapters: [], fallback: { state: 'unsupported' },
  paths: [{ id: 'p', ...(file.transcode ? { kind: 'transcode', transport: 'hls', mimeType: 'application/vnd.apple.mpegurl' } as const : { kind: 'direct', transport: 'file', mimeType: 'video/mp4' } as const), readiness: 'ready', url: 'https://media.test/f', qualities: [], boundaries: [], ...(file.source ? { sourceId: file.source } : {}) }],
  selectedPathId: 'p', audioTracks: file.audioTracks, subtitleTracks: file.subtitleTracks,
  ...(file.selectedAudioTrackId ? { selectedAudioTrackId: file.selectedAudioTrackId } : {}), selectedSubtitleTrackId: file.selectedSubtitleTrackId ?? null,
  ...(file.version ? { selectedVersionId: file.version } : {}), ...(file.unavailable ? { sourceFailure: 'version_unavailable' } as const : {}),
});

interface Lab {
  playback: Playback; box: StateBox<VelaState>; commands: any[];
  /** The start requests sent. */
  starts: any[];
  /** The sessions a stop was sent to. */
  stops: string[];
  /** The stop commands sent, with the session each went to. */
  stopCommands: any[];
  /** What each session's server side currently plays (a track command changes it). */
  files: Map<string, File>;
  /** Fire the pending timers (all, or those of `ms`) and let the replies settle. */
  run(ms?: number): Promise<void>;
  /** Hold back the answers to version switches until `until` settles; the server has moved to the version meanwhile. */
  holdSwitch(until: Promise<unknown>): void;
}

/** A store whose sessions play `queue` in order; `refuse` makes the server refuse a track command or a version switch once the
 * promise it returns settles (one that settles with 'deliver' holds the request on its way and lets it reach the server then);
 * `answer` holds back the answer to a track command it takes until the promise it returns settles, and answers with the file that
 * promise gives, if any (the server took the command before it moved on); `series` is the viewer's
 * remembered choice for the series of every title; `versions` are the files a version switch can move a session to, by version id
 * (on Ether a switch must name the file's current generations; one to a version not listed is refused). */
async function lab(queue: File[], body: (lab: Lab) => Promise<void>, refuse: (command: any) => boolean | Promise<unknown> = () => false,
  answer: (command: any) => Promise<unknown> | undefined = () => undefined, series?: SeriesTrackPreference, versions?: Record<string, File>): Promise<void> {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  const timers = new Map<number, { fire: () => unknown; ms: number }>();
  let sequence = 0;
  globalThis.setTimeout = ((fire: () => unknown, ms = 0) => { const id = ++sequence; timers.set(id, { fire, ms }); return id; }) as never;
  globalThis.clearTimeout = ((id: number) => { timers.delete(id); }) as never;
  try {
    const commands: any[] = [];
    const starts: any[] = [];
    const stops: string[] = [];
    const stopCommands: any[] = [];
    let n = 0, switchHeld: Promise<unknown> | undefined;
    const files = new Map<string, File>();
    const plan = (id: string) => planOf(id, files.get(id)!);
    const tracks = async (id: string, c: any) => {
      commands.push(c);
      const refused = refuse(c);
      if (refused instanceof Promise) { if (await refused !== 'deliver') throw new Error('refused'); }
      else if (refused) throw new Error('refused');
      const now = files.get(id)!;
      if (now.ether) {
        // The server takes it at once; the answer may be held back.
        if (c.sourceGeneration !== (now.generation ?? 0) || c.seekGeneration !== (now.seek ?? 0)) throw stale(now);
        const taken = { ...now, generation: (now.generation ?? 0) + 1, seek: (now.seek ?? 0) + 1, revision: (now.revision ?? 1) + 1,
          ...(c.audioTrackId !== undefined ? { selectedAudioTrackId: c.audioTrackId } : {}),
          ...(c.subtitleTrackId !== undefined ? { selectedSubtitleTrackId: c.subtitleTrackId } : {}) };
        files.set(id, taken);
        await answer(c);
        return planOf(id, taken);
      }
      const file = files.get(id)!;
      files.set(id, { ...file, revision: (file.revision ?? 1) + 1,
        ...(c.audioTrackId !== undefined ? { selectedAudioTrackId: c.audioTrackId } : {}),
        ...(c.subtitleTrackId !== undefined ? { selectedSubtitleTrackId: c.subtitleTrackId } : {}) });
      const held = answer(c);
      const answered = held ? await held : undefined;
      if (answered && typeof answered === 'object' && 'audioTracks' in answered) return planOf(id, answered as File);
      return plan(id);
    };
    const adapter = {
      startPlayback: async (request: any) => { starts.push(request); const id = `s${++n}`; files.set(id, queue[n - 1]!); return plan(id); },
      sessionSnapshot: async (id: string) => ({ plan: plan(id) }),
      changeTracks: async (id: string, c: any) => tracks(id, c),
      command: async (id: string, c: any) => { if (c.kind === 'stop') { stops.push(id); stopCommands.push({ sessionId: id, ...c }); } return c.kind === 'tracks' ? tracks(id, c) : plan(id); },
      ...(versions ? { titleVersions: async () => [], clearVersionChoice: async () => {},
        switchVersion: async (id: string, c: any) => {
          const refused = refuse(c);
          if (refused instanceof Promise && await refused !== 'deliver') throw new Error('refused');
          const now = files.get(id)!;
          if (now.ether && (c.sourceGeneration !== (now.generation ?? 0) || c.seekGeneration !== (now.seek ?? 0))) throw stale(now);
          if (!versions[c.versionId]) throw new Error('refused');
          files.set(id, versions[c.versionId]!); const reply = plan(id); await switchHeld; return reply;
        } } : {}),
    };
    const session = { epoch: 0, onReset() {}, ready: async () => ({ adapter, plan: (p: PlaybackPlan) => p, record: { id: 'server' } }), negotiate: async () => {}, key: () => 'key', client: { audioCodecs: [] },
      ...(series ? { tokens: async () => ({ viewer: { id: 'viewer' } }) } : {}) };
    const box = new StateBox({ playback: initialPlayback, auth: { phase: 'signed-in' } } as VelaState);
    const seriesTracks = series ? { get: () => series, hasForViewer: () => true, rememberAudio() {}, rememberSubtitle() {} } as unknown as SeriesTracks : undefined;
    const playback = new Playback(box, session as unknown as Session, () => {}, () => {}, seriesTracks);
    const run = async (ms?: number) => {
      for (const [id, timer] of [...timers]) if (timers.has(id) && (ms === undefined || timer.ms === ms)) { timers.delete(id); await timer.fire(); }
      for (let i = 0; i < 20; i++) await Promise.resolve();
    };
    await body({ playback, box, commands, starts, stops, stopCommands, files, run, holdSwitch: until => { switchHeld = until; } });
    await playback.stop();
  } finally { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; }
}

/** Plays `first`, the viewer picks `choice`, the session fails and is replaced by one playing `second`: the track commands sent. */
async function recoverOnto(first: File, choice: { audioTrackId?: string; subtitleTrackId?: string | null }, second: File): Promise<any[]> {
  let sent: any[] = [];
  await lab([first, second], async ({ playback, box, commands, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', ...choice });
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    sent = commands.filter(c => c.kind === 'tracks');
  });
  return sent;
}

test('a replacement file that numbers its tracks differently keeps the chosen language', async () => {
  const first = { source: 'a', audioTracks: [audio('4', 'fra', { default: true }), audio('7', 'eng')], subtitleTracks: [], selectedAudioTrackId: '4' };
  // The new file's id 4 is English; French is 7 and is what the server already selected.
  const commands = await recoverOnto(first, { audioTrackId: '4', subtitleTrackId: null },
    { source: 'b', audioTracks: [audio('4', 'eng'), audio('7', 'fra', { default: true })], subtitleTracks: [], selectedAudioTrackId: '7' });
  expect(commands).toEqual([]);
  // Here the server picked English: the French track is asked for by its new id.
  const asked = await recoverOnto(first, { audioTrackId: '4', subtitleTrackId: null },
    { source: 'b', audioTracks: [audio('4', 'eng', { default: true }), audio('7', 'fra')], subtitleTracks: [], selectedAudioTrackId: '4' });
  expect(asked.map(c => c.audioTrackId)).toEqual(['7']);
});

test('two tracks in the chosen language on a new file leave the server\'s choice', async () => {
  // Main audio and commentary are both English; the old id 1 is the commentary on the new file.
  const commands = await recoverOnto(
    { source: 'a', audioTracks: [audio('1', 'eng', { default: true }), audio('2', 'eng')], subtitleTracks: [], selectedAudioTrackId: '1' },
    { audioTrackId: '1', subtitleTrackId: null },
    { source: 'b', audioTracks: [audio('1', 'eng'), audio('2', 'eng', { default: true })], subtitleTracks: [], selectedAudioTrackId: '2' });
  expect(commands).toEqual([]);
});

test('forced and hearing-impaired subtitles are matched by their flags on a new file', async () => {
  const first = { source: 'a', audioTracks: [audio('1', 'eng')], selectedAudioTrackId: '1',
    subtitleTracks: [subtitle('3', 'eng', { forced: true }), subtitle('5', 'eng'), subtitle('6', 'eng', { hearingImpaired: true })] };
  const forced = await recoverOnto(first, { audioTrackId: '1', subtitleTrackId: '3' },
    { source: 'b', audioTracks: [audio('1', 'eng')], selectedAudioTrackId: '1',
      subtitleTracks: [subtitle('3', 'eng'), subtitle('5', 'eng', { hearingImpaired: true }), subtitle('6', 'eng', { forced: true })] });
  expect(forced.map(c => c.subtitleTrackId)).toEqual(['6']);
  const sdh = await recoverOnto(first, { audioTrackId: '1', subtitleTrackId: '6' },
    { source: 'b', audioTracks: [audio('1', 'eng')], selectedAudioTrackId: '1',
      subtitleTracks: [subtitle('3', 'eng'), subtitle('5', 'eng', { hearingImpaired: true }), subtitle('6', 'eng', { forced: true })] });
  expect(sdh.map(c => c.subtitleTrackId)).toEqual(['5']);
  // A file whose only English subtitle is the full one never gets it in place of forced.
  const none = await recoverOnto(first, { audioTrackId: '1', subtitleTrackId: '3' },
    { source: 'b', audioTracks: [audio('1', 'eng')], selectedAudioTrackId: '1', subtitleTracks: [subtitle('3', 'eng')] });
  expect(none).toEqual([]);
});

test('a track of unknown language is not carried to a new file', async () => {
  const commands = await recoverOnto(
    { source: 'a', audioTracks: [audio('1', 'eng'), audio('2', '')], subtitleTracks: [], selectedAudioTrackId: '1' },
    { audioTrackId: '2', subtitleTrackId: null },
    { source: 'b', audioTracks: [audio('1', 'eng'), audio('2', '')], subtitleTracks: [], selectedAudioTrackId: '1' });
  expect(commands).toEqual([]);
});

test('subtitles off stay off on a new file', async () => {
  const commands = await recoverOnto(
    { source: 'a', audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('2', 'eng')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '2' },
    { audioTrackId: '1', subtitleTrackId: null },
    { source: 'b', audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('2', 'eng')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '2' });
  expect(commands.map(c => [c.audioTrackId, c.subtitleTrackId])).toEqual([[undefined, null]]);
});

test('the same file, or a file of unknown identity, keeps the chosen ids', async () => {
  const file = (source?: string) => ({ ...(source ? { source } : {}), audioTracks: [audio('1', 'eng', { default: true }), audio('2', 'eng')],
    subtitleTracks: [subtitle('3', 'eng'), subtitle('4', 'eng')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '3' });
  const same = await recoverOnto(file('a'), { audioTrackId: '2', subtitleTrackId: '4' }, file('a'));
  expect(same.map(c => [c.audioTrackId, c.subtitleTrackId])).toEqual([['2', '4']]);
  const unknown = await recoverOnto(file(), { audioTrackId: '2', subtitleTrackId: '4' }, file('b'));
  expect(unknown.map(c => [c.audioTrackId, c.subtitleTrackId])).toEqual([['2', '4']]);
});

test('a late snapshot from the session\'s previous source does not change the choice', async () => {
  // French is 4 on A; the session moves on to B, where 4 is English; A's last report comes in late.
  const a = { source: 'a', audioTracks: [audio('4', 'fra'), audio('7', 'eng')], subtitleTracks: [], selectedAudioTrackId: '4' };
  const b = { source: 'b', generation: 1, audioTracks: [audio('4', 'eng'), audio('7', 'fra')], subtitleTracks: [], selectedAudioTrackId: '7' };
  const c = { source: 'c', audioTracks: [audio('4', 'fra'), audio('7', 'eng')], subtitleTracks: [], selectedAudioTrackId: '4' };
  await lab([a, c], async ({ playback, box, commands, files, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', sourceGeneration: 0, audioTrackId: '4', subtitleTrackId: null });
    files.set('s1', b);
    await run(5000);
    expect(box.get().playback.plan?.sourceGeneration).toBe(1);
    playback.snapshot({ sessionId: 's1', live: null, position: 61, state: 'playing', sourceGeneration: 0, audioTrackId: '4', subtitleTrackId: null });
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.filter(c => c.kind === 'tracks')).toEqual([]);
    expect(files.get('s2')!.selectedAudioTrackId).toBe('4');
  });
});

test('subtitles off are asked for on their own when the server refuses them with an audio change', async () => {
  // The old audio id is not on the new file, whose stream burns in the English subtitle.
  const a = { source: 'a', audioTracks: [audio('4', 'fra')], subtitleTracks: [subtitle('2', 'eng')], selectedAudioTrackId: '4', selectedSubtitleTrackId: '2' };
  const b = { source: 'b', audioTracks: [audio('1', 'eng'), audio('9', 'fra')], subtitleTracks: [subtitle('2', 'eng')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '2' };
  await lab([a, b], async ({ playback, commands, files, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', audioTrackId: '4', subtitleTrackId: null });
    playback.recover('s1');
    await run();
    expect(commands.filter(c => c.kind === 'tracks').map(c => [c.audioTrackId, c.subtitleTrackId])).toEqual([['9', null], [undefined, null]]);
    expect(files.get('s2')!.selectedSubtitleTrackId).toBeNull();
    expect(files.get('s2')!.selectedAudioTrackId).toBe('1');
  }, c => c.audioTrackId !== undefined);
});

test('a recovery before any player report carries the plan\'s track to a new file', async () => {
  await lab([
    { source: 'a', audioTracks: [audio('4', 'fra'), audio('7', 'eng')], subtitleTracks: [], selectedAudioTrackId: '4' },
    { source: 'b', audioTracks: [audio('4', 'eng'), audio('7', 'fra')], subtitleTracks: [], selectedAudioTrackId: '4' },
  ], async ({ playback, box, commands, files, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.filter(c => c.kind === 'tracks').map(c => c.audioTrackId)).toEqual(['7']);
    expect(files.get('s2')!.selectedAudioTrackId).toBe('7');
  });
});

test('an undetermined language is not carried to a new file', async () => {
  await lab([
    { source: 'a', audioTracks: [audio('1', 'eng'), audio('2', 'und')], subtitleTracks: [], selectedAudioTrackId: '1' },
    { source: 'b', audioTracks: [audio('1', 'und'), audio('2', 'eng')], subtitleTracks: [], selectedAudioTrackId: '2' },
  ], async ({ playback, box, commands, files, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', audioTrackId: '2', subtitleTrackId: null });
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.filter(c => c.kind === 'tracks')).toEqual([]);
    expect(files.get('s2')!.selectedAudioTrackId).toBe('2');
  });
});

test('a choice made on one title is not carried into the next', async () => {
  await lab([
    { source: 'a', audioTracks: [audio('4', 'fra'), audio('7', 'eng')], subtitleTracks: [], selectedAudioTrackId: '4' },
    { source: 'x', audioTracks: [audio('4', 'eng'), audio('7', 'fra')], subtitleTracks: [], selectedAudioTrackId: '4' },
    { source: 'y', audioTracks: [audio('4', 'fra'), audio('7', 'eng')], subtitleTracks: [], selectedAudioTrackId: '7' },
  ], async ({ playback, box, commands, files, run }) => {
    await playback.start({ kind: 'title', id: 'one' });
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', audioTrackId: '4', subtitleTrackId: null });
    await playback.start({ kind: 'title', id: 'two' });
    await run(0);
    expect(box.get().playback.sessionId).toBe('s2');
    playback.recover('s2');
    await run();
    expect(box.get().playback.sessionId).toBe('s3');
    expect(commands.filter(c => c.kind === 'tracks')).toEqual([]);
    expect(files.get('s3')!.selectedAudioTrackId).toBe('7');
  });
});

test('a refusal that settles after the title was opened again sends nothing more to the abandoned session', async () => {
  const a = { source: 'a', audioTracks: [audio('4', 'fra')], subtitleTracks: [subtitle('2', 'eng')], selectedAudioTrackId: '4', selectedSubtitleTrackId: '2' };
  const b = { source: 'b', audioTracks: [audio('1', 'eng'), audio('9', 'fra')], subtitleTracks: [subtitle('2', 'eng')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '2' };
  let release = () => {};
  const refusal = new Promise<void>(resolve => { release = resolve; });
  await lab([a, b, b], async ({ playback, box, commands, stops, files, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', audioTrackId: '4', subtitleTrackId: null });
    playback.recover('s1');
    const recovery = run();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(commands.filter(c => c.kind === 'tracks').map(c => [c.audioTrackId, c.subtitleTrackId])).toEqual([['9', null]]);
    // The viewer opens the title again (resuming it) and plays it with subtitles on before the refusal arrives.
    const reopened = playback.start({ kind: 'title', id: 'movie', positionSeconds: 60 });
    await run();
    await reopened;
    expect(box.get().playback.sessionId).toBe('s3');
    playback.snapshot({ sessionId: 's3', live: null, position: 0, state: 'playing', audioTrackId: '1', subtitleTrackId: '2' });
    release();
    await recovery;
    expect(commands.filter(c => c.kind === 'tracks').map(c => [c.audioTrackId, c.subtitleTrackId])).toEqual([['9', null]]);
    expect(stops).toContain('s2');
    expect(files.get('s2')!.selectedSubtitleTrackId).toBe('2');
    expect(box.get().playback.sessionId).toBe('s3');
  }, c => c.audioTrackId !== undefined ? refusal : false);
});

test('language codes that name the same language carry the choice to a new file', async () => {
  // A tags its English audio 'en' and its French subtitle 'fre'; B uses 'eng' and 'fra' under other ids.
  await lab([
    { source: 'a', audioTracks: [audio('4', 'fre'), audio('7', 'en')], subtitleTracks: [subtitle('5', 'fre')], selectedAudioTrackId: '4' },
    { source: 'b', audioTracks: [audio('4', 'eng'), audio('7', 'fra')], subtitleTracks: [subtitle('5', 'eng'), subtitle('6', 'fra')], selectedAudioTrackId: '7' },
  ], async ({ playback, box, commands, files, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', audioTrackId: '7', subtitleTrackId: '5' });
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.filter(c => c.kind === 'tracks').map(c => [c.audioTrackId, c.subtitleTrackId])).toEqual([['4', '6']]);
    expect(files.get('s2')!.selectedAudioTrackId).toBe('4');
    expect(files.get('s2')!.selectedSubtitleTrackId).toBe('6');
  });
});

test('main audio and a commentary in one language under two codes leave the server\'s choice', async () => {
  // The choice was 'en'; B's main audio is 'eng' and its commentary 'en': two tracks fit.
  await lab([
    { source: 'a', audioTracks: [audio('1', 'en')], subtitleTracks: [], selectedAudioTrackId: '1' },
    { source: 'b', audioTracks: [audio('1', 'eng', { default: true }), audio('2', 'en', { name: 'Commentary' })], subtitleTracks: [], selectedAudioTrackId: '1' },
  ], async ({ playback, box, commands, files, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', audioTrackId: '1', subtitleTrackId: null });
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.filter(c => c.kind === 'tracks')).toEqual([]);
    expect(files.get('s2')!.selectedAudioTrackId).toBe('1');
  });
});

test('subtitles never turned on are not sent as off with a carried audio choice', async () => {
  // Subtitles were off from the start; B numbers French differently and selects its forced subtitle itself.
  await lab([
    { source: 'a', audioTracks: [audio('4', 'fra'), audio('7', 'eng')], subtitleTracks: [subtitle('3', 'fra', { forced: true })], selectedAudioTrackId: '7' },
    { source: 'b', audioTracks: [audio('4', 'eng'), audio('7', 'fra')], subtitleTracks: [subtitle('3', 'fra', { forced: true })], selectedAudioTrackId: '4', selectedSubtitleTrackId: '3' },
  ], async ({ playback, box, commands, files, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', audioTrackId: '4', subtitleTrackId: null });
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.filter(c => c.kind === 'tracks').map(c => [c.audioTrackId, c.subtitleTrackId])).toEqual([['7', undefined]]);
    expect(files.get('s2')!.selectedAudioTrackId).toBe('7');
    expect(files.get('s2')!.selectedSubtitleTrackId).toBe('3');
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('3');
  });
});

test('after subtitles off went through on their own, the server\'s later selection is shown', async () => {
  const a = { source: 'a', audioTracks: [audio('4', 'fra')], subtitleTracks: [subtitle('2', 'eng')], selectedAudioTrackId: '4', selectedSubtitleTrackId: '2' };
  const b = { source: 'b', audioTracks: [audio('1', 'eng'), audio('9', 'fra')], subtitleTracks: [subtitle('2', 'eng'), subtitle('8', 'eng')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '2' };
  await lab([a, b], async ({ playback, box, commands, files, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', audioTrackId: '4', subtitleTrackId: null });
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.filter(c => c.kind === 'tracks').map(c => [c.audioTrackId, c.subtitleTrackId])).toEqual([['9', null], [undefined, null]]);
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
    // The server then selects subtitle 8 (a downloaded subtitle, another version); the next poll shows it.
    files.set('s2', { ...files.get('s2')!, selectedSubtitleTrackId: '8' });
    await run(5000);
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('8');
  }, c => c.audioTrackId !== undefined);
});

test('a file without subtitles in between does not turn off the forced subtitle of the next', async () => {
  // A plays French subtitles; B has none and reports none; C selects its forced subtitle.
  await lab([
    { source: 'a', audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('3', 'fra')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '3' },
    { source: 'b', audioTracks: [audio('1', 'eng')], subtitleTracks: [], selectedAudioTrackId: '1' },
    { source: 'c', audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('4', 'eng', { forced: true })], selectedAudioTrackId: '1', selectedSubtitleTrackId: '4' },
  ], async ({ playback, box, commands, files, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', audioTrackId: '1', subtitleTrackId: '3' });
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    playback.snapshot({ sessionId: 's2', live: null, position: 61, state: 'playing', audioTrackId: '1', subtitleTrackId: null });
    playback.recover('s2');
    await run();
    expect(box.get().playback.sessionId).toBe('s3');
    expect(commands.filter(c => c.kind === 'tracks')).toEqual([]);
    expect(files.get('s3')!.selectedSubtitleTrackId).toBe('4');
  });
});

test('a new source of the session without subtitles does not turn off the forced subtitle of the next file', async () => {
  // The session moves on from A (French subtitles) to B (none, a new source generation); a recovery lands on C.
  const b = { source: 'b', generation: 1, audioTracks: [audio('1', 'eng')], subtitleTracks: [], selectedAudioTrackId: '1' };
  await lab([
    { source: 'a', audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('3', 'fra')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '3' },
    { source: 'c', audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('4', 'eng', { forced: true })], selectedAudioTrackId: '1', selectedSubtitleTrackId: '4' },
  ], async ({ playback, box, commands, files, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', sourceGeneration: 0, audioTrackId: '1', subtitleTrackId: '3' });
    files.set('s1', b);
    await run(5000);
    expect(box.get().playback.plan?.sourceGeneration).toBe(1);
    playback.snapshot({ sessionId: 's1', live: null, position: 61, state: 'playing', sourceGeneration: 1, audioTrackId: '1', subtitleTrackId: null });
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.filter(c => c.kind === 'tracks')).toEqual([]);
    expect(files.get('s2')!.selectedSubtitleTrackId).toBe('4');
  });
});

test('a subtitle chosen before a new source of the same file that fails before reporting is carried', async () => {
  // French is chosen on the part; a quality switch raises the source generation, the server selects English, and the new stream fails while loading.
  const file = { source: 'a', audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('2', 'eng', { default: true }), subtitle('3', 'fra')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '2' };
  await lab([file, file], async ({ playback, box, commands, files, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', sourceGeneration: 0, audioTrackId: '1', subtitleTrackId: '3' });
    files.set('s1', { ...file, generation: 1 });
    await run(5000);
    expect(box.get().playback.plan?.sourceGeneration).toBe(1);
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.filter(c => c.kind === 'tracks').map(c => [c.audioTrackId, c.subtitleTrackId])).toEqual([[undefined, '3']]);
    expect(files.get('s2')!.selectedSubtitleTrackId).toBe('3');
  });
});

test('a subtitle is carried past a file without subtitles that fails before reporting', async () => {
  // A plays French subtitles; B has none and fails before any report; C offers French again.
  await lab([
    { source: 'a', audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('3', 'fra')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '3' },
    { source: 'b', audioTracks: [audio('1', 'eng')], subtitleTracks: [], selectedAudioTrackId: '1' },
    { source: 'c', audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('4', 'eng'), subtitle('5', 'fra')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '4' },
  ], async ({ playback, box, commands, files, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', audioTrackId: '1', subtitleTrackId: '3' });
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    playback.recover('s2');
    await run();
    expect(box.get().playback.sessionId).toBe('s3');
    expect(commands.filter(c => c.kind === 'tracks').map(c => [c.audioTrackId, c.subtitleTrackId])).toEqual([[undefined, '5']]);
    expect(files.get('s3')!.selectedSubtitleTrackId).toBe('5');
  });
});

test('subtitles turned off by command before the first player report stay off after a recovery', async () => {
  const file = { source: 'a', audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('2', 'eng')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '2' };
  await lab([file, file], async ({ playback, box, commands, files, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    await playback.command('s1', { kind: 'tracks', subtitleTrackId: null, sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'off' });
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', audioTrackId: '1', subtitleTrackId: null });
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.filter(c => c.kind === 'tracks').slice(1).map(c => [c.audioTrackId, c.subtitleTrackId])).toEqual([[undefined, null]]);
    expect(files.get('s2')!.selectedSubtitleTrackId).toBeNull();
  });
});

test('a subtitle the server selects while the player still reports none is not taken for off', async () => {
  const file = { source: 'a', audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('2', 'eng')], selectedAudioTrackId: '1' };
  await lab([file, { ...file, selectedSubtitleTrackId: '2' }], async ({ playback, box, commands, files, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', audioTrackId: '1', subtitleTrackId: null });
    files.set('s1', { ...file, selectedSubtitleTrackId: '2' });
    await run(5000);
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('2');
    // The player has not taken up subtitle 2 yet.
    playback.snapshot({ sessionId: 's1', live: null, position: 61, state: 'playing', audioTrackId: '1', subtitleTrackId: null });
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.filter(c => c.kind === 'tracks')).toEqual([]);
    expect(files.get('s2')!.selectedSubtitleTrackId).toBe('2');
  });
});

test('a subtitle in one script is not carried to the other script of its language', async () => {
  await lab([
    { source: 'a', audioTracks: [audio('1', 'zh')], subtitleTracks: [subtitle('5', 'zh-Hant')], selectedAudioTrackId: '1' },
    { source: 'b', audioTracks: [audio('1', 'zh')], subtitleTracks: [subtitle('6', 'zh-Hans')], selectedAudioTrackId: '1' },
  ], async ({ playback, box, commands, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', audioTrackId: '1', subtitleTrackId: '5' });
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.filter(c => c.kind === 'tracks')).toEqual([]);
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
  });
});

test('a recovery after one that kept the tracks locally keeps them locally', async () => {
  // On B the server takes neither track command; tracks chosen locally stay local, also on C.
  const a = { source: 'a', audioTracks: [audio('4', 'fra')], subtitleTracks: [subtitle('2', 'eng')], selectedAudioTrackId: '4', selectedSubtitleTrackId: '2' };
  const b = { source: 'b', audioTracks: [audio('1', 'eng'), audio('9', 'fra')], subtitleTracks: [subtitle('2', 'eng'), subtitle('8', 'eng')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '2' };
  await lab([a, b, b], async ({ playback, box, commands, files, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', audioTrackId: '4', subtitleTrackId: null });
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
    playback.recover('s2');
    await run();
    expect(box.get().playback.sessionId).toBe('s3');
    expect(commands.filter(c => c.kind === 'tracks').map(c => [c.audioTrackId, c.subtitleTrackId])).toEqual([['9', null], [undefined, null]]);
    expect(box.get().playback.plan?.selectedAudioTrackId).toBe('9');
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
    files.set('s3', { ...files.get('s3')!, selectedSubtitleTrackId: '8' });
    await run(5000);
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
  }, () => true);
});

test('a subtitle the server refuses on a new file is kept locally by its id there, not the old one', async () => {
  // Old id 4 is the full English subtitle; on the new file 4 is the forced one and the full one is 7.
  await lab([
    { source: 'a', audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('3', 'eng', { forced: true }), subtitle('4', 'eng')], selectedAudioTrackId: '1' },
    { source: 'b', audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('4', 'eng', { forced: true }), subtitle('7', 'eng')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '4' },
  ], async ({ playback, box, commands, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', audioTrackId: '1', subtitleTrackId: '4' });
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.filter(c => c.kind === 'tracks').map(c => [c.audioTrackId, c.subtitleTrackId])).toEqual([[undefined, '7']]);
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('7');
    await run(5000);
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('7');
  }, () => true);
});

test('a choice the new file cannot place is left to its own selection when the server refuses the others', async () => {
  // French is 2 on the old file; the new file has two French tracks and 2 is English there.
  await lab([
    { source: 'a', audioTracks: [audio('1', 'eng'), audio('2', 'fra')], subtitleTracks: [subtitle('3', 'eng')], selectedAudioTrackId: '2', selectedSubtitleTrackId: '3' },
    { source: 'b', audioTracks: [audio('2', 'eng'), audio('5', 'fra'), audio('6', 'fra')], subtitleTracks: [subtitle('3', 'eng')], selectedAudioTrackId: '5', selectedSubtitleTrackId: '3' },
  ], async ({ playback, box, commands, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', audioTrackId: '2', subtitleTrackId: null });
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.filter(c => c.kind === 'tracks').map(c => [c.audioTrackId, c.subtitleTrackId])).toEqual([[undefined, null]]);
    expect(box.get().playback.plan?.selectedAudioTrackId).toBe('5');
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
  }, () => true);
});

test('an id reused where a file identity is missing must name the same kind of track', async () => {
  const first = (source?: string) => ({ ...(source ? { source } : {}), audioTracks: [audio('1', 'eng')], selectedAudioTrackId: '1',
    subtitleTracks: [subtitle('3', 'eng', { forced: true }), subtitle('4', 'eng')] });
  const second = (source?: string) => ({ ...(source ? { source } : {}), audioTracks: [audio('1', 'eng')], selectedAudioTrackId: '1',
    subtitleTracks: [subtitle('4', 'eng', { forced: true }), subtitle('7', 'eng')], selectedSubtitleTrackId: '4' });
  for (const [before, after] of [[undefined, 'b'], ['a', undefined], [undefined, undefined]] as const) {
    const commands = await recoverOnto(first(before), { audioTrackId: '1', subtitleTrackId: '4' }, second(after));
    expect(commands.map(c => [c.audioTrackId, c.subtitleTrackId])).toEqual([[undefined, '7']]);
  }
});

test('an id the old plan does not list is not reused on a file of unknown identity', async () => {
  // The player reports subtitle 4, which the old plan does not list; on the new file 4 is a forced French subtitle.
  await lab([
    { audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('3', 'eng')], selectedAudioTrackId: '1' },
    { source: 'b', audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('4', 'fra', { forced: true })], selectedAudioTrackId: '1' },
  ], async ({ playback, box, commands, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', audioTrackId: '1', subtitleTrackId: '4' });
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.filter(c => c.kind === 'tracks')).toEqual([]);
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
  });
});

test('leaving while the subtitles-off retry is unanswered stops the session at the generation it moved to', async () => {
  // The combined command is refused; the Off-only retry is taken and moves the session to source generation 1.
  const a = { source: 'a', audioTracks: [audio('4', 'fra')], subtitleTracks: [subtitle('2', 'eng')], selectedAudioTrackId: '4', selectedSubtitleTrackId: '2' };
  const b = { source: 'b', audioTracks: [audio('1', 'eng'), audio('9', 'fra')], subtitleTracks: [subtitle('2', 'eng')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '2' };
  let release = () => {};
  const reply = new Promise<void>(resolve => { release = resolve; });
  await lab([a, b], async ({ playback, commands, stopCommands, files, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', audioTrackId: '4', subtitleTrackId: null });
    playback.recover('s1');
    const recovery = run();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(commands.filter(c => c.kind === 'tracks').map(c => [c.audioTrackId, c.subtitleTrackId])).toEqual([['9', null], [undefined, null]]);
    await playback.stop();
    files.set('s2', { ...files.get('s2')!, generation: 1 });
    release();
    await recovery;
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(stopCommands.filter(c => c.sessionId === 's2').map(c => c.sourceGeneration)).toEqual([1]);
  }, c => c.audioTrackId !== undefined, c => c.audioTrackId === undefined ? reply : undefined);
});

test('subtitles turned off after a subtitle report stay off when the session fails before the next report', async () => {
  const file = { source: 'a', audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('2', 'eng')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '2' };
  await lab([file, file], async ({ playback, box, commands, files, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', audioTrackId: '1', subtitleTrackId: '2' });
    await playback.command('s1', { kind: 'tracks', subtitleTrackId: null, sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'off' });
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.filter(c => c.kind === 'tracks').slice(1).map(c => [c.audioTrackId, c.subtitleTrackId])).toEqual([[undefined, null]]);
    expect(files.get('s2')!.selectedSubtitleTrackId).toBeNull();
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
  });
});

test('a remembered series audio track the replacement cannot switch to locally leaves its own selection', async () => {
  // French is 4 on the direct file and applied there by the engine; the replacement is a transcode without
  // separate audio renditions, where French is 7 and the server plays English.
  await lab([
    { source: 'a', audioTracks: [audio('1', 'eng'), audio('4', 'fra')], subtitleTracks: [], selectedAudioTrackId: '1' },
    { source: 'b', transcode: true, audioTracks: [audio('1', 'eng'), audio('7', 'fra')], subtitleTracks: [], selectedAudioTrackId: '1' },
  ], async ({ playback, box, commands, run }) => {
    await playback.start({ kind: 'title', id: 'episode', showId: 'show' });
    expect(box.get().playback.plan?.selectedAudioTrackId).toBe('4');
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.filter(c => c.kind === 'tracks')).toEqual([]);
    expect(box.get().playback.plan?.selectedAudioTrackId).toBe('1');
  }, () => false, () => undefined, { audio: { language: 'fra' }, updatedAt: 1 });
});

test('a remembered series Off is carried when the episode already started with subtitles off', async () => {
  await lab([
    { source: 'a', audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('3', 'eng')], selectedAudioTrackId: '1' },
    { source: 'b', audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('9', 'eng')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '9' },
  ], async ({ playback, box, commands, files, run }) => {
    await playback.start({ kind: 'title', id: 'episode', showId: 'show' });
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    // Nothing was chosen against the episode's start, so the tracks are not local: Off is sent, as on main.
    expect(commands.filter(c => c.kind === 'tracks').map(c => c.subtitleTrackId)).toEqual([null]);
    expect(files.get('s2')!.selectedSubtitleTrackId).toBeNull();
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
  }, () => false, () => undefined, { subtitle: null, updatedAt: 1 });
});

test('an audio pick the server took after a remembered series Off equal to the start is sent to the replacement', async () => {
  // French is 4 on the direct file; the replacement is a transcode without separate audio renditions, where French is 7.
  await lab([
    { source: 'a', audioTracks: [audio('1', 'eng'), audio('4', 'fra')], subtitleTracks: [subtitle('3', 'eng')], selectedAudioTrackId: '1' },
    { source: 'b', transcode: true, audioTracks: [audio('1', 'eng'), audio('7', 'fra')], subtitleTracks: [subtitle('3', 'eng')], selectedAudioTrackId: '1' },
  ], async ({ playback, box, commands, files, run }) => {
    await playback.start({ kind: 'title', id: 'episode', showId: 'show' });
    await playback.command('s1', { kind: 'tracks', audioTrackId: '4', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'fra' });
    expect(box.get().playback.plan?.selectedAudioTrackId).toBe('4');
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.filter(c => c.kind === 'tracks').slice(1).map(c => c.audioTrackId)).toEqual(['7']);
    expect(files.get('s2')!.selectedAudioTrackId).toBe('7');
    expect(box.get().playback.plan?.selectedAudioTrackId).toBe('7');
  }, () => false, () => undefined, { subtitle: null, updatedAt: 1 });
});

test('a subtitle the player reports after a remembered series Off equal to the start is kept on recovery', async () => {
  // A pick made in the player itself (as Now Playing does on Apple) reaches the store only as a report.
  const file = { source: 'a', audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('3', 'eng')], selectedAudioTrackId: '1' };
  await lab([file, file], async ({ playback, box, run }) => {
    await playback.start({ kind: 'title', id: 'episode', showId: 'show' });
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', audioTrackId: '1', subtitleTrackId: '3' });
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('3');
  }, () => false, () => undefined, { subtitle: null, updatedAt: 1 });
});

test('of several tracks in the chosen language on a new file, the one with the chosen region is carried', async () => {
  // The series remembers en-US subtitles: the episode plays en-US 4; the replacement file has en-US 4 and a generic en 7, which the server selected.
  await lab([
    { source: 'a', audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('4', 'en-US')], selectedAudioTrackId: '1' },
    { source: 'b', audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('4', 'en-US'), subtitle('7', 'en')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '7' },
  ], async ({ playback, box, run }) => {
    await playback.start({ kind: 'title', id: 'episode', showId: 'show' });
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('4');
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('4');
  }, () => false, () => undefined, { subtitle: { language: 'en-us' }, updatedAt: 1 });
  // A choice the server took is asked for by that id too.
  const commands = await recoverOnto(
    { source: 'a', audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('4', 'en-US')], selectedAudioTrackId: '1' },
    { audioTrackId: '1', subtitleTrackId: '4' },
    { source: 'b', audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('4', 'en-US'), subtitle('7', 'en')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '7' });
  expect(commands.map(c => c.subtitleTrackId)).toEqual(['4']);
});

test('after a version switch, an Off the new version selected itself is not carried as the viewer\'s', async () => {
  // Off chosen on version A; version B already selects no subtitle and reports it; B fails onto file C, whose default is forced 9.
  await lab([
    { source: 'a', audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('3', 'eng')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '3' },
    { source: 'c', audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('9', 'eng', { forced: true })], selectedAudioTrackId: '1', selectedSubtitleTrackId: '9' },
  ], async ({ playback, box, commands, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    await playback.command('s1', { kind: 'tracks', subtitleTrackId: null, sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'off' });
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
    await playback.switchVersion('s1', 'b');
    expect(box.get().playback.plan?.sourceGeneration).toBe(1);
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', sourceGeneration: 1, audioTrackId: '1', subtitleTrackId: null });
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.filter(c => c.kind === 'tracks').slice(1)).toEqual([]);
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('9');
  }, () => false, () => undefined, undefined,
  { b: { source: 'b', generation: 1, audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('5', 'eng')], selectedAudioTrackId: '1' } });
});

test('of several tracks in the chosen language, region and flags on a new file, recovery picks the one opening it picks', async () => {
  // The series remembers en-US AAC audio; file B has en-US AAC 4 and en-US AC-3 7, which the server selects.
  const b = { source: 'b', audioTracks: [audio('4', 'en-US'), audio('7', 'en-US', { codec: 'ac3' })], subtitleTracks: [], selectedAudioTrackId: '7' };
  const series = { audio: { language: 'en-us', codecFamily: 'aac' }, updatedAt: 1 };
  await lab([b], async ({ playback, box }) => {
    await playback.start({ kind: 'title', id: 'episode', showId: 'show' });
    expect(box.get().playback.plan?.selectedAudioTrackId).toBe('4');
  }, () => false, () => undefined, series);
  await lab([
    { source: 'a', audioTracks: [audio('4', 'en-US')], subtitleTracks: [], selectedAudioTrackId: '4' },
    b,
  ], async ({ playback, box, run }) => {
    await playback.start({ kind: 'title', id: 'episode', showId: 'show' });
    expect(box.get().playback.plan?.selectedAudioTrackId).toBe('4');
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(box.get().playback.plan?.selectedAudioTrackId).toBe('4');
  }, () => false, () => undefined, series);
});

test('after a version switch, an Off chosen on the new version is carried', async () => {
  // Version B already selects no subtitle; the viewer chooses Off there and the player confirms it; B fails onto file C, whose default is forced 9.
  await lab([
    { source: 'a', audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('3', 'eng')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '3' },
    { source: 'c', audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('9', 'eng', { forced: true })], selectedAudioTrackId: '1', selectedSubtitleTrackId: '9' },
  ], async ({ playback, box, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    await playback.switchVersion('s1', 'b');
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', sourceGeneration: 1, audioTrackId: '1', subtitleTrackId: null });
    playback.rememberTrack('s1', 'subtitle', null);
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
  }, () => false, () => undefined, undefined,
  { b: { source: 'b', generation: 1, audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('5', 'eng')], selectedAudioTrackId: '1' } });
});

test('a switch reply that comes after the session published the version and an Off chosen there leaves the Off', async () => {
  // The session publishes version B (subtitle 5) while the switch reply is held; the viewer turns subtitles off on B and the
  // player confirms it; the reply comes in; B fails onto file C, whose default is forced 9, before another report.
  let release = () => {};
  await lab([
    { source: 'a', audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('3', 'eng')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '3' },
    { source: 'c', audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('9', 'eng', { forced: true })], selectedAudioTrackId: '1', selectedSubtitleTrackId: '9' },
  ], async ({ playback, box, holdSwitch, run }) => {
    holdSwitch(new Promise<void>(resolve => { release = resolve; }));
    await playback.start({ kind: 'title', id: 'movie' });
    const switching = playback.switchVersion('s1', 'b');
    await run(5000);
    expect(box.get().playback.plan?.sourceGeneration).toBe(1);
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('5');
    await playback.command('s1', { kind: 'tracks', subtitleTrackId: null, sourceGeneration: 1, seekGeneration: 0, idempotencyKey: 'off' });
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', sourceGeneration: 1, audioTrackId: '1', subtitleTrackId: null });
    playback.rememberTrack('s1', 'subtitle', null);
    release();
    await switching;
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
  }, () => false, () => undefined, undefined,
  { b: { source: 'b', version: 'b', generation: 1, audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('5', 'eng')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '5' } });
});

test('without a source id on the plans, recovery picks the track opening the file picks over a reused id', async () => {
  // The series remembers en-US AAC audio, playing as id 4 on file A; file B has en-US AAC 8 and en-US AC-3 4, which the server
  // selects. The plans name their files by version id only, or not at all.
  const series = { audio: { language: 'en-us', codecFamily: 'aac' }, updatedAt: 1 };
  for (const [first, second] of [['a', 'b'], [undefined, undefined]] as const) {
    const b = { ...(second ? { version: second } : {}), audioTracks: [audio('8', 'en-US'), audio('4', 'en-US', { codec: 'ac3' })], subtitleTracks: [], selectedAudioTrackId: '4' };
    await lab([b], async ({ playback, box }) => {
      await playback.start({ kind: 'title', id: 'episode', showId: 'show' });
      expect(box.get().playback.plan?.selectedAudioTrackId).toBe('8');
    }, () => false, () => undefined, series);
    await lab([
      { ...(first ? { version: first } : {}), audioTracks: [audio('4', 'en-US')], subtitleTracks: [], selectedAudioTrackId: '4' },
      b,
    ], async ({ playback, box, run }) => {
      await playback.start({ kind: 'title', id: 'episode', showId: 'show' });
      expect(box.get().playback.plan?.selectedAudioTrackId).toBe('4');
      playback.recover('s1');
      await run();
      expect(box.get().playback.sessionId).toBe('s2');
      expect(box.get().playback.plan?.selectedAudioTrackId).toBe('8');
    }, () => false, () => undefined, series);
  }
});

test('a version the session publishes before the switch reply starts from its own selection', async () => {
  // Off chosen on version A; the session publishes version B, which selects no subtitle, while the switch reply is held; B reports
  // Off and fails onto file C, whose default is forced 9, before the reply comes in.
  let release = () => {};
  await lab([
    { source: 'a', audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('3', 'eng')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '3' },
    { source: 'c', audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('9', 'eng', { forced: true })], selectedAudioTrackId: '1', selectedSubtitleTrackId: '9' },
  ], async ({ playback, box, commands, holdSwitch, run }) => {
    holdSwitch(new Promise<void>(resolve => { release = resolve; }));
    await playback.start({ kind: 'title', id: 'movie' });
    await playback.command('s1', { kind: 'tracks', subtitleTrackId: null, sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'off' });
    const switching = playback.switchVersion('s1', 'b');
    await run(5000);
    expect(box.get().playback.plan?.sourceGeneration).toBe(1);
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', sourceGeneration: 1, audioTrackId: '1', subtitleTrackId: null });
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.filter(c => c.kind === 'tracks').slice(1)).toEqual([]);
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('9');
    release();
    await switching;
  }, () => false, () => undefined, undefined,
  { b: { source: 'b', version: 'b', generation: 1, audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('5', 'eng')], selectedAudioTrackId: '1' } });
});

test('a new source of the version playing during a switch is not taken for the version asked for', async () => {
  // Off accepted on version A; while the switch to B is unanswered the session moves A to a new source (a quality change),
  // then the switch is refused; A fails onto file C, whose default is forced 9.
  let refuse = (_: Error) => {};
  await lab([
    { source: 'a', version: 'a', audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('3', 'eng')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '3' },
    { source: 'c', audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('9', 'eng', { forced: true })], selectedAudioTrackId: '1', selectedSubtitleTrackId: '9' },
  ], async ({ playback, box, commands, files, holdSwitch, run }) => {
    const refused = new Promise<void>((_, reject) => { refuse = reject; });
    refused.catch(() => undefined);
    holdSwitch(refused);
    await playback.start({ kind: 'title', id: 'movie' });
    await playback.command('s1', { kind: 'tracks', subtitleTrackId: null, sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'off' });
    const a = files.get('s1')!;
    const switching = playback.switchVersion('s1', 'b').catch(() => 'refused');
    for (let i = 0; i < 20; i++) await Promise.resolve();
    files.set('s1', { ...a, generation: 1 });
    await run(5000);
    expect(box.get().playback.plan?.sourceGeneration).toBe(1);
    expect(box.get().playback.plan?.selectedVersionId).toBe('a');
    refuse(new Error('Conflict'));
    expect(await switching).toBe('refused');
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.filter(c => c.kind === 'tracks').slice(1).map(c => c.subtitleTrackId)).toEqual([null]);
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
  }, () => false, () => undefined, undefined,
  { b: { source: 'b', version: 'b', generation: 1, audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('5', 'eng')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '5' } });
});

test('a version the session publishes before the switch reply is not given the local tracks of the previous one', async () => {
  // The series remembers SDH, applied by the engine on version A; the session publishes version B with forced 5 selected
  // while the switch reply is held; the reply comes in and B fails onto file C, whose default is forced 9, before a report.
  let release = () => {};
  await lab([
    { source: 'a', audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('3', 'eng'), subtitle('6', 'eng', { hearingImpaired: true })], selectedAudioTrackId: '1', selectedSubtitleTrackId: '3' },
    { source: 'c', audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('8', 'eng', { hearingImpaired: true }), subtitle('9', 'eng', { forced: true })], selectedAudioTrackId: '1', selectedSubtitleTrackId: '9' },
  ], async ({ playback, box, commands, holdSwitch, run }) => {
    holdSwitch(new Promise<void>(resolve => { release = resolve; }));
    await playback.start({ kind: 'title', id: 'episode', showId: 'show' });
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('6');
    expect(commands.filter(c => c.kind === 'tracks')).toEqual([]);
    const switching = playback.switchVersion('s1', 'b');
    await run(5000);
    expect(box.get().playback.plan?.sourceGeneration).toBe(1);
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('5');
    release();
    await switching;
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('9');
  }, () => false, () => undefined, { subtitle: { language: 'eng', hearingImpaired: true }, updatedAt: 1 },
  { b: { source: 'b', version: 'b', generation: 1, audioTracks: [audio('1', 'eng')],
    subtitleTracks: [subtitle('5', 'eng', { forced: true }), subtitle('7', 'eng', { hearingImpaired: true })], selectedAudioTrackId: '1', selectedSubtitleTrackId: '5' } });
});

test('a version row alone that is the same on both plans does not keep a reused id of another language', async () => {
  // Auto names both plans by the same row and nothing else; English is 4 on the release A played, French is 4 on the one C plays.
  const commands = await recoverOnto(
    { version: 'auto', audioTracks: [audio('2', 'fra'), audio('4', 'eng')], subtitleTracks: [], selectedAudioTrackId: '2' },
    { audioTrackId: '4', subtitleTrackId: null },
    { version: 'auto', audioTracks: [audio('4', 'fra'), audio('7', 'eng')], subtitleTracks: [], selectedAudioTrackId: '4' });
  expect(commands.map(c => c.audioTrackId)).toEqual(['7']);
});

/** File C of the tests below: one English audio track and a forced English subtitle, id 9, that it selects. */
const forcedNine: File = { source: 'c', ether: true, audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('9', 'eng', { forced: true })], selectedAudioTrackId: '1', selectedSubtitleTrackId: '9' };

test('a track reply older than the version shown does not replace it or carry its choice', async () => {
  // Off is taken on version A (source generation 1) and published, but its reply is held; the switch to version B, which selects
  // forced 5, comes in first (generation 2); A's reply arrives, then B fails onto file C, whose default is forced 9.
  let release = () => {};
  const reply = new Promise<void>(resolve => { release = resolve; });
  await lab([
    { source: 'a', version: 'a', ether: true, audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('3', 'eng')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '3' },
    forcedNine,
  ], async ({ playback, box, commands, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    const off = playback.command('s1', { kind: 'tracks', subtitleTrackId: null, sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'off' });
    await run(5000);
    expect(box.get().playback.plan?.sourceGeneration).toBe(1);
    await playback.switchVersion('s1', 'b');
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('5');
    release();
    await off;
    expect(box.get().playback.plan?.sourceGeneration).toBe(2);
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('5');
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.filter(c => c.kind === 'tracks').slice(1)).toEqual([]);
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('9');
  }, () => false, c => c.idempotencyKey === 'off' ? reply : undefined, undefined,
  { b: { source: 'b', version: 'b', ether: true, generation: 2, seek: 2, audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('5', 'eng', { forced: true })], selectedAudioTrackId: '1', selectedSubtitleTrackId: '5' } });
});

test('a track command of the previous version that the server finds stale is not sent again to the new version', async () => {
  // Off chosen on version A reaches the server after the switch to version B (forced 5) moved it to generation 2, and is
  // refused as stale; B then fails onto file C, whose default is forced 9.
  let refuse = (_: Error) => {};
  const refused = new Promise<never>((_, reject) => { refuse = reject; });
  refused.catch(() => undefined);
  await lab([
    { source: 'a', version: 'a', ether: true, audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('3', 'eng')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '3' },
    forcedNine,
  ], async ({ playback, box, commands, files, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    const off = playback.command('s1', { kind: 'tracks', subtitleTrackId: null, sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'off' });
    await playback.switchVersion('s1', 'b');
    refuse(new VelaError({ class: 'conflict', code: 'stale_generation', message: 'stale generation',
      currentGenerations: { sourceGeneration: 2, seekGeneration: 2 }, retry: { allowed: false } } as never, 409));
    expect(await off).toBe(false);
    expect(commands.filter(c => c.kind === 'tracks').map(c => c.idempotencyKey)).toEqual(['off']);
    expect(files.get('s1')!.selectedSubtitleTrackId).toBe('5');
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.filter(c => c.kind === 'tracks').slice(1)).toEqual([]);
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('9');
  }, c => c.idempotencyKey === 'off' ? refused : false, () => undefined, undefined,
  { b: { source: 'b', version: 'b', ether: true, generation: 2, seek: 2, audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('5', 'eng', { forced: true })], selectedAudioTrackId: '1', selectedSubtitleTrackId: '5' } });
});

test('recovery after the session published the version asked for, before the switch reply, requests that version', async () => {
  // Pinned to version A; the switch reply to version B is held while the session publishes B; B fails before the reply.
  let release = () => {};
  const a = { source: 'a', version: 'a', ether: true, audioTracks: [audio('1', 'eng')], subtitleTracks: [], selectedAudioTrackId: '1' };
  const b = { source: 'b', version: 'b', ether: true, generation: 1, seek: 1, audioTracks: [audio('1', 'eng')], subtitleTracks: [], selectedAudioTrackId: '1' };
  await lab([a, { ...b, generation: 0, seek: 0 }], async ({ playback, box, starts, holdSwitch, run }) => {
    holdSwitch(new Promise<void>(resolve => { release = resolve; }));
    await playback.start({ kind: 'title', id: 'movie', versionId: 'a' });
    const switching = playback.switchVersion('s1', 'b');
    await run(5000);
    expect(box.get().playback.plan?.selectedVersionId).toBe('b');
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(starts.map(request => request.versionId)).toEqual(['a', 'b']);
    release();
    await switching;
  }, () => false, () => undefined, undefined, { b });
});

test('a choice the server took is kept when its reply comes after the same file was reopened', async () => {
  // Off is taken on file A and published (source generation 1), but its reply is held; the session reopens the same file
  // (generation 2); the reply arrives, then the session fails onto file C, whose default is forced 9.
  let release = () => {};
  const reply = new Promise<void>(resolve => { release = resolve; });
  await lab([
    { source: 'a', version: 'a', ether: true, audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('3', 'eng')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '3' },
    forcedNine,
  ], async ({ playback, box, commands, files, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    const off = playback.command('s1', { kind: 'tracks', subtitleTrackId: null, sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'off' });
    await run(5000);
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
    files.set('s1', { ...files.get('s1')!, generation: 2, seek: 2 });
    await run(5000);
    expect(box.get().playback.plan?.sourceGeneration).toBe(2);
    release();
    await off;
    expect(box.get().playback.plan?.sourceGeneration).toBe(2);
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.filter(c => c.kind === 'tracks').slice(1).map(c => c.subtitleTrackId)).toEqual([null]);
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
  }, () => false, c => c.idempotencyKey === 'off' ? reply : undefined);
});

test('a choice the server took is kept when the answer to a later pick on the same file comes first', async () => {
  // Off is taken on file A (source generation 1) but its reply is held; French audio, picked next, is taken after it (generation 2)
  // and answered first; Off's reply arrives, then the session fails onto file C, whose default is forced 9.
  let release = () => {};
  const reply = new Promise<void>(resolve => { release = resolve; });
  await lab([
    { source: 'a', version: 'a', ether: true, audioTracks: [audio('1', 'eng'), audio('2', 'fra')], subtitleTracks: [subtitle('3', 'eng')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '3' },
    forcedNine,
  ], async ({ playback, box, commands, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    const off = playback.command('s1', { kind: 'tracks', subtitleTrackId: null, sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'off' });
    expect(await playback.command('s1', { kind: 'tracks', audioTrackId: '2', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'fra' })).toBe(true);
    expect(box.get().playback.plan?.sourceGeneration).toBe(2);
    release();
    await off;
    expect(box.get().playback.plan?.sourceGeneration).toBe(2);
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBeNull();
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
  }, () => false, c => c.idempotencyKey === 'off' ? reply : undefined);
});

test('subtitles off the session published before the reply stay off when it fails', async () => {
  // Off is taken on file A and published, but no reply comes; the session fails onto file C, whose default is forced 9, at once
  // or after a version switch the server refuses.
  for (const refusedSwitch of [false, true]) {
    await lab([
      { source: 'a', version: 'a', ether: true, audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('3', 'eng')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '3' },
      forcedNine,
    ], async ({ playback, box, commands, run }) => {
      await playback.start({ kind: 'title', id: 'movie' });
      void playback.command('s1', { kind: 'tracks', subtitleTrackId: null, sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'off' });
      await run(5000);
      expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
      if (refusedSwitch) expect(await playback.switchVersion('s1', 'x').catch(() => 'refused')).toBe('refused');
      playback.recover('s1');
      await run();
      expect(box.get().playback.sessionId).toBe('s2');
      expect(commands.filter(c => c.kind === 'tracks').slice(1).map(c => c.subtitleTrackId)).toEqual([null]);
      expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
    }, () => false, c => c.idempotencyKey === 'off' ? new Promise(() => {}) : undefined, undefined, {});
  }
});

test('a track command refused as stale is not sent again after Auto moved the session to another release', async () => {
  // French is 4 on the release Auto plays (A); the server fails over to release B, where 4 is English and French is 7, and
  // refuses the pick as stale.
  let refuse = (_: Error) => {};
  const refused = new Promise<never>((_, reject) => { refuse = reject; });
  refused.catch(() => undefined);
  await lab([
    { source: 'a', version: 'auto', ether: true, audioTracks: [audio('4', 'fra'), audio('7', 'eng')], subtitleTracks: [], selectedAudioTrackId: '7' },
  ], async ({ playback, box, commands, files, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    const pick = playback.command('s1', { kind: 'tracks', audioTrackId: '4', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'pick' });
    files.set('s1', { source: 'b', version: 'auto', ether: true, generation: 1, seek: 1, audioTracks: [audio('4', 'eng'), audio('7', 'fra')], subtitleTracks: [], selectedAudioTrackId: '7' });
    await run(5000);
    expect(box.get().playback.plan?.sourceGeneration).toBe(1);
    refuse(stale(files.get('s1')!));
    expect(await pick).toBe(false);
    expect(commands.filter(c => c.kind === 'tracks').map(c => c.idempotencyKey)).toEqual(['pick']);
    expect(files.get('s1')!.selectedAudioTrackId).toBe('7');
  }, c => c.idempotencyKey === 'pick' ? refused : false);
});

test('a track command refused as stale is not sent again after a switch to another version and back', async () => {
  // Off chosen on version A reaches the server after switches to version B and back to A, and is refused as stale.
  let refuse = (_: Error) => {};
  const refused = new Promise<never>((_, reject) => { refuse = reject; });
  refused.catch(() => undefined);
  const a = { source: 'a', version: 'a', ether: true, audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('3', 'eng')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '3' };
  await lab([a], async ({ playback, commands, files }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    const off = playback.command('s1', { kind: 'tracks', subtitleTrackId: null, sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'off' });
    await playback.switchVersion('s1', 'b');
    await playback.switchVersion('s1', 'a');
    refuse(stale(files.get('s1')!));
    expect(await off).toBe(false);
    expect(commands.filter(c => c.kind === 'tracks').map(c => c.idempotencyKey)).toEqual(['off']);
    expect(files.get('s1')!.selectedSubtitleTrackId).toBe('3');
  }, c => c.idempotencyKey === 'off' ? refused : false, () => undefined, undefined,
  { b: { source: 'b', version: 'b', ether: true, generation: 1, seek: 1, audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('5', 'eng', { forced: true })], selectedAudioTrackId: '1', selectedSubtitleTrackId: '5' },
    a: { ...a, generation: 2, seek: 2 } });
});

test('a switch reply that comes in while the session is recovered is not taken', async () => {
  // Pinned to version A, the viewer turns subtitles off and the server confirms it; the switch to version B (forced 5) is sent
  // and the session fails, before or after B is published; the switch reply comes in during the recovery. The replacement plays
  // file C, whose default is forced 9: it keeps Off and asks for A when B was not published, and asks for B when it was.
  for (const published of [false, true]) {
    let release = () => {};
    await lab([
      { source: 'a', version: 'a', ether: true, audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('3', 'eng')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '3' },
      forcedNine,
    ], async ({ playback, box, starts, holdSwitch, run }) => {
      holdSwitch(new Promise<void>(resolve => { release = resolve; }));
      await playback.start({ kind: 'title', id: 'movie', versionId: 'a' });
      expect(await playback.command('s1', { kind: 'tracks', subtitleTrackId: null, sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'off' })).toBe(true);
      const switching = playback.switchVersion('s1', 'b');
      for (let i = 0; i < 20; i++) await Promise.resolve();
      if (published) {
        await run(5000);
        expect(box.get().playback.plan?.selectedVersionId).toBe('b');
      }
      playback.recover('s1');
      release();
      await switching;
      expect(box.get().playback.plan).toBeNull();
      await run();
      expect(box.get().playback.sessionId).toBe('s2');
      expect(starts.map(request => request.versionId)).toEqual(['a', published ? 'b' : 'a']);
      expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe(published ? '9' : null);
    }, () => false, () => undefined, undefined,
    { b: { source: 'b', version: 'b', ether: true, generation: 2, seek: 2, audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('5', 'eng', { forced: true })], selectedAudioTrackId: '1', selectedSubtitleTrackId: '5' } });
  }
});

test('a track taken on the version published before the switch reply stays when the reply comes in', async () => {
  // The session publishes version B (English 4) while the switch reply is held; French 7 is taken on B; the older reply comes in;
  // B fails onto file C, where French is 4.
  let release = () => {};
  await lab([
    { source: 'a', version: 'a', ether: true, audioTracks: [audio('1', 'eng')], subtitleTracks: [], selectedAudioTrackId: '1' },
    { source: 'c', ether: true, audioTracks: [audio('4', 'fra'), audio('7', 'eng')], subtitleTracks: [], selectedAudioTrackId: '7' },
  ], async ({ playback, box, commands, holdSwitch, run }) => {
    holdSwitch(new Promise<void>(resolve => { release = resolve; }));
    await playback.start({ kind: 'title', id: 'movie' });
    const switching = playback.switchVersion('s1', 'b');
    await run(5000);
    expect(box.get().playback.plan?.selectedVersionId).toBe('b');
    expect(box.get().playback.plan?.selectedAudioTrackId).toBe('4');
    expect(await playback.command('s1', { kind: 'tracks', audioTrackId: '7', sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'fra' })).toBe(true);
    release();
    await switching;
    expect(box.get().playback.plan?.selectedAudioTrackId).toBe('7');
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.filter(c => c.kind === 'tracks').slice(1).map(c => c.audioTrackId)).toEqual(['4']);
    expect(box.get().playback.plan?.selectedAudioTrackId).toBe('4');
  }, () => false, () => undefined, undefined,
  { b: { source: 'b', version: 'b', ether: true, generation: 1, seek: 1, audioTracks: [audio('4', 'eng'), audio('7', 'fra')], subtitleTracks: [], selectedAudioTrackId: '4' } });
});

test('a plan republished with the selection it already showed does not confirm a pending track command', async () => {
  // The player plays a track the plan does not show (subtitle 3 while the plan shows Off, or French 4 while it shows English 1);
  // the viewer asks for what the plan shows, the session republishes its unchanged selection, the server refuses the command and
  // the session fails onto the same file again: the track the player played is restored.
  for (const kind of ['subtitle', 'audio'] as const) {
    let refuse = () => {};
    const refused = new Promise<void>(resolve => { refuse = resolve; });
    const a: File = { source: 'a', version: 'a', ether: true, audioTracks: [audio('1', 'eng'), audio('4', 'fra')], subtitleTracks: [subtitle('3', 'eng')], selectedAudioTrackId: '1', selectedSubtitleTrackId: null };
    await lab([a, a], async ({ playback, box, files, run }) => {
      await playback.start({ kind: 'title', id: 'movie' });
      playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', ...(kind === 'subtitle' ? { subtitleTrackId: '3' } : { audioTrackId: '4' }) });
      const pick = playback.command('s1', { kind: 'tracks', ...(kind === 'subtitle' ? { subtitleTrackId: null } : { audioTrackId: '1' }), sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'pick' });
      files.set('s1', { ...files.get('s1')!, revision: 2 });
      await run(5000);
      // The republish only moves the server's clock, so it is heard but stays off the screen (plan-clock.ts).
      expect(box.get().playback.plan?.revision).toBe(1);
      expect((playback as unknown as { clockAhead: PlaybackPlan | null }).clockAhead?.revision).toBe(2);
      refuse();
      expect(await pick).toBe(false);
      playback.recover('s1');
      await run();
      expect(box.get().playback.sessionId).toBe('s2');
      if (kind === 'subtitle') expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('3');
      else expect(box.get().playback.plan?.selectedAudioTrackId).toBe('4');
    }, c => c.idempotencyKey === 'pick' ? refused : false);
  }
});

test('a plan of an older source generation does not confirm a pending track command', async () => {
  // Off is taken on file A (source generation 1); subtitle 3, asked for next, awaits its reply while a refresh shows the older
  // generation 0, where 3 is selected; the session republishes generation 1 with Off, the server refuses 3 and the session
  // fails onto file C, whose default is forced 9.
  let refuse = () => {};
  const refused = new Promise<void>(resolve => { refuse = resolve; });
  const a: File = { source: 'a', version: 'a', ether: true, audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('3', 'eng')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '3' };
  await lab([a, forcedNine], async ({ playback, box, files, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    expect(await playback.command('s1', { kind: 'tracks', subtitleTrackId: null, sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'off' })).toBe(true);
    const taken = files.get('s1')!;
    const pick = playback.command('s1', { kind: 'tracks', subtitleTrackId: '3', sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'pick' });
    files.set('s1', a);
    expect(await playback.refresh('s1')).toBe(true);
    // A read behind the newest plan heard is not shown: generation 1 stays.
    expect(box.get().playback.plan?.sourceGeneration).toBe(1);
    files.set('s1', taken);
    await run(5000);
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
    refuse();
    expect(await pick).toBe(false);
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
  }, c => c.idempotencyKey === 'pick' ? refused : false);
});

test('a plan of another file at the same source generation does not confirm a pending track command', async () => {
  // Auto plays release A, where the player reports Spanish 2; English 4, asked for next, awaits its reply while the server fails
  // over to release B at the same source generation, whose default is English 4; the server refuses the pick and the session
  // fails onto file C, where Spanish is 2 and English 4 is the default.
  let refuse = () => {};
  const refused = new Promise<void>(resolve => { refuse = resolve; });
  await lab([
    { source: 'a', version: 'auto', ether: true, audioTracks: [audio('1', 'eng'), audio('2', 'spa')], subtitleTracks: [], selectedAudioTrackId: '1' },
    { source: 'c', ether: true, audioTracks: [audio('2', 'spa'), audio('4', 'eng')], subtitleTracks: [], selectedAudioTrackId: '4' },
  ], async ({ playback, box, files, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', audioTrackId: '2' });
    const pick = playback.command('s1', { kind: 'tracks', audioTrackId: '4', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'pick' });
    files.set('s1', { source: 'b', version: 'auto', ether: true, revision: 2, audioTracks: [audio('4', 'eng'), audio('5', 'spa')], subtitleTracks: [], selectedAudioTrackId: '4' });
    await run(5000);
    expect(box.get().playback.plan?.revision).toBe(2);
    refuse();
    expect(await pick).toBe(false);
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(box.get().playback.plan?.selectedAudioTrackId).toBe('2');
  }, c => c.idempotencyKey === 'pick' ? refused : false);
});

test('a later audio pick does not drop the pending subtitles-off command the session then publishes', async () => {
  // Off is taken on file A but no reply comes; French audio, asked for next, awaits its reply; the session publishes Off and
  // fails onto file C, whose default is forced 9.
  await lab([
    { source: 'a', version: 'a', ether: true, audioTracks: [audio('1', 'eng'), audio('2', 'fra')], subtitleTracks: [subtitle('3', 'eng')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '3' },
    forcedNine,
  ], async ({ playback, box, commands, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    void playback.command('s1', { kind: 'tracks', subtitleTrackId: null, sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'off' });
    void playback.command('s1', { kind: 'tracks', audioTrackId: '2', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'fra' });
    await run(5000);
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.filter(c => c.kind === 'tracks').slice(2).map(c => c.subtitleTrackId)).toEqual([null]);
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
  }, c => c.idempotencyKey === 'fra' ? new Promise(() => {}) : false, c => c.idempotencyKey === 'off' ? new Promise(() => {}) : undefined);
});

test('a subtitle chosen and confirmed locally while subtitles off await their reply is not replaced when the session publishes the off', async () => {
  // On HLS, Off is asked for the embedded subtitle 3 but no reply comes; the viewer then picks French sidecar 7 locally and the
  // player confirms it; the session publishes the earlier Off and fails onto file C, whose default is forced 9, before the reply.
  const french = (url: string) => subtitle('7', 'fra', { delivery: { kind: 'external', format: 'webvtt', url } });
  await lab([
    { source: 'a', version: 'a', ether: true, transcode: true, audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('3', 'eng', { delivery: { kind: 'embedded' } }), french('https://media.test/a7.vtt')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '3' },
    { ...forcedNine, transcode: true, subtitleTracks: [subtitle('9', 'eng', { forced: true }), french('https://media.test/c7.vtt')] },
  ], async ({ playback, box, commands, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    void playback.command('s1', { kind: 'tracks', subtitleTrackId: null, sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'off' });
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is sent.
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', sourceGeneration: 0, audioTrackId: '1', subtitleTrackId: '7' });
    playback.rememberTrack('s1', 'subtitle', '7');
    await run(5000);
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.filter(c => c.kind === 'tracks').slice(1).map(c => c.subtitleTrackId)).toEqual(['7']);
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('7');
  }, () => false, c => c.idempotencyKey === 'off' ? new Promise(() => {}) : undefined);
});

test('an audio track chosen and confirmed locally while another awaits its reply is not replaced when the session publishes that one', async () => {
  // French audio 2 is asked for but no reply comes; the viewer then picks German 4 locally and the player confirms it; the session
  // publishes French and fails onto file C before the reply.
  const tracks = [audio('1', 'eng'), audio('2', 'fra'), audio('4', 'deu')];
  await lab([
    { source: 'a', version: 'a', ether: true, audioTracks: tracks, subtitleTracks: [], selectedAudioTrackId: '1' },
    { source: 'c', ether: true, audioTracks: tracks, subtitleTracks: [], selectedAudioTrackId: '1' },
  ], async ({ playback, box, commands, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    void playback.command('s1', { kind: 'tracks', audioTrackId: '2', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'fra' });
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is sent.
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', sourceGeneration: 0, audioTrackId: '4', subtitleTrackId: null });
    playback.rememberTrack('s1', 'audio', '4');
    await run(5000);
    expect(box.get().playback.plan?.selectedAudioTrackId).toBe('2');
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.filter(c => c.kind === 'tracks').slice(1).map(c => c.audioTrackId)).toEqual(['4']);
    expect(box.get().playback.plan?.selectedAudioTrackId).toBe('4');
  }, () => false, c => c.idempotencyKey === 'fra' ? new Promise(() => {}) : undefined);
});

test('a version switch of the failed session does not stop the replacement retrying a stale track command', async () => {
  // The switch from A to version B gets no reply; the session fails onto file C, which moves to a new source before Off,
  // chosen on C, reaches the server and is refused as stale.
  await lab([
    { source: 'a', version: 'a', ether: true, audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('3', 'eng')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '3' },
    { source: 'c', ether: true, audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('3', 'eng')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '3' },
  ], async ({ playback, box, commands, files, holdSwitch, run }) => {
    holdSwitch(new Promise(() => {}));
    await playback.start({ kind: 'title', id: 'movie' });
    void playback.switchVersion('s1', 'b');
    for (let i = 0; i < 20; i++) await Promise.resolve();
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    files.set('s2', { ...files.get('s2')!, generation: 1, seek: 1 });
    expect(await playback.command('s2', { kind: 'tracks', subtitleTrackId: null, sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'off' })).toBe(true);
    expect(commands.filter(c => c.kind === 'tracks').map(c => c.subtitleTrackId)).toEqual([null, null]);
    expect(files.get('s2')!.selectedSubtitleTrackId).toBeNull();
  }, () => false, () => undefined, undefined,
  { b: { source: 'b', version: 'b', ether: true, generation: 1, seek: 1, audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('5', 'eng', { forced: true })], selectedAudioTrackId: '1', selectedSubtitleTrackId: '5' } });
});

test('a switch reply that comes in while the session is recovered sets the version a later recovery asks for', async () => {
  // Pinned to version A, the switch to version B is sent and the session fails before B is published; the reply comes in during
  // the backoff; the replacement fails too.
  let release = () => {};
  const a: File = { source: 'a', version: 'a', ether: true, audioTracks: [audio('1', 'eng')], subtitleTracks: [], selectedAudioTrackId: '1' };
  await lab([a, a, a], async ({ playback, box, starts, holdSwitch, run }) => {
    holdSwitch(new Promise<void>(resolve => { release = resolve; }));
    await playback.start({ kind: 'title', id: 'movie', versionId: 'a' });
    const switching = playback.switchVersion('s1', 'b');
    for (let i = 0; i < 20; i++) await Promise.resolve();
    playback.recover('s1');
    release();
    await switching;
    expect(box.get().playback.plan).toBeNull();
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    playback.recover('s2');
    await run();
    expect(box.get().playback.sessionId).toBe('s3');
    expect(starts.map(request => request.versionId)).toEqual(['a', 'a', 'b']);
  }, () => false, () => undefined, undefined,
  { b: { source: 'b', version: 'b', ether: true, generation: 1, seek: 1, audioTracks: [audio('1', 'eng')], subtitleTracks: [], selectedAudioTrackId: '1' } });
});

test('a switch reply that a later switch replaced does not set the version recovery asks for', async () => {
  // Pinned to version A, the session publishes version B while the switch reply is held; the viewer switches to C, whose reply
  // comes in, or is held while the session publishes C; B's reply comes in, then C fails.
  for (const answered of [true, false]) {
    let releaseB = () => {}, releaseC = () => {};
    const a: File = { source: 'a', version: 'a', ether: true, audioTracks: [audio('1', 'eng')], subtitleTracks: [], selectedAudioTrackId: '1' };
    const b: File = { ...a, source: 'b', version: 'b', generation: 1, seek: 1 };
    const c: File = { ...a, source: 'c', version: 'c', generation: 2, seek: 2 };
    await lab([a, { ...c, generation: 0, seek: 0 }], async ({ playback, box, starts, holdSwitch, run }) => {
      holdSwitch(new Promise<void>(resolve => { releaseB = resolve; }));
      await playback.start({ kind: 'title', id: 'movie', versionId: 'a' });
      const toB = playback.switchVersion('s1', 'b');
      await run(5000);
      expect(box.get().playback.plan?.selectedVersionId).toBe('b');
      holdSwitch(answered ? Promise.resolve() : new Promise<void>(resolve => { releaseC = resolve; }));
      const toC = playback.switchVersion('s1', 'c');
      if (answered) await toC;
      else await run(5000);
      expect(box.get().playback.plan?.selectedVersionId).toBe('c');
      releaseB();
      await toB;
      expect(box.get().playback.plan?.selectedVersionId).toBe('c');
      playback.recover('s1');
      await run();
      expect(box.get().playback.sessionId).toBe('s2');
      expect(starts.map(request => request.versionId)).toEqual(['a', 'c']);
      releaseC();
      await toC;
    }, () => false, () => undefined, undefined, { b, c });
  }
});

test('an older subtitle reply does not replace a newer subtitle choice on recovery', async () => {
  // File A selects forced 2. Off is taken but its reply is held, Regular 3 is taken and answered, then Off's reply comes in;
  // or Regular 3's reply is held, Off is taken and answered, then Regular's reply comes in. The session fails onto file C,
  // whose default is forced 9 and whose regular English subtitle is 8: it gets the later choice.
  for (const first of ['off', 'regular'] as const) {
    let release = () => {};
    const reply = new Promise<void>(resolve => { release = resolve; });
    await lab([
      { source: 'a', version: 'a', ether: true, audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('2', 'eng', { forced: true }), subtitle('3', 'eng')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '2' },
      { ...forcedNine, subtitleTracks: [subtitle('9', 'eng', { forced: true }), subtitle('8', 'eng')] },
    ], async ({ playback, box, commands, run }) => {
      await playback.start({ kind: 'title', id: 'movie' });
      const off = { kind: 'tracks', subtitleTrackId: null, sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'off' } as const;
      const regular = { kind: 'tracks', subtitleTrackId: '3', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'regular' } as const;
      const held = playback.command('s1', first === 'off' ? off : regular);
      for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is taken.
      expect(await playback.command('s1', first === 'off' ? regular : off)).toBe(true);
      expect(box.get().playback.plan?.sourceGeneration).toBe(2);
      release();
      await held;
      playback.recover('s1');
      await run();
      expect(box.get().playback.sessionId).toBe('s2');
      expect(commands.filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBe(first === 'off' ? '8' : null);
      expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe(first === 'off' ? '8' : null);
    }, () => false, c => c.idempotencyKey === first ? reply : undefined);
  }
});

/** File A plays forced 2 and offers regular 3; file C selects forced 9 and offers regular 8. */
const forcedTwo: File = { source: 'a', version: 'a', ether: true, audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('2', 'eng', { forced: true }), subtitle('3', 'eng')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '2' };
const forcedNineRegularEight: File = { ...forcedNine, subtitleTracks: [subtitle('9', 'eng', { forced: true }), subtitle('8', 'eng')] };
const offCommand = { kind: 'tracks', subtitleTrackId: null, sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'off' } as const;

test('a refused subtitle command leaves an earlier accepted one counting', async () => {
  // Off is taken but its reply is held; Regular 3 is refused, before Off's reply comes in or after it; the session fails onto
  // file C before another report: Off stays.
  for (const refusedFirst of [true, false]) {
    let release = () => {}, refuse = (_: Error) => {};
    const reply = new Promise<void>(resolve => { release = resolve; });
    const refused = new Promise<never>((_, reject) => { refuse = reject; });
    refused.catch(() => undefined);
    const refusal = new VelaError({ class: 'request', code: 'invalid_track', message: 'invalid track', retry: { allowed: false } } as never, 422);
    await lab([forcedTwo, forcedNineRegularEight], async ({ playback, box, commands, run }) => {
      await playback.start({ kind: 'title', id: 'movie' });
      const off = playback.command('s1', offCommand);
      for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is taken.
      const regular = playback.command('s1', { kind: 'tracks', subtitleTrackId: '3', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'regular' });
      for (let i = 0; i < 5; i++) await Promise.resolve();
      if (refusedFirst) { refuse(refusal); expect(await regular).toBe(false); }
      release();
      await off;
      if (!refusedFirst) { refuse(refusal); expect(await regular).toBe(false); }
      const sent = commands.length;
      playback.recover('s1');
      await run();
      expect(box.get().playback.sessionId).toBe('s2');
      expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBeNull();
      expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
    }, c => c.idempotencyKey === 'regular' ? refused : false, c => c.idempotencyKey === 'off' ? reply : undefined);
  }
});

test('a refused switch leaves the switch sent before it to come in', async () => {
  // Pinned to version A, the switch to B is held and B not yet published; the switch to C is refused; B's reply comes in
  // (and the session publishes B, or not yet); B fails: recovery requests B.
  for (const published of [false, true]) {
    let releaseB = () => {};
    const a: File = { source: 'a', version: 'a', ether: true, audioTracks: [audio('1', 'eng')], subtitleTracks: [], selectedAudioTrackId: '1' };
    const b: File = { ...a, source: 'b', version: 'b', generation: 1, seek: 1 };
    const c: File = { ...a, source: 'c', version: 'c', generation: 2, seek: 2 };
    await lab([a, { ...b, generation: 0, seek: 0 }], async ({ playback, box, starts, holdSwitch, run }) => {
      holdSwitch(new Promise<void>(resolve => { releaseB = resolve; }));
      await playback.start({ kind: 'title', id: 'movie', versionId: 'a' });
      const toB = playback.switchVersion('s1', 'b');
      for (let i = 0; i < 5; i++) await Promise.resolve(); // The switch is taken.
      expect(box.get().playback.plan?.selectedVersionId).toBe('a');
      expect(await playback.switchVersion('s1', 'c').catch(() => 'refused')).toBe('refused');
      releaseB();
      await toB;
      if (published) await run(5000);
      playback.recover('s1');
      await run();
      expect(box.get().playback.sessionId).toBe('s2');
      expect(starts.map(request => request.versionId)).toEqual(['a', 'b']);
    }, () => false, () => undefined, undefined, { b, c });
  }
});

test('a player confirmation of the subtitle command awaiting its reply leaves that reply counting', async () => {
  // Off is taken but its reply is held; the player confirms Off, then a report of the same source shows forced 2 again; Off's
  // reply comes in and the session fails onto file C before another report: Off stays.
  let release = () => {};
  const reply = new Promise<void>(resolve => { release = resolve; });
  await lab([forcedTwo, forcedNineRegularEight], async ({ playback, box, commands, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    const off = playback.command('s1', offCommand);
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is taken.
    playback.rememberTrack('s1', 'subtitle', null);
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', sourceGeneration: 0, subtitleTrackId: '2' });
    release();
    await off;
    const sent = commands.length;
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBeNull();
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
  }, () => false, c => c.idempotencyKey === 'off' ? reply : undefined);
});

test('a track command for a session that is no longer the active one does not change the choices of the active one', async () => {
  // Session 1 was recovered onto session 2 (file A again). Off is taken on session 2 but its reply is held; a queued subtitle
  // command for session 1 goes out; Off's reply comes in and session 2 fails onto file C before another report: Off stays.
  let release = () => {};
  const reply = new Promise<void>(resolve => { release = resolve; });
  await lab([forcedTwo, forcedTwo, forcedNineRegularEight], async ({ playback, box, commands, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    const off = playback.command('s2', offCommand);
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is taken.
    void playback.command('s1', { kind: 'tracks', subtitleTrackId: '3', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'departed' });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    release();
    await off;
    const sent = commands.length;
    playback.recover('s2');
    await run();
    expect(box.get().playback.sessionId).toBe('s3');
    expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBeNull();
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
  }, () => false, c => c.idempotencyKey === 'off' ? reply : c.idempotencyKey === 'departed' ? new Promise(() => {}) : undefined);
});

test('an older subtitle reply does not replace a newer subtitle choice the player confirmed', async () => {
  // As above, but the later command's reply is held too and the player confirms its choice before the earlier reply comes in.
  for (const first of ['off', 'regular'] as const) {
    let release = () => {};
    const reply = new Promise<void>(resolve => { release = resolve; });
    await lab([forcedTwo, forcedNineRegularEight], async ({ playback, box, commands, run }) => {
      await playback.start({ kind: 'title', id: 'movie' });
      const regular = { kind: 'tracks', subtitleTrackId: '3', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'regular' } as const;
      const held = playback.command('s1', first === 'off' ? offCommand : regular);
      for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is taken.
      // Sent on the generations the first one moved the file to, so that it is taken and its reply held as well.
      void playback.command('s1', { ...(first === 'off' ? regular : offCommand), sourceGeneration: 1, seekGeneration: 1 });
      for (let i = 0; i < 5; i++) await Promise.resolve();
      playback.rememberTrack('s1', 'subtitle', first === 'off' ? '3' : null);
      release();
      await held;
      const sent = commands.length;
      playback.recover('s1');
      await run();
      expect(box.get().playback.sessionId).toBe('s2');
      expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBe(first === 'off' ? '8' : null);
      expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe(first === 'off' ? '8' : null);
    }, () => false, c => c.idempotencyKey === first ? reply : c.idempotencyKey === (first === 'off' ? 'regular' : 'off') ? new Promise(() => {}) : undefined);
  }
});

test('a subtitle command whose request is lost leaves an earlier accepted one counting', async () => {
  // Off is taken but its reply is held; Regular 3 never reaches the server, before Off's reply comes in or after it; the session
  // fails onto file C before another report: Off stays.
  for (const lostFirst of [true, false]) {
    let release = () => {}, lose = (_: Error) => {};
    const reply = new Promise<void>(resolve => { release = resolve; });
    const lost = new Promise<never>((_, reject) => { lose = reject; });
    lost.catch(() => undefined);
    await lab([forcedTwo, forcedNineRegularEight], async ({ playback, box, commands, run }) => {
      await playback.start({ kind: 'title', id: 'movie' });
      const off = playback.command('s1', offCommand);
      for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is taken.
      const regular = playback.command('s1', { kind: 'tracks', subtitleTrackId: '3', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'regular' });
      for (let i = 0; i < 5; i++) await Promise.resolve();
      if (lostFirst) { lose(new TypeError('fetch failed')); expect(await regular).toBe(false); }
      release();
      await off;
      if (!lostFirst) { lose(new TypeError('fetch failed')); expect(await regular).toBe(false); }
      const sent = commands.length;
      playback.recover('s1');
      await run();
      expect(box.get().playback.sessionId).toBe('s2');
      expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBeNull();
      expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
    }, c => c.idempotencyKey === 'regular' ? lost : false, c => c.idempotencyKey === 'off' ? reply : undefined);
  }
});

test('a refused subtitle command does not undo a choice the player confirmed after an earlier reply', async () => {
  // Regular 3 and then Off are sent; Regular's reply comes in, the player confirms Off, then Off is refused; the session fails
  // onto file C before another report: Off stays.
  let release = () => {}, refuse = (_: Error) => {};
  const reply = new Promise<void>(resolve => { release = resolve; });
  const refused = new Promise<never>((_, reject) => { refuse = reject; });
  refused.catch(() => undefined);
  await lab([forcedTwo, forcedNineRegularEight], async ({ playback, box, commands, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    const regular = playback.command('s1', { kind: 'tracks', subtitleTrackId: '3', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'regular' });
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is taken.
    const off = playback.command('s1', offCommand);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    release();
    expect(await regular).toBe(true);
    playback.rememberTrack('s1', 'subtitle', null);
    refuse(new VelaError({ class: 'request', code: 'invalid_track', message: 'invalid track', retry: { allowed: false } } as never, 422));
    expect(await off).toBe(false);
    const sent = commands.length;
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBeNull();
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
  }, c => c.idempotencyKey === 'off' ? refused : false, c => c.idempotencyKey === 'regular' ? reply : undefined);
});

test('a track command refused after a version switch does not bring back a choice made on the previous version', async () => {
  // On version A, Off and then Regular 3 are sent; Off's reply comes in; the switch to version B (forced 5) comes in; Regular is
  // refused; B fails onto file C, whose default is forced 9: nothing chosen on A is sent.
  let refuse = (_: Error) => {};
  const refused = new Promise<never>((_, reject) => { refuse = reject; });
  refused.catch(() => undefined);
  await lab([{ ...forcedTwo, version: 'a' }, forcedNineRegularEight], async ({ playback, box, commands, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    const off = playback.command('s1', offCommand);
    const regular = playback.command('s1', { kind: 'tracks', subtitleTrackId: '3', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'regular' });
    expect(await off).toBe(true);
    await playback.switchVersion('s1', 'b');
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('5');
    refuse(new VelaError({ class: 'request', code: 'invalid_track', message: 'invalid track', retry: { allowed: false } } as never, 422));
    expect(await regular).toBe(false);
    const sent = commands.length;
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.slice(sent).filter(c => c.kind === 'tracks')).toEqual([]);
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('9');
  }, c => c.idempotencyKey === 'regular' ? refused : false, () => undefined, undefined,
  { b: { source: 'b', version: 'b', ether: true, generation: 2, seek: 2, audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('5', 'eng', { forced: true })], selectedAudioTrackId: '1', selectedSubtitleTrackId: '5' } });
});

test('refused switches sent after a switch awaiting its reply leave the version recovery asks for to the switches that came in', async () => {
  // Pinned to version A, switches to B, C and D are sent before B is published. C and D are refused before B's reply in either
  // order, or after it; or the replies of B and C come in, in either order, and D is refused. The session then fails.
  const a: File = { source: 'a', version: 'a', ether: true, audioTracks: [audio('1', 'eng')], subtitleTracks: [], selectedAudioTrackId: '1' };
  const versions = { b: { ...a, source: 'b', version: 'b' }, c: { ...a, source: 'c', version: 'c' }, d: { ...a, source: 'd', version: 'd' } };
  const refusal = () => new VelaError({ class: 'request', code: 'invalid_version', message: 'invalid version', retry: { allowed: false } } as never, 422);
  const cases = [
    { order: ['c', 'd', 'b'], succeeds: ['b'] }, { order: ['d', 'c', 'b'], succeeds: ['b'] },
    { order: ['b', 'd', 'c'], succeeds: ['b'] }, { order: ['b', 'c', 'd'], succeeds: ['b', 'c'] }, { order: ['c', 'b', 'd'], succeeds: ['b', 'c'] },
  ];
  for (const { order, succeeds } of cases) {
    const settle: Record<string, () => void> = {};
    const held = (version: string) => new Promise<void>(resolve => { settle[version] = resolve; });
    const refusedPromises: Record<string, Promise<never>> = {};
    const refuseNow: Record<string, () => void> = {};
    for (const version of ['c', 'd']) {
      if (succeeds.includes(version)) continue;
      refusedPromises[version] = new Promise<never>((_, reject) => { refuseNow[version] = () => reject(refusal()); });
      refusedPromises[version]!.catch(() => undefined);
    }
    await lab([a, { ...versions[succeeds.at(-1) as 'b' | 'c'], generation: 0, seek: 0 }], async ({ playback, box, starts, holdSwitch, run }) => {
      await playback.start({ kind: 'title', id: 'movie', versionId: 'a' });
      const switches: Record<string, Promise<unknown>> = {};
      for (const version of ['b', 'c', 'd']) {
        holdSwitch(held(version));
        switches[version] = playback.switchVersion('s1', version).catch(() => 'refused');
        for (let i = 0; i < 5; i++) await Promise.resolve(); // The switch is taken.
      }
      expect(box.get().playback.plan?.selectedVersionId).toBe('a');
      for (const version of order) {
        if (succeeds.includes(version)) settle[version]!();
        else refuseNow[version]!();
        if (succeeds.includes(version)) expect(await switches[version]).not.toBe('refused');
        else expect(await switches[version]).toBe('refused');
      }
      playback.recover('s1');
      await run();
      expect(box.get().playback.sessionId).toBe('s2');
      expect(starts.map(request => request.versionId)).toEqual(['a', succeeds.at(-1)!]);
    }, c => c.kind === 'version' ? refusedPromises[c.versionId] ?? false : false, () => undefined, undefined, versions);
  }
});

test('a switch reply that comes after the session published its version ends an earlier error and restarts the budget', async () => {
  // Pinned to version A, the session has had both its restarts; a track command is refused (an error is shown); the switch to B is
  // sent and the session publishes B (revision 2) before the reply (revision 3, position 64) comes in; B then fails before playing.
  let release = () => {};
  const a: File = { source: 'a', version: 'a', ether: true, audioTracks: [audio('1', 'eng')], subtitleTracks: [], selectedAudioTrackId: '1' };
  const b: File = { ...a, source: 'b', version: 'b', generation: 1, seek: 1, revision: 3, position: 64 };
  await lab([a, a, a, { ...b, generation: 0, seek: 0 }], async ({ playback, box, starts, files, holdSwitch, run }) => {
    await playback.start({ kind: 'title', id: 'movie', versionId: 'a' });
    for (const session of ['s1', 's2']) {
      playback.recover(session);
      await run();
    }
    expect(box.get().playback.sessionId).toBe('s3');
    expect(await playback.command('s3', { kind: 'tracks', audioTrackId: '1', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'refused' })).toBe(false);
    expect(box.get().playback.error).not.toBe('');
    holdSwitch(new Promise<void>(resolve => { release = resolve; }));
    const toB = playback.switchVersion('s3', 'b');
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The switch is taken.
    files.set('s3', { ...b, revision: 2, position: 60 });
    await run(5000);
    expect(box.get().playback.plan?.selectedVersionId).toBe('b');
    expect(box.get().playback.plan?.revision).toBe(2);
    release();
    await toB;
    expect(box.get().playback.error).toBe('');
    expect(box.get().playback.plan?.revision).toBe(3);
    expect(box.get().playback.plan?.positionSeconds).toBe(64);
    playback.recover('s3');
    await run();
    expect(box.get().playback.phase).not.toBe('failed');
    expect(box.get().playback.sessionId).toBe('s4');
    expect(starts.map(request => request.versionId)).toEqual(['a', 'a', 'a', 'b']);
  }, c => c.idempotencyKey === 'refused', () => undefined, undefined, { b });
});

test('a player confirmation counts as the latest subtitle command awaiting its reply only when it shows that command\'s choice', async () => {
  // Off and then Regular 3 are taken with both replies held; the player confirms Off again; Regular's reply comes in, then
  // Off's; the session fails onto file C before another report: Off stays.
  let releaseOff = () => {}, releaseRegular = () => {};
  const offReply = new Promise<void>(resolve => { releaseOff = resolve; });
  const regularReply = new Promise<void>(resolve => { releaseRegular = resolve; });
  await lab([forcedTwo, forcedNineRegularEight], async ({ playback, box, commands, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    const off = playback.command('s1', offCommand);
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is taken.
    const regular = playback.command('s1', { kind: 'tracks', subtitleTrackId: '3', sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'regular' });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(commands.filter(c => c.kind === 'tracks').map(c => c.idempotencyKey)).toEqual(['off', 'regular']);
    playback.rememberTrack('s1', 'subtitle', null);
    releaseRegular();
    await regular;
    releaseOff();
    await off;
    const sent = commands.length;
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBeNull();
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
  }, () => false, c => c.idempotencyKey === 'off' ? offReply : c.idempotencyKey === 'regular' ? regularReply : undefined);
});

test('the reply of a track command sent before a version switch does not record its choice on the new version', async () => {
  // On version A, Regular 3 and then Off are sent, Off's reply held; the switch to version B comes in; Off's reply comes in
  // with a plan of B; Regular 3 is chosen on B and answered; B fails onto file C: Regular, as 8.
  let release = (_: File) => {};
  const reply = new Promise<File>(resolve => { release = resolve; });
  const a: File = { ...forcedTwo, ether: false };
  const b: File = { ...a, source: 'b', version: 'b', generation: 1, seek: 1 };
  await lab([a, forcedNineRegularEight], async ({ playback, box, commands, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    expect(await playback.command('s1', { kind: 'tracks', subtitleTrackId: '3', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'regular' })).toBe(true);
    const off = playback.command('s1', offCommand);
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is taken.
    await playback.switchVersion('s1', 'b');
    expect(box.get().playback.plan?.selectedVersionId).toBe('b');
    release({ ...b, selectedSubtitleTrackId: null });
    await off;
    expect(await playback.command('s1', { kind: 'tracks', subtitleTrackId: '3', sourceGeneration: 1, seekGeneration: 0, idempotencyKey: 'regular-b' })).toBe(true);
    const sent = commands.length;
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBe('8');
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('8');
  }, () => false, c => c.idempotencyKey === 'off' ? reply : undefined, undefined, { b });
});

test('track commands whose session never becomes ready leave nothing awaiting a reply', async () => {
  await lab([forcedTwo], async ({ playback }) => {
    const session = (playback as unknown as { session: { ready: () => Promise<unknown> } }).session;
    await playback.start({ kind: 'title', id: 'movie' });
    const ready = session.ready;
    session.ready = async () => { throw new TypeError('fetch failed'); };
    for (const key of ['one', 'two', 'three']) {
      expect(await playback.command('s1', { ...offCommand, idempotencyKey: key })).toBe(false);
    }
    session.ready = ready;
    expect((playback as unknown as { outstanding: Map<unknown, number> }).outstanding.size).toBe(0);
  });
});

/** As forcedTwo and forcedNineRegularEight, with French audio (4 on A, 6 on C). */
const forcedTwoFrench: File = { ...forcedTwo, audioTracks: [audio('1', 'eng'), audio('4', 'fra')] };
const forcedNineFrench: File = { ...forcedNineRegularEight, audioTracks: [audio('1', 'eng'), audio('6', 'fra')] };
const regularCommand = { kind: 'tracks', subtitleTrackId: '3', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'regular' } as const;
const invalidTrack = () => new VelaError({ class: 'request', code: 'invalid_track', message: 'invalid track', retry: { allowed: false } } as never, 422);
const invalidVersion = () => new VelaError({ class: 'request', code: 'invalid_version', message: 'invalid version', retry: { allowed: false } } as never, 422);

test('a track command refused as stale is not sent again when a newer pick of its kind was sent after it', async () => {
  // Off is sent; Regular 3 reaches the server first; Off's stale-generation rejection is delivered; after a player report the
  // session fails onto file C: Regular, as 8. When the newer pick was French audio instead, Off is still sent again.
  for (const newer of ['subtitle', 'audio'] as const) {
    let refuse = (_: Error) => {};
    const refused = new Promise<never>((_, reject) => { refuse = reject; });
    refused.catch(() => undefined);
    await lab([forcedTwoFrench, forcedNineFrench], async ({ playback, box, commands, files, run }) => {
      await playback.start({ kind: 'title', id: 'movie' });
      const off = playback.command('s1', offCommand);
      for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is on its way.
      expect(await playback.command('s1', newer === 'subtitle' ? regularCommand
        : { kind: 'tracks', audioTrackId: '4', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'fra' })).toBe(true);
      refuse(stale(files.get('s1')!));
      expect(await off).toBe(newer === 'audio');
      expect(commands.filter(c => c.kind === 'tracks').map(c => c.idempotencyKey)).toEqual(newer === 'subtitle' ? ['off', 'regular'] : ['off', 'fra', 'key']);
      const now = files.get('s1')!;
      playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', sourceGeneration: now.generation,
        audioTrackId: now.selectedAudioTrackId, subtitleTrackId: now.selectedSubtitleTrackId ?? null });
      const sent = commands.length;
      playback.recover('s1');
      await run();
      expect(box.get().playback.sessionId).toBe('s2');
      const carried = commands.slice(sent).filter(c => c.kind === 'tracks').at(-1);
      expect([carried?.audioTrackId, carried?.subtitleTrackId]).toEqual(newer === 'subtitle' ? [undefined, '8'] : ['6', null]);
      expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe(newer === 'subtitle' ? '8' : null);
    }, c => c.idempotencyKey === 'off' ? refused : false);
  }
});

test('a stale track command for both kinds is sent again only for the kind no newer pick was sent for', async () => {
  // French audio with Off is sent; Regular 3 reaches the server first; the stale-generation rejection of the first is delivered:
  // French alone is sent again, and Regular stays.
  let refuse = (_: Error) => {};
  const refused = new Promise<never>((_, reject) => { refuse = reject; });
  refused.catch(() => undefined);
  await lab([forcedTwoFrench], async ({ playback, commands, files }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    const both = playback.command('s1', { kind: 'tracks', audioTrackId: '4', subtitleTrackId: null, sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'both' });
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is on its way.
    expect(await playback.command('s1', regularCommand)).toBe(true);
    refuse(stale(files.get('s1')!));
    expect(await both).toBe(true);
    const again = commands.filter(c => c.kind === 'tracks').at(-1);
    expect([again?.idempotencyKey, again?.audioTrackId, 'subtitleTrackId' in again]).toEqual(['key', '4', false]);
    expect([files.get('s1')!.selectedAudioTrackId, files.get('s1')!.selectedSubtitleTrackId]).toEqual(['4', '3']);
  }, c => c.idempotencyKey === 'both' ? refused : false);
});

test('a published Off counts as accepted while a newer subtitle pick is still pending', async () => {
  // Off's reply is held; Regular 3 is sent, and the session publishes the plan showing Off while Regular is still on its way; Off's
  // reply is lost (after the publication, or before it); the session fails onto file C before Regular resolves: Off. When Regular
  // then reaches the server and is answered, Regular (as 8); when it is refused, Off.
  const cases = [
    { regular: 'pending', lostFirst: false }, { regular: 'pending', lostFirst: true },
    { regular: 'answered', lostFirst: false }, { regular: 'refused', lostFirst: false },
  ] as const;
  for (const { regular, lostFirst } of cases) {
    let lose = (_: Error) => {}, deliver = (_: unknown) => {}, refuse = (_: Error) => {};
    const offReply = new Promise<never>((_, reject) => { lose = reject; });
    offReply.catch(() => undefined);
    const transit = new Promise<unknown>((resolve, reject) => { deliver = resolve; refuse = reject; });
    transit.catch(() => undefined);
    await lab([forcedTwo, forcedNineRegularEight], async ({ playback, box, commands, run }) => {
      await playback.start({ kind: 'title', id: 'movie' });
      const off = playback.command('s1', offCommand);
      for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is taken.
      const pick = playback.command('s1', { ...regularCommand, sourceGeneration: 1, seekGeneration: 1 });
      for (let i = 0; i < 5; i++) await Promise.resolve();
      if (lostFirst) { lose(new TypeError('fetch failed')); expect(await off).toBe(false); }
      await run(5000);
      expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
      if (!lostFirst) { lose(new TypeError('fetch failed')); expect(await off).toBe(false); }
      if (regular === 'answered') { deliver('deliver'); expect(await pick).toBe(true); }
      if (regular === 'refused') { refuse(invalidTrack()); expect(await pick).toBe(false); }
      const sent = commands.length;
      playback.recover('s1');
      await run();
      expect(box.get().playback.sessionId).toBe('s2');
      expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBe(regular === 'answered' ? '8' : null);
      expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe(regular === 'answered' ? '8' : null);
    }, c => c.idempotencyKey === 'regular' ? transit : false, c => c.idempotencyKey === 'off' ? offReply : undefined);
  }
});

test('a published Off counts for the oldest pending Off, so a Regular sent between them still counts when answered', async () => {
  // Off is taken but its reply held; Regular 3 and then Off again are on their way when the session publishes the plan showing Off
  // (twice); Regular reaches the server and is answered; the session fails onto file C before the second Off resolves: Regular, as 8.
  let deliver = () => {};
  const transit = new Promise<unknown>(resolve => { deliver = () => resolve('deliver'); });
  await lab([forcedTwo, forcedNineRegularEight], async ({ playback, box, commands, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    void playback.command('s1', offCommand);
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is taken.
    const regular = playback.command('s1', { ...regularCommand, sourceGeneration: 1, seekGeneration: 1 });
    void playback.command('s1', { ...offCommand, sourceGeneration: 2, seekGeneration: 2, idempotencyKey: 'off-again' });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await run(5000);
    await run(5000);
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
    deliver();
    expect(await regular).toBe(true);
    const sent = commands.length;
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBe('8');
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('8');
  }, c => c.idempotencyKey === 'regular' ? transit : c.idempotencyKey === 'off-again' ? new Promise(() => {}) : false,
  c => c.idempotencyKey === 'off' ? new Promise(() => {}) : undefined);
});

/** A file of a server whose track commands change no generation (Plex): forced 104 is selected and Regular 105 offered. The
 * replacement selects forced 109 and offers Regular 108. */
const plexForced: File = { source: 'p', audioTracks: [audio('1', 'eng'), audio('2', 'fra')], subtitleTracks: [subtitle('104', 'eng', { forced: true }), subtitle('105', 'eng')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '104' };
const plexReplacement: File = { source: 'q', audioTracks: [audio('1', 'eng'), audio('2', 'fra')], subtitleTracks: [subtitle('109', 'eng', { forced: true }), subtitle('108', 'eng')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '109' };
const plexReport = (tracks: { audioTrackId?: string; subtitleTrackId?: string | null }) =>
  ({ sessionId: 's1', live: null, position: 60, state: 'playing' as const, sourceGeneration: 0, ...tracks });

test('a player report queued before an accepted Off does not undo it', async () => {
  // The server accepts Off without changing generations, but a report queued before it still says forced 104 (after a report of
  // the audio alone, or not); the session fails before the player reports Off: the replacement gets Off, not forced 109.
  for (const audioFirst of [false, true]) {
    await lab([plexForced, plexReplacement], async ({ playback, box, commands, run }) => {
      await playback.start({ kind: 'title', id: 'movie' });
      expect(await playback.command('s1', offCommand)).toBe(true);
      expect(box.get().playback.plan?.sourceGeneration).toBe(0);
      if (audioFirst) playback.snapshot(plexReport({ audioTrackId: '1' }));
      playback.snapshot(plexReport({ audioTrackId: '1', subtitleTrackId: '104' }));
      const sent = commands.length;
      playback.recover('s1');
      await run();
      expect(box.get().playback.sessionId).toBe('s2');
      expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBeNull();
      expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
    });
  }
});

test('after an accepted Off, the earlier subtitle the viewer returns to is theirs', async () => {
  // The server accepts Off without changing generations; the player reports Off and later forced 104, or the viewer picks forced
  // 104 again before any report of Off; the session fails onto the replacement: forced 109, its own default.
  for (const back of ['reported', 'picked'] as const) {
    await lab([plexForced, plexReplacement], async ({ playback, box, commands, run }) => {
      await playback.start({ kind: 'title', id: 'movie' });
      expect(await playback.command('s1', offCommand)).toBe(true);
      if (back === 'reported') playback.snapshot(plexReport({ subtitleTrackId: null }));
      else playback.rememberTrack('s1', 'subtitle', '104');
      playback.snapshot(plexReport({ subtitleTrackId: '104' }));
      const sent = commands.length;
      playback.recover('s1');
      await run();
      expect(box.get().playback.sessionId).toBe('s2');
      expect(commands.slice(sent).filter(c => c.kind === 'tracks')).toEqual([]);
      expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('109');
    });
  }
});

test('a report queued before several accepted subtitle picks in a row does not undo the last', async () => {
  // From forced 104, Off and then Regular 105 are accepted without a generation change; a queued report of 104 or of Off comes
  // in; the session fails onto the replacement: Regular, as 108.
  for (const queued of ['104', null]) {
    await lab([plexForced, plexReplacement], async ({ playback, box, commands, run }) => {
      await playback.start({ kind: 'title', id: 'movie' });
      expect(await playback.command('s1', offCommand)).toBe(true);
      expect(await playback.command('s1', { kind: 'tracks', subtitleTrackId: '105', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'regular' })).toBe(true);
      playback.snapshot(plexReport({ subtitleTrackId: queued }));
      const sent = commands.length;
      playback.recover('s1');
      await run();
      expect(box.get().playback.sessionId).toBe('s2');
      expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBe('108');
      expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('108');
    });
  }
});

test('a refused later pick leaves a queued report of the earlier subtitle ignored', async () => {
  // The server accepts Off without changing generations and refuses Regular 105 next; a report queued before Off still says
  // forced 104; the session fails onto the replacement: Off.
  await lab([plexForced, plexReplacement], async ({ playback, box, commands, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    expect(await playback.command('s1', offCommand)).toBe(true);
    expect(await playback.command('s1', { kind: 'tracks', subtitleTrackId: '105', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'regular' })).toBe(false);
    playback.snapshot(plexReport({ subtitleTrackId: '104' }));
    const sent = commands.length;
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBeNull();
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
  }, c => c.idempotencyKey === 'regular');
});

test('a late reply of an Off the session published does not hold back a later report of the earlier subtitle', async () => {
  // Off's reply is held while the session publishes Off (a new revision, no generation change); the player reports Off; the reply
  // comes in; the player then reports forced 104 and the session fails onto the replacement: forced 109.
  let release = () => {};
  const reply = new Promise<void>(resolve => { release = resolve; });
  await lab([plexForced, plexReplacement], async ({ playback, box, commands, files, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    const off = playback.command('s1', offCommand);
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is taken.
    files.set('s1', { ...plexForced, revision: 2, selectedSubtitleTrackId: null });
    await run(5000);
    expect(box.get().playback.plan?.revision).toBe(2);
    playback.snapshot(plexReport({ subtitleTrackId: null }));
    release();
    expect(await off).toBe(true);
    playback.snapshot(plexReport({ subtitleTrackId: '104' }));
    const sent = commands.length;
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.slice(sent).filter(c => c.kind === 'tracks')).toEqual([]);
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('109');
  }, () => false, c => c.idempotencyKey === 'off' ? reply : undefined);
});

test('a switch whose reply timed out is pinned when the session publishes its version', async () => {
  // Pinned to version A: B applies, its reply times out, then B's plan arrives; B fails: recovery requests B.
  const a: File = { source: 'a', version: 'a', ether: true, audioTracks: [audio('1', 'eng')], subtitleTracks: [], selectedAudioTrackId: '1' };
  const b: File = { ...a, source: 'b', version: 'b', generation: 1, seek: 1 };
  const timeout = Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'));
  timeout.catch(() => undefined);
  await lab([a, { ...b, generation: 0, seek: 0 }], async ({ playback, box, starts, holdSwitch, run }) => {
    holdSwitch(timeout);
    await playback.start({ kind: 'title', id: 'movie', versionId: 'a' });
    expect(await playback.switchVersion('s1', 'b').catch(() => 'timed out')).toBe('timed out');
    expect(box.get().playback.plan?.selectedVersionId).toBe('a');
    await run(5000);
    expect(box.get().playback.plan?.selectedVersionId).toBe('b');
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(starts.map(request => request.versionId)).toEqual(['a', 'b']);
  }, () => false, () => undefined, undefined, { b });
});

test('a switch whose request was lost does not keep a stale track command from being sent again', async () => {
  // Pinned to version A, the switch to B is lost on its way; A moves to a new source before Off reaches the server and is refused
  // as stale: Off is sent again.
  const lost = Promise.reject(new TypeError('fetch failed'));
  lost.catch(() => undefined);
  await lab([{ ...forcedTwo }], async ({ playback, commands, files }) => {
    await playback.start({ kind: 'title', id: 'movie', versionId: 'a' });
    expect(await playback.switchVersion('s1', 'b').catch(() => 'lost')).toBe('lost');
    files.set('s1', { ...files.get('s1')!, generation: 1, seek: 1 });
    expect(await playback.command('s1', offCommand)).toBe(true);
    expect(commands.filter(c => c.kind === 'tracks').map(c => c.subtitleTrackId)).toEqual([null, null]);
    expect(files.get('s1')!.selectedSubtitleTrackId).toBeNull();
  }, c => c.kind === 'version' ? lost : false, () => undefined, undefined, { b: { ...forcedTwo, source: 'b', version: 'b' } });
});

test('a refused overlapping switch does not erase a choice confirmed on the version published before the reply', async () => {
  // Pinned to version A, B's reply is held; C is refused (or C and D, before or after B is published); B is published and Off is
  // confirmed on B; B's reply comes in and B fails onto file C, whose default is forced 9: Off, and recovery requests B.
  const b: File = { source: 'b', version: 'b', ether: true, generation: 1, seek: 1, audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('5', 'eng', { forced: true })], selectedAudioTrackId: '1', selectedSubtitleTrackId: '5' };
  const cases = [{ refused: ['c'], publishedFirst: false }, { refused: ['c', 'd'], publishedFirst: false }, { refused: ['c', 'd'], publishedFirst: true }];
  for (const { refused, publishedFirst } of cases) {
    let releaseB = () => {};
    const refuseNow: Record<string, () => void> = {};
    const refusals: Record<string, Promise<never>> = {};
    for (const version of refused) {
      refusals[version] = new Promise<never>((_, reject) => { refuseNow[version] = () => reject(invalidVersion()); });
      refusals[version]!.catch(() => undefined);
    }
    await lab([forcedTwo, forcedNine], async ({ playback, box, commands, starts, holdSwitch, run }) => {
      holdSwitch(new Promise<void>(resolve => { releaseB = resolve; }));
      await playback.start({ kind: 'title', id: 'movie', versionId: 'a' });
      const toB = playback.switchVersion('s1', 'b');
      for (let i = 0; i < 5; i++) await Promise.resolve(); // The switch is taken.
      const others = refused.map(version => playback.switchVersion('s1', version).catch(() => 'refused'));
      for (let i = 0; i < 5; i++) await Promise.resolve();
      if (publishedFirst) await run(5000);
      for (const version of refused) refuseNow[version]!();
      expect(await Promise.all(others)).toEqual(refused.map(() => 'refused'));
      if (!publishedFirst) await run(5000);
      expect(box.get().playback.plan?.selectedVersionId).toBe('b');
      expect(await playback.command('s1', { ...offCommand, sourceGeneration: 1, seekGeneration: 1 })).toBe(true);
      releaseB();
      await toB;
      expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
      const sent = commands.length;
      playback.recover('s1');
      await run();
      expect(box.get().playback.sessionId).toBe('s2');
      expect(starts.map(request => request.versionId)).toEqual(['a', 'b']);
      expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBeNull();
      expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
    }, c => c.kind === 'version' ? refusals[c.versionId] ?? false : false, () => undefined, undefined, { b });
  }
});

test('a plan naming a switched version published after a later switch took effect does not pin it', async () => {
  // Pinned to version A, B's reply is held; the switch to C is answered; the session then publishes a plan naming B; it fails:
  // recovery requests C. (Switches sent from one plan both name its generations, as a server that takes overlapping switches.)
  const a: File = { source: 'a', version: 'a', audioTracks: [audio('1', 'eng')], subtitleTracks: [], selectedAudioTrackId: '1' };
  const versions = { b: { ...a, source: 'b', version: 'b' }, c: { ...a, source: 'c', version: 'c' } };
  await lab([a, versions.c], async ({ playback, box, starts, files, holdSwitch, run }) => {
    holdSwitch(new Promise<void>(() => {}));
    await playback.start({ kind: 'title', id: 'movie', versionId: 'a' });
    void playback.switchVersion('s1', 'b');
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The switch is taken.
    holdSwitch(Promise.resolve());
    await playback.switchVersion('s1', 'c');
    expect(box.get().playback.plan?.selectedVersionId).toBe('c');
    files.set('s1', { ...versions.b, generation: 3, seek: 3 });
    await run(5000);
    expect(box.get().playback.plan?.selectedVersionId).toBe('b');
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(starts.map(request => request.versionId)).toEqual(['a', 'c']);
  }, () => false, () => undefined, undefined, versions);
});

test('switches to A, B and A in a row followed by a quality change on A keep the choices made on A', async () => {
  // Pinned to version X, switches to A, B and A are sent with their replies held (they move the session to source generations 1,
  // 2 and 3); the session publishes A, Off is taken on A and A moves to a new source (a quality change); the replies come in, B's
  // first, and A fails onto file C, whose default is forced 9: Off, and recovery requests A. (A server that takes overlapping
  // switches.)
  const x: File = { source: 'x', version: 'x', audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('3', 'eng')], selectedAudioTrackId: '1', selectedSubtitleTrackId: '3' };
  const versions: Record<string, File> = { a: { ...x, source: 'a', version: 'a', generation: 1, seek: 1 }, b: { ...x, source: 'b', version: 'b', generation: 2, seek: 2 } };
  const settle: (() => void)[] = [];
  await lab([x, forcedNine], async ({ playback, box, commands, starts, files, holdSwitch, run }) => {
    await playback.start({ kind: 'title', id: 'movie', versionId: 'x' });
    const switches: Promise<unknown>[] = [];
    for (const [i, version] of ['a', 'b', 'a'].entries()) {
      if (i === 2) versions.a = { ...versions.a!, generation: 3, seek: 3 };
      holdSwitch(new Promise<void>(resolve => { settle[i] = resolve; }));
      switches.push(playback.switchVersion('s1', version));
      for (let i = 0; i < 5; i++) await Promise.resolve(); // The switch is taken.
    }
    await run(5000);
    expect(box.get().playback.plan?.selectedVersionId).toBe('a');
    expect(box.get().playback.plan?.sourceGeneration).toBe(3);
    expect(await playback.command('s1', { ...offCommand, sourceGeneration: 3, seekGeneration: 3 })).toBe(true);
    files.set('s1', { ...files.get('s1')!, generation: 5, seek: 5 });
    await run(5000);
    expect(box.get().playback.plan?.sourceGeneration).toBe(5);
    for (const i of [1, 2, 0]) { settle[i]!(); await switches[i]; }
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
    const sent = commands.length;
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(starts.map(request => request.versionId)).toEqual(['x', 'a']);
    expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBeNull();
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
  }, () => false, () => undefined, undefined, versions);
});

test('a published version counts for the oldest switch to it, so a switch sent between them still counts when answered', async () => {
  // Pinned to version X, switches to B, A and B are sent; B's reply is held and the other two are still on their way when the
  // session publishes B; A then reaches the server and is answered, the second B is refused, B's reply comes in and A fails:
  // recovery requests A. (A server that takes overlapping switches.)
  const x: File = { source: 'x', version: 'x', audioTracks: [audio('1', 'eng')], subtitleTracks: [], selectedAudioTrackId: '1' };
  const versions: Record<string, File> = { b: { ...x, source: 'b', version: 'b', generation: 1, seek: 1 }, a: { ...x, source: 'a', version: 'a', generation: 2, seek: 2 } };
  let releaseB = () => {}, deliverA = () => {}, refuseB = () => {};
  const toA = new Promise<unknown>(resolve => { deliverA = () => resolve('deliver'); });
  const againB = new Promise<never>((_, reject) => { refuseB = () => reject(invalidVersion()); });
  againB.catch(() => undefined);
  let sent = 0;
  await lab([x, { ...versions.a!, generation: 0, seek: 0 }], async ({ playback, box, starts, holdSwitch, run }) => {
    await playback.start({ kind: 'title', id: 'movie', versionId: 'x' });
    holdSwitch(new Promise<void>(resolve => { releaseB = resolve; }));
    const first = playback.switchVersion('s1', 'b');
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The switch is taken.
    const second = playback.switchVersion('s1', 'a');
    const third = playback.switchVersion('s1', 'b').catch(() => 'refused');
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await run(5000);
    expect(box.get().playback.plan?.selectedVersionId).toBe('b');
    holdSwitch(Promise.resolve());
    deliverA();
    await second;
    expect(box.get().playback.plan?.selectedVersionId).toBe('a');
    refuseB();
    expect(await third).toBe('refused');
    releaseB();
    await first;
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(starts.map(request => request.versionId)).toEqual(['x', 'a']);
  }, c => c.kind !== 'version' ? false : c.versionId === 'a' ? toA : ++sent === 2 ? againB : false, () => undefined, undefined, versions);
});

test('a published pick counts for the newest pending pick of its kind, not one a later accepted pick replaced', async () => {
  // Off's reply is held or lost; Regular 3 is answered, or confirmed by the player while its reply is held; Off is sent again and
  // taken, its reply held; the session publishes Off and fails onto file C before any report: Off.
  for (const first of ['held', 'lost'] as const) {
    for (const regular of ['answered', 'confirmed'] as const) {
      let lose = (_: Error) => {};
      const offReply = new Promise<never>((_, reject) => { lose = reject; });
      offReply.catch(() => undefined);
      await lab([forcedTwo, forcedNineRegularEight], async ({ playback, box, commands, run }) => {
        await playback.start({ kind: 'title', id: 'movie' });
        const off = playback.command('s1', offCommand);
        for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is taken.
        if (first === 'lost') { lose(new TypeError('fetch failed')); expect(await off).toBe(false); }
        const pick = playback.command('s1', { ...regularCommand, sourceGeneration: 1, seekGeneration: 1 });
        if (regular === 'answered') expect(await pick).toBe(true);
        else {
          for (let i = 0; i < 5; i++) await Promise.resolve();
          playback.rememberTrack('s1', 'subtitle', '3');
        }
        void playback.command('s1', { ...offCommand, sourceGeneration: 2, seekGeneration: 2, idempotencyKey: 'off-again' });
        for (let i = 0; i < 5; i++) await Promise.resolve();
        await run(5000);
        expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
        const sent = commands.length;
        playback.recover('s1');
        await run();
        expect(box.get().playback.sessionId).toBe('s2');
        expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBeNull();
        expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
      }, () => false, c => c.idempotencyKey === 'off' ? offReply
        : c.idempotencyKey === 'off-again' || (regular === 'confirmed' && c.idempotencyKey === 'regular') ? new Promise(() => {}) : undefined);
    }
  }
});

test('a published forced subtitle counts for the newest pick of it after an accepted Off replaced an older one', async () => {
  // From Regular 3, forced 2 is taken but its reply lost; Off is answered; forced 2 is sent again and taken, its reply held; the
  // session publishes forced 2 and fails onto file C before any report: forced 9, its own default, with no track command.
  await lab([{ ...forcedTwo, selectedSubtitleTrackId: '3' }, forcedNineRegularEight], async ({ playback, box, commands, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    expect(await playback.command('s1', { kind: 'tracks', subtitleTrackId: '2', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'forced' })).toBe(false);
    expect(await playback.command('s1', { ...offCommand, sourceGeneration: 1, seekGeneration: 1 })).toBe(true);
    void playback.command('s1', { kind: 'tracks', subtitleTrackId: '2', sourceGeneration: 2, seekGeneration: 2, idempotencyKey: 'forced-again' });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await run(5000);
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('2');
    const sent = commands.length;
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.slice(sent).filter(c => c.kind === 'tracks')).toEqual([]);
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('9');
  }, () => false, c => c.idempotencyKey === 'forced' ? Promise.reject(new TypeError('fetch failed')) : c.idempotencyKey === 'forced-again' ? new Promise(() => {}) : undefined);
});

test('a choice the player confirms after a later pick was sent counts as newer than that pick', async () => {
  // Off's reply is held; Regular 3 is taken but its reply lost; the player confirms Off; the session publishes Regular and fails
  // onto file C: Off.
  await lab([forcedTwo, forcedNineRegularEight], async ({ playback, box, commands, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    void playback.command('s1', offCommand);
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is taken.
    expect(await playback.command('s1', { ...regularCommand, sourceGeneration: 1, seekGeneration: 1 })).toBe(false);
    playback.rememberTrack('s1', 'subtitle', null);
    await run(5000);
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('3');
    const sent = commands.length;
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBeNull();
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
  }, () => false, c => c.idempotencyKey === 'off' ? new Promise(() => {}) : c.idempotencyKey === 'regular' ? Promise.reject(new TypeError('fetch failed')) : undefined);
});

test('a choice the player confirmed is not confirmed again by a later publication after the player reported another', async () => {
  // Off's reply is held; the player confirms Off, then reports a return to forced 2; the session publishes Off and fails onto
  // file C: forced 9, its own default, with no track command.
  await lab([forcedTwo, forcedNineRegularEight], async ({ playback, box, commands, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    void playback.command('s1', offCommand);
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is taken.
    playback.rememberTrack('s1', 'subtitle', null);
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', sourceGeneration: 0, audioTrackId: '1', subtitleTrackId: '2' });
    await run(5000);
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
    const sent = commands.length;
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.slice(sent).filter(c => c.kind === 'tracks')).toEqual([]);
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('9');
  }, () => false, c => c.idempotencyKey === 'off' ? new Promise(() => {}) : undefined);
});

test('a report of the earlier subtitle on the source an accepted Off moved to is taken', async () => {
  // On Ether, Off is answered and moves the source generation; the player then reports forced 2 on the new source; the session
  // fails onto file C: forced 9, its own default, with no track command.
  await lab([forcedTwo, forcedNineRegularEight], async ({ playback, box, commands, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    expect(await playback.command('s1', offCommand)).toBe(true);
    expect(box.get().playback.plan?.sourceGeneration).toBe(1);
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', sourceGeneration: 1, audioTrackId: '1', subtitleTrackId: '2' });
    const sent = commands.length;
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.slice(sent).filter(c => c.kind === 'tracks')).toEqual([]);
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('9');
  });
});

test('after the player reported Off while its reply was awaited, a later report of the earlier subtitle is taken', async () => {
  // The server accepts Off without changing generations; the player reports Off before the reply comes in; it then reports forced
  // 104 and the session fails onto the replacement: forced 109, with no track command.
  let release = () => {};
  const reply = new Promise<void>(resolve => { release = resolve; });
  await lab([plexForced, plexReplacement], async ({ playback, box, commands, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    const off = playback.command('s1', offCommand);
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is on its way.
    playback.snapshot(plexReport({ subtitleTrackId: null }));
    release();
    expect(await off).toBe(true);
    playback.snapshot(plexReport({ subtitleTrackId: '104' }));
    const sent = commands.length;
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.slice(sent).filter(c => c.kind === 'tracks')).toEqual([]);
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('109');
  }, () => false, c => c.idempotencyKey === 'off' ? reply : undefined);
});

test('an older switch reply for a version other than the one shown does not set the version recovery asks for', async () => {
  // Pinned to version X, B is published at source generation 1 with its reply held; A and then B again are sent; the session
  // publishes B at generation 3 without publishing A; A's reply for generation 2 comes in and B fails: recovery requests B.
  // (A server that takes overlapping switches.)
  const x: File = { source: 'x', version: 'x', audioTracks: [audio('1', 'eng')], subtitleTracks: [], selectedAudioTrackId: '1' };
  const versions: Record<string, File> = { b: { ...x, source: 'b', version: 'b', generation: 1, seek: 1 }, a: { ...x, source: 'a', version: 'a', generation: 2, seek: 2 } };
  let releaseA = () => {};
  await lab([x, { ...versions.b!, generation: 0, seek: 0 }], async ({ playback, box, starts, holdSwitch, run }) => {
    await playback.start({ kind: 'title', id: 'movie', versionId: 'x' });
    holdSwitch(new Promise<void>(() => {}));
    void playback.switchVersion('s1', 'b');
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The switch is taken.
    await run(5000);
    expect(box.get().playback.plan?.selectedVersionId).toBe('b');
    holdSwitch(new Promise<void>(resolve => { releaseA = resolve; }));
    const toA = playback.switchVersion('s1', 'a');
    for (let i = 0; i < 5; i++) await Promise.resolve();
    versions.b = { ...versions.b!, generation: 3, seek: 3 };
    holdSwitch(new Promise<void>(() => {}));
    void playback.switchVersion('s1', 'b');
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await run(5000);
    expect([box.get().playback.plan?.selectedVersionId, box.get().playback.plan?.sourceGeneration]).toEqual(['b', 3]);
    releaseA();
    await toA;
    expect(box.get().playback.plan?.selectedVersionId).toBe('b');
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(starts.map(request => request.versionId)).toEqual(['x', 'b']);
  }, () => false, () => undefined, undefined, versions);
});

test('a report of the requested track while the player buffers ends the guard against reports of the earlier one', async () => {
  // From English 1, French 2 is asked for while the player buffers; the server takes it without a generation change and its reply is
  // held; the player reports French while buffering before the reply comes in and again after (or only after, or only before); the
  // viewer then returns to English, reported twice while playing; the session fails onto the replacement: English, its own default,
  // with no track command.
  for (const [before, after] of [[true, true], [false, true], [true, false]]) {
    let release = () => {};
    const reply = new Promise<void>(resolve => { release = resolve; });
    await lab([plexForced, plexReplacement], async ({ playback, box, commands, run }) => {
      await playback.start({ kind: 'title', id: 'movie' });
      const french = playback.command('s1', { kind: 'tracks', audioTrackId: '2', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'french' });
      for (let i = 0; i < 5; i++) await Promise.resolve(); // The server takes it; its reply is held.
      if (before) playback.snapshot({ ...plexReport({ audioTrackId: '2' }), state: 'buffering' });
      release();
      expect(await french).toBe(true);
      expect(box.get().playback.plan?.sourceGeneration).toBe(0);
      if (after) playback.snapshot({ ...plexReport({ audioTrackId: '2' }), state: 'buffering' });
      playback.snapshot(plexReport({ audioTrackId: '1' }));
      playback.snapshot(plexReport({ audioTrackId: '1' }));
      const sent = commands.length;
      playback.recover('s1');
      await run();
      expect(box.get().playback.sessionId).toBe('s2');
      expect(commands.slice(sent).filter(c => c.kind === 'tracks' && c.audioTrackId !== undefined)).toEqual([]);
      expect(box.get().playback.plan?.selectedAudioTrackId).toBe('1');
    }, () => false, c => c.idempotencyKey === 'french' ? reply : undefined);
  }
});

test('a pick the player reported and then left for another track is not confirmed by a later publication', async () => {
  // On Ether, French 4 is taken and reported while playing, but its reply is lost; English 1 is selected locally and reported;
  // the session publishes the plan showing French and fails onto file C before the next report: English, with no audio command.
  let lose = (_: Error) => {};
  const lost = new Promise<never>((_, reject) => { lose = reject; });
  lost.catch(() => undefined);
  await lab([forcedTwoFrench, forcedNineFrench], async ({ playback, box, commands, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    const french = playback.command('s1', { kind: 'tracks', audioTrackId: '4', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'french' });
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is taken.
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', sourceGeneration: 0, audioTrackId: '4', subtitleTrackId: '2' });
    lose(new TypeError('fetch failed'));
    expect(await french).toBe(false);
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', sourceGeneration: 0, audioTrackId: '1', subtitleTrackId: '2' });
    await run(5000);
    expect(box.get().playback.plan?.selectedAudioTrackId).toBe('4');
    const sent = commands.length;
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.slice(sent).filter(c => c.kind === 'tracks' && c.audioTrackId !== undefined)).toEqual([]);
    expect(box.get().playback.plan?.selectedAudioTrackId).toBe('1');
  }, () => false, c => c.idempotencyKey === 'french' ? lost : undefined);
});

test('a track command refused as stale is sent again when the newer pick of its kind was refused outright', async () => {
  // Off is sent and held on its way; Regular 3 is sent and refused outright; the source generation advances on the same file;
  // Off is delivered and refused as stale: Off is sent again, and the session fails onto file C: Off, not forced 9.
  let deliver = () => {};
  const transit = new Promise<unknown>(resolve => { deliver = () => resolve('deliver'); });
  await lab([forcedTwo, forcedNineRegularEight], async ({ playback, box, commands, files, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    const off = playback.command('s1', offCommand);
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is on its way.
    expect(await playback.command('s1', regularCommand)).toBe(false);
    files.set('s1', { ...files.get('s1')!, generation: 1, seek: 1 });
    deliver();
    expect(await off).toBe(true);
    expect(commands.filter(c => c.kind === 'tracks').map(c => c.idempotencyKey)).toEqual(['off', 'regular', 'key']);
    expect(files.get('s1')!.selectedSubtitleTrackId).toBeNull();
    const sent = commands.length;
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBeNull();
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
  }, c => c.idempotencyKey === 'off' ? transit : c.idempotencyKey === 'regular' ? Promise.reject(invalidTrack()) : false);
});

test('a stale track command is not sent again over a newer pick of its kind that was not refused', async () => {
  // Off is sent and held on its way; Regular 3 reaches the server and its reply times out, or is answered and then French audio
  // or forced 2 is refused outright, or the player confirms Regular while its reply is held and forced 2 is refused outright; the
  // source generation advances on the same file; Off is delivered and refused as stale: it is not sent again. When Regular was
  // answered or confirmed, the session fails onto file C: Regular, as 8.
  const cases = [
    { regular: 'timed out', then: undefined }, { regular: 'answered', then: 'fra' },
    { regular: 'answered', then: 'forced' }, { regular: 'confirmed', then: 'forced' },
  ] as const;
  for (const { regular, then } of cases) {
    let deliver = () => {};
    const transit = new Promise<unknown>(resolve => { deliver = () => resolve('deliver'); });
    const timeout = Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'));
    timeout.catch(() => undefined);
    await lab([forcedTwoFrench, forcedNineFrench], async ({ playback, box, commands, files, run }) => {
      await playback.start({ kind: 'title', id: 'movie' });
      const off = playback.command('s1', offCommand);
      for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is on its way.
      const pick = playback.command('s1', regularCommand);
      if (regular === 'confirmed') {
        for (let i = 0; i < 5; i++) await Promise.resolve();
        playback.rememberTrack('s1', 'subtitle', '3');
      } else expect(await pick).toBe(regular === 'answered');
      if (then === 'fra') expect(await playback.command('s1', { kind: 'tracks', audioTrackId: '4', sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'fra' })).toBe(false);
      if (then === 'forced') expect(await playback.command('s1', { kind: 'tracks', subtitleTrackId: '2', sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'forced' })).toBe(false);
      files.set('s1', { ...files.get('s1')!, generation: 2, seek: 2 });
      deliver();
      expect(await off).toBe(false);
      expect(commands.filter(c => c.kind === 'tracks').map(c => c.idempotencyKey)).toEqual(['off', 'regular', ...then ? [then] : []]);
      if (regular === 'timed out') return;
      const sent = commands.length;
      playback.recover('s1');
      await run();
      expect(box.get().playback.sessionId).toBe('s2');
      expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBe('8');
      expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('8');
    }, c => c.idempotencyKey === 'off' ? transit : c.idempotencyKey === 'fra' || c.idempotencyKey === 'forced' ? Promise.reject(invalidTrack()) : false,
    c => c.idempotencyKey !== 'regular' ? undefined : regular === 'timed out' ? timeout : regular === 'confirmed' ? new Promise(() => {}) : undefined);
  }
});

test('a published plan confirms the subtitle of a combined command whose audio a later pick replaced', async () => {
  // French 4 with Off is accepted and its reply held; an English-only change succeeds and publishes English with Off; the session
  // fails onto file C before the combined reply arrives: Off, and English.
  await lab([forcedTwoFrench, forcedNineFrench], async ({ playback, box, commands, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    void playback.command('s1', { kind: 'tracks', audioTrackId: '4', subtitleTrackId: null, sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'both' });
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is taken.
    expect(await playback.command('s1', { kind: 'tracks', audioTrackId: '1', sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'eng' })).toBe(true);
    expect([box.get().playback.plan?.selectedAudioTrackId, box.get().playback.plan?.selectedSubtitleTrackId]).toEqual(['1', null]);
    const sent = commands.length;
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    const carried = commands.slice(sent).filter(c => c.kind === 'tracks');
    expect(carried.at(-1)?.subtitleTrackId).toBeNull();
    expect(carried.some(c => c.audioTrackId !== undefined)).toBe(false);
    expect([box.get().playback.plan?.selectedAudioTrackId, box.get().playback.plan?.selectedSubtitleTrackId]).toEqual(['1', null]);
  }, () => false, c => c.idempotencyKey === 'both' ? new Promise(() => {}) : undefined);
});

test('a combined command whose subtitle a published plan does not show is not confirmed, and its late reply still counts', async () => {
  // French 4 with Off is accepted and its reply held; an English-only change succeeds and publishes English with forced 2, and the
  // session fails onto file C: forced 9, its own default. When the combined reply then arrives (after English with Off was
  // published, or English with forced 2), Off. The audio stays English.
  for (const [shown, reply] of [[null, true], ['2', false], ['2', true]] as const) {
    let release = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    await lab([forcedTwoFrench, forcedNineFrench], async ({ playback, box, commands, files, run }) => {
      await playback.start({ kind: 'title', id: 'movie' });
      const both = playback.command('s1', { kind: 'tracks', audioTrackId: '4', subtitleTrackId: null, sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'both' });
      for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is taken.
      if (shown) files.set('s1', { ...files.get('s1')!, selectedSubtitleTrackId: shown });
      expect(await playback.command('s1', { kind: 'tracks', audioTrackId: '1', sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'eng' })).toBe(true);
      expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe(shown);
      if (reply) { release(); expect(await both).toBe(false); }
      const sent = commands.length;
      playback.recover('s1');
      await run();
      expect(box.get().playback.sessionId).toBe('s2');
      const off = shown === null || reply;
      const carried = commands.slice(sent).filter(c => c.kind === 'tracks');
      expect(carried.some(c => c.audioTrackId !== undefined)).toBe(false);
      if (off) expect(carried.at(-1)?.subtitleTrackId).toBeNull();
      else expect(carried).toEqual([]);
      expect([box.get().playback.plan?.selectedAudioTrackId, box.get().playback.plan?.selectedSubtitleTrackId]).toEqual(['1', off ? null : '9']);
    }, () => false, c => c.idempotencyKey === 'both' ? held : undefined);
  }
});

test('a switch whose reply timed out is pinned when its version plays after a later switch was refused as stale', async () => {
  // Pinned to version A: B applies and its reply times out; C is sent and refused as stale; B's plan arrives and plays; B fails:
  // recovery requests B.
  const a: File = { source: 'a', version: 'a', ether: true, audioTracks: [audio('1', 'eng')], subtitleTracks: [], selectedAudioTrackId: '1' };
  const versions: Record<string, File> = { b: { ...a, source: 'b', version: 'b', generation: 1, seek: 1 }, c: { ...a, source: 'c', version: 'c', generation: 2, seek: 2 } };
  const timeout = Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'));
  timeout.catch(() => undefined);
  await lab([a, { ...versions.b!, generation: 0, seek: 0 }], async ({ playback, box, starts, holdSwitch, run }) => {
    holdSwitch(timeout);
    await playback.start({ kind: 'title', id: 'movie', versionId: 'a' });
    expect(await playback.switchVersion('s1', 'b').catch(() => 'timed out')).toBe('timed out');
    expect(await playback.switchVersion('s1', 'c').catch((error: VelaError) => error.detail.code)).toBe('stale_generation');
    await run(5000);
    expect(box.get().playback.plan?.selectedVersionId).toBe('b');
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(starts.map(request => request.versionId)).toEqual(['a', 'b']);
  }, () => false, () => undefined, undefined, versions);
});

test('a switch whose reply timed out is pinned when its version plays while a later switch is unanswered', async () => {
  // Pinned to version A: B applies and its reply times out; C is on its way when B's plan arrives and plays: B is taken; C is then
  // answered or refused and the session fails: recovery requests C, or B.
  for (const c of ['answered', 'refused'] as const) {
    const a: File = { source: 'a', version: 'a', audioTracks: [audio('1', 'eng')], subtitleTracks: [], selectedAudioTrackId: '1' };
    const versions: Record<string, File> = { b: { ...a, source: 'b', version: 'b', generation: 1, seek: 1 }, c: { ...a, source: 'c', version: 'c', generation: 2, seek: 2 } };
    const timeout = Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'));
    timeout.catch(() => undefined);
    let deliver = () => {}, refuse = () => {};
    const transit = new Promise<unknown>((resolve, reject) => { deliver = () => resolve('deliver'); refuse = () => reject(invalidVersion()); });
    transit.catch(() => undefined);
    const pinned = c === 'answered' ? 'c' : 'b';
    await lab([a, { ...versions[pinned]!, generation: 0, seek: 0 }], async ({ playback, box, starts, holdSwitch, run }) => {
      holdSwitch(timeout);
      await playback.start({ kind: 'title', id: 'movie', versionId: 'a' });
      expect(await playback.switchVersion('s1', 'b').catch(() => 'timed out')).toBe('timed out');
      const toC = playback.switchVersion('s1', 'c').catch(() => 'refused');
      for (let i = 0; i < 5; i++) await Promise.resolve(); // The switch is on its way.
      await run(5000);
      expect(box.get().playback.plan?.selectedVersionId).toBe('b');
      if (c === 'answered') { holdSwitch(Promise.resolve()); deliver(); } else refuse();
      await toC;
      expect(box.get().playback.plan?.selectedVersionId).toBe(pinned);
      playback.recover('s1');
      await run();
      expect(box.get().playback.sessionId).toBe('s2');
      expect(starts.map(request => request.versionId)).toEqual(['a', pinned]);
    }, command => command.kind === 'version' && command.versionId === 'c' ? transit : false, () => undefined, undefined, versions);
  }
});

test('a switch whose reply timed out is not pinned by its plan after a later switch took effect', async () => {
  // Pinned to version A: B applies and its reply times out; the switch to C is answered; the session then publishes a plan naming
  // B; it fails: recovery requests C.
  const a: File = { source: 'a', version: 'a', audioTracks: [audio('1', 'eng')], subtitleTracks: [], selectedAudioTrackId: '1' };
  const versions: Record<string, File> = { b: { ...a, source: 'b', version: 'b', generation: 1, seek: 1 }, c: { ...a, source: 'c', version: 'c', generation: 2, seek: 2 } };
  const timeout = Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'));
  timeout.catch(() => undefined);
  await lab([a, versions.c!], async ({ playback, box, starts, files, holdSwitch, run }) => {
    holdSwitch(timeout);
    await playback.start({ kind: 'title', id: 'movie', versionId: 'a' });
    expect(await playback.switchVersion('s1', 'b').catch(() => 'timed out')).toBe('timed out');
    holdSwitch(Promise.resolve());
    await playback.switchVersion('s1', 'c');
    expect(box.get().playback.plan?.selectedVersionId).toBe('c');
    files.set('s1', { ...versions.b!, generation: 3, seek: 3 });
    await run(5000);
    expect(box.get().playback.plan?.selectedVersionId).toBe('b');
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(starts.map(request => request.versionId)).toEqual(['a', 'c']);
  }, () => false, () => undefined, undefined, versions);
});

test('a published version counts for the oldest switch to it when that switch timed out, so a switch sent between them still counts', async () => {
  // Pinned to version X, B applies and its reply times out; switches to A and B are on their way when the session publishes B;
  // A then reaches the server and is answered, the second B is refused and A fails: recovery requests A.
  const x: File = { source: 'x', version: 'x', audioTracks: [audio('1', 'eng')], subtitleTracks: [], selectedAudioTrackId: '1' };
  const versions: Record<string, File> = { b: { ...x, source: 'b', version: 'b', generation: 1, seek: 1 }, a: { ...x, source: 'a', version: 'a', generation: 2, seek: 2 } };
  const timeout = Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'));
  timeout.catch(() => undefined);
  let deliverA = () => {}, refuseB = () => {};
  const toA = new Promise<unknown>(resolve => { deliverA = () => resolve('deliver'); });
  const againB = new Promise<never>((_, reject) => { refuseB = () => reject(invalidVersion()); });
  againB.catch(() => undefined);
  let sent = 0;
  await lab([x, { ...versions.a!, generation: 0, seek: 0 }], async ({ playback, box, starts, holdSwitch, run }) => {
    await playback.start({ kind: 'title', id: 'movie', versionId: 'x' });
    holdSwitch(timeout);
    expect(await playback.switchVersion('s1', 'b').catch(() => 'timed out')).toBe('timed out');
    const second = playback.switchVersion('s1', 'a');
    const third = playback.switchVersion('s1', 'b').catch(() => 'refused');
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await run(5000);
    expect(box.get().playback.plan?.selectedVersionId).toBe('b');
    holdSwitch(Promise.resolve());
    deliverA();
    await second;
    expect(box.get().playback.plan?.selectedVersionId).toBe('a');
    refuseB();
    expect(await third).toBe('refused');
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(starts.map(request => request.versionId)).toEqual(['x', 'a']);
  }, c => c.kind !== 'version' ? false : c.versionId === 'a' ? toA : ++sent === 2 ? againB : false, () => undefined, undefined, versions);
});

test('a late reply of an accepted Off does not record it after the player showed Off and then Regular', async () => {
  // The server accepts Off at the same generation and its reply is held; the player reports Off, then Regular 105; the reply is
  // released and the session fails onto the replacement: Regular, as 108.
  let release = () => {};
  const reply = new Promise<void>(resolve => { release = resolve; });
  await lab([plexForced, plexReplacement], async ({ playback, box, commands, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    const off = playback.command('s1', offCommand);
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is on its way.
    playback.snapshot(plexReport({ subtitleTrackId: null }));
    playback.snapshot(plexReport({ subtitleTrackId: '105' }));
    release();
    expect(await off).toBe(true);
    expect(box.get().playback.plan?.sourceGeneration).toBe(0);
    const sent = commands.length;
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBe('108');
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('108');
  }, () => false, c => c.idempotencyKey === 'off' ? reply : undefined);
});

test('a late reply of an accepted Off records it when the player stays on Off or never reported it', async () => {
  // The server accepts Off at the same generation and its reply is held; the player reports Off and stays on it, or reports
  // nothing, or only a queued forced 104; the reply is released and the session fails onto the replacement: Off.
  for (const reports of [[null, null], [], ['104']] as (string | null)[][]) {
    let release = () => {};
    const reply = new Promise<void>(resolve => { release = resolve; });
    await lab([plexForced, plexReplacement], async ({ playback, box, commands, run }) => {
      await playback.start({ kind: 'title', id: 'movie' });
      const off = playback.command('s1', offCommand);
      for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is on its way.
      for (const id of reports) playback.snapshot(plexReport({ subtitleTrackId: id }));
      release();
      expect(await off).toBe(true);
      const sent = commands.length;
      playback.recover('s1');
      await run();
      expect(box.get().playback.sessionId).toBe('s2');
      expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBeNull();
      expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
    }, () => false, c => c.idempotencyKey === 'off' ? reply : undefined);
  }
});

test('a late reply of an Off a published plan confirmed does not record it after the player showed another subtitle on that plan', async () => {
  // On Ether, Off is taken and its reply held; the session publishes Off on the new source; the player reports forced 2 there, or
  // Off; the reply comes in and the session fails onto file C: forced 9, its own default, with no track command, or Off.
  for (const report of ['2', null] as const) {
    let release = () => {};
    const reply = new Promise<void>(resolve => { release = resolve; });
    await lab([forcedTwo, forcedNineRegularEight], async ({ playback, box, commands, run }) => {
      await playback.start({ kind: 'title', id: 'movie' });
      const off = playback.command('s1', offCommand);
      for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is taken.
      await run(5000);
      expect([box.get().playback.plan?.sourceGeneration, box.get().playback.plan?.selectedSubtitleTrackId]).toEqual([1, null]);
      playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', sourceGeneration: 1, audioTrackId: '1', subtitleTrackId: report });
      release();
      await off;
      const sent = commands.length;
      playback.recover('s1');
      await run();
      expect(box.get().playback.sessionId).toBe('s2');
      if (report) expect(commands.slice(sent).filter(c => c.kind === 'tracks')).toEqual([]);
      else expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBeNull();
      expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe(report ? '9' : null);
    }, () => false, c => c.idempotencyKey === 'off' ? reply : undefined);
  }
});

test('a stale track command is not sent again for a kind the player showed and then left', async () => {
  // Off is sent and held on its way; the player reports Off, then forced 2; the source generation advances on the same file; Off
  // is delivered and refused as stale: it is not sent again, and the session fails onto file C: forced 9, with no track command.
  let deliver = () => {};
  const transit = new Promise<unknown>(resolve => { deliver = () => resolve('deliver'); });
  await lab([forcedTwo, forcedNineRegularEight], async ({ playback, box, commands, files, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    const off = playback.command('s1', offCommand);
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is on its way.
    for (const id of [null, '2']) playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', sourceGeneration: 0, audioTrackId: '1', subtitleTrackId: id });
    files.set('s1', { ...files.get('s1')!, generation: 1, seek: 1 });
    deliver();
    expect(await off).toBe(false);
    expect(commands.filter(c => c.kind === 'tracks').map(c => c.idempotencyKey)).toEqual(['off']);
    const sent = commands.length;
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.slice(sent).filter(c => c.kind === 'tracks')).toEqual([]);
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('9');
  }, c => c.idempotencyKey === 'off' ? transit : false);
});

test('a stale track command is not sent again over a newer pick the player confirmed before the server refused it', async () => {
  // Off is sent and held on its way; Regular 3 is sent, the player confirms it and the server then refuses it outright; the source
  // generation advances on the same file; Off is delivered and refused as stale: it is not sent again, and the session fails onto
  // file C: Regular, as 8.
  let deliver = () => {};
  const transit = new Promise<unknown>(resolve => { deliver = () => resolve('deliver'); });
  let refuse = () => {};
  const refusal = new Promise<unknown>((_, reject) => { refuse = () => reject(invalidTrack()); });
  refusal.catch(() => undefined);
  await lab([forcedTwo, forcedNineRegularEight], async ({ playback, box, commands, files, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    const off = playback.command('s1', offCommand);
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is on its way.
    const regular = playback.command('s1', regularCommand);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    playback.rememberTrack('s1', 'subtitle', '3');
    refuse();
    expect(await regular).toBe(false);
    files.set('s1', { ...files.get('s1')!, generation: 1, seek: 1 });
    deliver();
    expect(await off).toBe(false);
    expect(commands.filter(c => c.kind === 'tracks').map(c => c.idempotencyKey)).toEqual(['off', 'regular']);
    const sent = commands.length;
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBe('8');
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('8');
  }, c => c.idempotencyKey === 'off' ? transit : c.idempotencyKey === 'regular' ? refusal : false);
});

test('a plan held back for moving only the clock still confirms the last pending Off before an older Regular reply', async () => {
  // Off, Regular 105 and Off again are accepted at the same generation with their replies held; the session publishes Off at
  // revision 2 and, with nothing else changed, at revision 4, which only moves the clock; Regular's reply of revision 3 is released
  // and the session fails onto the replacement: Off.
  let release = () => {};
  const reply = new Promise<File>(resolve => { release = () => resolve({ ...plexForced, revision: 3, selectedSubtitleTrackId: '105' }); });
  await lab([plexForced, plexReplacement], async ({ playback, box, commands, files, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    void playback.command('s1', offCommand);
    const regular = playback.command('s1', { ...regularCommand, subtitleTrackId: '105' });
    void playback.command('s1', { ...offCommand, idempotencyKey: 'off-again' });
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The commands are taken.
    files.set('s1', { ...plexForced, revision: 2, selectedSubtitleTrackId: null });
    await run(5000);
    expect([box.get().playback.plan?.revision, box.get().playback.plan?.selectedSubtitleTrackId]).toEqual([2, null]);
    files.set('s1', { ...plexForced, revision: 4, selectedSubtitleTrackId: null });
    await run(5000);
    // Heard, but kept off the screen (plan-clock.ts).
    expect(box.get().playback.plan?.revision).toBe(2);
    expect((playback as unknown as { clockAhead: PlaybackPlan | null }).clockAhead?.revision).toBe(4);
    release();
    expect(await regular).toBe(true);
    const sent = commands.length;
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBeNull();
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
  }, () => false, c => c.idempotencyKey === 'regular' ? reply : c.idempotencyKey === 'off' || c.idempotencyKey === 'off-again' ? new Promise(() => {}) : undefined);
});

test('a stale combined command sent again for audio alone does not hold back an older subtitle command', async () => {
  // Off, then French 4 with Regular 3, then forced 2 are sent and held on their way; the source generation advances on the same
  // file; the combined command is delivered, refused as stale and sent again for French alone; forced 2 is refused outright; Off is
  // delivered and refused as stale: it is sent again, and the session fails onto file C: Off, with French as 6.
  let deliverOff = () => {}, deliverCombined = () => {}, refuseForced = () => {};
  const offTransit = new Promise<unknown>(resolve => { deliverOff = () => resolve('deliver'); });
  const combinedTransit = new Promise<unknown>(resolve => { deliverCombined = () => resolve('deliver'); });
  const forcedTransit = new Promise<unknown>((_, reject) => { refuseForced = () => reject(invalidTrack()); });
  forcedTransit.catch(() => undefined);
  await lab([forcedTwoFrench, forcedNineFrench], async ({ playback, box, commands, files, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    const off = playback.command('s1', offCommand);
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is on its way.
    const combined = playback.command('s1', { kind: 'tracks', audioTrackId: '4', subtitleTrackId: '3', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'combined' });
    const forced = playback.command('s1', { kind: 'tracks', subtitleTrackId: '2', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'forced' });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    files.set('s1', { ...files.get('s1')!, generation: 1, seek: 1 });
    deliverCombined();
    expect(await combined).toBe(true);
    refuseForced();
    expect(await forced).toBe(false);
    deliverOff();
    expect(await off).toBe(true);
    expect(commands.filter(c => c.kind === 'tracks').map(c => [c.idempotencyKey, c.audioTrackId, c.subtitleTrackId]))
      .toEqual([['off', undefined, null], ['combined', '4', '3'], ['forced', undefined, '2'], ['key', '4', undefined], ['key', undefined, null]]);
    const sent = commands.length;
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBeNull();
    expect([box.get().playback.plan?.selectedAudioTrackId, box.get().playback.plan?.selectedSubtitleTrackId]).toEqual(['6', null]);
  }, c => c.idempotencyKey === 'off' ? offTransit : c.idempotencyKey === 'combined' ? combinedTransit : c.idempotencyKey === 'forced' ? forcedTransit : false);
});

test('a late reply of an accepted Off does not record it after the player showed Off before the command left and then Regular', async () => {
  // The server accepts Off at the same generation and its reply is held; the player reports Off before the command has left, then
  // Regular 105; the reply is released and the session fails onto the replacement: Regular, as 108.
  let release = () => {};
  const reply = new Promise<void>(resolve => { release = resolve; });
  await lab([plexForced, plexReplacement], async ({ playback, box, commands, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    const off = playback.command('s1', offCommand);
    playback.snapshot(plexReport({ subtitleTrackId: null }));
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is on its way.
    playback.snapshot(plexReport({ subtitleTrackId: '105' }));
    release();
    expect(await off).toBe(true);
    const sent = commands.length;
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBe('108');
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('108');
  }, () => false, c => c.idempotencyKey === 'off' ? reply : undefined);
});

test('a late reply of an accepted Off does not put Off back on the plan shown after Regular was accepted and reported', async () => {
  // The server accepts Off at the same generation and its reply is held; the session publishes Off; Regular 105 is accepted and the
  // player reports it; Off's reply is released: the plan shown stays Regular 105, and after a report of what it shows the session
  // fails onto the replacement: Regular, as 108.
  let release = () => {};
  const reply = new Promise<File>(resolve => { release = () => resolve({ ...plexForced, revision: 2, selectedSubtitleTrackId: null }); });
  await lab([plexForced, plexReplacement], async ({ playback, box, commands, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    const off = playback.command('s1', offCommand);
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is taken.
    await run(5000);
    expect([box.get().playback.plan?.revision, box.get().playback.plan?.selectedSubtitleTrackId]).toEqual([2, null]);
    expect(await playback.command('s1', { ...regularCommand, subtitleTrackId: '105' })).toBe(true);
    playback.snapshot(plexReport({ subtitleTrackId: '105' }));
    release();
    expect(await off).toBe(true);
    const shown = box.get().playback.plan!;
    expect([shown.revision, shown.selectedSubtitleTrackId]).toEqual([3, '105']);
    playback.snapshot(plexReport({ audioTrackId: shown.selectedAudioTrackId, subtitleTrackId: shown.selectedSubtitleTrackId ?? null }));
    const sent = commands.length;
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBe('108');
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('108');
  }, () => false, c => c.idempotencyKey === 'off' ? reply : undefined);
});

test('a late audio reply does not put back the subtitle a later pick replaced on the plan shown', async () => {
  // French audio 2 is accepted at the same generation and its reply held; Regular 105 is accepted; the French reply is released,
  // older on revision than the plan shown or newer: the plan shows French with Regular 105, and the session fails onto the
  // replacement: French, and Regular as 108.
  for (const revision of [2, 4]) {
    let release = () => {};
    const reply = new Promise<File>(resolve => { release = () => resolve({ ...plexForced, revision, selectedAudioTrackId: '2' }); });
    await lab([plexForced, plexReplacement], async ({ playback, box, commands, run }) => {
      await playback.start({ kind: 'title', id: 'movie' });
      const french = playback.command('s1', { kind: 'tracks', audioTrackId: '2', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'fra' });
      for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is taken.
      expect(await playback.command('s1', { ...regularCommand, subtitleTrackId: '105' })).toBe(true);
      release();
      expect(await french).toBe(true);
      expect([box.get().playback.plan?.selectedAudioTrackId, box.get().playback.plan?.selectedSubtitleTrackId]).toEqual(['2', '105']);
      const sent = commands.length;
      playback.recover('s1');
      await run();
      expect(box.get().playback.sessionId).toBe('s2');
      expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBe('108');
      expect([box.get().playback.plan?.selectedAudioTrackId, box.get().playback.plan?.selectedSubtitleTrackId]).toEqual(['2', '108']);
    }, () => false, c => c.idempotencyKey === 'fra' ? reply : undefined);
  }
});

test('a late reply of a combined command at the same generation leaves the audio a later pick chose on the plan shown', async () => {
  // French 2 with Off is accepted at the same generation and its reply held; English 1 alone is accepted; the combined reply is
  // released, older on revision than the plan shown or newer: the plan shows English with Off, and the session fails onto the
  // replacement: Off, and English.
  for (const revision of [2, 4]) {
    let release = () => {};
    const reply = new Promise<File>(resolve => { release = () => resolve({ ...plexForced, revision, selectedAudioTrackId: '2', selectedSubtitleTrackId: null }); });
    await lab([plexForced, plexReplacement], async ({ playback, box, commands, run }) => {
      await playback.start({ kind: 'title', id: 'movie' });
      const both = playback.command('s1', { kind: 'tracks', audioTrackId: '2', subtitleTrackId: null, sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'both' });
      for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is taken.
      expect(await playback.command('s1', { kind: 'tracks', audioTrackId: '1', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'eng' })).toBe(true);
      release();
      expect(await both).toBe(true);
      expect([box.get().playback.plan?.selectedAudioTrackId, box.get().playback.plan?.selectedSubtitleTrackId]).toEqual(['1', null]);
      const sent = commands.length;
      playback.recover('s1');
      await run();
      expect(box.get().playback.sessionId).toBe('s2');
      const carried = commands.slice(sent).filter(c => c.kind === 'tracks');
      expect(carried.at(-1)?.subtitleTrackId).toBeNull();
      expect(carried.some(c => c.audioTrackId !== undefined)).toBe(false);
      expect([box.get().playback.plan?.selectedAudioTrackId, box.get().playback.plan?.selectedSubtitleTrackId]).toEqual(['1', null]);
    }, () => false, c => c.idempotencyKey === 'both' ? reply : undefined);
  }
});

test('a late reply of an Off a published plan confirmed still shows its newer plan', async () => {
  // Off is accepted at the same generation and its reply held; the session publishes Off; the reply comes in with a later revision:
  // its plan is shown, and the session fails onto the replacement: Off.
  let release = () => {};
  const reply = new Promise<File>(resolve => { release = () => resolve({ ...plexForced, revision: 3, position: 90, selectedSubtitleTrackId: null }); });
  await lab([plexForced, plexReplacement], async ({ playback, box, commands, run }) => {
    await playback.start({ kind: 'title', id: 'movie' });
    const off = playback.command('s1', offCommand);
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is taken.
    await run(5000);
    expect(box.get().playback.plan?.revision).toBe(2);
    release();
    expect(await off).toBe(true);
    expect([box.get().playback.plan?.revision, box.get().playback.plan?.positionSeconds, box.get().playback.plan?.selectedSubtitleTrackId]).toEqual([3, 90, null]);
    const sent = commands.length;
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBeNull();
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
  }, () => false, c => c.idempotencyKey === 'off' ? reply : undefined);
});

/** Version B of the tests below: a new source with a forced subtitle, 5, that it selects. */
const forcedFive: File = { source: 'b', version: 'b', ether: true, generation: 1, seek: 1, audioTracks: [audio('1', 'eng')], subtitleTracks: [subtitle('5', 'eng', { forced: true })], selectedAudioTrackId: '1', selectedSubtitleTrackId: '5' };

test('a stale track command is not sent again onto the version a switch whose reply timed out moved the session to', async () => {
  // Pinned to version A, Off is sent and held on its way; B applies, its switch reply times out and its plan is held back, so A is
  // still shown; Off is delivered and refused as stale: it is not sent again, and B keeps its forced 5.
  let deliver = () => {};
  const transit = new Promise<unknown>(resolve => { deliver = () => resolve('deliver'); });
  const timeout = Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'));
  timeout.catch(() => undefined);
  await lab([forcedTwo], async ({ playback, box, commands, files, holdSwitch }) => {
    holdSwitch(timeout);
    await playback.start({ kind: 'title', id: 'movie', versionId: 'a' });
    const off = playback.command('s1', offCommand);
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is on its way.
    expect(await playback.switchVersion('s1', 'b').catch(() => 'timed out')).toBe('timed out');
    expect(box.get().playback.plan?.selectedVersionId).toBe('a');
    deliver();
    expect(await off).toBe(false);
    expect(commands.filter(c => c.kind === 'tracks').map(c => c.idempotencyKey)).toEqual(['off']);
    expect(files.get('s1')!.selectedSubtitleTrackId).toBe('5');
  }, c => c.idempotencyKey === 'off' ? transit : false, () => undefined, undefined, { b: forcedFive });
});

test('a switch the server refused does not keep a stale track command from being sent again, and one taken in does', async () => {
  // Pinned to version A, Off is sent and held on its way; the switch to B is refused; A moves to a new source and Off is delivered
  // and refused as stale: Off is sent again. When B applied instead, its reply timed out and the session then published B, Off is
  // not sent again and B keeps its forced 5.
  for (const toB of ['refused', 'published'] as const) {
    let deliver = () => {};
    const transit = new Promise<unknown>(resolve => { deliver = () => resolve('deliver'); });
    const timeout = Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'));
    timeout.catch(() => undefined);
    await lab([forcedTwo], async ({ playback, box, commands, files, holdSwitch, run }) => {
      holdSwitch(timeout);
      await playback.start({ kind: 'title', id: 'movie', versionId: 'a' });
      const off = playback.command('s1', offCommand);
      for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is on its way.
      expect(await playback.switchVersion('s1', 'b').catch(() => 'failed')).toBe('failed');
      if (toB === 'refused') files.set('s1', { ...files.get('s1')!, generation: 1, seek: 1 });
      else {
        await run(5000);
        expect(box.get().playback.plan?.selectedVersionId).toBe('b');
      }
      deliver();
      expect(await off).toBe(toB === 'refused');
      expect(commands.filter(c => c.kind === 'tracks').map(c => c.idempotencyKey)).toEqual(toB === 'refused' ? ['off', 'key'] : ['off']);
      expect(files.get('s1')!.selectedSubtitleTrackId).toBe(toB === 'refused' ? null : '5');
    }, c => c.idempotencyKey === 'off' ? transit : toB === 'refused' && c.kind === 'version' ? Promise.reject(invalidVersion()) : false,
    () => undefined, undefined, { b: forcedFive });
  }
});

test('a pick that never reached the server does not keep an older stale track command from being sent again', async () => {
  // Off is sent and held on its way; Regular 3 fails in session.ready() before it reaches the server; the source generation
  // advances on the same file; Off is delivered and refused as stale: only Off reached the server, it is sent again once, and the
  // session fails onto file C: Off, not forced 9.
  let deliver = () => {};
  const transit = new Promise<unknown>(resolve => { deliver = () => resolve('deliver'); });
  await lab([forcedTwo, forcedNineRegularEight], async ({ playback, box, commands, files, run }) => {
    const session = (playback as unknown as { session: { ready: () => Promise<unknown> } }).session;
    await playback.start({ kind: 'title', id: 'movie' });
    const off = playback.command('s1', offCommand);
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is on its way.
    const ready = session.ready;
    session.ready = async () => { throw new TypeError('fetch failed'); };
    expect(await playback.command('s1', regularCommand)).toBe(false);
    session.ready = ready;
    files.set('s1', { ...files.get('s1')!, generation: 1, seek: 1 });
    deliver();
    expect(await off).toBe(true);
    expect(commands.filter(c => c.kind === 'tracks').map(c => c.idempotencyKey)).toEqual(['off', 'key']);
    expect(files.get('s1')!.selectedSubtitleTrackId).toBeNull();
    const sent = commands.length;
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBeNull();
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
  }, c => c.idempotencyKey === 'off' ? transit : false);
});

test('a pick the player confirmed before it failed to reach the server still keeps an older stale track command from being sent again', async () => {
  // Off is sent and held on its way; Regular 3 waits for session.ready(), the player confirms Regular and ready() then fails; the
  // source generation advances on the same file; Off is delivered and refused as stale: it is not sent again, and the session fails
  // onto file C: Regular, as 8.
  let deliver = () => {};
  const transit = new Promise<unknown>(resolve => { deliver = () => resolve('deliver'); });
  await lab([forcedTwo, forcedNineRegularEight], async ({ playback, box, commands, files, run }) => {
    const session = (playback as unknown as { session: { ready: () => Promise<unknown> } }).session;
    await playback.start({ kind: 'title', id: 'movie' });
    const off = playback.command('s1', offCommand);
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is on its way.
    const ready = session.ready;
    let fail = () => {};
    session.ready = () => new Promise((_, reject) => { fail = () => reject(new TypeError('fetch failed')); });
    const regular = playback.command('s1', regularCommand);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    playback.rememberTrack('s1', 'subtitle', '3');
    fail();
    expect(await regular).toBe(false);
    session.ready = ready;
    files.set('s1', { ...files.get('s1')!, generation: 1, seek: 1 });
    deliver();
    expect(await off).toBe(false);
    expect(commands.filter(c => c.kind === 'tracks').map(c => c.idempotencyKey)).toEqual(['off']);
    const sent = commands.length;
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBe('8');
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('8');
  }, c => c.idempotencyKey === 'off' ? transit : false);
});

test('a late reply of one kind shows the other kind the player confirmed after a later pick', async () => {
  // French 4 is held on its way; Regular 3 is taken (a new source) and its reply held; the player confirms Regular while the plan
  // shown still has forced 2; French is delivered, refused as stale and sent again, and its reply shows French with Regular 3: the
  // plan shows them, and after a report of what it shows the session fails onto file C: French as 6, and Regular as 8. The same
  // with Off held on its way and French 4 taken and confirmed: French with Off, then French as 6 and Off.
  const frenchCommand = { kind: 'tracks', audioTrackId: '4', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'fra' } as const;
  for (const [first, later, kind, id, expected] of [[frenchCommand, regularCommand, 'subtitle', '3', ['4', '3', '6', '8']],
    [offCommand, frenchCommand, 'audio', '4', ['4', null, '6', null]]] as const) {
    let deliver = () => {};
    const transit = new Promise<unknown>(resolve => { deliver = () => resolve('deliver'); });
    const held = new Promise<unknown>(() => {});
    await lab([forcedTwoFrench, forcedNineFrench], async ({ playback, box, commands, run }) => {
      await playback.start({ kind: 'title', id: 'movie' });
      const late = playback.command('s1', first);
      for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is on its way.
      void playback.command('s1', later);
      for (let i = 0; i < 5; i++) await Promise.resolve(); // The server takes it.
      playback.rememberTrack('s1', kind, id);
      expect([box.get().playback.plan?.selectedAudioTrackId, box.get().playback.plan?.selectedSubtitleTrackId]).toEqual(['1', '2']);
      deliver();
      expect(await late).toBe(true);
      const shown = box.get().playback.plan!;
      expect([shown.selectedAudioTrackId, shown.selectedSubtitleTrackId]).toEqual(expected.slice(0, 2));
      playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', sourceGeneration: shown.sourceGeneration,
        audioTrackId: shown.selectedAudioTrackId, subtitleTrackId: shown.selectedSubtitleTrackId ?? null });
      const sent = commands.length;
      playback.recover('s1');
      await run();
      expect(box.get().playback.sessionId).toBe('s2');
      expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBe(expected[3]);
      expect([box.get().playback.plan?.selectedAudioTrackId, box.get().playback.plan?.selectedSubtitleTrackId]).toEqual(expected.slice(2));
    }, c => c.idempotencyKey === first.idempotencyKey ? transit : false, c => c.idempotencyKey === later.idempotencyKey ? held : undefined);
  }
});

test('a stale track command is sent again after a lost switch when the session names the release playing only beside its plan', async () => {
  // Pinned to version A, whose plans name no source and the session the release playing only beside the plan it reads; the switch
  // to B is lost on its way; A moves to a new source before Off reaches the server and is refused as stale: Off is sent again.
  const lost = Promise.reject(new TypeError('fetch failed'));
  lost.catch(() => undefined);
  await lab([{ ...forcedTwo, source: undefined }], async ({ playback, commands, files }) => {
    const session = (playback as unknown as { session: { ready: () => Promise<{ adapter: any }> } }).session;
    const ready = session.ready;
    session.ready = async () => {
      const connection = await ready();
      const { adapter } = connection;
      return { ...connection, adapter: { ...adapter,
        startPlayback: async (request: any) => ({ ...await adapter.startPlayback(request), playingVersionId: 'a' }),
        sessionSnapshot: async (id: string) => ({ ...await adapter.sessionSnapshot(id), playingVersionId: 'a' }) } };
    };
    await playback.start({ kind: 'title', id: 'movie', versionId: 'a' });
    expect(await playback.switchVersion('s1', 'b').catch(() => 'lost')).toBe('lost');
    files.set('s1', { ...files.get('s1')!, generation: 1, seek: 1 });
    expect(await playback.command('s1', offCommand)).toBe(true);
    expect(commands.filter(c => c.kind === 'tracks').map(c => c.subtitleTrackId)).toEqual([null, null]);
    expect(files.get('s1')!.selectedSubtitleTrackId).toBeNull();
  }, c => c.kind === 'version' ? lost : false, () => undefined, undefined, { b: { ...forcedTwo, source: undefined, version: 'b' } });
});

test('a pick the player reported before it failed to reach the server still keeps an older stale track command from being sent again', async () => {
  // Off is sent and held on its way; Regular 3 waits for session.ready(), the player reports Regular while playing or paused and
  // ready() then fails; the source generation advances on the same file; Off is delivered and refused as stale: it is not sent
  // again, and the session fails onto file C: Regular, as 8.
  for (const state of ['playing', 'paused'] as const) {
    let deliver = () => {};
    const transit = new Promise<unknown>(resolve => { deliver = () => resolve('deliver'); });
    await lab([forcedTwo, forcedNineRegularEight], async ({ playback, box, commands, files, run }) => {
      const session = (playback as unknown as { session: { ready: () => Promise<unknown> } }).session;
      await playback.start({ kind: 'title', id: 'movie' });
      const off = playback.command('s1', offCommand);
      for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is on its way.
      const ready = session.ready;
      let fail = () => {};
      session.ready = () => new Promise((_, reject) => { fail = () => reject(new TypeError('fetch failed')); });
      const regular = playback.command('s1', regularCommand);
      for (let i = 0; i < 5; i++) await Promise.resolve();
      playback.snapshot({ sessionId: 's1', live: null, position: 60, state, sourceGeneration: 0, audioTrackId: '1', subtitleTrackId: '3' });
      fail();
      expect(await regular).toBe(false);
      session.ready = ready;
      files.set('s1', { ...files.get('s1')!, generation: 1, seek: 1 });
      deliver();
      expect(await off).toBe(false);
      expect(commands.filter(c => c.kind === 'tracks').map(c => c.idempotencyKey)).toEqual(['off']);
      const sent = commands.length;
      playback.recover('s1');
      await run();
      expect(box.get().playback.sessionId).toBe('s2');
      expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBe('8');
      expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('8');
    }, c => c.idempotencyKey === 'off' ? transit : false);
  }
});

test('a pick the player reported only while buffering before it failed to reach the server does not keep an older stale track command from being sent again', async () => {
  // Off is sent and held on its way; Regular 3 waits for session.ready(), the player reports Regular only while buffering and
  // ready() then fails; the source generation advances on the same file; Off is delivered and refused as stale: Regular was never
  // recorded, so Off is sent again once, and the session fails onto file C: Off, not forced 9.
  let deliver = () => {};
  const transit = new Promise<unknown>(resolve => { deliver = () => resolve('deliver'); });
  await lab([forcedTwo, forcedNineRegularEight], async ({ playback, box, commands, files, run }) => {
    const session = (playback as unknown as { session: { ready: () => Promise<unknown> } }).session;
    await playback.start({ kind: 'title', id: 'movie' });
    const off = playback.command('s1', offCommand);
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is on its way.
    const ready = session.ready;
    let fail = () => {};
    session.ready = () => new Promise((_, reject) => { fail = () => reject(new TypeError('fetch failed')); });
    const regular = playback.command('s1', regularCommand);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'buffering', sourceGeneration: 0, audioTrackId: '1', subtitleTrackId: '3' });
    fail();
    expect(await regular).toBe(false);
    session.ready = ready;
    files.set('s1', { ...files.get('s1')!, generation: 1, seek: 1 });
    deliver();
    expect(await off).toBe(true);
    expect(commands.filter(c => c.kind === 'tracks').map(c => c.idempotencyKey)).toEqual(['off', 'key']);
    expect(files.get('s1')!.selectedSubtitleTrackId).toBeNull();
    const sent = commands.length;
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBeNull();
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
  }, c => c.idempotencyKey === 'off' ? transit : false);
});

test('a pick still waiting for session.ready() that the player reported only while buffering does not keep an older stale track command from being sent again', async () => {
  // Off is sent and held on its way; Regular 3 waits for session.ready() and the player reports Regular only while buffering; the
  // source generation advances on the same file and Off is delivered while Regular still waits, and refused as stale: Off is sent
  // again once; ready() then fails, and the session fails onto file C: Off, not forced 9.
  let deliver = () => {};
  const transit = new Promise<unknown>(resolve => { deliver = () => resolve('deliver'); });
  await lab([forcedTwo, forcedNineRegularEight], async ({ playback, box, commands, files, run }) => {
    const session = (playback as unknown as { session: { ready: () => Promise<unknown> } }).session;
    await playback.start({ kind: 'title', id: 'movie' });
    const off = playback.command('s1', offCommand);
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is on its way.
    const ready = session.ready;
    let fail = () => {};
    const waiting = new Promise((_, reject) => { fail = () => reject(new TypeError('fetch failed')); });
    waiting.catch(() => undefined);
    session.ready = () => waiting;
    const regular = playback.command('s1', regularCommand);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'buffering', sourceGeneration: 0, audioTrackId: '1', subtitleTrackId: '3' });
    files.set('s1', { ...files.get('s1')!, generation: 1, seek: 1 });
    deliver();
    expect(await off).toBe(true);
    expect(commands.filter(c => c.kind === 'tracks').map(c => c.idempotencyKey)).toEqual(['off', 'key']);
    expect(files.get('s1')!.selectedSubtitleTrackId).toBeNull();
    fail();
    expect(await regular).toBe(false);
    session.ready = ready;
    const sent = commands.length;
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBeNull();
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
  }, c => c.idempotencyKey === 'off' ? transit : false);
});

test('a pick still waiting for session.ready() that the player reported only while buffering is still sent after an older stale track command was sent again', async () => {
  // Off is sent and held on its way; Regular 3 waits for session.ready() and the player reports Regular only while buffering; the
  // source generation advances on the same file and Off is delivered, refused as stale and sent again; the player reports the Off
  // its reply shows; the session is then ready: Regular is sent, refused as stale and sent again, and the session fails onto file C,
  // where Regular is 3 again: Regular, not forced 9.
  const regularThree: File = { ...forcedNine, subtitleTracks: [subtitle('9', 'eng', { forced: true }), subtitle('3', 'eng')] };
  let deliver = () => {};
  const transit = new Promise<unknown>(resolve => { deliver = () => resolve('deliver'); });
  await lab([forcedTwo, regularThree], async ({ playback, box, commands, files, run }) => {
    const session = (playback as unknown as { session: { ready: () => Promise<unknown> } }).session;
    await playback.start({ kind: 'title', id: 'movie' });
    const off = playback.command('s1', offCommand);
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is on its way.
    const ready = session.ready;
    let open = () => {};
    const waiting = new Promise<unknown>(resolve => { open = () => resolve(ready()); });
    session.ready = () => waiting;
    const regular = playback.command('s1', regularCommand);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'buffering', sourceGeneration: 0, audioTrackId: '1', subtitleTrackId: '3' });
    files.set('s1', { ...files.get('s1')!, generation: 1, seek: 1 });
    deliver();
    expect(await off).toBe(true);
    expect(commands.filter(c => c.kind === 'tracks').map(c => c.idempotencyKey)).toEqual(['off', 'key']);
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
    playback.snapshot({ sessionId: 's1', live: null, position: 61, state: 'playing', sourceGeneration: box.get().playback.plan!.sourceGeneration,
      audioTrackId: '1', subtitleTrackId: null });
    open();
    expect(await regular).toBe(true);
    session.ready = ready;
    expect(commands.filter(c => c.kind === 'tracks').map(c => c.idempotencyKey)).toEqual(['off', 'key', 'regular', 'key']);
    expect(files.get('s1')!.selectedSubtitleTrackId).toBe('3');
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('3');
    const sent = commands.length;
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBe('3');
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('3');
  }, c => c.idempotencyKey === 'off' ? transit : false);
});

test('a report of subtitles off while they were already off does not keep a pick of off that failed to reach the server counting', async () => {
  // With subtitles off, Regular 3 is sent and held on its way; Off waits for session.ready(), the player still reports Off while
  // playing or paused and ready() then fails; the source generation advances on the same file; Regular is delivered and refused as
  // stale: it is sent again once, and the session fails onto file C, where Regular is 3 again: Regular, not forced 9.
  const regularThree: File = { ...forcedNine, subtitleTracks: [subtitle('9', 'eng', { forced: true }), subtitle('3', 'eng')] };
  for (const state of ['playing', 'paused'] as const) {
    let deliver = () => {};
    const transit = new Promise<unknown>(resolve => { deliver = () => resolve('deliver'); });
    await lab([{ ...forcedTwo, selectedSubtitleTrackId: null }, regularThree], async ({ playback, box, commands, files, run }) => {
      const session = (playback as unknown as { session: { ready: () => Promise<unknown> } }).session;
      await playback.start({ kind: 'title', id: 'movie' });
      const regular = playback.command('s1', regularCommand);
      for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is on its way.
      const ready = session.ready;
      let fail = () => {};
      session.ready = () => new Promise((_, reject) => { fail = () => reject(new TypeError('fetch failed')); });
      const off = playback.command('s1', offCommand);
      for (let i = 0; i < 5; i++) await Promise.resolve();
      playback.snapshot({ sessionId: 's1', live: null, position: 60, state, sourceGeneration: 0, audioTrackId: '1', subtitleTrackId: null });
      fail();
      expect(await off).toBe(false);
      session.ready = ready;
      files.set('s1', { ...files.get('s1')!, generation: 1, seek: 1 });
      deliver();
      expect(await regular).toBe(true);
      expect(commands.filter(c => c.kind === 'tracks').map(c => c.idempotencyKey)).toEqual(['regular', 'key']);
      expect(files.get('s1')!.selectedSubtitleTrackId).toBe('3');
      const sent = commands.length;
      playback.recover('s1');
      await run();
      expect(box.get().playback.sessionId).toBe('s2');
      expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBe('3');
      expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('3');
    }, c => c.idempotencyKey === 'regular' ? transit : false);
  }
});

test('a report of subtitles off that repeats an accepted off does not keep a pick of off that failed to reach the server counting', async () => {
  // Off is accepted and reported; Regular 3 is sent and held on its way; Off waits for session.ready(), the player still reports
  // Off while playing and ready() then fails; the source generation advances on the same file; Regular is delivered and refused as
  // stale: it is sent again once, and the session fails onto file C, where Regular is 3 again: Regular, not forced 9.
  const regularThree: File = { ...forcedNine, subtitleTracks: [subtitle('9', 'eng', { forced: true }), subtitle('3', 'eng')] };
  let deliver = () => {};
  const transit = new Promise<unknown>(resolve => { deliver = () => resolve('deliver'); });
  await lab([forcedTwo, regularThree], async ({ playback, box, commands, files, run }) => {
    const session = (playback as unknown as { session: { ready: () => Promise<unknown> } }).session;
    await playback.start({ kind: 'title', id: 'movie' });
    expect(await playback.command('s1', offCommand)).toBe(true);
    playback.snapshot({ sessionId: 's1', live: null, position: 60, state: 'playing', sourceGeneration: 1, audioTrackId: '1', subtitleTrackId: null });
    const regular = playback.command('s1', { ...regularCommand, sourceGeneration: 1, seekGeneration: 1 });
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is on its way.
    const ready = session.ready;
    let fail = () => {};
    session.ready = () => new Promise((_, reject) => { fail = () => reject(new TypeError('fetch failed')); });
    const again = playback.command('s1', { ...offCommand, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'off again' });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    playback.snapshot({ sessionId: 's1', live: null, position: 61, state: 'playing', sourceGeneration: 1, audioTrackId: '1', subtitleTrackId: null });
    fail();
    expect(await again).toBe(false);
    session.ready = ready;
    files.set('s1', { ...files.get('s1')!, generation: 2, seek: 2 });
    deliver();
    expect(await regular).toBe(true);
    expect(commands.filter(c => c.kind === 'tracks').map(c => c.idempotencyKey)).toEqual(['off', 'regular', 'key']);
    expect(files.get('s1')!.selectedSubtitleTrackId).toBe('3');
    const sent = commands.length;
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.subtitleTrackId).toBe('3');
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBe('3');
  }, c => c.idempotencyKey === 'regular' ? transit : false);
});

test('a track reply released after a seek keeps the plan shown', async () => {
  // Off is accepted at the same generation and its reply held; the viewer seeks to 110 seconds and the seek's plan still shows the
  // forced 104; Off's reply from before the seek is released, older or newer on revision than the plan shown: the plan shown stays
  // at 110 seconds on the seek's generation, with Off.
  for (const revision of [2, 4]) {
    let release = () => {};
    const reply = new Promise<File>(resolve => { release = () => resolve({ ...plexForced, revision, selectedSubtitleTrackId: null }); });
    await lab([plexForced, plexReplacement], async ({ playback, box, files }) => {
      await playback.start({ kind: 'title', id: 'movie' });
      const off = playback.command('s1', offCommand);
      for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is taken.
      files.set('s1', { ...files.get('s1')!, seek: 1, position: 110, revision: 3, selectedSubtitleTrackId: '104' });
      expect(await playback.command('s1', { kind: 'seek', positionSeconds: 110, sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'seek' })).toBe(true);
      release();
      expect(await off).toBe(true);
      const shown = box.get().playback.plan!;
      expect([shown.seekGeneration, shown.positionSeconds, shown.revision, shown.selectedSubtitleTrackId]).toEqual([1, 110, 3, null]);
    }, () => false, c => c.idempotencyKey === 'off' ? reply : undefined);
  }
});

test('a switch reply behind a plan that shows a later switch\'s version unavailable still takes its version', async () => {
  // Pinned to version A, both restarts are spent; B's reply is held; C is sent and the session publishes C as version_unavailable
  // at a later source; B's reply comes in, C is refused and the session fails: a replacement starts on B with a fresh budget.
  // (A server that takes overlapping switches.)
  const a: File = { source: 'a', version: 'a', audioTracks: [audio('1', 'eng')], subtitleTracks: [], selectedAudioTrackId: '1' };
  const b: File = { ...a, source: 'b', version: 'b', generation: 1, seek: 1 };
  const c: File = { ...a, source: 'c', version: 'c', generation: 2, seek: 2, unavailable: true };
  let releaseB = () => {}, refuseC = () => {};
  const toC = new Promise<never>((_, reject) => { refuseC = () => reject(invalidVersion()); });
  toC.catch(() => undefined);
  await lab([a, a, a, { ...b, generation: 0, seek: 0 }], async ({ playback, box, starts, files, holdSwitch, run }) => {
    await playback.start({ kind: 'title', id: 'movie', versionId: 'a' });
    for (const session of ['s1', 's2']) {
      playback.recover(session);
      await run();
    }
    expect(box.get().playback.sessionId).toBe('s3');
    holdSwitch(new Promise<void>(resolve => { releaseB = resolve; }));
    const switching = playback.switchVersion('s3', 'b');
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The switch is taken.
    const refused = playback.switchVersion('s3', 'c').catch(() => 'refused');
    for (let i = 0; i < 5; i++) await Promise.resolve();
    files.set('s3', c);
    await run(5000);
    expect([box.get().playback.plan?.selectedVersionId, box.get().playback.plan?.sourceFailure]).toEqual(['c', 'version_unavailable']);
    releaseB();
    await switching;
    refuseC();
    expect(await refused).toBe('refused');
    playback.recover('s3');
    await run();
    expect(box.get().playback.sessionId).toBe('s4');
    expect(starts.map(request => request.versionId)).toEqual(['a', 'a', 'a', 'b']);
  }, command => command.kind === 'version' && command.versionId === 'c' ? toC : false, () => undefined, undefined, { b, c });
});

test('a switch reply behind a newer plan of its own version, asked again, still takes its version once', async () => {
  // Pinned to version B, both restarts are spent; B is asked for again with its reply held, and the session publishes B at source
  // generation 1; B is asked for once more and the session publishes B at generation 2; the first reply comes in, the second
  // request is refused as stale and the session fails: a replacement starts on B with a fresh budget.
  const b: File = { source: 'b', version: 'b', audioTracks: [audio('1', 'eng')], subtitleTracks: [], selectedAudioTrackId: '1' };
  const later: File = { ...b, generation: 1, seek: 1, revision: 2 };
  let releaseB = () => {}, refuseAgain = () => {}, asked = 0;
  const again = new Promise<never>((_, reject) => { refuseAgain = () => reject(stale({ ...later, generation: 2, seek: 2 })); });
  again.catch(() => undefined);
  await lab([b, b, b, b], async ({ playback, box, starts, files, holdSwitch, run }) => {
    await playback.start({ kind: 'title', id: 'movie', versionId: 'b' });
    for (const session of ['s1', 's2']) {
      playback.recover(session);
      await run();
    }
    expect(box.get().playback.sessionId).toBe('s3');
    holdSwitch(new Promise<void>(resolve => { releaseB = resolve; }));
    const switching = playback.switchVersion('s3', 'b');
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The switch is taken.
    await run(5000);
    expect(box.get().playback.plan?.sourceGeneration).toBe(1);
    const refused = playback.switchVersion('s3', 'b').catch(() => 'refused');
    for (let i = 0; i < 5; i++) await Promise.resolve();
    files.set('s3', { ...later, generation: 2, seek: 2, revision: 3 });
    await run(5000);
    expect(box.get().playback.plan?.sourceGeneration).toBe(2);
    releaseB();
    await switching;
    refuseAgain();
    expect(await refused).toBe('refused');
    playback.recover('s3');
    await run();
    expect(box.get().playback.sessionId).toBe('s4');
    expect(starts.map(request => request.versionId)).toEqual(['b', 'b', 'b', 'b']);
  }, command => command.kind === 'version' && ++asked === 2 ? again : false, () => undefined, undefined, { b: later });
});

test('a switch reply that comes in while the session is recovered from behind a plan showing its version unavailable is not taken', async () => {
  // Pinned to version A, B's reply (usable) is held; the session then publishes B as version_unavailable at a later source and
  // fails; B's reply comes in during the backoff; the replacement fails too: recovery still asks for A.
  const a: File = { source: 'a', version: 'a', audioTracks: [audio('1', 'eng')], subtitleTracks: [], selectedAudioTrackId: '1' };
  const b: File = { ...a, source: 'b', version: 'b', generation: 1, seek: 1 };
  let release = () => {};
  await lab([a, a, a], async ({ playback, box, starts, files, holdSwitch, run }) => {
    holdSwitch(new Promise<void>(resolve => { release = resolve; }));
    await playback.start({ kind: 'title', id: 'movie', versionId: 'a' });
    const switching = playback.switchVersion('s1', 'b');
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The switch is taken.
    files.set('s1', { ...b, generation: 2, seek: 2, unavailable: true });
    await run(5000);
    expect([box.get().playback.plan?.selectedVersionId, box.get().playback.plan?.sourceFailure]).toEqual(['b', 'version_unavailable']);
    playback.recover('s1');
    release();
    await switching;
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    playback.recover('s2');
    await run();
    expect(box.get().playback.sessionId).toBe('s3');
    expect(starts.map(request => request.versionId)).toEqual(['a', 'a', 'a']);
  }, () => false, () => undefined, undefined, { b });
});

test('the reply of a second switch to a version already published keeps a track pick made on it', async () => {
  // Pinned to version A, the switch to B times out and B is asked for again with its reply held; the session publishes B, which
  // takes the first switch; the viewer picks French 2 on B with its reply held; the second switch's reply comes in at the plan
  // shown's generations and revision, then French's reply; B fails: recovery carries French.
  const a: File = { source: 'a', version: 'a', audioTracks: [audio('1', 'eng'), audio('2', 'fra')], subtitleTracks: [], selectedAudioTrackId: '1' };
  const b: File = { ...a, source: 'b', version: 'b', generation: 1, seek: 1 };
  const timeout = Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'));
  timeout.catch(() => undefined);
  let releaseB = () => {}, releaseFrench = () => {};
  const french = new Promise<void>(resolve => { releaseFrench = resolve; });
  await lab([a, { ...b, generation: 0, seek: 0 }], async ({ playback, box, commands, starts, holdSwitch, run }) => {
    await playback.start({ kind: 'title', id: 'movie', versionId: 'a' });
    holdSwitch(timeout);
    expect(await playback.switchVersion('s1', 'b').catch(() => 'timed out')).toBe('timed out');
    holdSwitch(new Promise<void>(resolve => { releaseB = resolve; }));
    const again = playback.switchVersion('s1', 'b');
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The switch is taken.
    await run(5000);
    expect([box.get().playback.plan?.selectedVersionId, box.get().playback.plan?.revision]).toEqual(['b', 1]);
    const pick = playback.command('s1', { kind: 'tracks', audioTrackId: '2', sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'french' });
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is taken.
    releaseB();
    await again;
    releaseFrench();
    expect(await pick).toBe(true);
    expect(box.get().playback.plan?.selectedAudioTrackId).toBe('2');
    const sent = commands.length;
    playback.recover('s1');
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    expect(starts.at(-1).versionId).toBe('b');
    expect(commands.slice(sent).filter(c => c.kind === 'tracks').at(-1)?.audioTrackId).toBe('2');
  }, () => false, c => c.idempotencyKey === 'french' ? french : undefined, undefined, { b });
});

test('a track reply that brings the version a switch waits for shows that version\'s own subtitles', async () => {
  // Pinned to version A, French 2 is accepted with its reply held; Off is accepted and answered; the switch to B is sent and its
  // reply held; French's reply is the first to bring B, with its forced 5: B shows forced 5, not A's Off.
  const a: File = { source: 'a', version: 'a', audioTracks: [audio('1', 'eng'), audio('2', 'fra')], subtitleTracks: [subtitle('4', 'eng', { forced: true })],
    selectedAudioTrackId: '1', selectedSubtitleTrackId: '4' };
  const b: File = { ...a, source: 'b', version: 'b', generation: 1, seek: 1, subtitleTracks: [subtitle('5', 'eng', { forced: true })], selectedAudioTrackId: '2', selectedSubtitleTrackId: '5' };
  let releaseFrench = () => {};
  const french = new Promise<File>(resolve => { releaseFrench = () => resolve(b); });
  await lab([a, { ...b, generation: 0, seek: 0 }], async ({ playback, box, holdSwitch }) => {
    await playback.start({ kind: 'title', id: 'movie', versionId: 'a' });
    const pick = playback.command('s1', { kind: 'tracks', audioTrackId: '2', sourceGeneration: 0, seekGeneration: 0, idempotencyKey: 'french' });
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The command is taken.
    expect(await playback.command('s1', offCommand)).toBe(true);
    expect(box.get().playback.plan?.selectedSubtitleTrackId).toBeNull();
    holdSwitch(new Promise<void>(() => {}));
    void playback.switchVersion('s1', 'b');
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The switch is taken.
    releaseFrench();
    expect(await pick).toBe(true);
    const shown = box.get().playback.plan!;
    expect([shown.selectedVersionId, shown.selectedAudioTrackId, shown.selectedSubtitleTrackId]).toEqual(['b', '2', '5']);
  }, () => false, c => c.idempotencyKey === 'french' ? french : undefined, undefined, { b });
});

test('a switch reply for a version shown but not taken on its source generation sets that version\'s tracks', async () => {
  // Pinned to version A, the player reports English 1; the switch to B is sent with its reply held. Either the session publishes B
  // with French 2 at the source generation the switch was sent from, which does not take it, and the reply comes in there; or B is
  // asked for twice, the session publishes B with English 1 at a later source, which takes the first switch, then B with French 2
  // at the next source, and the replies come in, the second at that source. B shows French and a recovery carries French.
  const a: File = { source: 'a', version: 'a', audioTracks: [audio('1', 'eng'), audio('2', 'fra')], subtitleTracks: [], selectedAudioTrackId: '1' };
  const french: File = { ...a, source: 'b', version: 'b', generation: 2, seek: 2, selectedAudioTrackId: '2' };
  for (const twice of [false, true]) {
    const versions: Record<string, File> = { b: twice ? { ...french, generation: 1, seek: 1, selectedAudioTrackId: '1' } : { ...french, generation: 0, seek: 0, revision: 2 } };
    await lab([a, { ...french, generation: 0, seek: 0, selectedAudioTrackId: '1' }], async ({ playback, box, files, starts, holdSwitch, run }) => {
      await playback.start({ kind: 'title', id: 'movie', versionId: 'a' });
      playback.snapshot({ sessionId: 's1', live: null, position: 10, state: 'playing', sourceGeneration: 0, audioTrackId: '1' });
      let releaseFirst = () => {}, releaseSecond = () => {};
      holdSwitch(new Promise<void>(resolve => { releaseFirst = resolve; }));
      const first = playback.switchVersion('s1', 'b');
      for (let i = 0; i < 5; i++) await Promise.resolve(); // The switch is taken.
      if (twice) {
        const english = files.get('s1')!;
        versions.b = french;
        holdSwitch(new Promise<void>(resolve => { releaseSecond = resolve; }));
        const second = playback.switchVersion('s1', 'b');
        for (let i = 0; i < 5; i++) await Promise.resolve(); // The switch is taken.
        files.set('s1', english);
        await run(5000);
        expect([box.get().playback.plan?.sourceGeneration, box.get().playback.plan?.selectedAudioTrackId]).toEqual([1, '1']);
        releaseFirst();
        await first;
        files.set('s1', french);
        await run(5000);
        releaseSecond();
        await second;
      } else {
        await run(5000);
        expect([box.get().playback.plan?.selectedVersionId, box.get().playback.plan?.sourceGeneration]).toEqual(['b', 0]);
        releaseFirst();
        await first;
      }
      expect(box.get().playback.plan?.selectedAudioTrackId).toBe('2');
      playback.recover('s1');
      await run();
      expect(box.get().playback.sessionId).toBe('s2');
      expect(starts.at(-1).versionId).toBe('b');
      expect(box.get().playback.plan?.selectedAudioTrackId).toBe('2');
    }, () => false, () => undefined, undefined, versions);
  }
});

test('a switch reply that comes in while the session is recovered from a newer source than a plan showing its version unavailable is taken', async () => {
  // Pinned to version A, the switch to B is held on its way; the session publishes B as version_unavailable at revision 2, then the
  // switch reaches the server, which takes it at a later source; the session fails and B's reply comes in during the backoff; the
  // replacement fails too: recovery asks for B.
  const a: File = { source: 'a', version: 'a', audioTracks: [audio('1', 'eng')], subtitleTracks: [], selectedAudioTrackId: '1' };
  const b: File = { ...a, source: 'b', version: 'b', generation: 1, seek: 1, revision: 3 };
  let deliver = () => {}, release = () => {};
  const onItsWay = new Promise<string>(resolve => { deliver = () => resolve('deliver'); });
  await lab([a, a, { ...b, generation: 0, seek: 0 }], async ({ playback, box, starts, files, holdSwitch, run }) => {
    holdSwitch(new Promise<void>(resolve => { release = resolve; }));
    await playback.start({ kind: 'title', id: 'movie', versionId: 'a' });
    const switching = playback.switchVersion('s1', 'b');
    for (let i = 0; i < 5; i++) await Promise.resolve();
    files.set('s1', { ...a, version: 'b', unavailable: true, revision: 2 });
    await run(5000);
    expect([box.get().playback.plan?.selectedVersionId, box.get().playback.plan?.sourceFailure]).toEqual(['b', 'version_unavailable']);
    deliver();
    for (let i = 0; i < 5; i++) await Promise.resolve(); // The switch is taken.
    expect(files.get('s1')?.source).toBe('b');
    playback.recover('s1');
    release();
    await switching;
    await run();
    expect(box.get().playback.sessionId).toBe('s2');
    playback.recover('s2');
    await run();
    expect(box.get().playback.sessionId).toBe('s3');
    expect(starts.map(request => request.versionId)).toEqual(['a', 'a', 'b']);
  }, command => command.kind === 'version' ? onItsWay : false, () => undefined, undefined, { b });
});
