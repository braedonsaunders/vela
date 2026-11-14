/** Vela v0. All durations/positions are seconds, rates bits/second, timestamps RFC3339 UTC. */
export type ID = string;
export type Timestamp = string;
export type Cursor = string;
export interface Page<T> { items: T[]; nextCursor?: Cursor; continuation: 'more' | 'exhausted' | 'unknown' }
export interface Mutation { idempotencyKey: string }
export interface Ack { accepted: true }
export interface Device { id: ID; name: string; platform: string; appVersion: string }
export interface ClientCapabilities {
  device: Device; protocolVersions: number[]; containers: string[]; videoCodecs: string[];
  audioCodecs: string[]; subtitleFormats: string[]; /** Native HLS acceptance, independent of MSE. */ hls: boolean; mse: boolean;
  maxWidth?: number; maxHeight?: number; maxBitrate?: number; hdr?: string[];
}
export interface Feature { available: boolean; reason?: string }
export interface ServerCapabilities {
  protocolVersion: 0; compatibleClientBuilds?: { minInclusive: string; maxExclusive: string }; server: { id: ID; name: string; version: string };
  features: { passwordSignIn: Feature; deviceGrant: Feature; quickConnect: Feature;
    descriptiveSearch: Feature; aiSearch: Feature; proactiveFallback: Feature; liveTV: Feature; extras: Feature; trailerPreview?: Feature; initialTrackSelection?: Feature; sessionTrackChanges?: Feature; extraPlayback?: Feature };
  skins: { id: ID; name: string }[]; defaultSkinId: ID;
}
export interface NegotiateRequest extends Mutation { client: ClientCapabilities }
export interface NegotiateResponse { capabilities: ServerCapabilities; client: ClientCapabilities }
export interface Viewer { id: ID; name: string; policyRevision: string; avatar?: ArtworkRef }
export interface Tokens { accessToken: string; refreshToken: string; expiresAt: Timestamp; viewer: Viewer }
export interface SignInRequest extends Mutation { username: string; password: string; device: Device }
export interface RefreshRequest extends Mutation { refreshToken: string; device: Device }
export interface RevokeRequest extends Mutation { refreshToken: string }
export interface DeviceGrantRequest extends Mutation { device: Device }
export interface DeviceGrant { deviceCode: string; userCode: string; verificationUrl: string; expiresAt: Timestamp; pollIntervalSeconds: number }
export interface DevicePollRequest extends Mutation { deviceCode: string; device: Device }
export type GrantPoll = { status: 'pending' | 'expired' | 'denied' } | { status: 'approved'; tokens: Tokens };
export interface GrantApproveRequest extends Mutation { userCode: string }
export interface QuickConnect { secret: string; code: string; expiresAt: Timestamp; pollIntervalSeconds: number }
export interface QuickPollRequest extends Mutation { secret: string; device: Device }
export interface QuickApproveRequest extends Mutation { code: string }
export interface ArtworkRef {
  id: ID; kind: 'poster' | 'backdrop' | 'logo' | 'still' | 'person' | 'channel'; tag: string;
  /** Positive dimensions describe delivered pixels; 0/0 means an unmeasured source. */
  sizes: { width: number; height: number; url: string }[]; blurHash?: string; thumbHash?: string; color?: string;
}
export type TitleKind = 'movie' | 'show' | 'season' | 'episode';
export interface WatchState { positionSeconds: number; played: boolean; favorite: boolean; watchlisted: boolean }
export interface Title {
  id: ID; kind: TitleKind; name: string; summary: string; year?: number; genres: string[];
  durationSeconds?: number; rating?: string; artwork: ArtworkRef[]; watch?: WatchState;
  showId?: ID; seasonId?: ID; seasonNumber?: number; episodeNumber?: number;
}
export interface Extra { id: ID; parentId: ID; kind: 'trailer' | 'clip' | 'featurette' | 'other'; name: string;
  durationSeconds?: number; artwork?: ArtworkRef; cachedPlayback?: { status: 'ready'; url: string; expiresAt: Timestamp }; availability: 'ready' | 'unresolved' | 'unavailable' }
export interface Chapter { id: ID; name: string; startSeconds: number; endSeconds?: number }
/** Verified source stream facts only; omitted when streams are estimated or unknown. */
export interface MediaSummary { video: { codec?: string; width?: number; height?: number; bitDepth?: number; colorTransfer?: string; dolbyVisionProfile?: number }[]; audio: { codec?: string; channels?: number; language?: string }[] }
export interface TitleDetail { title: Title; canPlay?: boolean; seasons?: Title[]; episodes?: Title[];
  extras: Extra[]; chapters: Chapter[]; crew?: { name: string; role?: string }[]; mediaSummary?: MediaSummary; cast: { name: string; role?: string; artwork?: ArtworkRef }[] }
