import { describe, expect, test } from 'bun:test';
import type { ByteReader } from '../web/engine/core/source/types';
import {
  MatroskaSubtitles,
  TEXT_LOOKBACK_BYTES,
  textLookbackPlan,
} from '../web/engine/universal/subtitles/matroska';

// A release-style MKV: one cluster every 2 s, video Cues only every 10 s and
// none for the SRT track, so a mid-file window cannot start at a text event.
const CLUSTER_SECONDS = 2;
const CUE_SECONDS = 10;
const DURATION = 260;
interface Event {
  start: number;
  end: number;
  text: string;
}
const EVENTS: Event[] = [
  { start: 10, end: 13, text: 'near start' },
  { start: 38, end: 41, text: 'before seek back' },
  { start: 65, end: 68, text: 'long gone' },
  { start: 69, end: 109, text: 'older than lookback' },
  { start: 71, end: 102, text: 'inside lookback' },
  { start: 95, end: 103, text: 'spans the indexed cluster' },
  { start: 105, end: 107, text: 'ahead' },
  { start: 118, end: 123, text: 'spans window end' },
  { start: 125, end: 126, text: 'after window' },
  { start: 214, end: 221, text: 'before seek forward' },
];

const bytes = (...parts: (number[] | Uint8Array)[]) => {
  const total = parts.reduce((n, part) => n + part.length, 0),
    out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};
const idBytes = (id: number) => {
  const out: number[] = [];
  for (let value = id; value; value = Math.floor(value / 256)) out.unshift(value % 256);
  return out;
};
const size8 = (value: number) => {
  const out = [0x01];
  for (let i = 6; i >= 0; i--) out.push(Math.floor(value / 256 ** i) % 256);
  return out;
};
const element = (id: number, ...payload: Uint8Array[]) => {
  const body = bytes(...payload);
  return bytes(idBytes(id), size8(body.length), body);
};
const uint = (id: number, value: number) => {
  const out: number[] = [];
  for (let i = 7; i >= 0; i--) out.push(Math.floor(value / 256 ** i) % 256);
  return element(id, new Uint8Array(out));
};
const string = (id: number, value: string) => element(id, new TextEncoder().encode(value));
const block = (track: number, relative: number, payload: Uint8Array) =>
  bytes([0x80 | track, (relative >> 8) & 255, relative & 255, 0x80], payload);

function buildMatroska(options: { corruptClusterAt?: number } = {}) {
  const head = element(0x1a45dfa3, string(0x4282, 'matroska'));
  const tracks = element(
    0x1654ae6b,
    element(0xae, uint(0xd7, 1), uint(0x83, 1), string(0x86, 'V_MPEG4/ISO/AVC')),
    element(0xae, uint(0xd7, 2), uint(0x83, 17), string(0x86, 'S_TEXT/UTF8'), string(0x22b59c, 'eng')),
  );
  const info = element(0x1549a966, uint(0x2ad7b1, 1000000));
  const clusters: Uint8Array[] = [];
  for (let time = 0; time < DURATION; time += CLUSTER_SECONDS) {
    const children = [uint(0xe7, time * 1000), element(0xa3, block(1, 0, new Uint8Array(4096)))];
    for (const event of EVENTS)
      if (event.start >= time && event.start < time + CLUSTER_SECONDS)
        children.push(
          element(
            0xa0,
            element(
              0xa1,
              block(2, Math.round((event.start - time) * 1000), new TextEncoder().encode(event.text)),
            ),
            uint(0x9b, Math.round((event.end - event.start) * 1000)),
          ),
        );
    const cluster = element(0x1f43b675, ...children);
    // A zero byte is never a valid EBML ID: the cluster's first child is unreadable.
    if (options.corruptClusterAt === time) cluster[12] = 0;
    clusters.push(cluster);
  }
  // SeekHead has a fixed size, so the layout can be computed before it is filled in.
  const seekHead = (cues: number) =>
    element(
      0x114d9b74,
      element(0x4dbb, element(0x53ab, new Uint8Array(idBytes(0x1c53bb6b))), uint(0x53ac, cues)),
    );
  const prefix = seekHead(0).length + info.length + tracks.length;
  const positions: number[] = [];
  let at = prefix;
  for (const cluster of clusters) {
    positions.push(at);
    at += cluster.length;
  }
  const cues = element(
    0x1c53bb6b,
    ...positions.flatMap((position, index) => {
      const time = index * CLUSTER_SECONDS;
      return time % CUE_SECONDS
        ? []
        : [element(0xbb, uint(0xb3, time * 1000), element(0xb7, uint(0xf7, 1), uint(0xf1, position)))];
    }),
  );
  const segment = element(0x18538067, seekHead(at), info, tracks, ...clusters, cues);
  const segmentData = head.length + 4 + 8;
  return {
    file: bytes(head, segment),
    /** Absolute file offset of the cluster starting at `time`. */
    cluster: (time: number) => segmentData + positions[time / CLUSTER_SECONDS],
  };
}

