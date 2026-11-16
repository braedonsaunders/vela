import type { AudioRendition } from '../../../../protocol/v0/types';
import { parsePlaylist, type Playlist, type Segment } from './hls';
import { appendBuffer, mutation, PlaybackFault } from './buffer';
import { cancelled } from './session';

type ReadBytes = (url: string, signal: AbortSignal) => Promise<ArrayBuffer>;
interface Pending {
  trackId: string;
  abort: AbortController;
  resolve: () => void;
  reject: (error: unknown) => void;
}

/** The video producer owns this queue too: audio mutations never race append/remove. */
export class AudioBuffer {
  private buffer?: SourceBuffer;
  private current?: AudioRendition;
  private list?: Playlist;
  private nextSequence = -1;
  private init = '';
  private pending?: Pending;
  private audible?: { before: string; after: string; boundary: number };
  constructor(
    private media: MediaSource,
    private video: HTMLVideoElement,
    private renditions: AudioRendition[],
    private read: ReadBytes,
    private supported: (mime: string) => boolean,
  ) {}
  get trackId() {
    if (this.audible && this.video.currentTime < this.audible.boundary) return this.audible.before;
    return this.current?.trackId ?? null;
  }
  get pendingTrackId() {
    return (
      this.pending?.trackId ??
      (this.audible && this.video.currentTime < this.audible.boundary ? this.audible.after : null)
    );
  }
  available(group: string) {
    return this.renditions
      .filter(
        (r) =>
          r.groupId === group &&
          this.supported(r.mimeType) &&
          (!this.current || r.mimeType === this.current.mimeType || !!this.buffer?.changeType),
      )
      .map((r) => r.trackId);
  }
  dispose() {
    this.pending?.abort.abort();
    this.pending?.reject(new DOMException('Audio selection superseded', 'AbortError'));
    this.pending = undefined;
    if (this.buffer?.updating)
      try {
        this.buffer.abort();
      } catch {}
  }
  private async playlist(track: AudioRendition, anchor: Playlist, signal: AbortSignal) {
    const list = parsePlaylist(new TextDecoder().decode(await this.read(track.url, signal)), track.url);
    const match = list.segments.find((s) => anchor.segments.some((a) => a.sequence === s.sequence));
    if (!match) throw new PlaybackFault('Audio playlist has no shared timeline boundary', 'source');
    const offset = anchor.segments.find((s) => s.sequence === match.sequence)!.start - match.start;
    list.segments.forEach((s) => {
      s.start += offset;
    });
    return list;
  }
  async start(group: string, trackId: string | null, anchor: Playlist, signal: AbortSignal) {
    const track = this.renditions.find(
      (r) => r.groupId === group && (trackId === null || r.trackId === trackId),
    );
    if (!track || !this.supported(track.mimeType))
      throw new PlaybackFault('Selected audio rendition is not supported', 'source');
    this.current = track;
    this.list = await this.playlist(track, anchor, signal);
    this.buffer = this.media.addSourceBuffer(track.mimeType);
  }
  select(trackId: string): Promise<void> {
    if (!this.current || !this.available(this.current.groupId).includes(trackId))
      return Promise.reject(new Error('Audio track is outside the active rendition group'));
    this.pending?.abort.abort();
    this.pending?.reject(new DOMException('Audio selection superseded', 'AbortError'));
    if (trackId === this.current.trackId) {
      this.pending = undefined;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      this.pending = { trackId, abort: new AbortController(), resolve, reject };
    });
  }
  private async append(segment: Segment, signal: AbortSignal) {
    if (this.init !== segment.init) {
      await appendBuffer(this.buffer!, await this.read(segment.init, signal), this.video, signal);
      this.init = segment.init;
    }
    await appendBuffer(this.buffer!, await this.read(segment.url, signal), this.video, signal);
    this.nextSequence = segment.sequence + 1;
  }
  async fill(from: number, until: number, anchor: Playlist, signal: AbortSignal) {
    if (!this.current || !this.list) return;
    if (!this.list.ended && !this.list.segments.some((s) => s.start + s.duration >= until - 0.1))
      this.list = await this.playlist(this.current, anchor, signal);
    const shared = this.list.segments.find((s) => anchor.segments.some((a) => a.sequence === s.sequence));
    if (shared) {
      const offset = anchor.segments.find((s) => s.sequence === shared.sequence)!.start - shared.start;
      this.list.segments.forEach((s) => {
        s.start += offset;
      });
    }
    const segments = this.list.segments.filter(
      (s) => s.start + s.duration > from + 0.001 && s.start < until - 0.001,
    );
    if (!segments.length) throw new PlaybackFault('Audio does not cover the video boundary', 'source');
    for (const segment of segments) {
      if (segment.sequence < this.nextSequence) continue;
      if (segment.gap) throw new PlaybackFault('Publisher marked audio unavailable', 'source');
      await this.append(segment, signal);
    }
  }
  async applySelection(anchor: Playlist, signal: AbortSignal) {
    const pending = this.pending;
    if (!pending || !this.current || !this.buffer || !this.buffer.buffered.length) return;
    let mutated = false;
    try {
      const track = this.renditions.find(
        (r) => r.groupId === this.current!.groupId && r.trackId === pending.trackId,
      )!;
      const requestSignal = AbortSignal.any([signal, pending.abort.signal]);
      const list = await this.playlist(track, anchor, requestSignal);
      const boundary = list.segments.find((s) => s.start > this.video.currentTime + 0.25);
      if (!boundary || !anchor.segments.some((s) => Math.abs(s.start - boundary.start) <= 0.1))
        throw new Error('No aligned future audio switch boundary');
      const end = this.buffer.buffered.length
        ? this.buffer.buffered.end(this.buffer.buffered.length - 1)
        : boundary.start + boundary.duration;
      const segments = list.segments.filter(
        (s) => s.start >= boundary.start && s.start < Math.max(end, boundary.start + boundary.duration),
      );
      // Keep old audio intact while loading the complete replacement of its buffered tail.
      const init = await this.read(boundary.init, requestSignal);
      const bytes: ArrayBuffer[] = [];
      for (const segment of segments) {
        if (segment.gap) throw new Error('Replacement audio contains an upstream gap');
        bytes.push(await this.read(segment.url, requestSignal));
      }
      cancelled(requestSignal);
      if (this.video.currentTime + 0.05 >= boundary.start)
        throw new Error('Audio switch boundary passed during loading; select again');
      if (track.mimeType !== this.current.mimeType && !this.buffer.changeType)
        throw new Error('Browser cannot change audio codec');
      const before = this.trackId!;
      mutated = true;
      // After removal starts, finish this replacement even if a later user choice supersedes it.
      await mutation(this.buffer, signal, () => this.buffer!.remove(boundary.start, Infinity));
      if (track.mimeType !== this.current.mimeType) this.buffer.changeType(track.mimeType);
      this.buffer.appendWindowStart = boundary.start;
      await appendBuffer(this.buffer, init, this.video, signal);
      for (const data of bytes) await appendBuffer(this.buffer, data, this.video, signal);
      this.current = track;
      this.list = list;
      this.init = boundary.init;
      this.nextSequence = segments.at(-1)!.sequence + 1;
      this.audible = { before, after: track.trackId, boundary: boundary.start };
      if (this.pending === pending) this.pending = undefined;
      pending.resolve();
    } catch (error) {
      if (this.pending === pending) this.pending = undefined;
      pending.reject(error);
      cancelled(signal);
      if (mutated) throw error; // An append failure needs source recovery; do not pretend old audio remains intact.
    }
  }
  async evict(before: number, signal: AbortSignal) {
    if (before > 0 && this.buffer?.buffered.length && this.buffer.buffered.start(0) < before - 5)
      await mutation(this.buffer, signal, () => this.buffer!.remove(0, before));
  }
}
