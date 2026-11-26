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

/** `ether`: as on Ether, a track command must name the file's current generations and advances both. */
interface File { source?: string; version?: string; generation?: number; seek?: number; revision?: number; position?: number; ether?: boolean; transcode?: boolean; audioTracks: Track[]; subtitleTracks: Track[]; selectedAudioTrackId?: string; selectedSubtitleTrackId?: string | null }

const stale = (file: File) => new VelaError({ class: 'conflict', code: 'stale_generation', message: 'stale generation',
  currentGenerations: { sourceGeneration: file.generation ?? 0, seekGeneration: file.seek ?? 0 }, retry: { allowed: false } } as never, 409);

const planOf = (sessionId: string, file: File): PlaybackPlan => ({
  sessionId, revision: file.revision ?? 1, state: 'playing', positionSeconds: file.position ?? 0, sourceGeneration: file.generation ?? 0, seekGeneration: file.seek ?? 0, chapters: [], fallback: { state: 'unsupported' },
  paths: [{ id: 'p', ...(file.transcode ? { kind: 'transcode', transport: 'hls', mimeType: 'application/vnd.apple.mpegurl' } as const : { kind: 'direct', transport: 'file', mimeType: 'video/mp4' } as const), readiness: 'ready', url: 'https://media.test/f', qualities: [], boundaries: [], ...(file.source ? { sourceId: file.source } : {}) }],
  selectedPathId: 'p', audioTracks: file.audioTracks, subtitleTracks: file.subtitleTracks,
  ...(file.selectedAudioTrackId ? { selectedAudioTrackId: file.selectedAudioTrackId } : {}), selectedSubtitleTrackId: file.selectedSubtitleTrackId ?? null,
  ...(file.version ? { selectedVersionId: file.version } : {}),
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

/** A store whose sessions play `queue` in order; `refuse` makes the server refuse a track command (once the promise it returns settles),
 * or a version switch once the promise it returns for it settles;
 * `answer` holds back the answer to a track command it takes until the promise it returns settles, and answers with the file that
 * promise gives, if any (the server took the command before it moved on); `series` is the viewer's
 * remembered choice for the series of every title; `versions` are the files a version switch can move a session to, by version id
 * (a switch must name the file's current generations; one to a version not listed is refused). */
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
      if (refused instanceof Promise) { await refused; throw new Error('refused'); }
      if (refused) throw new Error('refused');
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
      const held = answer(c);
      const answered = held ? await held : undefined;
      if (answered && typeof answered === 'object' && 'audioTracks' in answered) return planOf(id, answered as File);
      const file = files.get(id)!;
      files.set(id, { ...file, revision: (file.revision ?? 1) + 1,
        ...(c.audioTrackId !== undefined ? { selectedAudioTrackId: c.audioTrackId } : {}),
        ...(c.subtitleTrackId !== undefined ? { selectedSubtitleTrackId: c.subtitleTrackId } : {}) });
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
          if (refused instanceof Promise) { await refused; throw new Error('refused'); }
          const now = files.get(id)!;
          if (c.sourceGeneration !== (now.generation ?? 0) || c.seekGeneration !== (now.seek ?? 0)) throw stale(now);
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
      expect(box.get().playback.plan?.revision).toBe(2);
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
    expect(box.get().playback.plan?.sourceGeneration).toBe(0);
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
