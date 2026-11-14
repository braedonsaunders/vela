import { AdaptiveBitrate, BandwidthEstimator } from './abr';
import { parsePlaylist, type Playlist, type Segment } from './hls';
import { cancelled, delay } from './session';
import type { Rendition } from './model';

type MediaSourceClass = typeof MediaSource;
export function mediaSourceClass(): MediaSourceClass | undefined {
  return (globalThis as typeof globalThis & { ManagedMediaSource?: MediaSourceClass }).ManagedMediaSource ?? globalThis.MediaSource;
}
export class PlaybackFault extends Error {
  constructor(message: string, readonly kind: 'network' | 'source' | 'decoder', readonly retryable = false) { super(message); }
}
export function bufferAhead(video: HTMLVideoElement) {
  for (let i = 0; i < video.buffered.length; i++) if (video.currentTime >= video.buffered.start(i) - 0.05 && video.currentTime < video.buffered.end(i)) return video.buffered.end(i) - video.currentTime;
  return 0;
}
function mutation(buffer: SourceBuffer, signal: AbortSignal, operation: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    cancelled(signal);
    const clean = () => { buffer.removeEventListener('updateend', done); buffer.removeEventListener('error', error); signal.removeEventListener('abort', abort); };
    const done = () => { clean(); resolve(); };
    const error = () => { clean(); reject(new PlaybackFault('SourceBuffer rejected media', 'decoder')); };
    const abort = () => { clean(); reject(new DOMException('Aborted', 'AbortError')); };
    buffer.addEventListener('updateend', done, { once: true }); buffer.addEventListener('error', error, { once: true }); signal.addEventListener('abort', abort, { once: true });
    try { operation(); } catch (e) { clean(); reject(e); }
  });
}
/** Single producer serializes append/remove. No append can outlive its source. */
export class SegmentPipeline {
  readonly bandwidth = new BandwidthEstimator();
  readonly abr = new AdaptiveBitrate();
  current?: Rendition;
  lowDelay = false;
  private media?: MediaSource; private objectUrl?: string; private buffer?: SourceBuffer;
  private dropPrevious = { dropped: 0, total: 0 }; private dropRatio = 0;
  private driftPenalty = 0;
  constructor(private video: HTMLVideoElement, private onRendition: (r: Rendition) => void) {}
  dispose() {
    if (this.buffer?.updating) { try { this.buffer.abort(); } catch {} }
    if (this.media?.readyState === 'open') { try { this.media.endOfStream(); } catch {} }
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.buffer = undefined; this.media = undefined; this.objectUrl = undefined;
  }
  private async fetchBytes(url: string, signal: AbortSignal, progress?: (bytes: number, elapsed: number) => void): Promise<ArrayBuffer> {
    const started = performance.now();
    const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]), credentials: 'same-origin' });
    if (!response.ok) throw new PlaybackFault(`Media HTTP ${response.status}`, 'network', response.status === 408 || response.status === 429 || response.status >= 500 || response.status === 404);
    const chunks: Uint8Array[] = []; let size = 0;
    if (response.body) {
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > 64 * 1024 * 1024) throw new PlaybackFault('Segment exceeds 64 MiB budget', 'source');
          chunks.push(value); progress?.(size, performance.now() - started);
        }
      } finally { reader.releaseLock(); }
    }
    cancelled(signal);
    const bytes = new Uint8Array(size); let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
    // ResourceTiming transferSize=0 is a cache hit only when timing is exposed.
    const timing = performance.getEntriesByName(response.url).at(-1) as PerformanceResourceTiming | undefined;
    const cached = response.headers.get('X-Cache')?.toLowerCase() === 'hit' || !!(timing && timing.transferSize === 0 && timing.decodedBodySize > 0);
    this.bandwidth.sample(size, performance.now() - started, cached);
    return bytes.buffer;
  }
  private async bytes(url: string, signal: AbortSignal, progress?: (bytes: number, elapsed: number) => void) {
    const deadline = performance.now() + 12000;
    for (let attempt = 0;; attempt++) {
      try { return await this.fetchBytes(url, signal, progress); }
      catch (error) {
        cancelled(signal);
        const retryable = error instanceof TypeError || error instanceof PlaybackFault && error.retryable;
        if (!retryable || attempt >= 2 || performance.now() >= deadline) throw error;
        this.driftPenalty = Math.min(12, this.driftPenalty + 3);
        await delay(300 * 2 ** attempt, signal);
      }
    }
  }
  private async playlist(r: Rendition, signal: AbortSignal): Promise<Playlist> {
    return parsePlaylist(new TextDecoder().decode(await this.bytes(r.url, signal)), r.url);
  }
  private async append(bytes: ArrayBuffer, signal: AbortSignal) {
    const buffer = this.buffer!;
    try { await mutation(buffer, signal, () => buffer.appendBuffer(bytes)); }
    catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'QuotaExceededError') throw error;
      const end = this.video.currentTime - 10;
      if (end <= 0) throw new PlaybackFault('Insufficient media buffer quota', 'source');
      await mutation(buffer, signal, () => buffer.remove(0, end));
      await mutation(buffer, signal, () => buffer.appendBuffer(bytes));
    }
  }
  async run(ladder: Rendition[], position: number, live: boolean, signal: AbortSignal) {
    const MS = mediaSourceClass(); if (!MS) throw new PlaybackFault('MediaSource unavailable', 'source');
    const playable = ladder.filter(r => MS.isTypeSupported(r.mime));
    if (!playable.length) throw new PlaybackFault('No supported segmented codec', 'source');
    const media = this.media = new MS();
    // ManagedMediaSource requires disabling remote playback before attachment.
    this.video.disableRemotePlayback = true;
    this.objectUrl = URL.createObjectURL(media); this.video.src = this.objectUrl;
    await new Promise<void>((resolve, reject) => {
      const clean = () => { media.removeEventListener('sourceopen', open); signal.removeEventListener('abort', abort); };
      const open = () => { clean(); resolve(); }; const abort = () => { clean(); reject(new DOMException('Aborted', 'AbortError')); };
      media.addEventListener('sourceopen', open, { once: true }); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    });
    cancelled(signal);
    let rendition = this.abr.choose(playable, undefined, 0, this.bandwidth.bps, 0, performance.now());
    this.current = rendition; this.onRendition(rendition);
    this.buffer = media.addSourceBuffer(rendition.mime);
    let list = await this.playlist(rendition, signal);
    if (!live && list.ended) media.duration = list.segments.reduce((sum, s) => sum + s.duration, 0);
    let next = live ? list.segments[Math.max(0, list.segments.length - (this.lowDelay ? 2 : 4))] : list.segments.find(s => s.start + s.duration > position);
    if (!next) throw new PlaybackFault('Position outside source timeline', 'source');
    let sequence = next.sequence, init = '', first = true;
    // Live sliding manifests are anchored by overlapping sequence, never reset to zero.
    while (!signal.aborted) {
      const ahead = bufferAhead(this.video);
      const target = live ? (this.lowDelay ? 6 : 18 + this.driftPenalty) : 30;
      if (ahead >= target || ('streaming' in media && !(media as MediaSource & { streaming: boolean }).streaming)) { await delay(250, signal); continue; }
      const quality = this.video.getVideoPlaybackQuality?.();
      if (quality) {
        const total = quality.totalVideoFrames - this.dropPrevious.total;
        if (total >= 30) {
          this.dropRatio = Math.max(0, quality.droppedVideoFrames - this.dropPrevious.dropped) / total;
          this.dropPrevious = { dropped: quality.droppedVideoFrames, total: quality.totalVideoFrames };
        }
      }
      const choice = this.abr.choose(playable.filter(r => r.mime === rendition.mime), rendition, ahead, this.bandwidth.bps, this.dropRatio, performance.now());
      if (choice.id !== rendition.id) {
        const candidate = await this.playlist(choice, signal);
        const compatible = candidate.segments.find(s => s.sequence === sequence);
        // Plans promise aligned sequences; reject playlists lacking the boundary.
        if (compatible) { rendition = choice; list = candidate; this.current = choice; this.onRendition(choice); init = ''; }
      }
      next = list.segments.find(s => s.sequence === sequence);
      if (!next) {
        if (list.ended) { if (media.readyState === 'open') media.endOfStream(); return; }
        await delay(Math.max(500, list.targetDuration * 500), signal);
        const fresh = await this.playlist(rendition, signal);
        const overlap = fresh.segments.find(s => list.segments.some(old => old.sequence === s.sequence));
        if (!overlap) throw new PlaybackFault('Live playlist lost timeline overlap', 'source');
        const offset = list.segments.find(s => s.sequence === overlap.sequence)!.start - overlap.start;
        fresh.segments.forEach(s => { s.start += offset; }); list = fresh; continue;
      }
      if (next.init !== init) { await this.append(await this.bytes(next.init, signal), signal); init = next.init; }
      const request = new AbortController();
      const abort = () => request.abort(); signal.addEventListener('abort', abort, { once: true });
      let abandon: Rendition | undefined;
      let bytes: ArrayBuffer;
      const timeout = setTimeout(() => request.abort(new PlaybackFault('Segment deadline exceeded', 'network', true)), 15000);
      try {
        bytes = await this.bytes(next.url, request.signal, (received, elapsed) => {
          const lower = [...playable].filter(r => r.mime === rendition.mime && r.bandwidth < rendition.bandwidth).sort((a,b) => a.bandwidth-b.bandwidth)[0];
          if (lower && this.abr.abandon(rendition, lower, next!.duration, received, elapsed, bufferAhead(this.video))) { abandon = lower; request.abort(); }
        });
      } catch (error) {
        cancelled(signal);
        if (!abandon) throw request.signal.reason instanceof PlaybackFault ? request.signal.reason : error;
        rendition = abandon; list = await this.playlist(rendition, signal); this.current = rendition; this.onRendition(rendition); init = ''; continue;
      } finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); }
      await this.append(bytes, signal);
      if (first) { this.video.currentTime = live ? next.start : position; first = false; }
      sequence++;
      const retain = live ? 15 : 30;
      if (this.video.currentTime > retain && this.buffer.buffered.length && this.buffer.buffered.start(0) < this.video.currentTime - retain - 5) {
        await mutation(this.buffer, signal, () => this.buffer!.remove(0, this.video.currentTime - retain));
      }
      // Skip only tiny holes; large gaps go through visible recovery.
      if (this.video.readyState < 3) for (let i = 0; i < this.video.buffered.length; i++) {
        const gap = this.video.buffered.start(i) - this.video.currentTime;
        if (gap > 0.02 && gap <= 0.25) { this.video.currentTime = this.video.buffered.start(i) + 0.01; break; }
      }
      if (live && this.lowDelay && this.video.buffered.length) {
        const drift = this.video.buffered.end(this.video.buffered.length - 1) - this.video.currentTime;
        this.video.playbackRate = drift > 8 ? 1.03 : 1;
      }
    }
  }
}
