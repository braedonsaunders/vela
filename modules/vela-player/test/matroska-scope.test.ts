import { expect, test } from 'bun:test';
import type { ByteReader } from '../web/engine/core/source/types';

test('an MP4 track sharing an original-file scope bypasses Matroska helpers', async () => {
  const path = '../web/engine/core/demux/matroska-stream';
  const { hasStreamingMatroskaBacking, installMatroskaStreaming, primeMatroskaIndex, streamingMatroskaOffset } = await import(path);
  const source = {};
  const reader: ByteReader = { size: async () => 0, read: async () => new Uint8Array(), dispose() {} };
  const stop = installMatroskaStreaming(source, reader, new AbortController().signal, 0);
  try {
    const track = { _backing: { internalTrack: { demuxer: { input: { _rootSource: source } } } } };
    expect(primeMatroskaIndex(track)).toBeUndefined();
    expect(hasStreamingMatroskaBacking(track)).toBe(false);
    expect(streamingMatroskaOffset(track, {} as never)).toBeUndefined();
  } finally { stop(); }
});
