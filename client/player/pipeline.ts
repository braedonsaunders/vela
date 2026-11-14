import { AudioBuffer } from './audio';
import type { AudioRendition } from '../../protocol/v0/types';
import { PlaybackFault, mutation, appendBuffer } from './buffer';
export { PlaybackFault } from './buffer';
import { AdaptiveBitrate, BandwidthEstimator } from './abr';
import { parsePlaylist, type Playlist } from './hls';
import { cancelled, delay } from './session';
import type { LiveSnapshot, Rendition } from './model';

type MediaSourceClass = typeof MediaSource;
export function mediaSourceClass(): MediaSourceClass | undefined {
  return (globalThis as typeof globalThis & { ManagedMediaSource?: MediaSourceClass }).ManagedMediaSource ?? globalThis.MediaSource;
}
export function bufferAhead(video: HTMLVideoElement) {
  for (let i = 0; i < video.buffered.length; i++) if (video.currentTime >= video.buffered.start(i) - 0.05 && video.currentTime < video.buffered.end(i)) return video.buffered.end(i) - video.currentTime;
  return 0;
}
/** Single producer serializes append/remove. No append can outlive its source. */
export class SegmentPipeline {
  readonly bandwidth = new BandwidthEstimator();
  readonly abr = new AdaptiveBitrate();
  current?: Rendition; audioRenditions: AudioRendition[] = []; initialAudioTrackId: string | null = null;
  private audio?: AudioBuffer;
  get audioTrackId() { return this.audio?.trackId ?? null; }
  get pendingAudioTrackId() { return this.audio?.pendingTrackId ?? null; }
  get audioTracks() { return this.current?.audioGroupId ? this.audio?.available(this.current.audioGroupId) ?? [] : []; }
  selectAudio(trackId: string) { return this.audio ? this.audio.select(trackId) : Promise.reject(new Error('No alternate audio buffer')); }
  lowDelay = false; expensiveSwitches = false; initialRenditionId?: string;
  liveWindowStart: number | null = null; maxLiveDrift = 45;
  publishedEdge: number | null = null; publishedStart: number | null = null;
  retrying = false;
  private publicationPending = false; private upstreamGap = false;
  private segmentStarted: number | null = null; private segmentDuration = 0;
  get delivery(): LiveSnapshot['delivery'] {
    if (this.upstreamGap) return 'upstream-gap';
    if (this.segmentStarted !== null && (this.retrying || performance.now() - this.segmentStarted > Math.max(1000, this.segmentDuration * 1000))) return 'segment-delayed';
    if (this.publicationPending) return 'waiting-for-publication';
    return this.publishedEdge === null ? 'unknown' : 'available';
  }
  private published(list: Playlist) {
    this.publishedStart = list.segments[0]?.start ?? null;
    const last = list.segments.at(-1); this.publishedEdge = last ? last.start + last.duration : null;
  }
  private streamingAllowed = true; private request?: AbortController; private detachStreaming?: () => void;
  private media?: MediaSource; private objectUrl?: string; private buffer?: SourceBuffer;
  private dropPrevious = { dropped: 0, total: 0 }; private dropRatio = 0;
  private driftPenalty = 0;
  constructor(private video: HTMLVideoElement, private onRendition: (r: Rendition) => void) {}
  dispose() {
    this.audio?.dispose(); this.audio = undefined;
    this.detachStreaming?.(); this.detachStreaming = undefined; this.request?.abort(); this.request = undefined;
    if (this.buffer?.updating) { try { this.buffer.abort(); } catch {} }
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
      } catch (error) { await reader.cancel().catch(() => {}); throw error; } finally { reader.releaseLock(); }
    }
    cancelled(signal);
    const bytes = new Uint8Array(size); let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
    // ResourceTiming transferSize=0 is a cache hit only when timing is exposed.
    const timing = performance.getEntriesByName(response.url).at(-1) as PerformanceResourceTiming | undefined;
    const noStore = /(?:^|,)\s*no-store\b/i.test(response.headers.get('Cache-Control') ?? '');
    const sameOrigin = new URL(response.url, document.baseURI).origin === location.origin;
    // Cross-origin zero transferSize can be privacy redaction, especially in Firefox.
    const cached = response.headers.get('X-Cache')?.toLowerCase() === 'hit' || !noStore && sameOrigin && !!(timing && timing.transferSize === 0 && timing.decodedBodySize > 0);
    this.bandwidth.sample(size, performance.now() - started, cached);
    return bytes.buffer;
  }
  private async bytes(url: string, signal: AbortSignal, progress?: (bytes: number, elapsed: number) => void) {
    const deadline = performance.now() + 12000;
    try { for (let attempt = 0;; attempt++) {
      try { return await this.fetchBytes(url, signal, progress); }
      catch (error) {
        cancelled(signal);
        const retryable = error instanceof TypeError || error instanceof PlaybackFault && error.retryable;
        if (!retryable || attempt >= 2 || performance.now() >= deadline) throw error;
        this.retrying = true;
        this.driftPenalty = Math.min(12, this.driftPenalty + 3);
        await delay(300 * 2 ** attempt, signal);
      }
    } } finally { this.retrying = false; }
  }
  private async playlist(r: Rendition, signal: AbortSignal): Promise<Playlist> {
    return parsePlaylist(new TextDecoder().decode(await this.bytes(r.url, signal)), new URL(r.url, document.baseURI).href);
  }
  private append(bytes: ArrayBuffer, signal: AbortSignal) {
    return appendBuffer(this.buffer!, bytes, this.video, signal);
  }
  async run(ladder: Rendition[], position: number, live: boolean, signal: AbortSignal) {
    const MS = mediaSourceClass(); if (!MS) throw new PlaybackFault('MediaSource unavailable', 'source');
    const playable = ladder.filter(r => MS.isTypeSupported(r.mime));
    if (!playable.length) throw new PlaybackFault('No supported segmented codec', 'source');
    const media = this.media = new MS();
    this.streamingAllowed = !('streaming' in media) || !!(media as MediaSource & { streaming: boolean }).streaming;
    const start = () => { this.streamingAllowed = true; };
    const stop = () => { this.streamingAllowed = false; this.request?.abort(new DOMException('Browser paused managed media loading', 'AbortError')); };
    media.addEventListener('startstreaming', start); media.addEventListener('endstreaming', stop);
    this.detachStreaming = () => { media.removeEventListener('startstreaming', start); media.removeEventListener('endstreaming', stop); };
    // ManagedMediaSource requires disabling remote playback before attachment.
    this.video.disableRemotePlayback = true;
    this.objectUrl = URL.createObjectURL(media); this.video.src = this.objectUrl;
    await new Promise<void>((resolve, reject) => {
      const clean = () => { media.removeEventListener('sourceopen', open); signal.removeEventListener('abort', abort); };
      const open = () => { clean(); resolve(); }; const abort = () => { clean(); reject(new DOMException('Aborted', 'AbortError')); };
      media.addEventListener('sourceopen', open, { once: true }); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    });
    cancelled(signal);
    let rendition = playable.find(r => r.id === this.initialRenditionId) ?? playable[0];
    this.abr.expensive = this.expensiveSwitches; let startupBuffered = false;
    this.current = rendition; this.onRendition(rendition);
    this.buffer = media.addSourceBuffer(rendition.mime);
    let list = await this.playlist(rendition, signal);
    if (live) { list.segments.forEach(s => { s.start += this.liveWindowStart ?? 0; }); this.published(list); }
    if (rendition.audioGroupId) {
      this.audio = new AudioBuffer(media, this.video, this.audioRenditions, (url, signal) => this.bytes(url, signal), mime => MS.isTypeSupported(mime));
      await this.audio.start(rendition.audioGroupId, this.initialAudioTrackId, list, signal);
    }
    if (!live && list.ended) media.duration = list.segments.reduce((sum, s) => sum + s.duration, 0);
    let next = live ? (position > 0 ? list.segments.find(s => s.start + s.duration > position) : undefined) ?? list.segments[Math.max(0, list.segments.length - (this.lowDelay ? 2 : 4))] : list.segments.find(s => s.start + s.duration > position) ?? (list.ended && position === media.duration ? list.segments.at(-1) : undefined);
    if (!next) throw new PlaybackFault('Position outside source timeline', 'source');
    let sequence = next.sequence, init = '', first = true;
    // Live sliding manifests are anchored by overlapping sequence, never reset to zero.
    while (!signal.aborted) {
      await this.audio?.applySelection(list, signal);
      const ahead = bufferAhead(this.video);
      const target = live ? (this.lowDelay ? 6 : 18 + this.driftPenalty) : 30;
      if (ahead >= target || !this.streamingAllowed) { await delay(250, signal); continue; }
      const quality = this.video.getVideoPlaybackQuality?.();
      if (quality) {
        const total = quality.totalVideoFrames - this.dropPrevious.total;
        if (total >= 30) {
          this.dropRatio = Math.max(0, quality.droppedVideoFrames - this.dropPrevious.dropped) / total;
          this.dropPrevious = { dropped: quality.droppedVideoFrames, total: quality.totalVideoFrames };
        }
      }
      if (ahead >= 12 && this.video.readyState >= 3 && !this.video.paused) startupBuffered = true;
      const proposed = this.abr.choose(playable.filter(r => r.mime === rendition.mime && r.audioGroupId === rendition.audioGroupId), rendition, ahead, this.bandwidth.bps, this.dropRatio, performance.now());
      const choice = startupBuffered || this.abr.manual ? proposed : rendition;
      if (choice.id !== rendition.id) {
        const candidate = await this.playlist(choice, signal);
        const compatible = candidate.segments.find(s => s.sequence === sequence);
        // Plans promise aligned sequences; reject playlists lacking the boundary.
        if (compatible) {
          const anchor = candidate.segments.find(s => list.segments.some(old => old.sequence === s.sequence));
          if (!anchor) throw new PlaybackFault('Rendition lost timeline overlap', 'source');
          const offset = list.segments.find(s => s.sequence === anchor.sequence)!.start - anchor.start;
          candidate.segments.forEach(s => { s.start += offset; });
          rendition = choice; list = candidate; if (live) this.published(list); this.current = choice; this.onRendition(choice); init = ''; }
      }
      next = list.segments.find(s => s.sequence === sequence);
      if (!next) {
        if (list.ended) {
          if (media.readyState === 'open') media.endOfStream();
          if (!this.audio) return;
          // Keep the audio producer available for a selection inside the buffered tail.
          await delay(250, signal); continue;
        }
        this.publicationPending = true;
        await delay(Math.max(500, list.targetDuration * 500), signal);
        const fresh = await this.playlist(rendition, signal);
        const overlap = fresh.segments.find(s => list.segments.some(old => old.sequence === s.sequence));
        if (!overlap) throw new PlaybackFault('Live playlist lost timeline overlap', 'source');
        const offset = list.segments.find(s => s.sequence === overlap.sequence)!.start - overlap.start;
        fresh.segments.forEach(s => { s.start += offset; }); list = fresh; if (live) this.published(list); continue;
      }
      this.publicationPending = false;
      if (next.gap) { this.upstreamGap = true; throw new PlaybackFault('Publisher marked segment unavailable (EXT-X-GAP)', 'source'); }
      if (next.init !== init) { await this.append(await this.bytes(next.init, signal), signal); init = next.init; }
      this.segmentStarted = performance.now(); this.segmentDuration = next.duration;
      const request = this.request = new AbortController();
      const abort = () => request.abort(); signal.addEventListener('abort', abort, { once: true });
      let abandon: Rendition | undefined;
      let bytes: ArrayBuffer;
      const timeout = setTimeout(() => request.abort(new PlaybackFault('Segment deadline exceeded', 'network', true)), 15000);
      try {
        bytes = await this.bytes(next.url, request.signal, (received, elapsed) => {
          const lower = [...playable].filter(r => r.mime === rendition.mime && r.audioGroupId === rendition.audioGroupId && r.bandwidth < rendition.bandwidth).sort((a,b) => a.bandwidth-b.bandwidth)[0];
          if (startupBuffered && !this.expensiveSwitches && lower && this.abr.abandon(rendition, lower, next!.duration, received, elapsed, bufferAhead(this.video))) { abandon = lower; request.abort(); }
        });
      } catch (error) {
        cancelled(signal);
        if (!this.streamingAllowed && request.signal.aborted) continue;
        if (!abandon) throw request.signal.reason instanceof PlaybackFault ? request.signal.reason : error;
        const candidate = await this.playlist(abandon, signal);
        const anchor = candidate.segments.find(s => list.segments.some(old => old.sequence === s.sequence));
        if (!anchor || !candidate.segments.some(s => s.sequence === sequence)) throw new PlaybackFault('Replacement rendition lacks next segment boundary', 'source');
        const offset = list.segments.find(s => s.sequence === anchor.sequence)!.start - anchor.start;
        candidate.segments.forEach(s => { s.start += offset; });
        rendition = abandon; list = candidate; this.current = rendition; this.onRendition(rendition); init = ''; continue;
      } finally { if (this.request === request) this.request = undefined; this.segmentStarted = null; clearTimeout(timeout); signal.removeEventListener('abort', abort); }
      await this.append(bytes, signal);
      await this.audio?.fill(next.start, next.start + next.duration, list, signal);
      if (first && live && this.liveWindowStart === null && this.buffer.buffered.length) {
        const offset = this.buffer.buffered.start(0) - next.start;
        list.segments.forEach(s => { s.start += offset; }); this.published(list);
      }
      if (first) { this.video.currentTime = live ? Math.max(next.start, position) : position; first = false; }
      sequence++;
      const retain = live ? 15 : 30;
      if (this.video.currentTime > retain && this.buffer.buffered.length && this.buffer.buffered.start(0) < this.video.currentTime - retain - 5) {
        await mutation(this.buffer, signal, () => this.buffer!.remove(0, this.video.currentTime - retain));
      }
      await this.audio?.evict(this.video.currentTime - retain, signal);
      // Skip only tiny holes; large gaps go through visible recovery.
      if (this.video.readyState < 3) for (let i = 0; i < this.video.buffered.length; i++) {
        const gap = this.video.buffered.start(i) - this.video.currentTime;
        if (gap > 0.02 && gap <= 0.25) { this.video.currentTime = this.video.buffered.start(i) + 0.01; break; }
      }
      if (live && this.video.buffered.length) {
        const drift = this.video.buffered.end(this.video.buffered.length - 1) - this.video.currentTime;
        if (drift > Math.max(this.maxLiveDrift, target + 6)) this.video.currentTime = this.video.buffered.end(this.video.buffered.length - 1) - target;
        this.video.playbackRate = this.lowDelay && drift > 8 ? 1.03 : 1;
      }
    }
  }
}
