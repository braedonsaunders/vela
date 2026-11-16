/** Source lifetime is independent of seek epochs. All times here are title µs. */
export type {ByteReader} from './source/types';

export interface EncodedPacket {
  trackId: string;
  timestampUs: number;
  durationUs: number;
  key: boolean;
  data: Uint8Array;
  /** Actual original-file byte position, never a generic packet sequence id. */
  sourceOffset?:number;
  epoch: number;
  /** Preserve container side data, including HDR metadata, through demux. */
  additions?: readonly { addId: number; data: Uint8Array }[];
}

interface TrackIdentity {
  id: string;
  containerTrackId: number | null;
  /** Null until a full-container census establishes the original stream order. */
  sourceIndex: number | null;
  codec: string;
  language: string;
}
export interface VideoTrack extends TrackIdentity {
  kind: 'video';
  width: number;
  height: number;
  rotation: number;
  config: VideoDecoderConfig | null;
  color: VideoColorSpaceInit;
  fieldOrder: string | null;
}
export interface AudioTrack extends TrackIdentity {
  kind: 'audio';
  sampleRate: number;
  channels: number;
  channelMask: number | null;
  config: AudioDecoderConfig | null;
  codecPrivate?: Uint8Array | null;
  waveFormat?: Uint8Array | null;
  /** Matroska codec IDs / WAVE tags remain available to package selection. */
  internalCodecId: string | number | Uint8Array | null;
}
export type MediaTrack = VideoTrack | AudioTrack;

export interface AudioClockAnchor {
  epoch: number;
  mediaTimeUs: number;
  performanceTimeMs: number;
  playing: boolean;
  bufferedUntilUs: number;
}

/** Scalar submission/output state; independent of physical-clock admission. */
export interface AudioBufferState {
  epoch:number;
  bufferedUntilUs:number;
  queuedFrames:number;
  consumedFrames:number;
  outputCredits:number;
  pendingChunks:number;
  submittedChunks:number;
}

export interface AudioOutput {
  bufferState?():AudioBufferState|null;
  configure(track: AudioTrack, epoch: number, signal: AbortSignal): Promise<void>;
  /** Resolves when accepted; implementations apply bounded queue backpressure. */
  decode(packet: EncodedPacket, signal: AbortSignal): Promise<void>;
  flush(positionUs: number, epoch: number, signal: AbortSignal): Promise<void>;
  /** Decode EOF tails into the bounded output queue; does not await playback. */
  drain?(signal: AbortSignal): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  setVolume(volume: number, muted: boolean): void;
  setRate(rate: number): void;
  dispose(): Promise<void>;
}

export interface DecodedVideoFrame {
  epoch: number;
  timestampUs: number;
  durationUs: number;
  /** Native and package routes supply their own resource-release operation. */
  release(): void;
}