export type RowEntry = { id: ID; receiptToken: string } & (
  { kind: 'title'; title: Title } | { kind: 'channel'; channel: Channel } |
  { kind: 'collection' | 'playlist' | 'directory'; name: string; artwork: ArtworkRef[]; targetId: ID });
export interface Row { id: ID; name: string; purpose: 'continue' | 'nextUp' | 'recentlyReleased' | 'recentlyAdded' | 'collection' | 'recommendation' | 'live' | 'watchlist';
  receiptToken: string; style?: string; previewOnFocus?: boolean; items: RowEntry[]; nextCursor?: Cursor; continuation: 'more' | 'exhausted' | 'unknown' }
export interface Hero { title: Title; receiptToken: string; previewOnFocus?: boolean; trailer?: Extra }
export interface Bootstrap { viewer: Viewer; capabilities: ServerCapabilities; defaultSkinId: ID; heroes?: Hero[]; rows: Row[]; nextCursor?: Cursor }
export interface RowsQuery { cursor?: Cursor; limit?: number; placement?: 'home' | 'detail' | 'library'; titleId?: ID }
export interface SearchRequest extends Mutation { query: string; generation: number; mode: 'fast' | 'descriptive'; cursor?: Cursor; limit?: number }
export interface SearchResponse extends Page<Title> { query: string; generation: number; receiptToken?: string }
export interface AISearchRequest extends Mutation { query: string; generation: number; previousJobId?: ID }
export interface AISearchJob { id: ID; generation: number; status: 'queued' | 'running' | 'complete' | 'cancelled' | 'failed'; results?: SearchResponse; error?: ProtocolError }
export interface CancelRequest extends Mutation { generation: number }
export interface Interaction { receiptToken: string; kind: 'visible' | 'selected' | 'played'; occurredAt: Timestamp;
  /** Visible means actually in the visible viewport; never merely prefetched. */
  visibleMilliseconds?: number; sessionId?: ID }
export interface InteractionsRequest extends Mutation { interactions: Interaction[] }
export interface Track { id: ID; kind: 'audio' | 'subtitle'; language: string; name: string; codec: string;
  channels?: number; forced?: boolean; hearingImpaired?: boolean; default?: boolean; url?: string }
export interface AudioRendition { trackId: ID; groupId: ID; url: string; mimeType: string; bitrate?: number }
export interface Quality { id: ID; width: number; height: number; bitrate: number; videoCodec: string; audioCodec?: string; url: string; codecStatus?: 'pending' | 'verified'; audioGroupId?: ID }
export interface Generations { sourceGeneration: number; seekGeneration: number }
export interface TrailerPreviewRequest extends Mutation { client: ClientCapabilities }
export interface PreviewGrant extends Generations { sessionId: ID; url: string; mimeType: string; expiresAt: Timestamp; purpose: 'preview' }
export type TrailerPreviewResponse = { state: 'ready'; grant: PreviewGrant } |
  { state: 'preparing'; retryAfterSeconds: number } | { state: 'unavailable'; reason: string };
export interface SwitchBoundary { atSeconds: number; independent: boolean; timelineId: ID;
  /** Source replacement requires this compatibility proof, not just a matching title. */
  compatibility: 'same-source' | 'verified-timeline'; audioTrackIds: ID[]; subtitleTrackIds: ID[] }
export interface PlaybackPath { id: ID; kind: 'direct' | 'remux' | 'transcode'; transport: 'file' | 'hls';
  url: string; mimeType: string; sourceId?: ID; timelineId?: ID; edition?: string;
  timelineOriginSeconds?: number; initialRenditionId?: ID; audioRenditions?: AudioRendition[];
  readiness: 'ready' | 'preparing' | 'unavailable'; qualities: Quality[]; boundaries: SwitchBoundary[] }
export interface Fallback { state: 'unsupported' | 'idle' | 'preparing' | 'ready' | 'unavailable' | 'capacity'; pathId?: ID; reason?: string }
export interface PlaybackPlan extends Generations { sessionId: ID; revision: number; titleId?: ID; channelId?: ID; extraId?: ID; purpose?: 'playback' | 'preview';
  state: 'ready' | 'playing' | 'paused' | 'recovering' | 'ended'; positionSeconds: number; durationSeconds?: number;
  paths: PlaybackPath[]; selectedPathId: ID; audioTracks: Track[]; subtitleTracks: Track[];
  selectedAudioTrackId?: ID; selectedSubtitleTrackId: ID | null; chapters: Chapter[]; fallback: Fallback;
  live?: { mode: 'adaptive' | 'low-delay'; windowStartSeconds?: number; liveEdgeSeconds?: number; maxDriftSeconds?: number } }
