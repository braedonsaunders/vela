import type { SessionCommand, AudioRendition, OriginalVideo } from '../wire/v0/types';
/** Local engine input. protocol.ts translates the versioned server plan here. */
export interface Track { id: string; label: string; language?: string; url?: string; codec?: string; channels?: number; streamIndex?: number }
export interface Rendition { id: string; url: string; bandwidth: number; mime: string; height?: number; audioGroupId?: string; codecStatus?: 'pending' | 'verified' }
export function codecKnown(rendition: Rendition) {
  return rendition.codecStatus !== 'pending' && /codecs="[^"]+"/.test(rendition.mime);
}
export interface Source {
  id: string; strategy: 'direct' | 'remux' | 'transcode'; delivery: 'file' | 'hls';
  url: string; mime: string; timeline: string; edition: string; audioTrackId?: string; recoveryAllowed?: boolean; boundaries?: number[];
  original?: boolean; originalVideo?: OriginalVideo;
  timelineOriginSeconds?: number; audioRenditions?: AudioRendition[]; initialRenditionId?: string; renditions?: Rendition[];
}
export interface OnDemandSource { id: string; onDemand: true }
export interface PlaybackSession {
  onDemandSources?: OnDemandSource[];
  serverState?: 'ready' | 'playing' | 'paused' | 'recovering' | 'ended';
  id: string; mediaId: string; edition: string; selectedSourceId?: string; serverControlled?: boolean; sources: Source[]; position?: number; duration?: number;
  audioTracks: Track[]; subtitleTracks: Track[]; audioTrackId?: string;
  subtitleTrackId?: string; live?: boolean; liveWindowStart?: number; liveEdge?: number; liveMaxDrift?: number; lowDelay?: boolean; sourceGeneration?: number; seekGeneration?: number;
}
export type Command = { id: number } & (
  { type: 'play' | 'pause' | 'pip' | 'fullscreen' | 'catchUp' | 'retry' } |
  { type: 'seekBy'; seconds: number } | { type: 'switchPath'; pathId: string } | { type: 'seek'; seconds: number } | { type: 'volume'; value: number } | { type: 'mute'; muted?: boolean } |
  { type: 'audio'; trackId: string } | { type: 'subtitle'; trackId: string | null } |
  { type: 'quality'; renditionId: string | null } | { type: 'lowDelay'; enabled: boolean });
export type FailureKind = 'network' | 'source' | 'decoder' | 'unsupported' | 'action';
export interface Failure { kind: FailureKind; message: string; recoverable: boolean }
export interface LiveSnapshot {
  edgeSeconds: number | null; windowStartSeconds: number | null; driftSeconds: number | null;
  edgeSource: 'playlist' | 'seekable' | 'server' | null;
  reconnecting: boolean;
  delivery: 'available' | 'waiting-for-publication' | 'segment-delayed' | 'upstream-gap' | 'unknown';
  canCatchUp: boolean;
}
export interface Snapshot {
  sessionId: string | null; sourceGeneration: number; seekGeneration: number;
  state: 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'recovering' | 'ended' | 'failed';
  sourceId: string | null; strategy: Source['strategy'] | null;
  backend: 'file' | 'native-hls' | 'mse' | 'webgpu' | null; renditionId: string | null; qualityIds: string[];
  capabilities: { pip: boolean; fullscreen: boolean; audioSwitch: boolean }; lockedQuality: string | null;
  live: LiveSnapshot | null;
  seekTarget: number | null; waiting: boolean; volume: number; muted: boolean;
  preparation: 'media-metadata' | 'initial-buffer' | 'starting' | null;
  position: number; duration: number | null; playable: { start: number; end: number }[];
  throughputBps: number | null; droppedFrames: number | null; totalFrames: number | null;
  audioTrackIds: string[]; audioTrackId: string | null; pendingAudioTrackId: string | null; subtitleTrackId: string | null; failure: Failure | null;
}
export type EngineEvent = { type: 'snapshot'; snapshot: Snapshot } |
  { type: 'error'; failure: Failure; sessionId?: string | null; sourceGeneration?: number; seekGeneration?: number } | { type: 'session-command'; sessionId: string; command: SessionCommand } | { type: 'session-refresh'; sessionId: string };
