import { assertEtherAudioTimeline } from './ether-fragment-timing';
import type { AudioFallbackResponse } from '../../../../../../packages/protocol/types';
import type { OwnedNativeMediaAudioBackendPort } from 'webgpu-player/src/audio/native/CustomDecodeNativeAudioBridge';
import { MAXIMUM_NATIVE_AUDIO_SEGMENT_BYTE_LENGTH, MAXIMUM_NATIVE_AUDIO_SEGMENT_DURATION_MICROSECONDS } from 'webgpu-player/src/audio/native/NativeMediaAudioLimits';
import { secondsToMicroseconds } from 'webgpu-player/src/MediaTime';
import { parsePlaylist, playlistChanged, type Playlist } from '../../hls';
import { livePlaylistReloadDelayMs } from '../../core/source/reload';
import { delay } from '../../session';

/** Feed the existing native audio backend after its owner starts it at the
 * absolute requested position with audio/mp4;codecs="mp4a.40.2". The owner keeps
 * its existing clock, gain, pause, seek and teardown API. No second clock exists.
 * Only one fragment is read at once; backend append supplies bounded backpressure. */
export async function feedEtherAudio(descriptor: AudioFallbackResponse, positionSeconds: number,
  backend: OwnedNativeMediaAudioBackendPort, generation: number, signal: AbortSignal,
  fetchResource: typeof fetch = (...args) => globalThis.fetch(...args)): Promise<void> {
  if (!Number.isFinite(positionSeconds) || positionSeconds < 0 || descriptor.timelineOriginSeconds !== 0 || descriptor.codec !== 'mp4a.40.2')
    throw new Error('Ether audio fallback needs its absolute-title AAC timeline');
  let nextSequence: number | null = null, nextStart = positionSeconds, initialization = '';
  let pendingInit: Uint8Array | null = null;
  let lastProgress = performance.now();
  let previousList: Playlist | null = null;
  while (!signal.aborted) {
    const bytes = await read(descriptor.url, 4 * 1024 * 1024, signal, fetchResource);
    const list = parsePlaylist(new TextDecoder().decode(bytes), descriptor.url);
    if (nextSequence === null) {
      if (list.segments[0].sequence !== 0) throw new Error('Ether audio fallback must begin with relative segment zero');
      nextSequence = 0;
    }
    if (list.segments[0].sequence > nextSequence) throw new Error('Ether audio fallback publication skipped an unplayed segment');
    const segments = list.segments.filter(segment => segment.sequence >= nextSequence!);
    for (const segment of segments) {
      signal.throwIfAborted();
      if (segment.sequence !== nextSequence || segment.gap) throw new Error('Ether audio fallback has a publication gap');
      const duration = secondsToMicroseconds(segment.duration);
      if (duration > MAXIMUM_NATIVE_AUDIO_SEGMENT_DURATION_MICROSECONDS)
        throw new Error('Ether audio fragment exceeds the native backend duration bound');
      if (initialization !== segment.init) {
        if (initialization) throw new Error('Ether audio initialization changed without a new audio generation');
        pendingInit = await read(segment.init, MAXIMUM_NATIVE_AUDIO_SEGMENT_BYTE_LENGTH, signal, fetchResource);
        initialization = segment.init;
      }
      const data = await read(segment.url, MAXIMUM_NATIVE_AUDIO_SEGMENT_BYTE_LENGTH, signal, fetchResource);
      if (pendingInit) {
        assertEtherAudioTimeline(pendingInit, data, positionSeconds);
        if (!await backend.appendInitializationSegment(generation, pendingInit)) return;
        pendingInit = null;
      }
      // The playlist starts at relative segment 0; encoded tfdt PTS already use
      // absolute title time. This metadata anchors scheduling only; never rewrite PTS.
      const end = nextStart + segment.duration;
      const accepted = await backend.appendMediaSegment(generation, { data,
        startTimeMicroseconds: secondsToMicroseconds(nextStart), endTimeMicroseconds: secondsToMicroseconds(end) });
      if (!accepted) return;
      nextStart = end; nextSequence++; lastProgress = performance.now();
    }
    if (list.ended) { signal.throwIfAborted(); await backend.endOfStream(generation); return; }
    if (performance.now() - lastProgress > 30_000) throw new Error('Ether audio publication stopped progressing');
    const changed = previousList === null || playlistChanged(previousList, list);
    previousList = list;
    await delay(
      livePlaylistReloadDelayMs(list.targetDuration, list.segments.at(-1)?.duration ?? null, changed),
      signal,
    );
  }
  signal.throwIfAborted();
}

async function read(url: string, maximumBytes: number, signal: AbortSignal, fetchResource: typeof fetch): Promise<Uint8Array> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      const response = await fetchResource(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
        credentials: 'same-origin', redirect: 'error' });
      if (response.status !== 200) {
        await response.body?.cancel();
        if (![202, 404, 408, 429, 500, 502, 503, 504].includes(response.status) || attempt >= 2)
          throw new TerminalAudioReadError(`Ether audio HTTP ${response.status}`);
        throw new Error(`Ether audio HTTP ${response.status}`);
      }
      const contentLength = response.headers.get('content-length');
      const expected = contentLength === null ? null : Number(contentLength);
      if (expected !== null && (!Number.isSafeInteger(expected) || expected < 1 || expected > maximumBytes)) {
        await response.body?.cancel(); throw new TerminalAudioReadError('Ether audio resource exceeds its byte bound');
      }
      if (!response.body) throw new Error('Empty Ether audio resource');
      const reader = response.body.getReader(), chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (let item = await reader.read(); !item.done; item = await reader.read()) {
          length += item.value.byteLength;
          if (length > maximumBytes) throw new TerminalAudioReadError('Ether audio resource exceeds its byte bound');
          chunks.push(item.value);
        }
      } catch (error) { await reader.cancel().catch(() => {}); throw error; }
      finally { reader.releaseLock(); }
      signal.throwIfAborted();
      if (!length || (expected !== null && length !== expected)) throw new Error('Truncated Ether audio resource');
      const result = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
      return result;
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof TerminalAudioReadError || attempt >= 2) throw error;
      await delay(250 * 2 ** attempt, signal);
    }
  }
}
class TerminalAudioReadError extends Error {}
