import { expect, test } from 'bun:test';
import { streamingPGSDisplays } from '../web/engine/universal/subtitles/streaming-pgs';
import type {
  SubtitleCluster,
  SubtitleClusterStream,
  SubtitleStreamPacket,
  SubtitleTrack,
} from '../web/engine/universal/subtitles/types';

// Matroska PGS blocks: type/u16-length segments, one display set per block.
const segment = (kind: number, ...body: number[]) => [kind, body.length >> 8, body.length & 255, ...body];
const u16 = (value: number) => [value >> 8, value & 255];
const showSet = () =>
  new Uint8Array([
    // Composition: 640x360, epoch start, one object at 10,10.
    ...segment(0x16, ...u16(640), ...u16(360), 0x10, ...u16(0), 0x80, 0, 0, 1, ...u16(0), 0, 0, ...u16(10), ...u16(10)),
    ...segment(0x17, 1, 0, ...u16(10), ...u16(10), ...u16(2), ...u16(1)),
    ...segment(0x14, 0, 0, 1, 235, 128, 128, 255),
    // A 2x1 object of palette entry 1: two single pixels, then end of line.
    ...segment(0x15, ...u16(0), 0, 0xc0, 0, 0, 8, ...u16(2), ...u16(1), 1, 1, 0, 0),
    ...segment(0x80),
  ]);
const clearSet = () =>
  new Uint8Array([...segment(0x16, ...u16(640), ...u16(360), 0x10, ...u16(1), 0, 0, 0, 0), ...segment(0x80)]);

/** Cluster bytes stand for their packets; the fake container hands them back. */
const packetsOf = new WeakMap<Uint8Array, SubtitleStreamPacket[]>();
let nextPosition = 1000;
const cluster = (time: number, cues: [number, Uint8Array][], epoch = 0): SubtitleCluster => {
  const bytes = new Uint8Array(1);
  packetsOf.set(
    bytes,
    cues.map(([at, data]) => ({ position: nextPosition++, time: at, duration: null, data })),
  );
  return { epoch, position: nextPosition++, payloadStart: 0, time, endTime: time + 5, bytes };
};
const cue = (start: number, end: number): [number, Uint8Array][] => [
  [start, showSet()],
  [end, clearSet()],
];
const container = {
  tracks: [{ id: 'pgs', containerTrackId: 3 } as SubtitleTrack],
  streamPackets: (_id: string, bytes: Uint8Array) => packetsOf.get(bytes) ?? [],
  decodeStreamPacket: async (_id: string, packet: SubtitleStreamPacket) => packet,
};

/** The AV demux's subtitle side: clusters it has read (replayed around a position) and new ones as it reads them. */
function demux(options: { history?: SubtitleCluster[]; replay?: () => Promise<void> } = {}) {
  const listeners = new Map<(cluster: SubtitleCluster) => void, ((error: unknown) => void) | undefined>();
  const stream: SubtitleClusterStream & { read(cluster: SubtitleCluster): void; fail(error: unknown): void } = {
    epoch: 0,
    subscribe(receive, onFailure) {
      listeners.set(receive, onFailure);
      return () => listeners.delete(receive);
    },
    async replay(position) {
      await options.replay?.();
      for (const item of options.history ?? [])
        if (item.endTime >= position - 4 && item.time <= position + 4) stream.read(item);
    },
    read(item) {
      for (const receive of listeners.keys()) receive(item);
    },
    fail(error) {
      for (const failure of listeners.values()) failure?.(error);
    },
  };
  return stream;
}
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
function start(stream: SubtitleClusterStream, clock: { now: number }, failures: unknown[] = []) {
  return streamingPGSDisplays({
    container,
    trackId: 'pgs',
    stream,
    position: clock.now,
    clock: () => clock.now,
    signal: new AbortController().signal,
    onFailure: (error) => failures.push(error),
  });
}
const bitmaps = (display: { bitmaps: unknown[] } | null) => display?.bitmaps.length ?? null;

test('a track with no subtitle for the next 25 s is ready at once and shows the first one when due', async () => {
  const clock = { now: 0 },
    failures: unknown[] = [];
  const stream = demux();
  const displays = await start(stream, clock, failures);
  expect(displays.at(0)).toBeNull();
  // Playback reaches the first subtitle; the demux reads its cluster a few seconds early.
  clock.now = 26;
  stream.read(cluster(30, cue(30, 33)));
  await settle();
  expect(displays.at(29.9)).toBeNull();
  expect(bitmaps(displays.at(30))).toBe(1);
  expect(bitmaps(displays.at(33))).toBe(0);
  expect(failures).toEqual([]);
  displays.dispose();
});

test('the replay around the start position paints a subtitle that is already showing', async () => {
  const clock = { now: 31 };
  const displays = await start(demux({ history: [cluster(28, cue(30, 33))] }), clock);
  expect(bitmaps(displays.at(31))).toBe(1);
  displays.dispose();
});

test('start-up still fails when the track cannot be read', async () => {
  const clock = { now: 0 };
  const unreadable = demux({
    replay: async () => {
      throw new Error('Subtitle fragment read failed');
    },
  });
  await expect(start(unreadable, clock)).rejects.toThrow('Subtitle fragment read failed');

  const failing = demux({ replay: async () => failing.fail(new Error('Subtitle fragment acquisition exceeds bound')) });
  await expect(start(failing, clock)).rejects.toThrow('Subtitle fragment acquisition exceeds bound');

  const corrupt = demux({ history: [cluster(0, [[0.5, new Uint8Array([0x16, 0, 40, 1])]])] });
  await expect(start(corrupt, clock)).rejects.toThrow('Truncated PGS segment');
});

test('after start-up a broken packet is reported, not ignored', async () => {
  const clock = { now: 0 },
    failures: unknown[] = [];
  const stream = demux();
  const displays = await start(stream, clock, failures);
  stream.read(cluster(2, [[2, new Uint8Array([0x16, 0, 40, 1])]]));
  await settle();
  expect(failures).toHaveLength(1);
  expect(String(failures[0])).toContain('Truncated PGS segment');
  displays.dispose();
});

test('a subtitle delay longer than the decode window keeps the cues the demux reads now', async () => {
  // Subtitles delayed 20 s: the subtitle clock runs 20 s behind the video the demux is reading.
  const clock = { now: 10 },
    failures: unknown[] = [];
  const stream = demux();
  const displays = await start(stream, clock, failures);
  stream.read(cluster(31, cue(31, 34)));
  await settle();
  expect(displays.at(10)).toBeNull();
  clock.now = 31;
  displays.at(31);
  await settle();
  expect(bitmaps(displays.at(31))).toBe(1);
  expect(failures).toEqual([]);
  displays.dispose();
});

test('cues far ahead wait as packets, so a long delay does not exhaust the display bound', async () => {
  const clock = { now: 0 },
    failures: unknown[] = [];
  const stream = demux();
  const displays = await start(stream, clock, failures);
  // 300 subtitles, more than the 256 decoded display sets the look-ahead may hold.
  for (let second = 100; second < 400; second++) stream.read(cluster(second, cue(second, second + 0.5)));
  await settle();
  expect(failures).toEqual([]);
  expect(displays.at(0)).toBeNull();
  // Playback moves through them a second at a time, as frames would.
  for (let second = 100; second < 400; second++) {
    clock.now = second;
    displays.at(second);
    await settle();
    expect(bitmaps(displays.at(second))).toBe(1);
    expect(bitmaps(displays.at(second + 0.5))).toBe(0);
  }
  expect(failures).toEqual([]);
  displays.dispose();
});
