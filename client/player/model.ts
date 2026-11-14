/** Local engine input. protocol.ts translates the versioned server plan here. */
export interface Track { id: string; label: string; language?: string; url?: string }
export interface Rendition { id: string; url: string; bandwidth: number; mime: string; height?: number }
export interface Source {
  id: string; strategy: 'direct' | 'remux' | 'transcode'; delivery: 'file' | 'hls';
  url: string; mime: string; timeline: string; edition: string; audioTrackId?: string; recoveryAllowed?: boolean;
  renditions?: Rendition[];
}
export interface PlaybackSession {
  id: string; mediaId: string; edition: string; sources: Source[]; position?: number;
  audioTracks: Track[]; subtitleTracks: Track[]; audioTrackId?: string;
  subtitleTrackId?: string; live?: boolean; liveWindowStart?: number; liveMaxDrift?: number; lowDelay?: boolean; sourceGeneration?: number; seekGeneration?: number;
}
export type Command = { id: number } & (
  { type: 'play' | 'pause' | 'pip' | 'fullscreen' } |
  { type: 'seek'; seconds: number } | { type: 'volume'; value: number } |
  { type: 'audio'; trackId: string } | { type: 'subtitle'; trackId: string | null } |
  { type: 'quality'; renditionId: string | null } | { type: 'lowDelay'; enabled: boolean });
export type FailureKind = 'network' | 'source' | 'decoder' | 'unsupported' | 'action';
export interface Failure { kind: FailureKind; message: string; recoverable: boolean }
export interface Snapshot {
  sessionId: string | null; sourceGeneration: number; seekGeneration: number;
  state: 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'recovering' | 'ended' | 'failed';
  sourceId: string | null; strategy: Source['strategy'] | null;
  backend: 'file' | 'native-hls' | 'mse' | null; renditionId: string | null;
  position: number; duration: number | null; playable: { start: number; end: number }[];
  throughputBps: number | null; droppedFrames: number | null; totalFrames: number | null;
  audioTrackId: string | null; subtitleTrackId: string | null; failure: Failure | null;
}
export type EngineEvent = { type: 'snapshot'; snapshot: Snapshot } |
  { type: 'error'; failure: Failure };
