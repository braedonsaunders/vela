import { configureEngineAssets } from '../../../vendor/webgpu-player/src/EngineAssets';
import { getCustomPlaybackRuntimeAvailability } from '../../../vendor/webgpu-player/src/capability/CustomPlaybackRuntime';
import { probeCustomDecodeCapabilities, type CustomDecodeCapabilities } from '../../../vendor/webgpu-player/src/capability/CustomDecodeCapabilities';
import { getCustomPlaybackEligibility, getAudioMetadataLayout } from '../../../vendor/webgpu-player/src/capability/CustomPlaybackEligibility';
import { prewarmBrowserAudioContext } from '../../../vendor/webgpu-player/src/audio/output/BrowserAudioContextPrewarm';
import { getWebGPUAudioOutputManager } from '../../../vendor/webgpu-player/src/audio/output/WebGPUAudioOutputManager';
import Controller from '../../../vendor/webgpu-player/src/pipeline/CustomPlaybackController';
import FrameLoop from '../../../vendor/webgpu-player/src/pipeline/CustomPlaybackFrameLoop';
import Presenter from '../../../vendor/webgpu-player/src/presentation/WebGPUPresenter';
import { readPresentationInput, getCustomPresentationEligibilityOptions, configurePresentationColorPipeline, alignPresentationInputBitDepth, getGPUVideoDecoderOffers, createGPUVideoDecodeSessionFactory } from '../../../vendor/webgpu-player/src/presentation/PresentationSetup';
import { createHDRToSDRRenderSettings } from '../../../vendor/webgpu-player/src/presentation/RenderSettings';
import { secondsToMicroseconds, microsecondsToSeconds } from '../../../vendor/webgpu-player/src/MediaTime';
import type { CustomPlaybackControllerEvent, CustomPlaybackTelemetry } from '../../../vendor/webgpu-player/src/pipeline/CustomPlaybackControllerTypes';
import { createAudioPackages, createBrowserCustomAudioOutputFactory } from './audio/upstream';
import { prepareOriginalAudioSwitch } from './audio/original-track';
import { videoPackageId, VideoPackages } from './video/packages';
import { outputLayout } from './audio/policy';
import type { DecoderRetry } from './retry';
import type { UniversalReadout } from './loader';
import { probeOriginal } from './probe';
import { upstreamOptions, type OriginalMedia } from './source';

export interface RuntimeOptions {
  surface: { container: HTMLDivElement; video: HTMLVideoElement };
  assets: { baseURL: string; assetKey: string; audioDecoderURL: string; videoDecoderURL: string };
  retry?: DecoderRetry;
  signal: AbortSignal;
  onEvent: (event: CustomPlaybackControllerEvent) => void;
  onFailure: (reason: string, position: number) => void;
}
/** One original file/session. This module is loaded separately from Contract and
 * the legacy media engine; workers and decoder packages remain separate assets. */
