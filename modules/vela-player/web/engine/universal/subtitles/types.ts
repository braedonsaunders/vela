export type SubtitleCodec = 'srt' | 'webvtt' | 'ass' | 'ssa' | 'pgs' | 'tx3g' | 'unknown';
export type SubtitleDelivery =
  | { kind: 'embedded' }
  | { kind: 'external'; format: 'webvtt' | 'webvtt-window' | 'srt' | 'ass' | 'ssa' | 'sup'; url: string }
  | { kind: 'burn-in' };
export interface SubtitleTrack {
  id: string;
  serverId?: string;
  streamIndex: number | null;
  containerTrackId: number | null;
  codec: SubtitleCodec;
  label: string;
  language: string;
  default: boolean;
  forced: boolean;
  delivery: SubtitleDelivery;
}
export interface SubtitleDescription {
  id: string;
  streamIndex?: number;
  codec?: string;
  label?: string;
  language?: string;
  delivery?: SubtitleDelivery;
}
export interface SubtitlePreferences {
  subtitleSize: 'small' | 'medium' | 'large' | 'xl';
  subtitleBackground: 'none' | 'shadow' | 'box';
  subtitleColor: 'white' | 'yellow';
  subtitlePosition: 'bottom' | 'raised';
  offsetSeconds: number;
}
export const defaultSubtitlePreferences: SubtitlePreferences = {
  subtitleSize: 'medium',
  subtitleBackground: 'shadow',
  subtitleColor: 'white',
  subtitlePosition: 'bottom',
  offsetSeconds: 0,
};
export interface SubtitleGenerations {
  sourceGeneration: number;
  seekGeneration: number;
}
export interface SubtitleSource extends SubtitleGenerations {
  url: string;
  container: string;
  sessionId: string;
}
export interface SubtitleFailure {
  trackId: string;
  serverId?: string;
  code: string;
  message: string;
}
export interface SubtitlePacket {
  time: number;
  duration: number | null;
  data: Uint8Array;
}
export interface SubtitleStreamPacket extends SubtitlePacket {
  position: number;
}
/** Borrowed bytes are valid only during the callback; retain selected packets, not clusters. */
export interface SubtitleCluster {
  epoch: number;
  position: number;
  payloadStart: number;
  time: number;
  endTime: number;
  bytes: Uint8Array;
}
export interface SubtitleClusterStream {
  readonly epoch: number;
  subscribe(
    receive: (cluster: SubtitleCluster) => void,
    onFailure?: (error: unknown) => void,
    trackNumber?: number,
  ): () => void;
  replay(positionSeconds: number, signal: AbortSignal): Promise<void>;
}
export interface SubtitleFont {
  name: string;
  mime: string;
  size: number;
  read(signal: AbortSignal): Promise<Uint8Array>;
}
export interface SubtitlePacketWindow {
  packets: SubtitlePacket[];
  completeHistory: boolean;
  /** Every event starting at or after this time was read (0 with complete history). */
  historyFrom: number;
  fromStart: boolean;
}
export interface SubtitleContainer {
  tracks: readonly SubtitleTrack[];
  fonts: readonly SubtitleFont[];
  configuration(trackId: string): Uint8Array | null;
  packets(trackId: string, start: number, end: number, signal: AbortSignal): Promise<SubtitlePacketWindow>;
  dispose(): void;
}
export function subtitleAbort(signal: AbortSignal) {
  signal.throwIfAborted();
}
export function subtitleLimit(value: number, max: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max)
    throw new Error(`Subtitle ${label} exceeds its bound`);
  return value;
}

export type { ByteReader as SubtitleByteReader } from '../../core/source/types';
