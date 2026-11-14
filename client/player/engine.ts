import type { Command, EngineEvent, Failure, PlaybackSession, Snapshot, Source } from './model';
import { SessionController, cancelled, delay, type Generation } from './session';
import { mediaSourceClass, PlaybackFault, SegmentPipeline } from './pipeline';

interface NativeAudioTrack { id: string; language: string; enabled: boolean }
type ExtendedVideo = HTMLVideoElement & { audioTracks?: ArrayLike<NativeAudioTrack>; webkitEnterFullscreen?: () => void };
/** Browser host only. This module must never enter Exact's data-module bundle. */
export class PlaybackEngine {
  readonly controller = new SessionController();
  private session?: PlaybackSession; private source?: Source; private pipeline?: SegmentPipeline;
  private status: Snapshot['state'] = 'idle'; private backend: Snapshot['backend'] = null;
  private failure: Failure | null = null; private audio: string | null = null; private subtitle: string | null = null;
  private timer: ReturnType<typeof setInterval>; private listeners: (() => void)[] = [];
  private attempted = new Set<string>(); private recovering = false; private disposed = false;
  private resumePosition = 0;
  private wantsPlay = false; private lowDelay = false; private manualQuality: string | null = null;
  private track?: HTMLTrackElement; private lastObservation = 0;
  constructor(readonly video: ExtendedVideo, private emit: (event: EngineEvent) => void, private fullscreenContainer: HTMLElement = video) {
    video.playsInline = true; video.controls = false; video.preload = 'auto';
    for (const [name, handler] of Object.entries({
      playing: () => { this.status = 'playing'; this.failure = null; },
      pause: () => { if (!['loading', 'recovering', 'failed'].includes(this.status)) this.status = 'paused'; },
      waiting: () => { if (this.status !== 'recovering') this.status = 'buffering'; },
      ended: () => { this.status = 'ended'; },
      error: () => { const e = video.error; if (!e || !this.session || this.disposed || this.status === 'failed') return;
        const kind = e.code === 2 ? 'network' : e.code === 3 ? 'decoder' : 'source';
        void this.recover(new PlaybackFault(e.message || `Media error ${e.code}`, kind), this.controller.token()); },
    })) {
      const listener = () => { handler(); this.publish(); };
      video.addEventListener(name, listener); this.listeners.push(() => video.removeEventListener(name, listener));
    }
    this.timer = setInterval(() => this.publish(), 1000);
  }
  snapshot(): Snapshot {
    const ranges = this.video.buffered, quality = this.video.getVideoPlaybackQuality?.();
    return {
      sessionId: this.session?.id ?? null, sourceGeneration: this.controller.source, seekGeneration: this.controller.seek,
      state: this.status, sourceId: this.source?.id ?? null, strategy: this.source?.strategy ?? null,
      backend: this.backend, renditionId: this.pipeline?.current?.id ?? null,
      position: Number.isFinite(this.video.currentTime) ? this.video.currentTime : 0,
      duration: Number.isFinite(this.video.duration) ? this.video.duration : null,
      playable: Array.from({ length: Math.min(ranges.length, 32) }, (_, i) => ({ start: ranges.start(i), end: ranges.end(i) })),
      throughputBps: this.pipeline?.bandwidth.bps ?? null, droppedFrames: quality?.droppedVideoFrames ?? null,
      totalFrames: quality?.totalVideoFrames ?? null, audioTrackId: this.audio, subtitleTrackId: this.subtitle, failure: this.failure,
    };
  }
  private publish() {
    if (this.disposed) return;
    const now = performance.now();
    if (now - this.lastObservation < 250) return;
    this.lastObservation = now; this.emit({ type: 'snapshot', snapshot: this.snapshot() });
  }
  private supported(source: Source) {
    if (source.edition !== this.session?.edition) return false;
    if (source.delivery === 'file') return !!this.video.canPlayType(source.mime);
    return !!this.video.canPlayType('application/vnd.apple.mpegurl') || !!source.renditions?.some(r => mediaSourceClass()?.isTypeSupported(r.mime));
  }
  private useNativeHls(source: Source) {
    const native = !!this.video.canPlayType('application/vnd.apple.mpegurl');
    const segmented = !!source.renditions?.some(r => mediaSourceClass()?.isTypeSupported(r.mime));
    return native && (!segmented || navigator.vendor === 'Apple Computer, Inc.');
  }
  private candidates() {
    const priority = { direct: 0, remux: 1, transcode: 2 };
    return (this.session?.sources ?? []).filter(s => this.supported(s)).sort((a,b) => priority[a.strategy] - priority[b.strategy]);
  }
  async load(session: PlaybackSession) {
    this.controller.start(session.id, session.sourceGeneration, session.seekGeneration); this.resetMedia(); this.session = session;
    this.source = undefined; this.failure = null; this.attempted.clear(); this.recovering = false;
    this.lowDelay = session.lowDelay ?? false;
    this.audio = session.audioTrackId ?? null; this.subtitle = session.subtitleTrackId ?? null;
    const source = this.candidates().find(s => s.id === session.selectedSourceId) ?? this.candidates().find(s => !this.audio || s.audioTrackId === this.audio) ?? this.candidates()[0];
    if (!source) { this.fail({ kind: 'unsupported', message: 'No browser-compatible source for this edition', recoverable: false }); return; }
    await this.activate(source, session.position ?? 0, false, true);
  }
  /** A server readiness/observation revision is not a new playback attempt. */
  updateSession(session: PlaybackSession) {
    if (session.id !== this.session?.id) throw new Error('Cannot update a different session');
    this.session = session;
    if ((session.subtitleTrackId ?? null) !== this.subtitle) {
      this.subtitle = session.subtitleTrackId ?? null; this.applySubtitle();
    }
    if ((session.audioTrackId ?? null) !== this.audio) {
      const previous = this.audio; this.audio = session.audioTrackId ?? null;
      if (!this.applyNativeAudio()) { this.audio = previous; this.emit({ type: 'error', failure: { kind: 'action', message: 'Audio change requires a new server source generation', recoverable: true } }); }
    }
  }
  private resetMedia() {
    this.video.pause(); this.pipeline?.dispose(); this.pipeline = undefined;
    this.track?.remove(); this.track = undefined; this.video.removeAttribute('src'); this.video.load(); this.video.playbackRate = 1;
  }
  private async activate(source: Source, position: number, recovery = false, initial = false) {
    this.resumePosition = position;
    const token = this.controller.changeSource(!initial); this.resetMedia(); this.source = source;
    this.attempted.add(source.id); this.status = recovery ? 'recovering' : 'loading'; this.failure = null;
    this.publish();
    try {
      if (source.delivery === 'hls' && !this.useNativeHls(source)) {
        this.backend = 'mse';
        const pipeline = this.pipeline = new SegmentPipeline(this.video, () => this.publish());
        pipeline.lowDelay = this.lowDelay; pipeline.liveWindowStart = this.session?.liveWindowStart ?? 0; pipeline.maxLiveDrift = this.session?.liveMaxDrift ?? 45; pipeline.abr.manual = this.manualQuality;
        void pipeline.run(source.renditions ?? [], position, !!this.session?.live, token.signal).catch(e => { if (this.controller.current(token)) void this.recover(e, token); });
      } else {
        this.backend = source.delivery === 'file' ? 'file' : 'native-hls';
        this.video.disableRemotePlayback = false; this.video.src = source.url;
      }
      await this.metadata(token);
      cancelled(token.signal);
      if (this.backend !== 'mse' && position > 0) this.video.currentTime = position;
      this.applySubtitle(); this.applyNativeAudio();
      this.status = 'paused';
      if (this.wantsPlay) await this.play();
      this.publish();
    } catch (e) { if (this.controller.current(token)) await this.recover(e, token); }
  }
  private metadata(token: Generation): Promise<void> {
    return new Promise((resolve, reject) => {
      const done = () => { clean(); resolve(); };
      const abort = () => { clean(); reject(new DOMException('Superseded', 'AbortError')); };
      const error = () => { clean(); reject(new PlaybackFault('Media metadata unavailable', 'source')); };
      const timer = setTimeout(() => { clean(); reject(new PlaybackFault('Metadata deadline exceeded', 'network', true)); }, 15000);
      const clean = () => { clearTimeout(timer); this.video.removeEventListener('loadedmetadata', done); this.video.removeEventListener('error', error); token.signal.removeEventListener('abort', abort); };
      this.video.addEventListener('loadedmetadata', done, { once: true }); this.video.addEventListener('error', error, { once: true }); token.signal.addEventListener('abort', abort, { once: true });
      if (this.video.readyState >= 1) done(); else if (token.signal.aborted) abort();
    });
  }
  private fail(failure: Failure) { this.controller.cancel(); this.pipeline?.dispose(); this.video.pause(); this.failure = failure; this.status = 'failed'; this.emit({ type: 'error', failure }); this.publish(); }
  private async recover(error: unknown, token: Generation) {
    if (!this.controller.current(token) || this.recovering) return;
    this.recovering = true;
    const kind = error instanceof PlaybackFault ? error.kind : error instanceof TypeError || error instanceof DOMException && error.name === 'TimeoutError' ? 'network' : 'source';
    const position = this.video.currentTime || this.resumePosition;
    this.status = 'recovering'; this.failure = { kind, message: error instanceof Error ? error.message : String(error), recoverable: true }; this.publish();
    try {
      // Requests already retry twice; source handoff is bounded by plan length.
      await delay(300, token.signal);
      const source = this.candidates().find(s => !this.attempted.has(s.id) && s.recoveryAllowed !== false && s.timeline === this.source?.timeline && s.edition === this.source?.edition && (!this.audio || s.audioTrackId === this.audio));
      if (!source) { this.fail({ ...this.failure!, recoverable: false }); return; }
      // Release the guard before activation so a failed replacement can advance again.
      this.recovering = false; await this.activate(source, position, true);
    } catch (e) { if (this.controller.current(token)) this.fail({ kind, message: String(e), recoverable: false }); }
    finally { this.recovering = false; }
  }
  private async play() {
    const token = this.controller.token();
    try { await this.video.play(); }
    catch (e) { if (!this.controller.current(token)) return; this.emit({ type: 'error', failure: { kind: 'action', message: e instanceof Error ? e.message : String(e), recoverable: true } }); }
  }
  private applyNativeAudio() {
    const tracks = this.video.audioTracks;
    if (!tracks || !this.audio) return false;
    const selected = Array.from(tracks).find(t => t.id === this.audio);
    if (!selected) return false;
    for (const track of Array.from(tracks)) track.enabled = track === selected;
    return true;
  }
  private applySubtitle() {
    this.track?.remove(); this.track = undefined;
    if (!this.subtitle) return;
    const selected = this.session?.subtitleTracks.find(t => t.id === this.subtitle);
    if (!selected?.url) throw new Error('Selected subtitle has no WebVTT URL');
    const track = this.track = document.createElement('track'); track.kind = 'subtitles';
    track.label = selected.label; track.srclang = selected.language ?? 'und'; track.src = selected.url; track.default = true;
    track.addEventListener('load', () => { if (this.track === track) track.track.mode = 'showing'; }, { once: true });
    track.addEventListener('error', () => { if (this.track === track) this.emit({ type: 'error', failure: { kind: 'source', message: 'Subtitle could not be loaded', recoverable: true } }); }, { once: true });
    this.video.append(track); track.track.mode = 'showing';
  }
  async command(command: Command) {
    if (this.disposed) return;
    try {
      switch (command.type) {
        case 'play': this.wantsPlay = true; await this.play(); break;
        case 'pause': this.wantsPlay = false; this.video.pause(); break;
        case 'seek': {
          if (!Number.isFinite(command.seconds) || command.seconds < 0 || Number.isFinite(this.video.duration) && command.seconds > this.video.duration) throw new Error('Seek outside media timeline');
          this.controller.changeSeek();
          if (this.backend === 'mse' && this.source) await this.activate(this.source, command.seconds, false, true);
          else this.video.currentTime = command.seconds;
          break;
        }
        case 'volume': if (!Number.isFinite(command.value) || command.value < 0 || command.value > 1) throw new Error('Volume outside 0–1'); this.video.volume = command.value; break;
        case 'quality':
          if (this.backend !== 'mse') throw new Error('Quality is controlled by the browser on this playback path');
          if (command.renditionId && !this.source?.renditions?.some(r => r.id === command.renditionId)) throw new Error('Unknown rendition');
          this.manualQuality = command.renditionId; if (this.pipeline) this.pipeline.abr.manual = command.renditionId; break;
        case 'audio': {
          if (!this.session?.audioTracks.some(t => t.id === command.trackId)) throw new Error('Unknown audio track');
          const previous = this.audio; this.audio = command.trackId;
          if (this.applyNativeAudio()) break;
          const source = this.candidates().find(s => s.audioTrackId === command.trackId && s.timeline === this.source?.timeline);
          if (!source) { this.audio = previous; throw new Error('Audio selection requires a compatible server source'); }
          await this.activate(source, this.video.currentTime); break;
        }
        case 'subtitle':
          if (command.trackId && !this.session?.subtitleTracks.some(t => t.id === command.trackId && t.url)) throw new Error('Unknown WebVTT track');
          this.subtitle = command.trackId; this.applySubtitle(); break;
        case 'lowDelay': this.lowDelay = command.enabled; if (this.pipeline) this.pipeline.lowDelay = command.enabled; if (!command.enabled) this.video.playbackRate = 1; break;
        case 'pip':
          if (!document.pictureInPictureEnabled || !this.video.requestPictureInPicture) throw new Error('Picture-in-picture is unavailable');
          await this.video.requestPictureInPicture(); break;
        case 'fullscreen':
          if (this.fullscreenContainer.requestFullscreen) await this.fullscreenContainer.requestFullscreen();
          else if (this.video.webkitEnterFullscreen) this.video.webkitEnterFullscreen();
          else throw new Error('Fullscreen is unavailable'); break;
      }
    } catch (e) { this.emit({ type: 'error', failure: { kind: 'action', message: e instanceof Error ? e.message : String(e), recoverable: true } }); }
    this.publish();
  }
  dispose() {
    this.disposed = true; this.controller.stop(); clearInterval(this.timer);
    for (const remove of this.listeners) remove(); this.listeners = []; this.resetMedia(); this.session = undefined;
  }
}
