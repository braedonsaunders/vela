/** Vela v0. All durations/positions are seconds, rates bits/second, timestamps RFC3339 UTC. */
export type ID = string;
export type Timestamp = string;
export type Cursor = string;
export interface Page<T> { items: T[]; nextCursor?: Cursor; continuation: 'more' | 'exhausted' | 'unknown' }
export interface Mutation { idempotencyKey: string }
export interface Ack { accepted: true }
export interface Device { id: ID; name: string; platform: string; appVersion: string }
export interface OriginalPlaybackCapabilities { version: 1; range: true; demuxContainers: string[]; videoDecoders: string[]; audioDecoders: string[]; webgpu: boolean }
export interface ClientCapabilities {
  originalPlayback?: OriginalPlaybackCapabilities;
  device: Device; protocolVersions: number[]; containers: string[]; videoCodecs: string[];
  audioCodecs: string[]; subtitleFormats: string[]; /** Native HLS acceptance, independent of MSE. */ hls: boolean; mse: boolean;
  maxWidth?: number; maxHeight?: number; maxBitrate?: number; hdr?: string[];
}
export interface Feature { available: boolean; reason?: string }
export type SearchSort = string;
export type SearchDirection = 'asc' | 'desc';
export type SearchKind = string;
export type SearchKindCapability = string | { id: string; label?: string };
export interface SearchOptions { sort?: SearchSort; direction?: SearchDirection; kind?: SearchKind; library?: ID }
export interface ServerCapabilities {
  /** Complete, unpaginated live guide windows when advertised. */
  liveGuideWindow?: { maxChannels: number; maxWindowMinutes: number };
  searchSorts?: { id: SearchSort; label?: string; directions: SearchDirection[] }[];
  searchKinds?: SearchKindCapability[];
  /** Search can be restricted to a visible library ID. */
  searchLibraries?: boolean;
  /** Trusted advertised HTTPS base origins; no path, query or fragment. */
  secureOrigins?: string[];
  protocolVersion: 0; compatibleClientBuilds?: { minInclusive: string; maxExclusive: string }; server: { id: ID; name: string; version: string };
  plexAccountSignIn?: boolean;
  features: { passwordSignIn: Feature; deviceGrant: Feature; quickConnect: Feature;
    descriptiveSearch: Feature; aiSearch: Feature; proactiveFallback: Feature; liveTV: Feature; libraryLive?: Feature; extras: Feature; trailerPreview?: Feature; themeMusic?: Feature; audioFallback?: Feature; initialTrackSelection?: Feature; sessionTrackChanges?: Feature; extraPlayback?: Feature };
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
  id: ID; kind: 'poster' | 'backdrop' | 'thumb' | 'logo' | 'still' | 'person' | 'channel'; tag: string;
  /** Positive dimensions describe delivered pixels; 0/0 means an unmeasured source. */
  sizes: { width: number; height: number; url: string }[]; blurHash?: string; thumbHash?: string; color?: string;
}
export type TitleKind = 'movie' | 'show' | 'season' | 'episode';
export interface WatchState { positionSeconds: number; played: boolean; favorite: boolean; watchlisted: boolean }
/** Actual server-sourced rating; scale is the maximum possible value. */
export interface TitleRating { source: string; kind: 'critic' | 'audience'; value: number; scale: number; state?: string; votes?: number; url?: string }
export interface ThemeMusic { url: string; expiresAt: Timestamp; durationSeconds?: number;
  /** Measured integrated loudness in LUFS; omitted when unmeasured. */ loudness?: number }
export interface Title {
  id: ID; kind: TitleKind; name: string; summary: string; year?: number; /** Original air/release date, YYYY-MM-DD. */ airDate?: string; dateDisplay?: 'date'; genres: string[];
  durationSeconds?: number; rating?: string; ratings?: TitleRating[]; artwork: ArtworkRef[]; watch?: WatchState; themeMusic?: ThemeMusic;
  showId?: ID; showName?: string; seasonId?: ID; seasonNumber?: number; episodeNumber?: number;
}
export interface Extra { id: ID; parentId: ID; kind: 'trailer' | 'clip' | 'featurette' | 'other'; name: string;
  durationSeconds?: number; artwork?: ArtworkRef; cachedPlayback?: { status: 'ready'; url: string; expiresAt: Timestamp }; availability: 'ready' | 'unresolved' | 'unavailable' }
