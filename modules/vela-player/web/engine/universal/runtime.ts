import NativeAudioBridge from 'webgpu-player/src/audio/native/CustomDecodeNativeAudioBridge';
import NativeAudioBackend from 'webgpu-player/src/audio/native/OwnedNativeMediaAudioBackend';
import {videoInfo} from '../video-info';
import type {NetworkReadout} from './transport';
import {playbackMark} from '../timing';
import { abortable } from './abortable';
import { QUALIFIED_ORIGINAL_VIDEO } from './qualified';
import { configureEngineAssets,createEngineWorker } from 'webgpu-player/src/EngineAssets';
import CustomDecodeSession from 'webgpu-player/src/pipeline/CustomDecodeSession';
import { getCustomPlaybackRuntimeAvailability } from 'webgpu-player/src/capability/CustomPlaybackRuntime';
import { probeCustomDecodeCapabilities, type CustomDecodeCapabilities } from 'webgpu-player/src/capability/CustomDecodeCapabilities';
import { getCustomPlaybackEligibility, getAudioMetadataLayout } from 'webgpu-player/src/capability/CustomPlaybackEligibility';
import { prewarmBrowserAudioContext } from 'webgpu-player/src/audio/output/BrowserAudioContextPrewarm';
import { getWebGPUAudioOutputManager } from 'webgpu-player/src/audio/output/WebGPUAudioOutputManager';
import Controller from 'webgpu-player/src/pipeline/CustomPlaybackController';
import FrameLoop from 'webgpu-player/src/pipeline/CustomPlaybackFrameLoop';
import Presenter from 'webgpu-player/src/presentation/WebGPUPresenter';
import { readPresentationInput, getCustomPresentationEligibilityOptions, configurePresentationColorPipeline, alignPresentationInputBitDepth, getGPUVideoDecoderOffers, createGPUVideoDecodeSessionFactory } from 'webgpu-player/src/presentation/PresentationSetup';
import { createHDRToSDRRenderSettings } from 'webgpu-player/src/presentation/RenderSettings';
import { secondsToMicroseconds, microsecondsToSeconds } from 'webgpu-player/src/MediaTime';
import type { CustomPlaybackControllerEvent, CustomPlaybackTelemetry } from 'webgpu-player/src/pipeline/CustomPlaybackControllerTypes';
import { createAudioPackages, createBrowserCustomAudioOutputFactory } from './audio/upstream';
import { prepareOriginalAudioSwitch } from './audio/original-track';
import { videoPackageId, VideoPackages } from './video/packages';
import { outputLayout } from './audio/policy';
import type { DecoderRetry } from './retry';
import type { UniversalReadout } from './loader';
import { audioDifferences } from './diagnostics';
import { probeOriginal } from './probe';
import { upstreamOptions, type OriginalMedia } from './source';
export {SubtitleSession} from './subtitles/session';

export interface RuntimeOptions {
  mediaRequests?:import('../media-auth').MediaRequestPolicy;
  surface: { container: HTMLDivElement; video: HTMLVideoElement };
  assets: { baseURL: string; assetKey: string; audioDecoderURL: string; videoDecoderURL: string };
  retry?: DecoderRetry;
  signal: AbortSignal;
  onEvent: (event: CustomPlaybackControllerEvent) => void;
  onFailure: (reason: string, position: number) => void;
}
/** Observe successful component presentation, rather than the later 250ms UI sample. */
class TimedPresenter extends Presenter {
  override presentDecodedFrame(...args:Parameters<Presenter['presentDecodedFrame']>){
    const drawn=super.presentDecodedFrame(...args);
    if(drawn)playbackMark('first-frame','webgpu');
    return drawn;
  }
}
/** One original file/session. This module is loaded separately from Contract and
 * the legacy media engine; workers and decoder packages remain separate assets. */