class MemoryReader implements ByteReader {
  readonly reads: number[] = [];
  constructor(private file: Uint8Array) {}
  async size() {
    return this.file.length;
  }
  async read(offset: number, length: number) {
    this.reads.push(offset);
    return this.file.slice(offset, offset + length);
  }
  dispose() {}
}

async function open(options: { corruptClusterAt?: number } = {}) {
  const fixture = buildMatroska(options),
    reader = new MemoryReader(fixture.file),
    container = await new MatroskaSubtitles(reader).open(new AbortController().signal);
  const id = container.tracks[0].id;
  const window = async (start: number) => {
    reader.reads.length = 0;
    const result = await container.packets(id, start, start + 20, new AbortController().signal);
    return { ...result, texts: result.packets.map((packet) => new TextDecoder().decode(packet.data)) };
  };
  return { fixture, reader, container, window };
}

describe('Matroska text subtitle windows without text Cues', () => {
  test('a track enabled mid-file shows the cue already on screen', async () => {
    const { window } = await open();
    const result = await window(100);
    expect(result.texts).toEqual([
      'inside lookback',
      'spans the indexed cluster',
      'ahead',
      'spans window end',
    ]);
    // Bounded, not complete: 30 s back, at the latest video Cue at or before 70 s.
    expect(result.completeHistory).toBe(false);
    expect(result.historyFrom).toBe(70);
    expect(result.fromStart).toBe(false);
  });

  test('a cue that began before the lookback edge is the accepted gap', async () => {
    const { window } = await open();
    const result = await window(100);
    expect(result.texts).not.toContain('older than lookback');
    expect(result.texts).not.toContain('long gone');
    expect(result.texts).not.toContain('after window');
  });

  test('the lookback reads only clusters between the edge and the window start', async () => {
    const { fixture, reader, window } = await open();
    await window(100);
    const media = reader.reads.filter((offset) => offset >= fixture.cluster(0));
    expect(Math.min(...media)).toBe(fixture.cluster(70));
  });

  test('a window continuing the previous one does not scan back again', async () => {
    const { fixture, reader, window } = await open();
    await window(100);
    const next = await window(114);
    expect(next.texts).toContain('spans window end');
    expect(next.texts).not.toContain('inside lookback');
    expect(next.historyFrom).toBe(70);
    const media = reader.reads.filter((offset) => offset >= fixture.cluster(0) && offset < fixture.cluster(250));
    expect(Math.min(...media)).toBe(fixture.cluster(110));
  });

  test('a seek forward and back keeps the track with a fresh bounded window', async () => {
    const { window } = await open();
    await window(100);
    const forward = await window(220);
    expect(forward.texts).toEqual(['before seek forward']);
    expect(forward.historyFrom).toBe(190);
    const back = await window(40);
    expect(back.texts).toEqual(['before seek back']);
    expect(back.historyFrom).toBe(10);
    expect(back.completeHistory).toBe(false);
  });

  test('a window within the lookback of 0:00 reads from the first cluster and is complete', async () => {
    const { window } = await open();
    const result = await window(12);
    expect(result.texts).toEqual(['near start']);
    expect(result.completeHistory).toBe(true);
    expect(result.historyFrom).toBe(0);
  });

  test('an unreadable lookback narrows the history instead of failing the track', async () => {
    const { window } = await open({ corruptClusterAt: 80 });
    const result = await window(100);
    expect(result.texts).toEqual(['ahead', 'spans window end']);
    expect(result.completeHistory).toBe(false);
    expect(result.historyFrom).toBe(100);
  });
});

describe('textLookbackPlan', () => {
  const index = (bytesPerSecond: number) =>
    Array.from({ length: 30 }, (_, i) => ({ time: i * 10, cluster: 1000 + i * 10 * bytesPerSecond }));

  test('starts at the latest indexed cluster at or before start minus 30 s', () => {
    const cues = index(500_000);
    expect(textLookbackPlan(cues, 1000, 105, cues[10].cluster)).toEqual({
      time: 70,
      cluster: cues[7].cluster,
    });
  });

  test('stays inside the byte bound when the bitrate is too high for 30 s', () => {
    const cues = index(1024 * 1024),
      initial = cues[10].cluster,
      plan = textLookbackPlan(cues, 1000, 100, initial)!;
    expect(initial - plan.cluster).toBeLessThanOrEqual(TEXT_LOOKBACK_BYTES);
    expect(plan.time).toBe(90);
  });

  test('reads from the first cluster near the beginning', () => {
    const cues = index(100_000);
    expect(textLookbackPlan(cues, 1000, 20, cues[2].cluster)).toEqual({ time: 0, cluster: 1000 });
  });

  test('has nothing to read back when the window already starts at the first cluster', () => {
    expect(textLookbackPlan(index(100_000), 1000, 5, 1000)).toBeNull();
  });
});