export interface Chapter { id: ID; name: string; startSeconds: number; endSeconds?: number }
/** Verified source stream facts only; omitted when streams are estimated or unknown.
 * audio.default marks the preferred track; an absent subtitleCount means the count is unknown. */
export interface MediaSummary { video: { codec?: string; width?: number; height?: number; bitDepth?: number; colorTransfer?: string; dolbyVisionProfile?: number }[]; audio: { codec?: string; channels?: number; language?: string; default?: boolean }[]; subtitleCount?: number }
/** Parts of a title answer the server is still producing (confirmed queued or running work only). */
export type PendingPart = 'seasons' | 'episodes' | 'extras' | 'trailer';
/** A partial answer: `pending` names the parts still in flight; ask again after `refreshAfterMs`. */
export interface PartialAnswer { pending?: PendingPart[]; refreshAfterMs?: number }
export interface TitleDetail extends PartialAnswer { title: Title; canPlay?: boolean; seasons?: Title[]; episodes?: Title[];
  /** Server-selected next episode; null means none. Omitted by older servers. */ nextUp?: Title | null;
  extras: Extra[]; chapters: Chapter[]; crew?: { id?: ID; name: string; role?: string; artwork?: ArtworkRef }[]; mediaSummary?: MediaSummary; cast: { id?: ID; name: string; role?: string; artwork?: ArtworkRef }[] }
/** A visible person facet, including metadata already cached by the server. */
export interface PersonDetail { id: ID; name: string; photo: ArtworkRef | null; roles: string[]; knownFor: string; biography?: string; birthday?: string; deathday?: string; deathDate?: string }
/** A facet-backed collections tab returns direct collection metadata. */
export interface LibraryFacetCollection { id: ID; name: string; itemCount: number; artwork: ArtworkRef[] }
/** Ordinary library collection entries retain the nested metadata envelope. */
export interface LibraryCollectionEntry { id: ID; kind: 'collection'; receiptToken: string; collection: { id: ID; name: string; summary: string; itemCount: number; artwork: ArtworkRef[] } }
export interface LibraryPersonEntry { id: ID; kind: 'person'; person: Pick<PersonDetail, 'id' | 'name' | 'photo'>; itemCount: number }
export type RowEntry = { id: ID; receiptToken: string } & (
  { kind: 'title'; title: Title; role?: string } | { kind: 'person'; person: LibraryPersonEntry['person']; itemCount: number } | { kind: 'channel'; channel: Channel } |
  { kind: 'collection' | 'playlist' | 'directory'; name: string; artwork: ArtworkRef[]; targetId: ID; itemCount?: number });
export interface Row { id: ID; name: string; purpose: 'continue' | 'nextUp' | 'recent' | 'recentlyReleased' | 'recentlyAdded' | 'collection' | 'recommendation' | 'live' | 'watchlist';
  receiptToken: string; style?: string; presentation?: 'ranked'; previewOnFocus?: boolean; items: RowEntry[]; nextCursor?: Cursor; continuation: 'more' | 'exhausted' | 'unknown' }
export type HeroReason = 'resume' | 'nextEpisode' | 'newRelease' | 'forYou' | 'trending' | 'featured';
export interface HeroAction { kind: 'resume' | 'play' | 'details'; titleId: ID; positionSeconds?: number }
export interface Hero { title: Title; receiptToken: string; reason: HeroReason; action: HeroAction;
  /** Short supporting/reason text, not the primary action button label. */
  label?: string; previewOnFocus?: boolean; trailer?: Extra }
