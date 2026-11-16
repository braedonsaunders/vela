import { type StartBufferResult } from './start-buffer';
import { MediaClock } from './clock';
import { type EncodedBufferAudit } from './packet-buffer';
import type { SourceBufferAudit } from '../universal/buffer-audit';
import { type PacketDemux } from './demux/file';
import { SegmentReader } from './source/segments';
import type { CoreVideoFrame, VideoBackend, VideoCallbacks } from './decode/video';
import { VideoScheduler } from './scheduler';
import { RangeReader } from './source/ranges';
import { MatroskaSubtitleStream } from './demux/subtitle-stream';
import type { AudioClockAnchor, AudioOutput, AudioTrack, MediaTrack, VideoTrack } from './types';

export interface CorePresenter {
  present(frame: CoreVideoFrame, positionUs: number): boolean;
  dispose(): void;
}

export interface CoreAudioFactoryOptions {
  signal: AbortSignal;
  onClock(anchor: AudioClockAnchor): void;
  onFailure(failure: {
    epoch: number;
    trackId: string;
    stage: 'native' | 'software' | 'output';
    message: string;
  }): void;
}

export interface CoreState {
  state: 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'ended' | 'failed';
  epoch: number;
  positionUs: number;
  durationUs: number | null;
  tracks: readonly MediaTrack[];
  videoTrackId: string | null;
  audioTrackId: string | null;
  bufferAheadSeconds: number | null;
  readAheadSeconds: number | null;
  throughputBps: number | null;
  throughputHistory: number[];
  startBuffer: StartBufferResult | null;
  bufferAudit: {
    source: SourceBufferAudit;
    encodedVideo: EncodedBufferAudit;
  } | null;
  decoded: number;
  presented: number;
  dropped: number;
  failure: string | null;
  diagnostics: string[];
}

export interface DecodeEpoch {
  id: number;
  abort: AbortController;
  demux: PacketDemux;
  decoder: VideoBackend;
  firstFrame: Promise<void>;
  resolveFirst(): void;
  primed: Promise<void>;
  resolvePrimed(): void;
  started: boolean;
  readAheadEndUs: number;
  videoEndUs: number;
  audioEndUs: number;
  deliveryMark: number;
  packetBytes: {
    video: number;
    audio: number;
  };
  packetDurationUs: {
    video: number;
    audio: number;
  };
  startBuffer: StartBufferResult | null;
  encodedVideo: EncodedBufferAudit;
  videoEnded: boolean;
  audioEnded: boolean;
  audioTailReported: boolean;
  audioBufferedUntilUs: number;
  audioAnchorsRejected: number;
}

export interface CoreLiveOptions {
  windowStartSeconds?: number;
  targetSeconds: number;
  startAtEdge: boolean;
}

export type CoreSource = {
  abort: AbortController;
  audio: AudioOutput;
} & (
  | {
      kind: 'file';
      reader: RangeReader;
      subtitleClusters: MatroskaSubtitleStream;
    }
  | {
      kind: 'hls';
      segments: SegmentReader;
      originUs: number;
      live?: CoreLiveOptions;
    }
);

export interface CoreDependencies {
  presenter: CorePresenter;
  createAudio(options: CoreAudioFactoryOptions): AudioOutput;
  onState(state: CoreState): void;
  onFailure(error: Error, positionUs: number): void;
  createVideo(callbacks: VideoCallbacks): VideoBackend;
  mediaRequests?: import('../media-auth').MediaRequestPolicy;
}
export interface SourceSessionState {
  source?: CoreSource;
  nextEpoch: number;
  tracks: MediaTrack[];
  video?: VideoTrack;
  audio?: AudioTrack;
  requestedAudioId?: string;
  initialAudioOrdinal: number;
  durationUs: number | null;
  containerName: string;
}
export interface DecodeState {
  epoch?: DecodeEpoch;
  decodedBeforeEpoch: number;
  lastPresentationAt: number;
  epochStartedAt: number;
  rotating: boolean;
}
export interface PlaybackIntent {
  playing: boolean;
  volume: number;
  muted: boolean;
  rate: number;
}
export interface CoreLifecycle {
  state: CoreState['state'];
  failure: string | null;
  closed: boolean;
  disposing?: Promise<void>;
  timer?: ReturnType<typeof setInterval>;
}
export interface CoreContext {
  readonly clock: MediaClock;
  readonly scheduler: VideoScheduler<CoreVideoFrame>;
  readonly dependencies: CoreDependencies;
  readonly session: SourceSessionState;
  readonly decode: DecodeState;
  readonly intent: PlaybackIntent;
  readonly lifecycle: CoreLifecycle;
}
