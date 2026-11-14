import { decoderRetry, type DecoderRetry } from './universal/retry';
import { canAttemptOriginal, loadOriginalRuntime, type OriginalBackend } from './universal/loader';
import { codecKnown } from './model';
import type { Command, EngineEvent, Failure, LiveSnapshot, PlaybackSession, Snapshot, Source } from './model';
import { SessionController, cancelled, delay, type Generation } from './session';
import { mediaSourceClass, PlaybackFault, SegmentPipeline } from './pipeline';
import { nativeMediaPlaylist } from './native-hls';
import { randomId } from '../src/protocol/id';

interface NativeAudioTrack { id: string; language: string; enabled: boolean }
type ExtendedVideo = HTMLVideoElement & { audioTracks?: ArrayLike<NativeAudioTrack>; webkitEnterFullscreen?: () => void; webkitExitFullscreen?: () => void; webkitSupportsFullscreen?: boolean; webkitDisplayingFullscreen?: boolean; webkitSupportsPresentationMode?: (mode: string) => boolean; webkitSetPresentationMode?: (mode: string) => void };
/** Browser host only. This module must never enter Exact's data-module bundle. */
export class PlaybackEngine {
  readonly controller = new SessionController();
  private session?: PlaybackSession; private source?: Source; private pipeline?: SegmentPipeline;
  private original?: OriginalBackend;
  private originalStartTimer?: ReturnType<typeof setTimeout>;
  private localDecoderRetries = new Set<string>();
  private originalClosing: Promise<void> = Promise.resolve();
  private status: Snapshot['state'] = 'idle'; private backend: Snapshot['backend'] = null;
  private audioPreference?: string;
  private failure: Failure | null = null; private audio: string | null = null; private subtitle: string | null = null;
  private timer: ReturnType<typeof setInterval> | undefined; private listeners: (() => void)[] = [];
  private attempted = new Set<string>(); private recovering = false; private disposed = false;
  private resumePosition = 0;
  private pendingSwitch?: { startedAt: number; sessionId: string; sourceId: string; source: number; seek: number; position: number; recovery: boolean };
  private lowDelayOverride: boolean | undefined;
  private terminalMedia?: { position: number; duration: number | null; frames?: number | null; dropped?: number | null };
  private localTransportIntent: 'playing' | 'paused' | undefined;
  private startupDeadlineMs = 45000;
  private nativeOrigin = 0;
  private pendingSeek?: { position: number; startedAt: number; authorized: boolean };
  private waitSince = 0; private everPlayed = false; private lastPosition = 0; private lastAdvance = 0;
  private wantsPlay = false; private lowDelay = false; private manualQuality: string | null = null;
  private speed = 1;
  private pendingTracks?: { audio?: string; subtitle?: string | null; startedAt: number };
  private track?: HTMLTrackElement; private lastObservation = 0;
  constructor(readonly video: ExtendedVideo, private deliver: (event: EngineEvent) => void, private fullscreenContainer: HTMLElement = video, private readonly ambient = false) {
    video.crossOrigin = 'anonymous'; video.playsInline = true; video.controls = false; video.preload = 'auto';
    if (ambient) { video.defaultMuted = true; video.muted = true; }
    else try { const saved = localStorage.getItem('vela.player.volume'); if (saved !== null && Number.isFinite(Number(saved))) video.volume = Math.max(0, Math.min(1, Number(saved))); video.muted = video.muted || localStorage.getItem('vela.player.muted') === 'true'; } catch {}
    this.timer = setInterval(() => { this.checkWaiting(); this.publish(); }, 1000);
  }
  private emit(event: EngineEvent) {
    this.deliver(event.type === 'error' ? { ...event, sessionId: this.session?.id ?? null,
      sourceGeneration: this.controller.source, seekGeneration: this.controller.seek } : event);
  }
  private position() { return this.terminalMedia?.position ?? this.original?.position ?? (this.video.readyState >= 1 && Number.isFinite(this.video.currentTime) ? this.nativeOrigin + this.video.currentTime : this.resumePosition); }
  private duration() { return this.terminalMedia?.duration ?? this.original?.readout.duration ?? (Number.isFinite(this.video.duration) ? this.nativeOrigin + this.video.duration : this.session?.duration ?? null); }
  private frameMetrics() {
    const quality = this.video.getVideoPlaybackQuality?.();
    return {frames:this.original?.readout.frames ?? quality?.totalVideoFrames ?? null, dropped:this.original?.readout.dropped ?? quality?.droppedVideoFrames ?? null};
  }
  private saveVolume() { if (this.ambient) return; try { localStorage.setItem('vela.player.volume', String(this.video.volume)); localStorage.setItem('vela.player.muted', String(this.video.muted)); } catch {} }
  private checkWaiting() {
    if (this.pendingTracks && performance.now() - this.pendingTracks.startedAt > 15000) {
      this.pendingTracks = undefined; this.emit({type:'error',failure:{kind:'action',message:'Track selection authorization timed out',recoverable:true}});
    }
    if (this.pendingSeek && !this.pendingSeek.authorized && performance.now() - this.pendingSeek.startedAt > 15000) { this.fail({kind:'network', message:'Seek authorization timed out', recoverable:true}); return; }
    if (this.pendingSwitch && performance.now() - this.pendingSwitch.startedAt > 15000) { this.pendingSwitch = undefined; this.fail({kind:'network', message:'Source switch authorization timed out', recoverable:true}); return; }
    if (!this.session || !this.source || !this.wantsPlay || ['failed','ended','recovering'].includes(this.status)) return;
    const now = performance.now();
    if (this.position() > this.lastPosition + 0.02 && (this.original ? this.status === 'playing' : !this.video.paused)) { this.everPlayed = true; this.lastAdvance = now; this.lastPosition = this.position(); return; }
    const expired = !this.everPlayed ? now - this.waitSince > this.startupDeadlineMs : now - this.lastAdvance > 30000;
    if (expired) void this.recover(new PlaybackFault(this.everPlayed ? 'Playback stalled for 30 seconds' : `Playback did not start within ${this.startupDeadlineMs / 1000} seconds`, 'network'), this.controller.token());
  }
  private detachMedia() { for (const remove of this.listeners) remove(); this.listeners = []; }
  private bindMedia(token: Generation) {
    const { video } = this;
    this.detachMedia();
    for (const [name, handler] of Object.entries({
      volumechange: () => { this.saveVolume(); },
      playing: () => { if (!this.video.paused && !this.video.error && this.video.readyState >= 3) { this.status = 'playing'; this.failure = null; if (this.pendingSeek?.authorized) this.pendingSeek = undefined; } },
      seeked: () => { if (this.pendingSeek?.authorized && !this.wantsPlay && this.video.readyState >= 2) this.pendingSeek = undefined; },
      pause: () => { if (!this.wantsPlay && !['loading', 'recovering', 'failed', 'ended'].includes(this.status)) this.status = 'paused'; },
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
    const audioTrackIds = this.original ? this.original.audioTrackIds : this.session?.serverControlled ? this.session.audioTracks.map(t => t.id) : this.backend === 'mse' ? this.pipeline?.audioTracks ?? [] : this.session?.audioTracks.filter(t => !!this.nativeAudio(t.id)).map(t => t.id) ?? [];
    return {
      sessionId: this.session?.id ?? null, sourceGeneration: this.controller.source, seekGeneration: this.controller.seek,
      state: this.pendingSeek ? 'buffering' : this.status, sourceId: this.source?.id ?? null, strategy: this.source?.strategy ?? null,
      diagnostics: this.original ? {metadataDiscrepancies:this.original.readout.metadataDiscrepancies} : undefined,
      backend: this.backend, renditionId: this.pipeline?.current?.id ?? (this.backend === 'native-hls' ? this.manualQuality ?? this.source?.initialRenditionId ?? null : null), qualityIds: this.pipeline?.qualityIds ?? [],
      capabilities: { pip: this.pipAvailable(), fullscreen: this.fullscreenAvailable(), audioSwitch: audioTrackIds.length > 1 }, lockedQuality: this.manualQuality,
      audioTracks: this.session?.audioTracks ?? [], subtitleTracks: this.session?.subtitleTracks ?? [], renditions: this.source?.renditions ?? [],
      speed: this.speed, speeds: this.original && !this.original.setSpeed ? [] : [0.5,0.75,1,1.25,1.5,1.75,2],
      pendingSubtitleTrackId: this.pendingTracks?.subtitle ?? null,
      chapters: this.session?.chapters ?? [],
      live: this.liveSnapshot(),
      seekTarget: this.pendingSeek?.position ?? null,
      waiting: !!this.pendingSeek || ['loading','buffering','recovering'].includes(this.status) || this.wantsPlay && this.video.seeking, volume: this.video.volume, muted: this.video.muted,
      preparation: ['loading','buffering'].includes(this.status) && (this.original?.readout.frames ?? quality?.totalVideoFrames ?? 0) === 0
        ? this.video.readyState < 1 ? 'media-metadata' : this.video.paused ? 'starting' : 'initial-buffer' : null,
      position: this.position(),
      duration: this.duration(),
      playable: Array.from({ length: Math.min(ranges.length, 32) }, (_, i) => ({ start: this.nativeOrigin + ranges.start(i), end: this.nativeOrigin + ranges.end(i) })),
      throughputBps: this.pipeline?.bandwidth.bps ?? null, droppedFrames: this.terminalMedia?.dropped ?? this.original?.readout.dropped ?? quality?.droppedVideoFrames ?? null,
      totalFrames: this.terminalMedia?.frames ?? this.original?.readout.frames ?? quality?.totalVideoFrames ?? null, audioTrackIds, audioTrackId: this.original ? (this.session?.audioTracks.some(track => track.id === this.original?.readout.audioTrackId) ? this.original.readout.audioTrackId : null) : this.pipeline?.audioTrackId ?? this.audio, pendingAudioTrackId: this.pendingTracks?.audio ?? this.original?.pendingAudioTrackId ?? this.pipeline?.pendingAudioTrackId ?? null, subtitleTrackId: this.subtitle, failure: this.failure,
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
  private publish(force = false) {
    if (this.disposed) return;
    if (this.pipeline?.audioTrackId) this.audio = this.pipeline.audioTrackId;
    const now = performance.now();
    if (!force && now - this.lastObservation < 250) return;
    this.lastObservation = now; this.emit({ type: 'snapshot', snapshot: this.snapshot() });
  }
  private supported(source: Source) {
    if (source.edition !== this.session?.edition) return false;
    if (source.delivery === 'file') return source.original && canAttemptOriginal() || !!this.video.canPlayType(source.mime);
    return !!this.video.canPlayType('application/vnd.apple.mpegurl') || !!source.renditions?.some(r => mediaSourceClass() && (!codecKnown(r) || mediaSourceClass()!.isTypeSupported(r.mime)));
  }
  private useNativeHls(source: Source) {
    const native = !!this.video.canPlayType('application/vnd.apple.mpegurl');
    const segmented = !!source.renditions?.some(r => mediaSourceClass() && (!codecKnown(r) || mediaSourceClass()!.isTypeSupported(r.mime)));
    const pending = !!source.renditions?.some(r => !codecKnown(r));
    const managed = 'ManagedMediaSource' in globalThis;
    return native && (!segmented || navigator.vendor === 'Apple Computer, Inc.' && !managed && !pending);
  }
  private candidates() {
    const priority = { direct: 0, remux: 1, transcode: 2 };
    return (this.session?.sources ?? []).filter(s => this.supported(s)).sort((a,b) => priority[a.strategy] - priority[b.strategy]);
  }
  async load(session: PlaybackSession) {
    if (!this.timer) this.timer = setInterval(() => { this.checkWaiting(); this.publish(); }, 1000);
    if (session.id !== this.session?.id || session.sourceGeneration !== this.controller.source || session.seekGeneration !== this.controller.seek) this.localDecoderRetries.clear();
    const pending = this.pendingSwitch;
    const handoff = pending && pending.sessionId === session.id && pending.sourceId === session.selectedSourceId &&
      session.sourceGeneration !== undefined && session.seekGeneration !== undefined &&
      session.sourceGeneration >= pending.source && session.sourceGeneration <= pending.source+1 &&
      session.seekGeneration >= pending.seek && session.seekGeneration <= pending.seek+1 &&
      (session.sourceGeneration > pending.source || session.seekGeneration > pending.seek);
    const position = handoff ? Math.max(pending.position, this.position()) : session.position ?? 0;
    const recovery = !!handoff && pending.recovery;
    this.pendingSwitch = undefined;
    if (session.id !== this.session?.id) this.pendingSeek = undefined;
    else if (this.pendingSeek && session.seekGeneration !== this.controller.seek) this.pendingSeek = { ...this.pendingSeek, position: session.position ?? this.pendingSeek.position, authorized: true };
    const previousServerState = session.id === this.session?.id ? this.session.serverState : undefined;
    if (session.id !== this.session?.id || session.selectedSourceId !== this.source?.id) this.manualQuality = null;
    if (session.id !== this.session?.id) {
      this.audioPreference = undefined; this.lowDelayOverride = undefined; this.localTransportIntent = undefined;
      // Opening the watch view is a play request. Later ready revisions merely
      // update metadata and must not override an explicit pause.
      this.wantsPlay = session.serverState !== 'paused' && session.serverState !== 'ended';
    }
    this.controller.start(session.id, session.sourceGeneration, session.seekGeneration); this.resetMedia(); this.session = session; this.pendingTracks = undefined;
    if (session.serverState === 'ended') { this.source = session.sources.find(s => s.id === session.selectedSourceId); this.endPlayback(session.position ?? 0); return; }
    this.applyServerState(session.serverState, previousServerState, false);
    this.source = undefined; this.failure = null; this.attempted.clear(); this.recovering = false;
    this.lowDelay = this.lowDelayOverride ?? session.lowDelay ?? false;
    const preferred = this.audioPreference;
    const selected = session.sources.find(s => s.id === session.selectedSourceId);
    this.audio = preferred && (selected?.audioRenditions?.some(a => a.trackId === preferred) || selected?.original && session.audioTracks.some(track => track.id === preferred)) ? preferred : session.audioTrackId ?? null; this.subtitle = session.subtitleTrackId ?? null;
    const source = this.candidates().find(s => s.id === session.selectedSourceId) ?? this.candidates().find(s => !this.audio || s.audioTrackId === this.audio) ?? this.candidates()[0];
    if (!source) { this.fail({ kind: 'unsupported', message: 'No browser-compatible source for this edition', recoverable: false }); return; }
    await this.activate(source, position, recovery, true);
  }
  /** A server readiness/observation revision is not a new playback attempt. */
  updateSession(session: PlaybackSession) {
    if (session.id !== this.session?.id) throw new Error('Cannot update a different session');
    const previousState = this.session?.serverState;
    this.session = session;
    if (this.pendingTracks && (this.pendingTracks.audio === undefined || this.pendingTracks.audio === session.audioTrackId) &&
        (this.pendingTracks.subtitle === undefined || this.pendingTracks.subtitle === (session.subtitleTrackId ?? null))) this.pendingTracks = undefined;
    const source = session.sources.find(s => s.id === this.source?.id);
    if (source) { this.source = source; this.pipeline?.updateRenditions(source.renditions ?? []); }
    this.applyServerState(session.serverState, previousState);
    if (this.status === 'ended') return;
    this.lowDelay = this.lowDelayOverride ?? session.lowDelay ?? this.lowDelay;
    if (this.pipeline) { this.pipeline.lowDelay = this.lowDelay; this.pipeline.maxLiveDrift = session.liveMaxDrift ?? 45; }
    if ((session.subtitleTrackId ?? null) !== this.subtitle) {
      this.subtitle = session.subtitleTrackId ?? null; this.applySubtitle();
    }
    if ((session.audioTrackId ?? null) !== this.audio) {
      // Observation/readiness revisions may still echo the old server track.
      // The local original-file preference remains valid while this pinned
      // source continues to advertise it; a new generation is handled by load.
      if (this.original && this.audioPreference === this.audio && session.audioTracks.some(track => track.id === this.audio)) return;
      const previous = this.audio; const preferred = this.audioPreference;
    const selected = session.sources.find(s => s.id === session.selectedSourceId);
    this.audio = preferred && selected?.audioRenditions?.some(a => a.trackId === preferred) ? preferred : session.audioTrackId ?? null;
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
    if (state === 'paused') { this.original?.pause(); this.video.pause(); this.status = 'paused'; this.publish(); }
    else if (this.video.paused) void this.play();
  }
  private endPlayback(position?: number) {
    if (this.status === 'ended' && this.terminalMedia) return;
    this.terminalMedia = { position: position ?? this.position(), duration: this.duration(), ...this.frameMetrics() };
    this.pendingSeek = undefined; this.releaseOriginal(); this.detachMedia(); this.status = 'ended'; this.failure = null; this.wantsPlay = false; this.localTransportIntent = undefined;
    this.controller.cancel(); this.pipeline?.dispose(); this.pipeline = undefined; this.track?.remove(); this.track = undefined;
    if (this.timer) clearInterval(this.timer); this.timer = undefined;
    this.video.pause(); this.video.removeAttribute('src'); this.video.load();
    this.lastObservation = -Infinity; this.publish();
  }
  private releaseOriginal() {
    if (this.originalStartTimer) clearTimeout(this.originalStartTimer); this.originalStartTimer = undefined;
    const original = this.original; this.original = undefined;
    if (original) this.originalClosing = original.dispose().catch(() => {});
  }
  private resetMedia() {
    if (this.originalStartTimer) clearTimeout(this.originalStartTimer); this.originalStartTimer = undefined;
    this.releaseOriginal();
    this.nativeOrigin = 0;
    this.terminalMedia = undefined;
    this.video.pause(); this.pipeline?.dispose(); this.pipeline = undefined;
    this.track?.remove(); this.track = undefined; this.video.removeAttribute('src'); this.video.load(); this.video.playbackRate = 1;
  }
  private async activate(source: Source, position: number, recovery = false, initial = false, retry?: DecoderRetry) {
    this.startupDeadlineMs = source.renditions?.some(r => !codecKnown(r)) ? 60000 : 45000;
    this.resumePosition = position; this.waitSince = performance.now(); this.lastAdvance = this.waitSince; this.lastPosition = position; this.everPlayed = false;
    const token = this.controller.changeSource(!initial); this.resetMedia(); this.source = source;
    this.bindMedia(token);
    this.attempted.add(source.id); this.status = recovery ? 'recovering' : 'loading'; this.failure = null; this.lastObservation = -Infinity;
    this.publish();
    if (source.original && canAttemptOriginal()) {
      this.backend = 'webgpu'; this.startupDeadlineMs = 8000;
      this.originalStartTimer = setTimeout(() => {
        this.originalStartTimer = undefined;
        if (this.controller.current(token) && !(this.original?.readout.presentedFrames ?? 0))
          void this.recover(new PlaybackFault('Original first-frame deadline exceeded (8 seconds)','decoder'),token);
      },8000);
    }
    try {
      await new Promise<void>(resolve => { const timer=setTimeout(resolve,3500); this.originalClosing.then(() => {clearTimeout(timer);resolve();},() => {clearTimeout(timer);resolve();}); });
      cancelled(token.signal);
      if (source.original && !this.session?.live && canAttemptOriginal()) {
        this.backend = 'webgpu'; this.startupDeadlineMs = 8000;
        const parent = this.video.parentElement;
        if (!(parent instanceof HTMLDivElement)) throw new Error('Original renderer surface is missing');
        const original = await loadOriginalRuntime({ surface:{container:parent,video:this.video}, signal:token.signal, retry,
          onFailure: reason => { if (this.controller.current(token)) void this.recover(new PlaybackFault(reason,'decoder'),token); },
          onEvent: event => {
            if (!this.controller.current(token) || !this.original) return;
            if (event.type === 'waiting') this.status = 'buffering';
            else if (event.type === 'playing' || event.type === 'statechange') {
              this.status = this.original.readout.state;
              if (this.status === 'playing') { this.failure = null; if (this.pendingSeek?.authorized) this.pendingSeek = undefined; }
            } else if (event.type === 'ended') { this.endPlayback(); return; }
            this.publish();
          }});
        cancelled(token.signal); this.original = original;
        if (!this.wantsPlay) original.pause();
        if (this.subtitle) throw new Error('Selected subtitles require a compatible fallback; original overlay is not ready');
        const info = source.originalVideo;
        await original.open({url:source.url,container:'',duration:this.session?.duration ?? null,position,
          video:{...info,codec:info?.codec ?? '',width:info?.width ?? 0,height:info?.height ?? 0},
          audio:(this.session?.audioTracks ?? []).map(t => ({id:t.id,codec:t.codec ?? '',channels:t.channels,language:t.language,streamIndex:t.streamIndex ?? -1})),selectedAudioId:this.audio});
        if (original.setSpeed) await original.setSpeed(this.speed);
        cancelled(token.signal); this.status = original.readout.state; if (this.pendingSeek?.authorized && this.status === 'paused') this.pendingSeek = undefined; this.publish(); return;
      }
      if (source.delivery === 'hls' && !this.useNativeHls(source)) {
        this.backend = 'mse';
        const pipeline = this.pipeline = new SegmentPipeline(this.video, () => this.publish(), () => { if (this.controller.current(token) && this.session) this.emit({ type: 'session-refresh', sessionId: this.session.id }); });
        pipeline.timelineOriginSeconds = source.timelineOriginSeconds ?? 0;
        pipeline.audioRenditions = source.audioRenditions ?? []; pipeline.initialAudioTrackId = this.audio;
        pipeline.expensiveSwitches = source.strategy === 'transcode'; pipeline.initialRenditionId = this.manualQuality ?? source.initialRenditionId; pipeline.lowDelay = this.lowDelay; pipeline.liveWindowStart = this.session?.liveWindowStart ?? null; pipeline.maxLiveDrift = this.session?.liveMaxDrift ?? 45; pipeline.abr.manual = this.manualQuality;
        void pipeline.run(source.renditions ?? [], position, !!this.session?.live, token.signal).catch(e => { if (this.controller.current(token)) void this.recover(e, token); });
      } else {
        this.backend = source.delivery === 'file' ? 'file' : 'native-hls';
        this.video.disableRemotePlayback = false;
        const pinned = source.renditions?.find(r => r.id === this.manualQuality);
        const media = source.delivery === 'hls' ? await nativeMediaPlaylist(pinned?.url ?? source.url, token.signal) : { url: source.url, duration: null };
        cancelled(token.signal);
        const legacyOffset = !this.session?.live && position > 0 && media.duration !== null && this.session?.duration !== undefined && Math.abs(media.duration + position - this.session.duration) <= 0.25;
        if (source.timelineOriginSeconds !== undefined && (!Number.isFinite(source.timelineOriginSeconds) || source.timelineOriginSeconds < 0)) throw new Error('Invalid media timeline origin');
        this.nativeOrigin = source.delivery === 'hls' ? source.timelineOriginSeconds ?? (legacyOffset ? position : 0) : 0;
        this.video.src = media.url;
      }
      await this.metadata(token);
      cancelled(token.signal);
      this.video.playbackRate = this.speed;
      if (this.backend !== 'mse' && position > 0) this.video.currentTime = Math.max(0, position - this.nativeOrigin);
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
      const timer = setTimeout(() => { clean(); reject(new PlaybackFault('Metadata deadline exceeded', 'network', true)); }, this.startupDeadlineMs);
      const clean = () => { clearTimeout(timer); this.video.removeEventListener('loadedmetadata', done); this.video.removeEventListener('error', error); token.signal.removeEventListener('abort', abort); };
      this.video.addEventListener('loadedmetadata', done, { once: true }); this.video.addEventListener('error', error, { once: true }); token.signal.addEventListener('abort', abort, { once: true });
      if (this.video.readyState >= 1) done(); else if (token.signal.aborted) abort();
    });
  }
  rejectCommand(message: string) {
    if (this.pendingTracks) { this.pendingTracks = undefined; if (message) this.emit({type:'error',failure:{kind:'action',message,recoverable:true}}); this.publish(); return; }
    this.pendingSwitch = undefined; if (message) this.fail({ kind: 'source', message, recoverable: false });
  }
  private requestTracks(tracks: {audio?: string; subtitle?: string | null}) {
    if (!this.session?.serverControlled) throw new Error('Server track selection is unavailable');
    if (this.pendingTracks) throw new Error('A track selection is already pending');
    this.pendingTracks = {...tracks,startedAt:performance.now()};
    this.emit({type:'session-command',sessionId:this.session.id,command:{kind:'tracks',sourceGeneration:this.controller.source,
      seekGeneration:this.controller.seek,idempotencyKey:randomId(),
      ...(tracks.audio === undefined ? {} : {audioTrackId:tracks.audio}),
      ...(tracks.subtitle === undefined ? {} : {subtitleTrackId:tracks.subtitle})}});
  }
  private requestSeek(seconds: number) {
    this.pendingSeek = { position: seconds, startedAt: performance.now(), authorized: false };
    this.status = 'buffering'; this.original?.pause(); this.video.pause(); this.lastObservation = -Infinity; this.publish();
    this.emit({ type: 'session-command', sessionId: this.session!.id, command: { kind: 'seek', positionSeconds: seconds,
      sourceGeneration: this.controller.source, seekGeneration: this.controller.seek, idempotencyKey: randomId() } });
  }
  private requestSwitch(source: Source | {id:string;onDemand:true}, position: number, recovery = false) {
    const boundary = 'onDemand' in source ? position : source.boundaries?.filter(at => at <= position).sort((a,b) => b-a)[0];
    if (boundary === undefined) throw new Error('No independent switch boundary offered by server');
    this.pendingSwitch = { startedAt: performance.now(), sessionId: this.session!.id, sourceId: source.id, source: this.controller.source, seek: this.controller.seek, position, recovery };
    this.emit({ type: 'session-command', sessionId: this.session!.id, command: { kind: 'switch', pathId: source.id, atSeconds: boundary,
      sourceGeneration: this.controller.source, seekGeneration: this.controller.seek, idempotencyKey: randomId() } });
  }
  private fail(failure: Failure) { const position = this.position(); const duration = this.duration(); const metrics = this.frameMetrics(); this.pendingSeek = undefined; this.failure = failure; this.status = 'failed'; this.controller.cancel(); this.detachMedia(); this.resetMedia(); this.terminalMedia = { position, duration, ...metrics }; this.emit({ type: 'error', failure }); this.lastObservation = -Infinity; this.publish(); }
  private async recover(error: unknown, token: Generation) {
    if (!this.controller.current(token) || this.recovering) return;
    this.recovering = true;
    const kind = error instanceof PlaybackFault ? error.kind : error instanceof TypeError || error instanceof DOMException && error.name === 'TimeoutError' ? 'network' : 'source';
    const position = this.position();
    const failure: Failure = { kind, message: error instanceof Error ? error.message : String(error), recoverable: true };
    if (this.originalStartTimer) clearTimeout(this.originalStartTimer); this.originalStartTimer = undefined;
    this.status = 'recovering'; this.failure = failure; this.publish(true);
    try {
      const retry = this.backend === 'webgpu' && (!failure.message.startsWith('Original first-frame deadline') || this.original?.readout.decoderReady) ? decoderRetry(failure.message) : null;
      if (retry && this.source?.original && !this.localDecoderRetries.has(this.source.id)) {
        this.localDecoderRetries.add(this.source.id);
        this.recovering = false;
        // Local decoder replacement retains the broker's source/seek identity.
        await this.activate(this.source, position, true, true, retry); return;
      }
      this.resumePosition = position; this.releaseOriginal();
      // Requests already retry twice; source handoff is bounded by plan length.
      await delay(300, token.signal);
      // A delayed recovery must not fail media that has since genuinely resumed.
      if (!this.video.error && this.video.readyState >= 3 && (!this.video.paused || !this.wantsPlay)) { this.status = this.video.paused ? 'paused' : 'playing'; this.failure = null; this.lastObservation = -Infinity; this.publish(); return; }
      const source = this.candidates().find(s => !this.attempted.has(s.id) && s.recoveryAllowed !== false && s.timeline === this.source?.timeline && s.edition === this.source?.edition && (!this.audio || s.audioTrackId === this.audio));
      if (!source) {
        const pending = this.session?.onDemandSources?.find(s => !this.attempted.has(s.id));
        if (pending && this.session?.serverControlled) { this.attempted.add(pending.id); this.requestSwitch(pending,position,true); return; }
        this.fail({ ...failure, recoverable: false }); return;
      }
      // Release the guard before activation so a failed replacement can advance again.
      this.recovering = false;
      if (this.session?.serverControlled) this.requestSwitch(source, position, true);
      else await this.activate(source, position, true);
    } catch (e) { if (this.controller.current(token)) this.fail({ kind, message: String(e), recoverable: false }); }
    finally { this.recovering = false; }
  }
  private async play() {
    if (this.original) { this.original.resume(); return; }
    const token = this.controller.token();
    try { await this.video.play(); if (this.controller.current(token)) { if (['failed','ended'].includes(this.status) || this.video.error) return; this.status = 'playing'; this.failure = null; if (this.pendingSeek?.authorized) this.pendingSeek = undefined; this.lastObservation = -Infinity; this.publish(); } }
    catch (e) {
      if (!this.controller.current(token)) return;
      if (e instanceof DOMException && e.name === 'NotAllowedError' && !this.video.muted) {
        this.video.muted = true;
        try { await this.video.play(); if (!this.controller.current(token)) return; this.status = 'playing'; this.failure = null; if (this.pendingSeek?.authorized) this.pendingSeek = undefined; this.lastObservation = -Infinity; this.publish(); return; } catch (retryError) { e = retryError; }
      }
      if (this.controller.current(token)) this.fail({ kind: 'action', message: e instanceof Error ? e.message : String(e), recoverable: true });
    }
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
    if (this.backend === 'webgpu') return !!document.fullscreenEnabled && !!this.fullscreenContainer.requestFullscreen;
    return !!document.fullscreenEnabled && !!this.fullscreenContainer.requestFullscreen ||
      !!this.video.webkitEnterFullscreen && this.video.webkitSupportsFullscreen !== false;
  }
  private applySubtitle() {
    this.track?.remove(); this.track = undefined;
    if (!this.subtitle) return;
    const selected = this.session?.subtitleTracks.find(t => t.id === this.subtitle);
    if (selected?.delivery?.kind === 'burn-in') return;
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
        case 'pause': this.localTransportIntent = 'paused'; this.wantsPlay = false; this.original?.pause(); this.video.pause(); break;
        case 'retry': if (this.session) await this.load({ ...this.session, position: this.terminalMedia?.position ?? this.position() }); break;
        case 'switchPath': {
          const source = this.candidates().find(s => s.id === command.pathId) ?? this.session?.onDemandSources?.find(s => s.id === command.pathId);
          if (!source || source.id === this.source?.id) break;
          if (this.session?.serverControlled) this.requestSwitch({id:source.id,onDemand:true}, this.position());
          else if (!('onDemand' in source) && source.recoveryAllowed !== false) await this.activate(source, this.position());
          break;
        }
        case 'seekBy': {
          if (!Number.isFinite(command.seconds)) throw new Error('Invalid relative seek');
          const upper = this.duration() ?? Infinity;
          await this.command({ id: command.id, type: 'seek', seconds: Math.max(0, Math.min(upper, (this.pendingSeek?.position ?? this.position()) + command.seconds)) }); break;
        }
        case 'seek': {
          if (!Number.isFinite(command.seconds) || command.seconds < 0 || this.duration() !== null && command.seconds > this.duration()!) throw new Error('Seek outside media timeline');
          if (this.session?.serverControlled) { this.requestSeek(command.seconds); break; }
          this.controller.changeSeek();
          if (this.backend === 'mse' && this.source) await this.activate(this.source, command.seconds, false, true);
          else this.video.currentTime = Math.max(0, command.seconds - this.nativeOrigin);
          break;
        }
        case 'catchUp': {
          const target = this.catchUpTarget();
          if (target === null) throw new Error('No newer usable live buffer or seekable range');
          await this.command({ id: command.id, type: 'seek', seconds: target }); break;
        }
        case 'mute': this.video.muted = command.muted ?? !this.video.muted; this.original?.setMuted(this.video.muted); this.saveVolume(); this.lastObservation = -Infinity; break;
        case 'volume': if (!Number.isFinite(command.value) || command.value < 0 || command.value > 1) throw new Error('Volume outside 0–1'); this.video.volume = command.value; this.original?.setVolume(command.value); if (command.value > 0) this.video.muted = false; this.original?.setMuted(this.video.muted); this.saveVolume(); this.lastObservation = -Infinity; break;
        case 'speed':
          if (!Number.isFinite(command.value) || command.value < 0.5 || command.value > 2) throw new Error('Playback speed must be between 0.5 and 2');
          if (this.original) { if (!this.original.setSpeed) throw new Error('Playback speed requires an updated runtime'); await this.original.setSpeed(command.value); }
          else this.video.playbackRate = command.value;
          this.speed = command.value; break;
        case 'quality': {
          if (command.renditionId?.startsWith('path:')) { await this.command({id:command.id,type:'switchPath',pathId:command.renditionId.slice(5)}); break; }
          const chosen = this.source?.renditions?.find(r => r.id === command.renditionId);
          if (command.renditionId && !chosen) throw new Error('Unknown quality rendition');
          if (this.source?.delivery !== 'hls') { if (command.renditionId) throw new Error('Original quality is fixed'); break; }
          this.manualQuality = command.renditionId;
          if (this.pipeline && (!chosen || this.pipeline.qualityIds.includes(chosen.id))) this.pipeline.abr.manual = command.renditionId;
          else if (this.source) await this.activate(this.source,this.position(),false,true);
          break;
        }
        case 'audio': {
          if (!this.session?.audioTracks.some(t => t.id === command.trackId)) throw new Error('Unknown audio track');
          if (this.original) {
            const original = this.original; await original.selectAudio(command.trackId);
            if (this.original !== original) return;
            this.audio = command.trackId; this.audioPreference = command.trackId; break;
          }
          if (this.pipeline?.audioTracks.includes(command.trackId)) {
            this.audioPreference = command.trackId;
            try { await this.pipeline.selectAudio(command.trackId); } catch (error) { if (this.audioPreference === command.trackId) this.audioPreference = this.audio ?? undefined; throw error; }
            break;
          }
          if (this.session.serverControlled && !this.nativeAudio(command.trackId)) { this.requestTracks({audio:command.trackId}); break; }
          const previous = this.audio; this.audio = command.trackId;
          if (this.applyNativeAudio()) break;
          const source = this.candidates().find(s => s.audioTrackId === command.trackId && s.timeline === this.source?.timeline);
          if (!source) { this.audio = previous; throw new Error('Audio selection requires a compatible server source'); }
          await this.activate(source, this.position()); break;
        }
        case 'subtitle': {
          const selected = command.trackId ? this.session?.subtitleTracks.find(t => t.id === command.trackId) : null;
          if (command.trackId && !selected) throw new Error('Unknown subtitle track');
          const current = this.session?.subtitleTracks.find(t => t.id === this.subtitle);
          if (selected?.delivery?.kind === 'burn-in' || current?.delivery?.kind === 'burn-in') { this.requestTracks({subtitle:command.trackId}); break; }
          if (this.original && command.trackId && this.session?.serverControlled) { this.requestTracks({subtitle:command.trackId}); break; }
          if (this.original && command.trackId) throw new Error('This source has no installed subtitle renderer');
          if (command.trackId && !this.session?.subtitleTracks.some(t => t.id === command.trackId && t.url)) throw new Error('Unknown WebVTT track');
          this.subtitle = command.trackId; this.applySubtitle(); break;
        }
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
    } catch (e) { if (e instanceof DOMException && e.name === 'AbortError') return; this.emit({ type: 'error', failure: { kind: 'action', message: e instanceof Error ? e.message : String(e), recoverable: true } }); }
    this.publish();
  }
  dispose() {
    this.disposed = true; this.controller.stop(); clearInterval(this.timer);
    for (const remove of this.listeners) remove(); this.listeners = []; this.resetMedia(); this.session = undefined;
  }
}