export type PlaybackTarget = { titleId: ID; channelId?: never; extraId?: never } |
  { channelId: ID; titleId?: never; extraId?: never } | { extraId: ID; titleId?: never; channelId?: never };
export type PlaybackRequest = Mutation & PlaybackTarget & { client: ClientCapabilities; positionSeconds?: number;
  audioTrackId?: ID; subtitleTrackId?: ID | null; allowTranscode?: boolean; liveMode?: 'adaptive' | 'low-delay' };
export type SessionCommand = Mutation & Generations & (
  { kind: 'seek'; positionSeconds: number } | { kind: 'pause' | 'resume' | 'stop' } |
  { kind: 'tracks'; audioTrackId?: ID; subtitleTrackId?: ID | null } |
  { kind: 'switch'; pathId: ID; atSeconds: number } | { kind: 'prepare-fallback'; maxBitrate: number });
export interface TimeRange { startSeconds: number; endSeconds: number }
export interface PlayerObservation extends Mutation, Generations { sequence: number; observedAt: Timestamp;
  positionSeconds: number; state: 'playing' | 'paused' | 'buffering' | 'ended'; playableRanges: TimeRange[];
  throughputBps?: number; droppedFrames?: number; totalFrames?: number; selectedPathId: ID;
  audioTrackId?: ID; subtitleTrackId?: ID | null; transferredBytes?: number;
  error?: { class: 'source' | 'decoder' | 'transient'; message: string } }
export interface SessionSnapshot { cursor: Cursor; revision: number; plan: PlaybackPlan;
  /** Server publication does not prove transfer, accepted buffer, or playback progress. */
  publishedRanges: TimeRange[]; lastObservationSequence?: number }
export type SessionEvent = { cursor: Cursor; revision: number; sessionId: ID } & (
  { type: 'snapshot'; snapshot: SessionSnapshot } | { type: 'plan'; plan: PlaybackPlan } |
  { type: 'error'; error: ProtocolError } | { type: 'ended'; reason: string });
export interface ProtocolError { class: 'auth' | 'policy' | 'not-found' | 'source' | 'decoder' | 'capacity' | 'transient' | 'request' | 'conflict';
  code: string; message: string; retry: { allowed: boolean; afterSeconds?: number; maxAttempts?: number };
  requestId?: ID; currentGenerations?: Generations }
export interface ErrorResponse { error: ProtocolError }
export interface Channel { id: ID; number: string; name: string; kind: string; artwork: ArtworkRef[]; favorite: boolean; rating?: string; group?: string }
export interface Programme { id: ID; channelId: ID; name: string; summary: string; start: Timestamp; end: Timestamp;
  titleId?: ID; episodeTitle?: string; seasonNumber?: number; episodeNumber?: number; artwork: ArtworkRef[]; rating?: string; genres?: string[] }
export interface GuideQuery { from: Timestamp; until: Timestamp; channelIds?: ID[]; cursor?: Cursor; limit?: number }
export interface GuideResponse extends Page<Programme> { from: Timestamp; until: Timestamp }
export interface ExtrasResponse { items: Extra[] }
/** One-use console Watch hand-off; redeem against the same Ether instance. */
export interface WebCodeRedeemRequest extends Mutation { code: string; device: Device }

export interface WatchRequest extends Mutation { played?: boolean; favorite?: boolean; watchlisted?: boolean }

export interface Collection { id: ID; kind: 'collection' | 'playlist' | 'directory'; name: string; summary?: string; artwork: ArtworkRef[] }
export interface CollectionContents extends Page<RowEntry> { collection: Collection }

export type LibrarySort = 'server' | 'title' | 'added' | 'released' | 'year' | 'rating' | 'duration' | 'popularity' | 'updated';
export type SortDirection = 'asc' | 'desc';
export interface LibraryBrowseOptions {
  sorts: { id: LibrarySort; directions: SortDirection[] }[];
  defaultSort: LibrarySort; defaultDirection: SortDirection;
  /** Boolean fields declare support; kind lists supported values. */
  filters: { kind?: TitleKind[]; genre?: boolean; genres?: string[]; year?: boolean; played?: boolean; favorite?: boolean };
}
export interface Library { id: ID; name: string; kind: 'movies' | 'shows' | 'live' | 'mixed'; artwork: ArtworkRef[]; browse: LibraryBrowseOptions }
export interface LibrariesQuery { cursor?: Cursor; limit?: number }
export interface LibraryBrowseQuery extends LibrariesQuery {
  sort?: LibrarySort; direction?: SortDirection; kind?: TitleKind; genre?: string; year?: number; played?: boolean; favorite?: boolean;
}
export interface LibraryContents extends Page<RowEntry> { library: Library; sort: LibrarySort; direction: SortDirection }
