import { expect, test } from 'bun:test';
import { Playback, initialPlayback } from '../src/store/playback';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type { PlaybackPlan, Track } from '../src/wire';

const audio = (id: string, language: string, more: Partial<Track> = {}): Track => ({ id, kind: 'audio', language, name: '', codec: 'aac', ...more });
const subtitle = (id: string, language: string, more: Partial<Track> = {}): Track => ({ id, kind: 'subtitle', language, name: '', codec: 'srt', ...more });

interface File { source?: string; generation?: number; audioTracks: Track[]; subtitleTracks: Track[]; selectedAudioTrackId?: string; selectedSubtitleTrackId?: string | null }

const planOf = (sessionId: string, file: File): PlaybackPlan => ({
  sessionId, revision: 1, state: 'playing', positionSeconds: 0, sourceGeneration: file.generation ?? 0, seekGeneration: 0, chapters: [], fallback: { state: 'unsupported' },
  paths: [{ id: 'p', kind: 'direct', transport: 'file', mimeType: 'video/mp4', readiness: 'ready', url: 'https://media.test/f', qualities: [], boundaries: [], ...(file.source ? { sourceId: file.source } : {}) }],
  selectedPathId: 'p', audioTracks: file.audioTracks, subtitleTracks: file.subtitleTracks,
  ...(file.selectedAudioTrackId ? { selectedAudioTrackId: file.selectedAudioTrackId } : {}), selectedSubtitleTrackId: file.selectedSubtitleTrackId ?? null,
});

interface Lab {
  playback: Playback; box: StateBox<VelaState>; commands: any[];
  /** The sessions a stop was sent to. */
  stops: string[];
  /** What each session's server side currently plays (a track command changes it). */
  files: Map<string, File>;
  /** Fire the pending timers (all, or those of `ms`) and let the replies settle. */
  run(ms?: number): Promise<void>;
}

/** A store whose sessions play `queue` in order; `refuse` makes the server refuse a track command (once the promise it returns settles). */
async function lab(queue: File[], body: (lab: Lab) => Promise<void>, refuse: (command: any) => boolean | Promise<unknown> = () => false): Promise<void> {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  const timers = new Map<number, { fire: () => unknown; ms: number }>();
  let sequence = 0;
  globalThis.setTimeout = ((fire: () => unknown, ms = 0) => { const id = ++sequence; timers.set(id, { fire, ms }); return id; }) as never;
  globalThis.clearTimeout = ((id: number) => { timers.delete(id); }) as never;
  try {
    const commands: any[] = [];
    const stops: string[] = [];
    let n = 0;
    const files = new Map<string, File>();
    const plan = (id: string) => planOf(id, files.get(id)!);
    const tracks = async (id: string, c: any) => {
      commands.push(c);
      const refused = refuse(c);
      if (refused instanceof Promise) { await refused; throw new Error('refused'); }
      if (refused) throw new Error('refused');
      const file = files.get(id)!;
      files.set(id, { ...file,
        ...(c.audioTrackId !== undefined ? { selectedAudioTrackId: c.audioTrackId } : {}),
        ...(c.subtitleTrackId !== undefined ? { selectedSubtitleTrackId: c.subtitleTrackId } : {}) });
      return plan(id);
    };
    const adapter = {
      startPlayback: async () => { const id = `s${++n}`; files.set(id, queue[n - 1]!); return plan(id); },
      sessionSnapshot: async (id: string) => ({ plan: plan(id) }),
      changeTracks: async (id: string, c: any) => tracks(id, c),
      command: async (id: string, c: any) => { if (c.kind === 'stop') stops.push(id); return c.kind === 'tracks' ? tracks(id, c) : plan(id); },
    };
    const session = { epoch: 0, onReset() {}, ready: async () => ({ adapter, plan: (p: PlaybackPlan) => p }), negotiate: async () => {}, key: () => 'key', client: {} };
    const box = new StateBox({ playback: initialPlayback, auth: { phase: 'signed-in' } } as VelaState);
    const playback = new Playback(box, session as unknown as Session, () => {}, () => {});
    const run = async (ms?: number) => {
      for (const [id, timer] of [...timers]) if (timers.has(id) && (ms === undefined || timer.ms === ms)) { timers.delete(id); await timer.fire(); }
      for (let i = 0; i < 20; i++) await Promise.resolve();
    };
    await body({ playback, box, commands, stops, files, run });
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