export interface Bootstrap { viewer: Viewer; capabilities: ServerCapabilities; defaultSkinId: ID; heroes?: Hero[]; rows: Row[]; nextCursor?: Cursor }
export interface RowsQuery { cursor?: Cursor; limit?: number; placement?: 'home' | 'detail' | 'library'; titleId?: ID; libraryId?: ID }
export interface SearchRequest extends Mutation, SearchOptions { query: string; generation: number; mode: 'fast' | 'descriptive'; cursor?: Cursor; limit?: number }
export interface LiveSearchResults { channels: Channel[]; programmes: Programme[]; programmeChannels?: Channel[] }
export interface DescriptiveSearchState { state: 'ready' | 'pending' | 'partial' | 'busy' | 'failed'; retry?: { allowed: boolean; afterSeconds?: number } }
export interface SearchResponse extends Page<Title> { query: string; generation: number; receiptToken?: string; live?: LiveSearchResults; descriptive?: DescriptiveSearchState }
export interface AISearchRequest extends Mutation { query: string; generation: number; previousJobId?: ID }
export interface AISearchJob { id: ID; generation: number; status: 'queued' | 'running' | 'partial' | 'complete' | 'cancelled' | 'failed';
  /** Required for partial: provisional results replaced by the final response. */
  results?: SearchResponse; error?: ProtocolError }
export interface CancelRequest extends Mutation { generation: number }
export interface Interaction { receiptToken: string; kind: 'visible' | 'selected' | 'played'; occurredAt: Timestamp;
  /** Visible means actually in the visible viewport; never merely prefetched. */
  visibleMilliseconds?: number; sessionId?: ID }
export interface InteractionsRequest extends Mutation { interactions: Interaction[] }
export type SubtitleDelivery = { kind: 'external'; format: 'webvtt' | 'webvtt-window'; url: string } |
  { kind: 'embedded' } | { kind: 'burn-in' };
export interface Track { streamIndex?: number; id: ID; kind: 'audio' | 'subtitle'; language: string; name: string; codec: string;
  channels?: number; forced?: boolean; hearingImpaired?: boolean; default?: boolean; url?: string;
  /** Subtitle delivery only; streamIndex remains the full source stream index. */
  delivery?: SubtitleDelivery }
export interface AudioRendition { trackId: ID; groupId: ID; url: string; mimeType: string; bitrate?: number }
export interface QualityTarget { width: number; height: number;
  /** Total peak bits/second, including audio. */ bitrate: number;
  /** Target video rate and peak video budget, in bits/second. */
  videoBitrate?: number; peakVideoBitrate?: number;
  /** Estimated total average video + audio bits/second. */ averageBitrate?: number;
  codec?: 'h264' | 'hevc'; videoCodec?: string; codecStatus?: 'pending' | 'verified';
  /** Intended output, not proof of decoded source colour characteristics. */
  dynamicRange?: 'sdr' | 'hdr10' | 'hlg' | 'dv' }
export interface Quality extends QualityTarget { id: ID; videoCodec: string; audioCodec?: string; url: string; audioGroupId?: ID }
export interface Generations { sourceGeneration: number; seekGeneration: number }
/** POST /titles/:id/trailer-preview initiates the request; GET polls it without a body or mutation key. */
export interface TrailerPreviewRequest extends Mutation { client: ClientCapabilities }
export interface PreviewGrant extends Generations { sessionId: ID; url: string; mimeType: string; expiresAt: Timestamp; purpose: 'preview' }
/** POST result or GET status of an already-requested preview; GET never starts preparation and returns 404 when none was requested. */
export type TrailerPreviewResponse = { state: 'ready'; grant: PreviewGrant } |
  { state: 'preparing'; retryAfterSeconds: number } | { state: 'unavailable'; reason: string };
export interface SwitchBoundary { atSeconds: number; independent: boolean; timelineId: ID;
  /** Source replacement requires this compatibility proof, not just a matching title. */
  compatibility: 'same-source' | 'verified-timeline'; audioTrackIds: ID[]; subtitleTrackIds: ID[] }