export class UniversalRuntime {
  private presenter: Presenter;
  private controller?: Controller;
  private loop?: FrameLoop;
  private disposed = false;
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
  private readonly generation = 1;
  private readonly visibility = () => this.loop?.synchronizePageVisibility(!document.hidden);
  constructor(private options: RuntimeOptions) {
    configureEngineAssets({ baseURL: options.assets.baseURL, cacheKey: options.assets.assetKey });
    this.presenter = new Presenter((reason) => this.failed(`WebGPU presentation: ${reason}`), () => this.loop?.schedule(false), () => this.failed('WebGPU device lost'));
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
    return { state: state === 'playing' || state === 'paused' || state === 'ended' ? state : state === 'seeking' ? 'buffering' : state === 'error' || state === 'fallback' ? 'failed' : 'loading',
      position: this.position, duration: telemetry?.durationMicroseconds == null ? null : microsecondsToSeconds(telemetry.durationMicroseconds),
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
    const signal = AbortSignal.any([this.options.signal, AbortSignal.timeout(60000)]);
    this.initializing = signal; signal.addEventListener('abort', this.abort, {once:true});
    // Capture audio activation before asynchronous capability/package work.
    const prewarm = media.selectedAudioId !== null ? prewarmBrowserAudioContext(48000) : null;
    try {
      media = this.media = await probeOriginal(media, signal);
      const registry = this.audioRegistry = createAudioPackages(this.options.assets.audioDecoderURL);
      const maximumChannels = this.maximumChannels = prewarm?.audioContext.destination.maxChannelCount ?? null;
      const preparedAudio = media.selectedAudioId ? await prepareOriginalAudioSwitch({url:media.url,
        tracks:media.audio, trackId:media.selectedAudioId, registry, maximumOutputChannels:maximumChannels, signal, forceSoftware:this.options.retry?.audio}) : null;
      if (preparedAudio) media = this.media = {...media, audio:media.audio.map(track =>
        track.id === media.selectedAudioId ? preparedAudio.actualTrack : track)};
      const options = upstreamOptions(media);
      const audio = media.audio.find(a => a.id === media.selectedAudioId);
      const packageSelection = preparedAudio?.audioOptions.audioDecoder ? await registry.load(preparedAudio.actualTrack.codec, signal) : null;
      signal.throwIfAborted();
      this.presenter.startSession(this.generation);
      const input = readPresentationInput(options);
      const [probedCapabilities, presentation] = await Promise.all([
        probeCustomDecodeCapabilities(options.mediaSource),
        getCustomPresentationEligibilityOptions(this.presenter, { input, options, isCurrent: this.current, isHDRToneMappingEnabled: async () => true }),
      ]);
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
        const decoder = await new VideoPackages(this.options.assets.videoDecoderURL).load(media.video.codec, signal);
        if (decoder) {
          const gpuVideoDecoders = await getGPUVideoDecoderOffers(this.presenter, [decoder], options);
          signal.throwIfAborted();
          eligibility = getCustomPlaybackEligibility(options, capabilities, {...eligibilityOptions, gpuVideoDecoders});
        }
      }
      if (!eligibility.eligible) throw new Error(`Original playback is not eligible: ${eligibility.reason}`);
      const aligned = alignPresentationInputBitDepth(input, eligibility.rawVideoFrameFormat);
      this.presenter.setDecodedFramePushMode(true, this.generation);
      this.presenter.attach(this.options.surface, this.generation);
      const configured = await configurePresentationColorPipeline(this.presenter, {
        clearDetectedInputPeak: () => {}, createHDRRenderConfiguration: peak => ({ automaticInputPeakNits: true,
          settings: createHDRToSDRRenderSettings({ toneMapping: { inputPeakNits: peak } }) }),
        dolbyVisionProfile: eligibility.dolbyVisionProfile, eligibility, generation: this.generation,
        input: aligned, options, rawVideoFrameFormat: eligibility.rawVideoFrameFormat, videoOutputMode: eligibility.videoOutputMode,
      });
      signal.throwIfAborted();
      if (!configured) throw new Error('Original colour pipeline could not be configured');
      const audioOptions = preparedAudio?.audioOptions ?? {};
      const controller = this.controller = new Controller({
        audioOutputFactory: audio ? createBrowserCustomAudioOutputFactory(prewarm, getWebGPUAudioOutputManager()) : undefined,
        gpuVideoDecodeSessionFactory: createGPUVideoDecodeSessionFactory(this.presenter, { slicing: true }),
        eventHandler: event => { if (this.current()) { this.options.onEvent(event); this.loop?.schedule(this.controller?.playbackState === 'playing'); } },
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
      const starting = controller.play({ ...eligibility, ...audioOptions, audioMetadataLayout: preparedAudio?.audioMetadataLayout ?? getAudioMetadataLayout(eligibility),
        audioOutputMode: audio ? 'decoded-pcm' : undefined, startTimeMicroseconds: secondsToMicroseconds(media.position),
        nativeHDRTransfer: eligibility.nativeHDRTransfer ?? null });
      if (!this.wantsPlaying) controller.pause();
      const result = await starting;
      signal.throwIfAborted();
      if (result.status !== 'started') throw new Error(`Original playback did not start: ${result.status}`);
      this.loop.schedule(true);
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
        registry:this.audioRegistry, maximumOutputChannels:this.maximumChannels, signal});
      signal.throwIfAborted();
      void this.readout; // Capture the retiring decode generation before restart.
      const result = await this.controller.setAudioStreamIndex(prepared.ordinal,
        {...prepared.audioOptions, audioMetadataLayout:prepared.audioMetadataLayout});
      signal.throwIfAborted();
      if (result.status !== 'started') throw new Error(`Original audio switch did not start: ${result.status}`);
      this.media = {...this.media, selectedAudioId:trackId,
        audio:this.media.audio.map(track => track.id === trackId ? prepared.actualTrack : track)};
      this.loop?.schedule(this.wantsPlaying);
    } finally { if (this.audioSwitch === job) { this.audioSwitch = undefined; this.pendingAudio = null; } }
  }
  async seek(position: number) { this.audioSwitch?.abort(); void this.readout; await this.controller?.seek(secondsToMicroseconds(position)); this.loop?.schedule(true); }
  dispose(): Promise<void> {
    if (this.disposing) return this.disposing;
    this.disposed = true; this.audioSwitch?.abort(); this.options.signal.removeEventListener('abort', this.abort);
    document.removeEventListener('visibilitychange', this.visibility);
    this.loop?.destroy();
    this.disposing = (async () => { try { await this.controller?.destroy(); } finally { this.presenter.destroy(); } })();
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
