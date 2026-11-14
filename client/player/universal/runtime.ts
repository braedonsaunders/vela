import { configureEngineAssets } from '../../../vendor/webgpu-player/src/EngineAssets';
import { getCustomPlaybackRuntimeAvailability } from '../../../vendor/webgpu-player/src/capability/CustomPlaybackRuntime';
import { probeCustomDecodeCapabilities } from '../../../vendor/webgpu-player/src/capability/CustomDecodeCapabilities';
import { getCustomPlaybackEligibility, getAudioMetadataLayout } from '../../../vendor/webgpu-player/src/capability/CustomPlaybackEligibility';
import { prewarmBrowserAudioContext } from '../../../vendor/webgpu-player/src/audio/output/BrowserAudioContextPrewarm';
import { getWebGPUAudioOutputManager } from '../../../vendor/webgpu-player/src/audio/output/WebGPUAudioOutputManager';
import Controller from '../../../vendor/webgpu-player/src/pipeline/CustomPlaybackController';
import FrameLoop from '../../../vendor/webgpu-player/src/pipeline/CustomPlaybackFrameLoop';
import Presenter from '../../../vendor/webgpu-player/src/presentation/WebGPUPresenter';
import { readPresentationInput, getCustomPresentationEligibilityOptions, configurePresentationColorPipeline, alignPresentationInputBitDepth, createGPUVideoDecodeSessionFactory } from '../../../vendor/webgpu-player/src/presentation/PresentationSetup';
import { createHDRToSDRRenderSettings } from '../../../vendor/webgpu-player/src/presentation/RenderSettings';
import { secondsToMicroseconds, microsecondsToSeconds } from '../../../vendor/webgpu-player/src/MediaTime';
import type { CustomPlaybackControllerEvent, CustomPlaybackTelemetry } from '../../../vendor/webgpu-player/src/pipeline/CustomPlaybackControllerTypes';
import { createAudioPackages, createBrowserCustomAudioOutputFactory, prepareAudioOptions } from './audio/upstream';
import { outputLayout } from './audio/policy';
import type { UniversalReadout } from './loader';
import { probeOriginal } from './probe';
import { upstreamOptions, type OriginalMedia } from './source';

export interface RuntimeOptions {
  surface: { container: HTMLDivElement; video: HTMLVideoElement };
  assets: { baseURL: string; assetKey: string; audioDecoderURL: string };
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
    return { state: state === 'playing' || state === 'paused' || state === 'ended' ? state : state === 'seeking' ? 'buffering' : state === 'error' || state === 'fallback' ? 'failed' : 'loading',
      position: this.position, duration: telemetry?.durationMicroseconds == null ? null : microsecondsToSeconds(telemetry.durationMicroseconds),
      frames: telemetry?.videoDecode.receivedFrameCount ?? 0, dropped: telemetry?.videoDecode.droppedFrameCount ?? 0 };
  }
  get presentationTelemetry() { return this.presenter.getTelemetry(); }
  get telemetry(): CustomPlaybackTelemetry | null { return this.controller?.getTelemetry() ?? null; }
  async open(media: OriginalMedia) {
    this.initialPosition = media.position;
    const availability = getCustomPlaybackRuntimeAvailability(undefined, { audioOutput: media.selectedAudioId !== null, nativeVideoDecoder: true });
    if (!availability.available) throw new Error(`Original playback unavailable: ${availability.reason}`);
    const signal = AbortSignal.any([this.options.signal, AbortSignal.timeout(60000)]);
    this.initializing = signal; signal.addEventListener('abort', this.abort, {once:true});
    // Capture audio activation before asynchronous capability/package work.
    const prewarm = media.selectedAudioId !== null ? prewarmBrowserAudioContext(48000) : null;
    try {
      media = await probeOriginal(media, signal);
      const options = upstreamOptions(media);
      const audio = media.audio.find(a => a.id === media.selectedAudioId);
      const registry = createAudioPackages(this.options.assets.audioDecoderURL);
      const commonAudio = !!audio && (['aac','opus','flac','mp3','vorbis'].includes(audio.codec) || audio.codec.startsWith('pcm_'));
      const forceSoftware = audio?.nativeSupported === false;
      const packageSelection = audio && (!commonAudio || forceSoftware) ? await registry.load(audio.codec, signal) : null;
      signal.throwIfAborted();
      this.presenter.startSession(this.generation);
      const input = readPresentationInput(options);
      const [capabilities, presentation] = await Promise.all([
        probeCustomDecodeCapabilities(options.mediaSource),
        getCustomPresentationEligibilityOptions(this.presenter, { input, options, isCurrent: this.current, isHDRToneMappingEnabled: async () => true }),
      ]);
      signal.throwIfAborted();
      if (!presentation) throw new Error('Original presentation preparation superseded');
      const maximumChannels = prewarm?.audioContext.destination.maxChannelCount ?? null;
      const eligibility = getCustomPlaybackEligibility(options, capabilities, {
        ...presentation, audioDecoders: packageSelection ? [packageSelection.source] : [],
        audioRenderTarget: { binauralHeadphones: false, speakerLayout: outputLayout(maximumChannels, audio?.channels ?? 2) },
        runtimeAvailability: availability,
      });
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
      const audioOptions = audio ? await prepareAudioOptions(registry, { codec: audio.codec, channels: audio.channels ?? 2 }, maximumChannels, signal, false, forceSoftware || !!eligibility.audioDecoder) : {};
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
      const starting = controller.play({ ...eligibility, ...audioOptions, audioMetadataLayout: getAudioMetadataLayout(eligibility),
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
  async seek(position: number) { await this.controller?.seek(secondsToMicroseconds(position)); this.loop?.schedule(true); }
  dispose(): Promise<void> {
    if (this.disposing) return this.disposing;
    this.disposed = true; this.options.signal.removeEventListener('abort', this.abort);
    document.removeEventListener('visibilitychange', this.visibility);
    this.loop?.destroy();
    this.disposing = (async () => { try { await this.controller?.destroy(); } finally { this.presenter.destroy(); } })();
    return this.disposing;
  }
}