export interface OriginalVideo { isInterlaced?: boolean; fieldOrder?: 'progressive' | 'tt' | 'bb' | 'tb' | 'bt'; rotation?: number; codec?: string; width?: number; height?: number; bitDepth?: number; profile?: string; level?: number; frameRate?: number; colorPrimaries?: string; colorTransfer?: string; colorSpace?: string; colorRange?: string; dvProfile?: number; dvLevel?: number; dvBlSignalCompatibilityId?: number; rpuPresent?: boolean; elPresent?: boolean; blPresent?: boolean }
export interface PlaybackPathBase { originalVideo?: OriginalVideo; original?: boolean; range?: boolean; byteLength?: number; id: ID; kind: 'direct' | 'remux' | 'transcode'; transport: 'file' | 'hls';
  mimeType: string; sourceId?: ID; timelineId?: ID; edition?: string;
  timelineOriginSeconds?: number; initialRenditionId?: ID; audioRenditions?: AudioRendition[];
  /** Output target metadata; readiness remains independent. */
  quality?: QualityTarget;
  qualities: Quality[]; boundaries: SwitchBoundary[] }
export type PlaybackPath = PlaybackPathBase & ({ readiness: 'on-demand'; url?: never } | { readiness: 'ready' | 'preparing' | 'unavailable'; url: string });
export interface Fallback { state: 'unsupported' | 'idle' | 'preparing' | 'ready' | 'unavailable' | 'capacity'; pathId?: ID; reason?: string }
export interface LiveAnchor { /** Nonnegative safe integer from the published snapshot. */ mediaSequence: number; windowStartSeconds: number }
/** HTTP 202 while an explicitly requested extra is being prepared; no session exists yet. */
export interface PlaybackPreparing { state: 'preparing'; retryAfterSeconds: number }
/** Session-scoped scrub thumbnail geometry; omission makes no availability claim. */
export interface TrickplayMetadata {
  /** One thumbnail's pixel dimensions, not the complete sprite sheet. */
  width: number; height: number;
  /** Positive integer milliseconds between title-time slots. */
  intervalMs: number;
  /** ceil(probed durationMs / intervalMs), including fallback slots; omit offer if duration unknown. */
  count: number;
  /** Sheet grid dimensions (currently 10 by 10). */
  cols: number; rows: number;
  /** Highest contiguous real-frame end from title time zero, in milliseconds; islands do not advance it. */
  coverageUntilMs: number;
  /** Monotonic within the plan's sourceGeneration; changes when published sheets change. */
  revision: number;
}
export interface PlaybackPlan extends Generations { sessionId: ID; revision: number; titleId?: ID; channelId?: ID; extraId?: ID; libraryId?: ID; liveItemId?: ID; title?: string; purpose?: 'playback' | 'preview';
  state: 'ready' | 'playing' | 'paused' | 'recovering' | 'ended'; positionSeconds: number; durationSeconds?: number;
  paths: PlaybackPath[]; selectedPathId: ID; audioTracks: Track[]; subtitleTracks: Track[];
  selectedAudioTrackId?: ID; selectedSubtitleTrackId: ID | null; chapters: Chapter[]; fallback: Fallback;
  /** Also carried by SessionSnapshot.plan and full plan events. */
  trickplay?: TrickplayMetadata;
  qualityLimitations?: { height: number; reason: string }[];
  livePolicy?: { latencyProfile: 'auto' | 'low' | 'stable'; targetLatencySeconds: number };
  live?: { mode: 'adaptive' | 'low-delay'; anchor?: LiveAnchor; windowStartSeconds?: number; liveEdgeSeconds?: number; maxDriftSeconds?: number } }
export type PlaybackTarget = { titleId: ID; channelId?: never; extraId?: never } |
  { channelId: ID; titleId?: never; extraId?: never } | { extraId: ID; titleId?: never; channelId?: never };
