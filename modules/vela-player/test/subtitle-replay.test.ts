import { expect, test } from 'bun:test';
import { MatroskaSubtitleStream, type StreamingClusterHint } from '../web/engine/core/demux/subtitle-stream';
import type { ByteReader } from '../web/engine/core/source/types';
import type { SubtitleCluster } from '../web/engine/universal/subtitles/types';

const SUBTITLES = 3,
  AUDIO_COMMENTARY_SUBTITLES = 4;
const file = Uint8Array.from({ length: 4096 }, (_, i) => i % 251);

/** A source whose cache holds only some ranges; `read` would go to the network. */
function source(cached: [number, number][]) {
  const reads: [number, number][] = [];
  const reader: ByteReader = {
    size: async () => file.length,
    read: async (offset, length) => {
      reads.push([offset, length]);
      return file.slice(offset, offset + length);
    },
    peek: (offset, length) =>
      cached.some(([start, end]) => offset >= start && offset + length <= end)
        ? file.slice(offset, offset + length)
        : null,
    dispose() {},
  };
  return { reader, reads };
}
/** One 2 s cluster with a subtitle block of each track, as the AV demux parses it. */
function parse(stream: MatroskaSubtitleStream, second: number) {
  const position = second * 100;
  const hint: StreamingClusterHint = {
    position,
    payloadStart: position + 12,
    length: 90,
    time: second,
    endTime: second + 2,
    timestamp: second * 1000,
  };
  stream.advance(hint);
  stream.fragment(hint, position + 20, 10, SUBTITLES);
  stream.fragment(hint, position + 40, 10, AUDIO_COMMENTARY_SUBTITLES);
}
function subscribe(stream: MatroskaSubtitleStream) {
  const offered: SubtitleCluster[] = [];
  stream.subscribe((cluster) => offered.push(cluster), undefined, SUBTITLES);
  return offered;
}

test('a replay offers subtitle blocks the demux parsed beyond its window, from cache only', async () => {
  // The demux has parsed 10 s to 34 s before the track is selected at 10 s; it never offers them again.
  const { reader, reads } = source([[0, 4096]]);
  const stream = new MatroskaSubtitleStream(reader, new AbortController().signal);
  for (const second of [10, 12, 14, 30, 34]) parse(stream, second);
  const offered = subscribe(stream);
  await stream.replay(10.5, new AbortController().signal);
  expect(offered.map((cluster) => cluster.time)).toEqual([10, 12, 14, 30, 34]);
  // Each offer is the selected track's block (after the cluster timestamp prefix), never the other track's.
  for (const cluster of offered)
    expect([...cluster.bytes.subarray(cluster.bytes.length - 10)]).toEqual([
      ...file.subarray(cluster.time * 100 + 20, cluster.time * 100 + 30),
    ]);
  // Only the window around the position (the covering cluster and two within 4 s) is read.
  expect(reads).toEqual([
    [1020, 10],
    [1220, 10],
    [1420, 10],
  ]);
});

test('a parsed block the reader no longer holds is skipped, not fetched', async () => {
  const { reader, reads } = source([[3000, 3500]]);
  const stream = new MatroskaSubtitleStream(reader, new AbortController().signal);
  for (const second of [10, 20, 30]) parse(stream, second);
  const offered = subscribe(stream);
  await stream.replay(10.5, new AbortController().signal);
  expect(offered.map((cluster) => cluster.time)).toEqual([10, 30]);
  expect(reads).toEqual([[1020, 10]]);
});

test('without a cache to peek, a replay keeps to its window', async () => {
  const { reader, reads } = source([]);
  delete reader.peek;
  const stream = new MatroskaSubtitleStream(reader, new AbortController().signal);
  for (const second of [10, 30]) parse(stream, second);
  const offered = subscribe(stream);
  await stream.replay(10.5, new AbortController().signal);
  expect(offered.map((cluster) => cluster.time)).toEqual([10]);
  expect(reads).toHaveLength(1);
});

test('blocks before the position stay outside the replay', async () => {
  const { reader } = source([[0, 4096]]);
  const stream = new MatroskaSubtitleStream(reader, new AbortController().signal);
  for (const second of [2, 20, 24]) parse(stream, second);
  const offered = subscribe(stream);
  await stream.replay(21, new AbortController().signal);
  expect(offered.map((cluster) => cluster.time)).toEqual([20, 24]);
});
