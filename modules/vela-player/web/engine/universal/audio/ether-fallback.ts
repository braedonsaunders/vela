import type { AudioFallbackRequest, AudioFallbackResponse, Mutation, Ack } from '../../../../../../protocol/v0/types';

/** Authenticated adapter calls stay outside the native view. Implemented by EtherAdapter. */
export interface AudioFallbackTransport {
  createAudioFallback(sessionId: string, request: AudioFallbackRequest, signal?: AbortSignal): Promise<AudioFallbackResponse>;
  cancelAudioFallback(sessionId: string, audioId: string, request: Mutation, signal?: AbortSignal): Promise<Ack>;
}
export interface AudioFallbackPosition {
  sessionId: string; trackId: string; positionSeconds: number;
  sourceGeneration: number; seekGeneration: number;
}
interface Active { sessionId: string; descriptor: AudioFallbackResponse }

/** Owns only Ether's audio rendition job. The runtime installs its HLS audio output
 * through the existing native-audio bridge; video URL/source identity is untouched.
 * Requests serialize so late old track choices cannot replace newer server jobs. */
export class EtherAudioFallback {
  private revision = 0;
  private active: Active | null = null;
  private requestAbort: AbortController | null = null;
  private pending = Promise.resolve();
  cleanupError: string | null = null;
  constructor(private transport: AudioFallbackTransport) {}
  get descriptor(): AudioFallbackResponse | null { return this.active?.descriptor ?? null; }

  async start(position: AudioFallbackPosition, signal: AbortSignal): Promise<AudioFallbackResponse> {
    signal.throwIfAborted();
    if (!Number.isFinite(position.positionSeconds) || position.positionSeconds < 0)
      throw new RangeError('Audio fallback needs an absolute media position');
    const revision = ++this.revision;
    this.requestAbort?.abort();
    const previous = this.pending;
    let release!: () => void;
    this.pending = new Promise<void>(resolve => { release = resolve; });
    try {
      await previous;
      signal.throwIfAborted();
      if (revision !== this.revision) throw new DOMException('Audio fallback superseded', 'AbortError');
      const request: AudioFallbackRequest = { idempotencyKey: crypto.randomUUID(), trackId: position.trackId,
        positionSeconds: position.positionSeconds, sourceGeneration: position.sourceGeneration,
        seekGeneration: position.seekGeneration, preferredCodec: 'aac' };
      const requestAbort = new AbortController(); this.requestAbort = requestAbort;
      const descriptor = await this.transport.createAudioFallback(position.sessionId, request,
        AbortSignal.any([signal, requestAbort.signal, AbortSignal.timeout(20_000)]));
      const created = { sessionId: position.sessionId, descriptor };
      if (signal.aborted || revision !== this.revision) {
        await this.retire(created);
        throw new DOMException('Audio fallback superseded', 'AbortError');
      }
      // Validate before publishing a resource the native view will fetch.
      if (!descriptor.id || descriptor.trackId !== position.trackId || !Number.isSafeInteger(descriptor.audioGeneration) ||
          descriptor.audioGeneration < 1 || descriptor.codec !== 'mp4a.40.2' ||
          descriptor.mimeType !== 'application/vnd.apple.mpegurl' || descriptor.timelineOriginSeconds !== 0) {
        await this.retire(created);
        throw new Error('Invalid Ether audio-only fallback descriptor');
      }
      let validURL = false;
      try { validURL = ['https:', 'http:'].includes(new URL(descriptor.url).protocol); } catch {}
      if (!validURL) { await this.retire(created); throw new Error('Invalid audio fallback URL'); }
      const old = this.active; this.active = created;
      if (old && old.descriptor.id !== descriptor.id) await this.retire(old);
      return descriptor;
    } finally { release(); }
  }

  async stop(): Promise<void> {
    ++this.revision; this.requestAbort?.abort();
    const active = this.active; this.active = null;
    // An in-flight start retires its own result when its revision no longer matches.
    if (active) await this.retire(active);
  }
  private async retire(active: Active) {
    try {
      await this.transport.cancelAudioFallback(active.sessionId, active.descriptor.id,
        { idempotencyKey: crypto.randomUUID() }, AbortSignal.timeout(10_000));
    } catch (error) {
      this.cleanupError = error instanceof Error ? error.message : String(error);
    }
  }
}