export type PlaybackRequest = Mutation & PlaybackTarget & { client: ClientCapabilities; positionSeconds?: number; mediaSourceId?: ID;
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
export interface ProtocolError { class: 'auth' | 'policy' | 'not-found' | 'source' | 'decoder' | 'playback' | 'capacity' | 'transient' | 'request' | 'conflict';
  code: string; message: string; retry: { allowed: boolean; afterSeconds?: number; maxAttempts?: number };
  requestId?: ID; currentGenerations?: Generations;
  suggest?: { maxChannels: number; maxWindowMinutes: number };
  /** Attempted delivery labels (not path IDs) and human-readable diagnostics. */
  rejectedPaths?: { path: string; reasons: string[] }[] }
export interface ErrorResponse { error: ProtocolError }
export interface LiveGuide { id: ID; name: string }
export interface Channel { id: ID; number: string; name: string; kind: string; artwork: ArtworkRef[]; favorite: boolean; rating?: string; group?: string; guides?: LiveGuide[] }
export interface Programme { id: ID; channelId: ID; name: string; summary: string; start: Timestamp; end: Timestamp;
  titleId?: ID; episodeTitle?: string; seasonNumber?: number; episodeNumber?: number; artwork: ArtworkRef[]; rating?: string; genres?: string[] }
export interface GuideQuery { from: Timestamp; until: Timestamp; channelIds?: ID[]; cursor?: Cursor; limit?: number }
export interface GuideResponse extends Page<Programme> { from: Timestamp; until: Timestamp }
export interface GuideWindowRequest { channelIds: ID[]; from: Timestamp; until: Timestamp }
export interface GuideWindowResponse {
  from: Timestamp; until: Timestamp; revision: string; validUntil: Timestamp;
  channels: { channelId: ID; state: 'ready' | 'unavailable'; programmes: Programme[] }[];
}
export interface ExtrasResponse extends PartialAnswer { items: Extra[] }
export interface ChildrenPage extends Page<Title>, PartialAnswer {}
/** One-use console Watch hand-off; redeem against the same Ether instance. */
export interface WebCodeRedeemRequest extends Mutation { code: string; device: Device }

export interface WatchRequest extends Mutation { played?: boolean; favorite?: boolean; watchlisted?: boolean }

export interface Collection { id: ID; kind: 'collection' | 'playlist' | 'directory'; name: string; summary?: string; artwork: ArtworkRef[] }
export interface CollectionContents extends Page<RowEntry> { collection: Collection }

export type LibrarySort = 'index' | 'server' | 'title' | 'added' | 'released' | 'year' | 'rating' | 'duration' | 'popularity' | 'updated';
export type SortDirection = 'asc' | 'desc';
export type LibraryCard = 'poster' | 'landscape' | 'square';
export interface LibraryTab { search?: boolean; searchPlaceholder?: string; id: string; label: string; kind: 'recommended' | 'library' | 'collections' | 'people' | 'live'; card?: LibraryCard; facet?: string; order?: 'name' | 'count'; sort?: LibrarySort; direction?: SortDirection }
/** All types return discrete value IDs; numeric/date/duration facets may be server-bucketed. */
export interface LibraryFacet { id: string; label: string; type: 'enum' | 'strings' | 'people' | 'int' | 'date' | 'duration'; multi: boolean }
export interface FacetValue { id: string; label: string; count: number }
export interface LibraryBrowseOptions {
  sorts: { id: LibrarySort; directions: SortDirection[] }[];
  defaultSort: LibrarySort; defaultDirection: SortDirection;
  /** Boolean fields declare support; kind lists supported values. */
  filters: { facets?: LibraryFacet[]; kind?: TitleKind[]; genre?: boolean; genres?: string[]; year?: boolean; played?: boolean; favorite?: boolean; collectionId?: boolean };
}
export interface Library { presentation?: { card: LibraryCard }; dateDisplay?: 'year' | 'date'; tabs?: LibraryTab[]; id: ID; name: string; kind: 'movies' | 'shows' | 'live' | 'mixed'; artwork: ArtworkRef[]; browse: LibraryBrowseOptions }
export interface LibrariesQuery { cursor?: Cursor; limit?: number }
export interface LibraryBrowseQuery extends LibrariesQuery {
  query?: string; facets?: Record<string, string[]>;
  sort?: LibrarySort; direction?: SortDirection; kind?: TitleKind; genre?: string; year?: number; played?: boolean; favorite?: boolean; collectionId?: ID;
}
export interface LibraryContents extends Page<RowEntry> { library: Library; sort: LibrarySort; direction: SortDirection }
export interface LibraryLiveItem { id: ID; title: string; subtitle?: string; badge?: string; viewers?: number; tags?: string[]; live?: boolean; artwork: ArtworkRef[] }
export interface LibraryLiveFilter { key: string; label: string }
export interface LibraryLiveQuery extends LibrariesQuery { tab?: string; query?: string; filter?: string }
export interface LibraryLiveContents extends Page<LibraryLiveItem> { library: Library; filters: LibraryLiveFilter[] }
export interface LibraryLivePlaybackRequest extends Mutation { itemId: ID; tab?: string; liveMode?: 'adaptive' | 'low-delay'; client: ClientCapabilities }

// Appearance: the server's default skin and the runtime skin packs it has installed.
// A pack is data only (no code, no CSS text): validated colours, lengths, font files and
// image URLs applied over one compiled layout engine. See docs/skin-distribution.md.
/** `#rrggbb` or `#rrggbbaa`, lowercase. */
export type PackColor = string;
export interface PackFontFile { url: string; weight: number; style: 'normal' | 'italic' }
/** sizeAdjust: percent (50-150) so a face with other metrics keeps the engine's line lengths. */
export interface PackFont { family: string; files: PackFontFile[]; sizeAdjust?: number }
export interface SkinPack {
  /** Pack schema; a client ignores a schema it does not implement. */
  schema: 1;
  id: ID; version: string; name: string; tagline?: string;
  /** The compiled layout engine the pack styles (`cinematic`, `index`, ...). */
  engine: ID;
  /** Engine role -> colour. The engine derives its whole palette from these roles. */
  palette: Record<string, PackColor>;
  /** Exact token overrides by Tamber name; only tokens the engine exposes apply. */
  tokens?: Record<string, PackColor>;
  fonts?: { display?: PackFont; text?: PackFont };
  /** Pixels. */
  radius?: { card?: number; panel?: number; pill?: number };
  /** Same-origin URLs under /vela/v0/appearance/. */
  images?: { preview?: string; backdrop?: string; wordmark?: string };
  /** Up to five colours the picker shows. */
  swatches: PackColor[];
}
export interface Branding { name?: string; wordmark?: { url: string; width: number; height: number; dark?: string } }
export interface Appearance {
  branding?: Branding;
  /** Monotonic; a client applies only a newer revision. */
  revision: number;
  /** An engine id or an installed pack id. */
  defaultSkinId: ID;
  /** The engine `defaultSkinId` runs on (itself for an engine). */
  defaultEngineId: ID;
  /** Owner override: the default replaces viewers' own picks while true. */
  force: boolean;
  packs: SkinPack[];
  /** Installed skin documents (packages/protocol/skin.ts), drawn by the client's renderer. */
  documents?: SkinDocumentRef[];
}
/** Where a skin document is served (same-origin, under /vela/v0/appearance/), with its picker card. */
export interface SkinDocumentRef { id: ID; name: string; version: string; url: string; tagline?: string; preview?: string; swatches: PackColor[] }
/** Viewer-level server events (`GET /events`), distinct from playback SessionEvent. */
export type ServerEvent = { cursor: Cursor } & ({ type: 'appearance'; appearance: Appearance });

export interface WebCodeIssueRequest extends Mutation { targetOrigin: string; device: Device }
export interface WebCodeIssueResponse { code: string; targetOrigin: string; expiresAt: Timestamp }

export interface AudioFallbackRequest extends Mutation, Generations { trackId: ID; positionSeconds: number; preferredCodec: 'aac' }
export interface AudioFallbackResponse { id: ID; audioGeneration: number; trackId: ID; url: string; mimeType: 'application/vnd.apple.mpegurl'; codec: 'mp4a.40.2'; timelineOriginSeconds: 0 }
