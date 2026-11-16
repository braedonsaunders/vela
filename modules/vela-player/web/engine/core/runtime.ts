import type { VideoBackend, VideoCallbacks } from './decode/video';
import type { AudioOutput } from './types';
import type {
  CorePresenter,
  CoreAudioFactoryOptions,
  CoreState,
  CoreLiveOptions,
  CoreContext,
} from './runtime-state';
import {
  snapshotCore,
  readPresentationTelemetry,
  readByteReader,
  isCoreStartupPending,
  readSubtitleClusters,
  readContainer,
  readLiveWindow,
} from './telemetry';
import { openFileSource, openHlsSource } from './source-session';
import {
  seekCore,
  selectCoreAudio,
  pauseCore,
  playCore,
  setCoreLiveTarget,
  setCoreVolume,
  setCoreRate,
} from './transport';
import { disposeCore } from './lifecycle';
import { createCoreContext } from './runtime-context';
export type { CoreState, CorePresenter, CoreAudioFactoryOptions, CoreLiveOptions } from './runtime-state';

/** Framework-independent public facade over source, decode, clock and lifecycle responsibilities. */
export class PlaybackCore {
  private readonly context: CoreContext;
  constructor(
    presenter: CorePresenter,
    createAudio: (options: CoreAudioFactoryOptions) => AudioOutput,
    onState: (state: CoreState) => void,
    /** The host owns authorized decoder/conversion recovery after this route. */
    onFailure: (error: Error, positionUs: number) => void,
    createVideo: (callbacks: VideoCallbacks) => VideoBackend,
    mediaRequests?: import('../media-auth').MediaRequestPolicy,
  ) {
    this.context = createCoreContext({
      presenter,
      createAudio,
      onState,
      onFailure,
      createVideo,
      mediaRequests,
    });
  }
  get clock() {
    return this.context.clock;
  }
  snapshot(): CoreState {
    return snapshotCore(this.context);
  }
  get presentationTelemetry() {
    return readPresentationTelemetry(this.context);
  }
  get byteReader() {
    return readByteReader(this.context);
  }
  get startupPending() {
    return isCoreStartupPending(this.context);
  }
  get subtitleClusters() {
    return readSubtitleClusters(this.context);
  }
  get container() {
    return readContainer(this.context);
  }
  get live() {
    return readLiveWindow(this.context);
  }
  open(url: string, positionUs = 0, audioOrdinal = 0): Promise<void> {
    return openFileSource(this.context, url, positionUs, audioOrdinal);
  }
  openHls(
    url: string,
    positionUs: number,
    originUs: number,
    audioOrdinal = 0,
    authority?: {
      sourceGeneration: number;
      seekGeneration: number;
    },
    live?: CoreLiveOptions,
  ): Promise<void> {
    return openHlsSource(this.context, url, positionUs, originUs, audioOrdinal, authority, live);
  }
  seek(positionUs: number) {
    return seekCore(this.context, positionUs);
  }
  selectAudio(trackId: string) {
    return selectCoreAudio(this.context, trackId);
  }
  pause() {
    return pauseCore(this.context);
  }
  play() {
    return playCore(this.context);
  }
  setLiveTarget(seconds: number) {
    return setCoreLiveTarget(this.context, seconds);
  }
  setVolume(volume: number, muted: boolean) {
    return setCoreVolume(this.context, volume, muted);
  }
  setRate(rate: number) {
    return setCoreRate(this.context, rate);
  }
  dispose(): Promise<void> {
    return disposeCore(this.context);
  }
}
