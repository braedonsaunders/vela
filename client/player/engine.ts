import type { Command, EngineEvent, Failure, LiveSnapshot, PlaybackSession, Snapshot, Source } from './model';
import { SessionController, cancelled, delay, type Generation } from './session';
import { mediaSourceClass, PlaybackFault, SegmentPipeline } from './pipeline';
import { randomId } from '../src/protocol/id';

interface NativeAudioTrack { id: string; language: string; enabled: boolean }
type ExtendedVideo = HTMLVideoElement & { audioTracks?: ArrayLike<NativeAudioTrack>; webkitEnterFullscreen?: () => void; webkitExitFullscreen?: () => void; webkitSupportsFullscreen?: boolean; webkitDisplayingFullscreen?: boolean; webkitSupportsPresentationMode?: (mode: string) => boolean; webkitSetPresentationMode?: (mode: string) => void };
/** Browser host only. This module must never enter Exact's data-module bundle. */
export class PlaybackEngine {
  readonly controller = new SessionController();
  private session?: PlaybackSession; private source?: Source; private pipeline?: SegmentPipeline;
  private status: Snapshot['state'] = 'idle'; private backend: Snapshot['backend'] = null;
  private failure: Failure | null = null; private audio: string | null = null; private subtitle: string | null = null;
  private timer: ReturnType<typeof setInterval> | undefined; private listeners: (() => void)[] = [];
  private attempted = new Set<string>(); private recovering = false; private disposed = false;
  private resumePosition = 0;
  private pendingSwitch?: { sessionId: string; sourceId: string; source: number; seek: number; position: number; recovery: boolean };
  private lowDelayOverride: boolean | undefined;
  private terminalMedia?: { position: number; duration: number | null };
  private localTransportIntent: 'playing' | 'paused' | undefined;
  private wantsPlay = false; private lowDelay = false; private manualQuality: string | null = null;
  private track?: HTMLTrackElement; private lastObservation = 0;
  constructor(readonly video: ExtendedVideo, private deliver: (event: EngineEvent) => void, private fullscreenContainer: HTMLElement = video) {
    video.crossOrigin = 'anonymous'; video.playsInline = true; video.controls = false; video.preload = 'auto';
    this.timer = setInterval(() => this.publish(), 1000);
  }
  private emit(event: EngineEvent) {
    this.deliver(event.type === 'error' ? { ...event, sessionId: this.session?.id ?? null,
      sourceGeneration: this.controller.source, seekGeneration: this.controller.seek } : event);
  }
  private detachMedia() { for (const remove of this.listeners) remove(); this.listeners = []; }
  private bindMedia(token: Generation) {
    const { video } = this;
    this.detachMedia();
    for (const [name, handler] of Object.entries({
      playing: () => { if (!this.video.paused && !this.video.error && this.video.readyState >= 3) { this.status = 'playing'; this.failure = null; } },
      pause: () => { if (!['loading', 'recovering', 'failed', 'ended'].includes(this.status)) this.status = 'paused'; },
      waiting: () => { if (!['recovering','ended','failed'].includes(this.status)) this.status = 'buffering'; },
      ended: () => { this.endPlayback(); },
      error: () => { const e = video.error; if (!e || !this.session || this.disposed || ['failed','ended'].includes(this.status)) return;
        const kind = e.code === 2 ? 'network' : e.code === 3 ? 'decoder' : 'source';
        void this.recover(new PlaybackFault(e.message || `Media error ${e.code}`, kind), this.controller.token()); },
    })) {
      const listener = () => { if (!this.controller.current(token) || ['failed','ended'].includes(this.status)) return; const previous = this.status; const failure = this.failure; handler(); if (previous !== this.status || failure !== this.failure) this.lastObservation = -Infinity; this.publish(); };
      video.addEventListener(name, listener); this.listeners.push(() => video.removeEventListener(name, listener));
    }
  }
  get observationAllowed() { return this.session?.serverState !== 'ended'; }
  snapshot(): Snapshot {
    const ranges = this.video.buffered, quality = this.video.getVideoPlaybackQuality?.();
    return {
      sessionId: this.session?.id ?? null, sourceGeneration: this.controller.source, seekGeneration: this.controller.seek,
      state: this.status, sourceId: this.source?.id ?? null, strategy: this.source?.strategy ?? null,
      backend: this.backend, renditionId: this.pipeline?.current?.id ?? null,
      capabilities: { pip: this.pipAvailable(), fullscreen: this.fullscreenAvailable(), audioSwitch: (this.session?.audioTracks.length ?? 0) > 1 && !!this.session?.audioTracks.every(t => !!this.nativeAudio(t.id)) }, lockedQuality: this.manualQuality,
      live: this.liveSnapshot(),
      preparation: ['loading','buffering'].includes(this.status) && (quality?.totalVideoFrames ?? 0) === 0
        ? this.video.readyState < 1 ? 'media-metadata' : this.video.paused ? 'starting' : 'initial-buffer' : null,
      position: this.terminalMedia?.position ?? (Number.isFinite(this.video.currentTime) ? this.video.currentTime : 0),
      duration: this.terminalMedia?.duration ?? (Number.isFinite(this.video.duration) ? this.video.duration : null),
      playable: Array.from({ length: Math.min(ranges.length, 32) }, (_, i) => ({ start: ranges.start(i), end: ranges.end(i) })),
      throughputBps: this.pipeline?.bandwidth.bps ?? null, droppedFrames: quality?.droppedVideoFrames ?? null,
      totalFrames: quality?.totalVideoFrames ?? null, audioTrackId: this.audio, subtitleTrackId: this.subtitle, failure: this.failure,
    };
  }
  private catchUpTarget(): number | null {
    const ranges = this.backend === 'mse' ? this.video.buffered : this.video.seekable;
    if (!this.session?.live || !ranges.length) return null;
    const index = ranges.length - 1, start = ranges.start(index), end = ranges.end(index);
    if (end - start < 0.25) return null;
    const target = Math.max(start + 0.05, end - (this.lowDelay ? 6 : 18));
    return target > this.video.currentTime + 0.25 ? Math.min(target, end - 0.1) : null;
  }
  private liveSnapshot(): LiveSnapshot | null {
    if (!this.session?.live) return null;
    const seekable = this.video.seekable;
    let edge = this.pipeline?.publishedEdge ?? null;
    let start = this.pipeline?.publishedStart ?? null;
    let source: LiveSnapshot['edgeSource'] = edge === null ? null : 'playlist';
    if (edge === null && seekable.length) {
      edge = seekable.end(seekable.length - 1); start = seekable.start(0); source = 'seekable';
    }
    if (edge === null && Number.isFinite(this.session.liveEdge)) {
      edge = this.session.liveEdge!; start = this.session.liveWindowStart ?? null; source = 'server';
    }
    return { edgeSeconds: edge, windowStartSeconds: start,
      driftSeconds: edge === null ? null : Math.max(0, edge - this.video.currentTime), edgeSource: source,
      reconnecting: this.status === 'recovering' || !!this.pipeline?.retrying,
      delivery: this.pipeline?.delivery ?? 'unknown', canCatchUp: this.catchUpTarget() !== null };
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
    const managed = 'ManagedMediaSource' in globalThis;
    return native && (!segmented || navigator.vendor === 'Apple Computer, Inc.' && !managed);
  }
  private candidates() {
    const priority = { direct: 0, remux: 1, transcode: 2 };
    return (this.session?.sources ?? []).filter(s => this.supported(s)).sort((a,b) => priority[a.strategy] - priority[b.strategy]);
  }
  async load(session: PlaybackSession) {
    if (!this.timer) this.timer = setInterval(() => this.publish(), 1000);
    const pending = this.pendingSwitch;
    const handoff = pending && pending.sessionId === session.id && pending.sourceId === session.selectedSourceId && pending.source === session.sourceGeneration && pending.seek === session.seekGeneration;
    const position = handoff ? Math.max(pending.position, this.video.currentTime) : session.position ?? 0;
    const recovery = !!handoff && pending.recovery;
    this.pendingSwitch = undefined;
    const previousServerState = session.id === this.session?.id ? this.session.serverState : undefined;
    if (session.id !== this.session?.id) {
      this.lowDelayOverride = undefined; this.localTransportIntent = undefined;
      // Opening the watch view is a play request. Later ready revisions merely
      // update metadata and must not override an explicit pause.
      this.wantsPlay = session.serverState !== 'paused' && session.serverState !== 'ended';
    }
    this.controller.start(session.id, session.sourceGeneration, session.seekGeneration); this.resetMedia(); this.session = session;
    if (session.serverState === 'ended') { this.source = session.sources.find(s => s.id === session.selectedSourceId); this.endPlayback(session.position ?? 0); return; }
    this.applyServerState(session.serverState, previousServerState, false);
    this.source = undefined; this.failure = null; this.attempted.clear(); this.recovering = false;
    this.lowDelay = this.lowDelayOverride ?? session.lowDelay ?? false;
    this.audio = session.audioTrackId ?? null; this.subtitle = session.subtitleTrackId ?? null;
    const source = this.candidates().find(s => s.id === session.selectedSourceId) ?? this.candidates().find(s => !this.audio || s.audioTrackId === this.audio) ?? this.candidates()[0];
    if (!source) { this.fail({ kind: 'unsupported', message: 'No browser-compatible source for this edition', recoverable: false }); return; }
    await this.activate(source, position, recovery, true);
  }
  /** A server readiness/observation revision is not a new playback attempt. */
  updateSession(session: PlaybackSession) {
    if (session.id !== this.session?.id) throw new Error('Cannot update a different session');
    const previousState = this.session?.serverState;
    this.session = session;
    this.applyServerState(session.serverState, previousState);
    if (this.status === 'ended') return;
    this.lowDelay = this.lowDelayOverride ?? session.lowDelay ?? this.lowDelay;
    if (this.pipeline) { this.pipeline.lowDelay = this.lowDelay; this.pipeline.maxLiveDrift = session.liveMaxDrift ?? 45; }
    if ((session.subtitleTrackId ?? null) !== this.subtitle) {
      this.subtitle = session.subtitleTrackId ?? null; this.applySubtitle();
    }
    if ((session.audioTrackId ?? null) !== this.audio) {
      const previous = this.audio; this.audio = session.audioTrackId ?? null;
      if (!this.applyNativeAudio()) { this.audio = previous; this.emit({ type: 'error', failure: { kind: 'action', message: 'Audio change requires a new server source generation', recoverable: true } }); }
    }
  }
  private applyServerState(state: PlaybackSession['serverState'], previous: PlaybackSession['serverState'], touchVideo = true) {
    if (state === 'ended') { this.endPlayback(); return; }
    if (state !== 'paused' && state !== 'playing') return;
    if (this.localTransportIntent) {
      if (state === this.localTransportIntent) this.localTransportIntent = undefined;
      return;
    }
    if (state === previous) return;
    this.wantsPlay = state === 'playing';
    if (!touchVideo) return;
    if (state === 'paused') { this.video.pause(); this.status = 'paused'; this.publish(); }
    else if (this.video.paused) void this.play();
  }
  private endPlayback(position?: number) {
    if (this.status === 'ended' && this.terminalMedia) return;
    this.terminalMedia = { position: position ?? this.video.currentTime, duration: Number.isFinite(this.video.duration) ? this.video.duration : null };
    this.detachMedia(); this.status = 'ended'; this.failure = null; this.wantsPlay = false; this.localTransportIntent = undefined;
    this.controller.cancel(); this.pipeline?.dispose(); this.pipeline = undefined; this.track?.remove(); this.track = undefined;
    if (this.timer) clearInterval(this.timer); this.timer = undefined;
    this.video.pause(); this.video.removeAttribute('src'); this.video.load();
    this.lastObservation = -Infinity; this.publish();
  }
  private resetMedia() {
    this.terminalMedia = undefined;
    this.video.pause(); this.pipeline?.dispose(); this.pipeline = undefined;
    this.track?.remove(); this.track = undefined; this.video.removeAttribute('src'); this.video.load(); this.video.playbackRate = 1;
  }
  private async activate(source: Source, position: number, recovery = false, initial = false) {
    this.resumePosition = position;
    const token = this.controller.changeSource(!initial); this.resetMedia(); this.source = source;
    this.bindMedia(token);
    this.attempted.add(source.id); this.status = recovery ? 'recovering' : 'loading'; this.failure = null; this.lastObservation = -Infinity;
    this.publish();
    try {
      if (source.delivery === 'hls' && !this.useNativeHls(source)) {
        this.backend = 'mse';
        const pipeline = this.pipeline = new SegmentPipeline(this.video, () => this.publish());
        pipeline.lowDelay = this.lowDelay; pipeline.liveWindowStart = this.session?.liveWindowStart ?? null; pipeline.maxLiveDrift = this.session?.liveMaxDrift ?? 45; pipeline.abr.manual = this.manualQuality;
        void pipeline.run(source.renditions ?? [], position, !!this.session?.live, token.signal).catch(e => { if (this.controller.current(token)) void this.recover(e, token); });
      } else {
        this.backend = source.delivery === 'file' ? 'file' : 'native-hls';
        this.video.disableRemotePlayback = false; this.video.src = source.url;
      }
      await this.metadata(token);
      cancelled(token.signal);
      if (this.backend !== 'mse' && position > 0) this.video.currentTime = position;
      this.applySubtitle(); this.applyNativeAudio();
      this.status = this.wantsPlay ? 'loading' : 'paused';
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
  rejectCommand(message: string) { this.pendingSwitch = undefined; if (message) this.fail({ kind: 'source', message, recoverable: false }); }
  private requestSeek(seconds: number) {
    this.emit({ type: 'session-command', sessionId: this.session!.id, command: { kind: 'seek', positionSeconds: seconds,
      sourceGeneration: this.controller.source, seekGeneration: this.controller.seek, idempotencyKey: randomId() } });
  }
  private requestSwitch(source: Source, position: number, recovery = false) {
    const boundary = source.boundaries?.filter(at => at <= position).sort((a,b) => b-a)[0];
    if (boundary === undefined) throw new Error('No independent switch boundary offered by server');
    this.pendingSwitch = { sessionId: this.session!.id, sourceId: source.id, source: this.controller.source + 1, seek: this.controller.seek, position, recovery };
    this.emit({ type: 'session-command', sessionId: this.session!.id, command: { kind: 'switch', pathId: source.id, atSeconds: boundary,
      sourceGeneration: this.controller.source, seekGeneration: this.controller.seek, idempotencyKey: randomId() } });
  }
  private fail(failure: Failure) { const position = this.video.currentTime; const duration = Number.isFinite(this.video.duration) ? this.video.duration : null; this.failure = failure; this.status = 'failed'; this.controller.cancel(); this.detachMedia(); this.resetMedia(); this.terminalMedia = { position, duration }; this.emit({ type: 'error', failure }); this.lastObservation = -Infinity; this.publish(); }
  private async recover(error: unknown, token: Generation) {
    if (!this.controller.current(token) || this.recovering) return;
    this.recovering = true;
    const kind = error instanceof PlaybackFault ? error.kind : error instanceof TypeError || error instanceof DOMException && error.name === 'TimeoutError' ? 'network' : 'source';
    const position = this.video.currentTime || this.resumePosition;
    const failure: Failure = { kind, message: error instanceof Error ? error.message : String(error), recoverable: true };
    this.status = 'recovering'; this.failure = failure; this.publish();
    try {
      // Requests already retry twice; source handoff is bounded by plan length.
      await delay(300, token.signal);
      // A delayed recovery must not fail media that has since genuinely resumed.
      if (!this.video.error && this.video.readyState >= 3 && (!this.video.paused || !this.wantsPlay)) { this.status = this.video.paused ? 'paused' : 'playing'; this.failure = null; this.lastObservation = -Infinity; this.publish(); return; }
      const source = this.candidates().find(s => !this.attempted.has(s.id) && s.recoveryAllowed !== false && s.timeline === this.source?.timeline && s.edition === this.source?.edition && (!this.audio || s.audioTrackId === this.audio));
      if (!source) { this.fail({ ...failure, recoverable: false }); return; }
      // Release the guard before activation so a failed replacement can advance again.
      this.recovering = false;
      if (this.session?.serverControlled) this.requestSwitch(source, position, true);
      else await this.activate(source, position, true);
    } catch (e) { if (this.controller.current(token)) this.fail({ kind, message: String(e), recoverable: false }); }
    finally { this.recovering = false; }
  }
  private async play() {
    const token = this.controller.token();
    try { await this.video.play(); if (this.controller.current(token)) { if (['failed','ended'].includes(this.status) || this.video.error) return; this.status = 'playing'; this.failure = null; this.lastObservation = -Infinity; this.publish(); } }
    catch (e) { if (!this.controller.current(token)) return; this.status = 'paused'; this.publish(); this.emit({ type: 'error', failure: { kind: 'action', message: e instanceof Error ? e.message : String(e), recoverable: true } }); }
  }
  private nativeAudio(id: string): NativeAudioTrack | undefined {
    const tracks = Array.from(this.video.audioTracks ?? []);
    const byId = tracks.find(t => t.id === id); if (byId) return byId;
    const preference = this.session?.audioTracks.find(t => t.id === id);
    if (!preference?.language) return undefined;
    const language = (value: string) => { try { return Intl.getCanonicalLocales(value)[0]?.split('-')[0] ?? ''; } catch { return ''; } };
    const wanted = language(preference.language);
    const matches = wanted ? tracks.filter(t => language(t.language) === wanted) : [];
    // A language proves identity only when exactly one native track matches.
    return matches.length === 1 ? matches[0] : undefined;
  }
  private applyNativeAudio() {
    const selected = this.audio ? this.nativeAudio(this.audio) : undefined;
    if (!selected) return false;
    for (const track of Array.from(this.video.audioTracks ?? [])) track.enabled = track === selected;
    return true;
  }
  private pipAvailable() {
    if (this.video.disablePictureInPicture || this.video.readyState < 2 || this.video.videoWidth <= 0 || this.status === 'ended') return false;
    return !!document.pictureInPictureEnabled && !!this.video.requestPictureInPicture ||
      !!this.video.webkitSetPresentationMode && !!this.video.webkitSupportsPresentationMode?.('picture-in-picture');
  }
  private fullscreenAvailable() {
    return !!document.fullscreenEnabled && !!this.fullscreenContainer.requestFullscreen ||
      !!this.video.webkitEnterFullscreen && this.video.webkitSupportsFullscreen !== false;
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
        case 'play': this.localTransportIntent = 'playing'; this.wantsPlay = true; await this.play(); break;
        case 'pause': this.localTransportIntent = 'paused'; this.wantsPlay = false; this.video.pause(); break;
        case 'retry': if (this.session) await this.load({ ...this.session, position: this.video.currentTime || this.resumePosition }); break;
        case 'switchPath': {
          const source = this.candidates().find(s => s.id === command.pathId);
          if (!source || source.id === this.source?.id) break;
          if (source.recoveryAllowed === false) throw new Error('Source has no compatibility proof');
          if (this.session?.serverControlled) this.requestSwitch(source, this.video.currentTime);
          else await this.activate(source, this.video.currentTime);
          break;
        }
        case 'seekBy': {
          if (!Number.isFinite(command.seconds)) throw new Error('Invalid relative seek');
          const upper = Number.isFinite(this.video.duration) ? this.video.duration : Infinity;
          await this.command({ id: command.id, type: 'seek', seconds: Math.max(0, Math.min(upper, this.video.currentTime + command.seconds)) }); break;
        }
        case 'seek': {
          if (!Number.isFinite(command.seconds) || command.seconds < 0 || Number.isFinite(this.video.duration) && command.seconds > this.video.duration) throw new Error('Seek outside media timeline');
          if (this.session?.serverControlled) { this.requestSeek(command.seconds); break; }
          this.controller.changeSeek();
          if (this.backend === 'mse' && this.source) await this.activate(this.source, command.seconds, false, true);
          else this.video.currentTime = command.seconds;
          break;
        }
        case 'catchUp': {
          const target = this.catchUpTarget();
          if (target === null) throw new Error('No newer usable live buffer or seekable range');
          await this.command({ id: command.id, type: 'seek', seconds: target }); break;
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
        case 'lowDelay': this.lowDelayOverride = command.enabled; this.lowDelay = command.enabled; if (this.pipeline) this.pipeline.lowDelay = command.enabled; if (!command.enabled) this.video.playbackRate = 1; break;
        case 'pip':
          if (!this.pipAvailable()) throw new Error('Picture-in-picture is unavailable');
          if (document.pictureInPictureElement === this.video) await document.exitPictureInPicture();
          else if (document.pictureInPictureEnabled && this.video.requestPictureInPicture) await this.video.requestPictureInPicture();
          else this.video.webkitSetPresentationMode?.('picture-in-picture'); break;
        case 'fullscreen':
          if (!this.fullscreenAvailable()) throw new Error('Fullscreen is unavailable');
          if (document.fullscreenElement === this.fullscreenContainer) await document.exitFullscreen();
          else if (document.fullscreenEnabled && this.fullscreenContainer.requestFullscreen) await this.fullscreenContainer.requestFullscreen();
          else if (this.video.webkitDisplayingFullscreen) this.video.webkitExitFullscreen?.();
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