export class UniversalRuntime {
  readonly implementation='upstream-controller' as const;
  private nativeAudio?:HTMLAudioElement;
  private presenter: Presenter;
  private controller?: Controller;
  private readonly credentialWorkers=new Set<Worker>();
  private loop?: FrameLoop;
  private disposed = false;
  private readonly lifetime = new AbortController();
  private failureSent = false;
  private wantsPlaying = true;
  private initialPosition = 0;
  private media?: OriginalMedia;
  private audioRegistry?: ReturnType<typeof createAudioPackages>;
  private maximumChannels: number | null = null;
  private audioSwitch?: AbortController;
  private pendingAudio: string | null = null;
  private metricsGeneration: number | null = null;
  private carriedFrames = 0; private carriedDropped = 0;
  private decodedFrames = 0; private droppedFrames = 0;
  get audioTrackIds() { return this.media?.audio.map(a => a.id) ?? []; }
  get pendingAudioTrackId() { return this.pendingAudio; }
  private disposing?: Promise<void>;
  private initializing?: AbortSignal;
  private generation = 1;
  private readonly visibility = () => {
    const visible = !document.hidden;
    this.loop?.synchronizePageVisibility(visible);
    if (!visible) this.loop?.cancel();
  };
  constructor(private options: RuntimeOptions) {
    configureEngineAssets({ baseURL: options.assets.baseURL, cacheKey: options.assets.assetKey });
    this.presenter = new TimedPresenter((_generation, reason) => this.failed(`WebGPU presentation: ${reason}`), () => this.loop?.schedule(false), () => this.failed('WebGPU device lost'));
    options.signal.addEventListener('abort', this.abort, { once: true });
    document.addEventListener('visibilitychange', this.visibility);
  }
  private abort = () => { void this.dispose(); };
  private current = () => !this.disposed && !this.options.signal.aborted && !this.initializing?.aborted;
  private failed(reason: string) { if (this.current() && !this.failureSent) { this.failureSent = true; this.options.onFailure(reason, this.position); } }
  get position() { return this.controller ? microsecondsToSeconds(this.controller.currentTimeMicroseconds) : this.initialPosition; }
  get readout(): UniversalReadout {
    const telemetry = this.controller?.getTelemetry();
    const state = telemetry?.state;
    const generation = telemetry?.videoDecode.activeGeneration ?? null;
    if (generation !== null) {
      if (this.metricsGeneration !== null && generation !== this.metricsGeneration) {
        this.carriedFrames += this.decodedFrames; this.carriedDropped += this.droppedFrames;
        this.decodedFrames = 0; this.droppedFrames = 0;
      }
      this.metricsGeneration = generation;
      this.decodedFrames = Math.max(this.decodedFrames, telemetry?.videoDecode.receivedFrameCount ?? 0);
      this.droppedFrames = Math.max(this.droppedFrames, telemetry?.videoDecode.droppedFrameCount ?? 0);
    }
    const decode=telemetry?.videoDecode;
    const videoEnd=decode?.lastFrameEndMediaTimeMicroseconds;
    const first=decode?.earliestQueuedFrameMediaTimeMicroseconds;
    const now=telemetry?.currentTimeMicroseconds??0;
    const videoAhead=videoEnd==null?null:first!==null&&first!==undefined&&first>now+100000?0:Math.max(0,(videoEnd-now)/1e6);
    const audioEnd=telemetry?.audioBridge?.submittedEndMediaTimeMicroseconds;
    let audioAhead=this.media?.audio.length?audioEnd==null?null:Math.max(0,(audioEnd-now)/1e6):Infinity;
    if(decode?.nativeAudioClockReady&&this.nativeAudio){
      const element=this.nativeAudio;audioAhead=0;
      for(let index=0;index<element.buffered.length;index++)if(element.currentTime>=element.buffered.start(index)-0.002&&element.currentTime<element.buffered.end(index)){
        audioAhead=element.buffered.end(index)-element.currentTime;break;
      }
    }
    const network=(decode as typeof decode & {velaNetwork?:NetworkReadout})?.velaNetwork;
    return {video:this.media?videoInfo(this.media.video):null,bufferAheadSeconds:videoAhead===null||audioAhead===null?null:Math.min(videoAhead,audioAhead),
      throughputBps:network?.throughputBps??null,throughputHistory:network?.history??[],state: state === 'playing' || state === 'paused' || state === 'ended' ? state : state === 'seeking' ? 'buffering' : state === 'error' || state === 'fallback' ? 'failed' : 'loading',
      position: this.position, duration: telemetry?.durationMicroseconds == null ? null : microsecondsToSeconds(telemetry.durationMicroseconds),
      audioTrackId:this.media?.selectedAudioId ?? null, metadataDiscrepancies:this.media?.discrepancies ?? [], presentedFrames:this.presenter.getTelemetry().presentedFrameCount, decoderReady:!!this.controller,
      frames: this.carriedFrames + this.decodedFrames, dropped: this.carriedDropped + this.droppedFrames };
  }
  get presentationTelemetry() { return this.presenter.getTelemetry(); }
  get telemetry(): CustomPlaybackTelemetry | null { return this.controller?.getTelemetry() ?? null; }
  async open(media: OriginalMedia) {
    // Wire media URLs may be origin-relative. Normalize once before demux and
    // track preparation so every consumer uses the same absolute source.
    if (!media.url.trim()) throw new Error('Original media URL is empty');
    let url: URL;
    try { url = new URL(media.url,document.baseURI); }
    catch { throw new Error('Original media URL is invalid'); }
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password)
      throw new Error('Original media requires a scoped HTTP source');
    media = {...media,url:url.href};
    this.initialPosition = media.position;
    const availability = getCustomPlaybackRuntimeAvailability(undefined, { audioOutput: media.selectedAudioId !== null, nativeVideoDecoder: false });
    if (!availability.available) throw new Error(`Original playback unavailable: ${availability.reason}`);
    const signal = AbortSignal.any([this.options.signal,this.lifetime.signal,AbortSignal.timeout(8000)]);
    this.initializing = signal; signal.addEventListener('abort', this.abort, {once:true});
    // Capture audio activation before asynchronous capability/package work.
    const prewarm = prewarmBrowserAudioContext(48000);
    try {
      playbackMark('metadata:start');
      media = this.media = await abortable(probeOriginal(media,signal,this.options.mediaRequests?.fetch),signal);
      playbackMark('metadata:ready');
      if (!QUALIFIED_ORIGINAL_VIDEO.includes(media.video.codec)) throw new Error(`Original video ${media.video.codec} is not yet qualified; using compatible fallback`);
      // Only the proven HDR10-compatible DV8 base is normalized by the probe.
      // Full DV reconstruction (including profile7) has not passed its gate.
      if (media.video.dvProfile !== undefined) throw new Error('Original Dolby Vision reconstruction is not yet qualified; using compatible fallback');
      const registry = this.audioRegistry = createAudioPackages(this.options.assets.audioDecoderURL);
      const maximumChannels = this.maximumChannels = prewarm?.audioContext.destination.maxChannelCount ?? null;
      playbackMark('audio:start');
      const preparedAudio = (media.audioTrackCount ?? media.audio.length) > 0 ? await abortable(prepareOriginalAudioSwitch({url:media.url,
        tracks:media.audio, trackId:media.selectedAudioId ?? media.audio[0]?.id ?? '', registry, maximumOutputChannels:maximumChannels, signal, forceSoftware:this.options.retry?.audio,fetcher:this.options.mediaRequests?.fetch}),signal) : null;
      playbackMark('audio:ready');
      if (preparedAudio) audioDifferences(preparedAudio.discrepancies,media.audio.find(track => track.id === media.selectedAudioId),preparedAudio.actualTrack);
      media = this.media = preparedAudio ? {...media, selectedAudioId:preparedAudio.actualTrack.id,
        audio:[...media.audio.filter(track => track.id !== preparedAudio.actualTrack.id),preparedAudio.actualTrack],
        discrepancies:[...new Set([...(media.discrepancies ?? []),...preparedAudio.discrepancies])].slice(0,32)}
        : {...media,audio:[],selectedAudioId:null};
      const options = upstreamOptions(media);
      const audio = media.audio.find(a => a.id === media.selectedAudioId);
      const packageSelection = preparedAudio?.audioOptions.audioDecoder ? await abortable(registry.load(preparedAudio.actualTrack.codec, signal),signal) : null;
      signal.throwIfAborted();
      this.presenter.startSession(this.generation);
      const input = readPresentationInput(options);
      playbackMark('decode:start');
      const [probedCapabilities, presentation] = await abortable(Promise.all([
        probeCustomDecodeCapabilities(options.mediaSource),
        getCustomPresentationEligibilityOptions(this.presenter, { input, options, isCurrent: this.current, isHDRToneMappingEnabled: async () => true }),
      ]),signal);
      signal.throwIfAborted();
      if (!presentation) throw new Error('Original presentation preparation superseded');
      // A generic vector cannot override the actual file's rejected config.
      const forceGPU = this.options.retry?.video === true && videoPackageId(media.video.codec) !== null;
      const capabilities = media.video.nativeSupported && !forceGPU ? probedCapabilities : withoutNativeVideo(probedCapabilities);
      const eligibilityOptions = {
        ...presentation, audioDecoders: packageSelection ? [packageSelection.source] : [],
        audioRenderTarget: { binauralHeadphones: false, speakerLayout: outputLayout(maximumChannels, audio?.channels ?? 2) },
        runtimeAvailability: availability,
      };
      // Native exact-config decode is preferred. Load only the selected codec's
      // independently served GPU package when the native route cannot qualify.
      let eligibility = getCustomPlaybackEligibility(options, capabilities, eligibilityOptions);
      if (forceGPU || !media.video.nativeSupported || !eligibility.eligible) {
        const decoder = await abortable(new VideoPackages(this.options.assets.videoDecoderURL).load(media.video.codec, signal),signal);
        if (decoder) {
          const gpuVideoDecoders = await abortable(getGPUVideoDecoderOffers(this.presenter, [decoder], options),signal);
          signal.throwIfAborted();
          eligibility = getCustomPlaybackEligibility(options, capabilities, {...eligibilityOptions, gpuVideoDecoders});
        }
      }
      if (!eligibility.eligible) throw new Error(`Original playback is not eligible: ${eligibility.reason}`);
      const aligned = alignPresentationInputBitDepth(input, eligibility.rawVideoFrameFormat);
      this.presenter.setDecodedFramePushMode(true, this.generation);
      this.presenter.attach(this.options.surface, this.generation);
      const configured = await abortable(configurePresentationColorPipeline(this.presenter, {
        clearDetectedInputPeak: () => {}, createHDRRenderConfiguration: peak => ({ automaticInputPeakNits: true,
          settings: createHDRToSDRRenderSettings({ toneMapping: { inputPeakNits: peak } }) }),
        dolbyVisionProfile: eligibility.dolbyVisionProfile, eligibility, generation: this.generation,
        input: aligned, options, rawVideoFrameFormat: eligibility.rawVideoFrameFormat, videoOutputMode: eligibility.videoOutputMode,
      }),signal);
      signal.throwIfAborted();
      if (!configured) throw new Error('Original colour pipeline could not be configured');
      playbackMark('decode:ready');
      const audioOptions = preparedAudio?.audioOptions ?? {};
      const controller = this.controller = new Controller({
        // Credential-bearing workers are never put in a shared idle pool for a
        // later principal. Ordinary Ether sessions keep the library's factory.
        videoDecodeSessionFactory:this.options.mediaRequests?.authorization()?(handler,audioFactory,nativeFactory,gpuFactory)=>{
          const factory=()=>{const worker=createEngineWorker('webgpu-player/CustomDecode.worker.js');this.credentialWorkers.add(worker);return worker;};
          const session=new CustomDecodeSession(handler,factory,null,audioFactory,nativeFactory,gpuFactory);
          const destroy=session.destroy.bind(session);session.destroy=()=>{try{destroy();}finally{for(const worker of this.credentialWorkers)worker.terminate();this.credentialWorkers.clear();}};
          return session;
        }:undefined,
        nativeAudioBridgeFactory:()=>new NativeAudioBridge(eventHandler=>new NativeAudioBackend({eventHandler,
          createAudioElement:()=>{const audio=document.createElement('audio');this.nativeAudio=audio;return audio;}})),
        audioOutputFactory: audio ? createBrowserCustomAudioOutputFactory(prewarm, getWebGPUAudioOutputManager()) : undefined,
        gpuVideoDecodeSessionFactory: createGPUVideoDecodeSessionFactory(this.presenter, { slicing: true }),
        eventHandler: event => { if (this.current()) { this.options.onEvent(event); if (!document.hidden) this.loop?.schedule(this.controller?.playbackState === 'playing'); } },
        fallbackHook: request => {
          const state = this.controller?.getTelemetry();
          const decode = state?.videoDecode;
          this.failed(`Original decode: ${request.reason} (worker=${decode?.state ?? 'unknown'}, bytes=${decode?.preparationSourceByteCount ?? 0}, frames=${decode?.receivedFrameCount ?? 0}, audio=${state?.audioPath ?? 'unknown'})`);
        },
      });
      controller.setMuted(this.options.surface.video.muted); controller.setVolume(this.options.surface.video.volume);
      this.loop = new FrameLoop({ controller, presenter: this.presenter, presentationGeneration: this.generation,
        isCurrent: this.current, onFailure: () => this.failed('Original frame presentation failed') });
      this.visibility();
      // Attach only after eligibility normalizes its source DTO; that parser
      // deliberately drops unknown fields. Credentials belong solely to the
      // private worker transport, never to metadata or capability caches.
      const privateSource={...eligibility.source,velaMediaAuthorization:this.options.mediaRequests?.authorization()};
      const starting = controller.play({ ...eligibility, ...audioOptions,source:privateSource, audioTrackIndex:preparedAudio?.ordinal ?? null, audioMetadataLayout: preparedAudio?.audioMetadataLayout ?? getAudioMetadataLayout(eligibility),
        audioOutputMode: audio ? 'decoded-pcm' : undefined, startTimeMicroseconds: secondsToMicroseconds(media.position),
        nativeHDRTransfer: eligibility.nativeHDRTransfer ?? null });
      if (!this.wantsPlaying) controller.pause();
      const result = await abortable(starting,signal);
      signal.throwIfAborted();
      if (result.status !== 'started') throw new Error(`Original playback did not start: ${result.status}`);
      if (document.hidden) controller.drainBackgroundVideo();
      else this.loop.schedule(true);
    } catch (error) { await this.dispose(); throw error; }
    finally { signal.removeEventListener('abort',this.abort); this.initializing = undefined; await prewarm?.close(); }
  }
  pause() { this.wantsPlaying = false; this.controller?.pause(); }
  resume() { this.wantsPlaying = true; this.controller?.resume(); this.loop?.schedule(true); }
  setVolume(volume: number) { this.controller?.setVolume(volume); }
  setMuted(muted: boolean) { this.controller?.setMuted(muted); }
  async selectAudio(trackId: string) {
    if (!this.media || !this.audioRegistry || !this.controller) throw new Error('Original audio is not ready');
    if (this.pendingAudio) throw new Error('An original audio switch is already in progress');
    if (this.media.selectedAudioId === trackId) return;
    const job = this.audioSwitch = new AbortController(); this.pendingAudio = trackId;
    const signal = AbortSignal.any([this.options.signal, job.signal]);
    try {
      const prepared = await prepareOriginalAudioSwitch({url:this.media.url, tracks:this.media.audio, trackId,
        registry:this.audioRegistry, maximumOutputChannels:this.maximumChannels, signal,fetcher:this.options.mediaRequests?.fetch});
      signal.throwIfAborted();
      void this.readout; // Capture the retiring decode generation before restart.
      this.advancePresentation();
      const result = await this.controller.setAudioStreamIndex(prepared.ordinal,
        {...prepared.audioOptions, audioMetadataLayout:prepared.audioMetadataLayout});
      signal.throwIfAborted();
      if (result.status !== 'started') throw new Error(`Original audio switch did not start: ${result.status}`);
      audioDifferences(prepared.discrepancies,this.media.audio.find(track => track.id === trackId),prepared.actualTrack);
      this.media = {...this.media, selectedAudioId:prepared.actualTrack.id,
        audio:[...this.media.audio.filter(track => track.id !== prepared.actualTrack.id),prepared.actualTrack],
        discrepancies:[...new Set([...(this.media.discrepancies ?? []),...prepared.discrepancies])].slice(0,32)};
      this.loop?.schedule(this.wantsPlaying);
    } finally { if (this.audioSwitch === job) { this.audioSwitch = undefined; this.pendingAudio = null; } }
  }
  private advancePresentation() {
    const generation = ++this.generation;
    this.loop?.setPresentationGeneration(generation);
    this.presenter.seek(generation);
  }
  async seek(position: number) {
    this.audioSwitch?.abort(); void this.readout; this.advancePresentation();
    await this.controller?.seek(secondsToMicroseconds(position)); this.loop?.schedule(this.wantsPlaying);
  }
  async setSpeed(value: number) {
    if (!Number.isFinite(value) || value < 0.5 || value > 2) throw new Error('Playback speed must be between 0.5 and 2');
    await this.controller?.setPlaybackRate(value);
    this.loop?.schedule(this.wantsPlaying);
  }
  dispose(): Promise<void> {
    if (this.disposing) return this.disposing;
    if (this.disposed) return Promise.resolve();
    this.disposed = true; this.lifetime.abort(); this.audioSwitch?.abort(); this.options.signal.removeEventListener('abort', this.abort);
    document.removeEventListener('visibilitychange', this.visibility);
    this.loop?.destroy();
    for(const worker of this.credentialWorkers)worker.terminate();this.credentialWorkers.clear();
    this.disposing = (async () => { try { await this.controller?.destroy(); } finally { this.nativeAudio=undefined;this.presenter.destroy(); } })();
    return this.disposing;
  }
}

/** Restrict only this file's route selection; do not mutate cached probe facts. */
function withoutNativeVideo(capabilities: CustomDecodeCapabilities): CustomDecodeCapabilities {
  const rejected = (entries: Record<string, object>) => Object.fromEntries(Object.entries(entries)
    .map(([key, value]) => [key, {...value, status:'unsupported', reason:'config-unsupported'}]));
  return {...capabilities,
    video:rejected(capabilities.video) as CustomDecodeCapabilities['video'],
    rawHDRVideo:rejected(capabilities.rawHDRVideo) as CustomDecodeCapabilities['rawHDRVideo'],
    h264Profiles:undefined, h264RawFormats:undefined, hevcRangeExtensions:undefined,
    av1RawFormats:undefined, nativeDolbyVisionHEVC:undefined, nativeHDRAV1:undefined,
    nativeHDRHEVC:undefined, nativeUltraHDVideo:undefined};
}
