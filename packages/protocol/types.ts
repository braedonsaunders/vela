/** Vela v0. All durations/positions are seconds, rates bits/second, timestamps RFC3339 UTC. */
import type { LiveEventRef, MultiviewTile, ProviderCapDetails } from './live-events';
import type { ScreenNavigationEntry, SurfaceContribution, SurfaceRow } from './screen';
export type * from './live-events';
export type * from './screen';
export type ID = string;
export type Timestamp = string;
export type Cursor = string;
export interface Page<T> { items: T[]; nextCursor?: Cursor; continuation: 'more' | 'exhausted' | 'unknown' }
export interface Mutation { idempotencyKey: string }
export interface Ack { accepted: true }
export interface Device { id: ID; name: string; platform: string; appVersion: string }
export interface OriginalPlaybackCapabilities { version: 1; range: true; demuxContainers: string[]; videoDecoders: string[]; audioDecoders: string[]; webgpu: boolean }
/** What reaches the speakers beyond decoding, measured on the output route at negotiation time. A route
 * change (receiver off, headphones) can change it; the client renegotiates or decodes. */
export interface AudioOutputCapabilities {
  /** Codecs delivered to the receiver as their original bitstream: 'ac3', 'eac3', 'eac3-joc', 'truehd',
   * 'dts', 'dts-hd', 'dts-uhd'. tvOS forwards E-AC-3 JOC itself and is listed as 'eac3', 'eac3-joc'. */
  passthrough: string[];
  /** Immersive presentations whose heights or objects reach the output by any route (passthrough, Dolby MAT,
   * a rendered bed with heights): 'eac3-joc', 'truehd-atmos', 'dtsx'. */
  immersive: string[];
  /** Most discrete PCM channels delivered (8 is 7.1, 12 is 7.1.4, 16 is 9.1.6). */
  maxChannels: number;
  /** Highest PCM rate delivered without resampling, in Hz. */
  maxSampleRate?: number;
  /** Lossless codecs (TrueHD, DTS-HD MA, FLAC, ALAC, PCM) reach the output without loss, bitstream or PCM. */
  lossless: boolean;
}
export interface ClientCapabilities {
  originalPlayback?: OriginalPlaybackCapabilities;
  device: Device; protocolVersions: number[]; containers: string[]; videoCodecs: string[];
  audioCodecs: string[]; subtitleFormats: string[]; /** Native HLS acceptance, independent of MSE. */ hls: boolean; mse: boolean;
  maxWidth?: number; maxHeight?: number; maxBitrate?: number;
  /** Ranges the device shows as such: 'hdr10', 'hdr10+', 'hlg', 'dv'. */
  hdr?: string[];
  /** Dolby Vision profiles shown as Dolby Vision, natively or after the client's own conversion ('5', '7',
   * '8.1', '8.4', '10.1'); '7' means the client converts it to 8.1. Other profiles play their base layer at best. */
  dolbyVisionProfiles?: string[];
  /** Dolby Vision profiles whose RPU the client applies itself and shows as HDR10 or SDR (libplacebo
   * reshaping where the display link has no Dolby Vision): correct colour, so direct play, not base layer. */
  dolbyVisionReshape?: string[];
  audioOutput?: AudioOutputCapabilities;
}
export interface Feature { available: boolean; reason?: string }
export type LivePreviewMode = 'auto' | 'on-click' | 'off';
export interface LivePreviewFeature extends Feature { mode: LivePreviewMode }
/** How the owner lets trailers play: `server` (Ether plays every extra), or `clientWhenPossible` (a client
 * that can embed plays an extra's `clientPlayback` itself, and falls back to the server-played extra). */
export type TrailerEmbedMode = 'server' | 'clientWhenPossible';
export interface TrailerEmbedFeature extends Feature { mode: TrailerEmbedMode }
export type SearchSort = string;
export type SearchDirection = 'asc' | 'desc';
export type SearchKind = string;
export type SearchKindCapability = string | { id: string; label?: string };
export interface SearchOptions { sort?: SearchSort; direction?: SearchDirection; kind?: SearchKind; library?: ID }
export type HistoryRecapPeriod = 'week' | 'month' | 'year' | 'all';
export type PlaylistImportFormat = 'm3u' | 'csv';
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
  /** Ether can turn an approved Plex account into a bounded Plex Home profile selection. */
  plexHomeProfiles?: boolean;
  features: { passwordSignIn: Feature; deviceGrant: Feature; quickConnect: Feature;
    descriptiveSearch: Feature; aiSearch: Feature;
    /** One ranked search list (`mode: 'auto'`): titles first, description matches as the server's fallback. */
    unifiedSearch?: Feature; proactiveFallback: Feature; liveTV: Feature; livePreview?: LivePreviewFeature; libraryLive?: Feature; removeFromContinue?: Feature; extras: Feature; trailerPreview?: Feature; themeMusic?: Feature; audioFallback?: Feature; initialTrackSelection?: Feature; sessionTrackChanges?: Feature; extraPlayback?: Feature; versions?: Feature;
    notInterested?: Feature & { thumbsUp: boolean };
    /** YouTube trailers in YouTube's privacy-enhanced embed on the client (Extra.clientPlayback). */
    trailerEmbed?: TrailerEmbedFeature;
    playlists?: Feature & { maxEntries: number };
    /** GET /favorites/titles?role=: a viewer's likes of one role (Liked Songs, saved albums, followed artists). */
    favoritesList?: Feature;
    /** GET /titles/:id/lyrics for playable titles whose source has lyrics. */
    lyrics?: Feature;
    /** PlaybackRequest.context is remembered; GET /recent lists what the viewer played from. */
    playContexts?: Feature;
    /** GET /titles/:id/continuation: what plays after a title when its queue ends (autoplay). */
    continuation?: Feature;
    /** PlaybackRequest.queued: a gapless next track's session coexists with the playing one (its media
     * may be read) and takes the device over on its first playing, paused or buffering observation.
     * `handoverSeconds` (Ether sends 15): the superseded session keeps serving reads and accepting
     * progress for that long after the takeover, so two may overlap (an AutoMix crossfade). */
    queuedPlayback?: Feature & { handoverSeconds?: number };
    /** GET /history/recap: listening recap across week, month, year or all time. */
    historyRecap?: Feature & { periods: HistoryRecapPeriod[] };
    /** POST /playlists/import, GET /playlists/import/:id, POST /playlists/import/:id/save. */
    playlistImport?: Feature & { links: string[]; files: PlaylistImportFormat[]; maxTracks: number };
    /** TitleMedia.recordingId, GET /libraries/:id/duplicates, POST /libraries/:id/duplicates/:recordingId, GET /titles/:id/recording. */
    duplicates?: Feature;
    /** Libraries and titles carry media classes and roles (docs/media-kinds.md). */
    mediaClasses?: Feature & { classes: MediaClass[] };
    /** Viewer policy for downloading original video files. */
    downloads?: { enabled: boolean; maxPerDay?: number; remainingToday?: number };
    /** POST /titles/:id/read and reading progress, for these formats. */
    reading?: Feature & { formats: ReadingFormat[] };
    /** Audio-only plans (PlaybackPlan.media = 'audio'). */
    audioPlayback?: Feature;
    /** Library.experience is sent on every library and is final (a plugin names how its library opens);
     * `experiences` lists the ids the server sends. Without it a client chooses by media class. */
    libraryExperiences?: Feature & { experiences: LibraryExperience[] };
    /** Live TV multiview groups: POST /multiview, PlaybackRequest.multiview. */
    multiview?: Feature & { maxTiles: number };
    /** Live TV catch-up and timeshift. `available`: some channel the viewer sees has a provider archive
     * (Channel.archiveDays, programme catchUp/startOver); `timeshift` is always present and independent:
     * live plans may carry `live.timeshift` (pause, rewind and go live inside the window). */
    liveCatchUp?: Feature & { maxDays?: number; timeshift: Feature & { maxMinutes?: number } };
    /** Plugin branching levels: GET /libraries/:id/rows?tab= for any recommended tab, and
     * GET /titles/:id/children?role= (or ?level=) with TitleMedia.childCounts. */
    pluginLevels?: Feature & { tabRows?: boolean; childRoles?: boolean };
    /** Subtitle search for a running session: GET /sessions/:id/subtitles/search and
     * POST /sessions/:id/subtitles/:offerId. `languages` are the codes a search accepts
     * (ISO 639-1, or a BCP 47 tag such as pt-BR where a region matters), in the server's order. */
    subtitleSearch?: Feature & { languages: string[] };
    /** Loudness levelling and AutoMix markers: TitleMedia.loudness and PlaybackPlan.loudness. A sub-flag
     * absent or false means that part is never sent: `album` (albumGainDb/albumPeak), `fades`
     * (trim.fadeInEndMs/fadeOutStartMs). Without the feature a client never levels or crossfades by them. */
    loudness?: Feature & { album?: boolean; fades?: boolean } };
  skins: { id: ID; name: string }[]; defaultSkinId: ID;
}
export interface NegotiateRequest extends Mutation { client: ClientCapabilities }
export interface NegotiateResponse { capabilities: ServerCapabilities; client: ClientCapabilities }
export interface Viewer { id: ID; name: string; policyRevision: string; avatar?: ArtworkRef }
export interface Tokens { accessToken: string; refreshToken: string; expiresAt: Timestamp; viewer: Viewer }
export interface PlexHomeProfile {
  id: ID; name: string; protected: boolean;
  /** Short-lived Ether URL usable during the unsigned selection challenge; never a Plex token URL. */
  avatarUrl?: string;
  /** Plex managed/restricted user. Absent when the server cannot determine it. */
  restricted?: boolean;
}
export interface PlexHomeSelection { selectionToken: string; expiresAt: Timestamp; profiles: PlexHomeProfile[] }
export type PlexAccountSignIn = Tokens | PlexHomeSelection;
export interface PlexHomeChallengeRequest extends Mutation { device: Device }
export interface PlexHomeSignInRequest extends Mutation { selectionToken: string; profileId: ID; pin?: string; device: Device }
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
/** What a library holds (docs/media-kinds.md). Clients read an unknown value as 'video'. */
export type MediaClass = 'video' | 'music' | 'audiobook' | 'book' | 'podcast' | 'photo';
/** What one level of a kind is. Clients read an unknown value as 'item'. */
export type MediaRole = 'item' | 'artist' | 'album' | 'track' | 'series' | 'book' | 'audiobook' | 'part' | 'show' | 'episode' | 'collection';
export type ReadingFormat = 'epub' | 'pdf' | 'cbz';
export type MediaCreditRole = 'artist' | 'albumArtist' | 'author' | 'narrator' | 'composer' | 'illustrator' | 'translator' | 'host';
/** A track's measured (or provider-hinted) loudness (features.loudness), ReplayGain 2.0 style: the gain
 * that brings it to `reference` LUFS. Peaks are linear true peak (1.0 = 0 dBTP). A `provider` hint carries
 * trackGainDb only; album values come once every track of the album is measured. */
export interface Loudness {
  trackGainDb: number; trackPeak?: number; albumGainDb?: number; albumPeak?: number;
  /** Integrated loudness, LUFS. */ lufs?: number; /** The gain's target, LUFS (-18). */ reference: number;
  source: 'measured' | 'provider';
  /** Milliseconds into the file: silence (below -60 dBFS) ends at startMs and starts at endMs; with
   * features.loudness.fades, the intro reaches full level at fadeInEndMs and the outro leaves it for
   * good at fadeOutStartMs (momentary loudness within 10 LU of integrated). */
  trim?: { startMs: number; endMs: number; fadeInEndMs?: number; fadeOutStartMs?: number };
}
/** A title's media class, role and structure. Title.kind keeps the movie/show/season/episode projection. */
export interface TitleMedia {
  /** A plugin level's own role is free text (a video child's 'concert'); clients read an unknown one as 'item'. */
  class: MediaClass; role: MediaRole | (string & {});
  /** Position inside the parent: track number, book number in a series, part number. */ index?: number;
  /** Disc or volume, for multi-disc albums. */ disc?: number;
  /** Ancestors, nearest first: a track's [album, artist]; a book's [series]. */ parents?: { id: ID; name: string; role: MediaRole }[];
  /** Direct children: tracks on an album, albums by an artist, books in a series. */ childCount?: number;
  /** Direct children per child level (features.pluginLevels): keyed by the level's role, or its key
   * when it has none, e.g. an artist's { album: 42, concert: 7 }. Children of one key are read with
   * GET /titles/:id/children?role=<key>. */ childCounts?: Record<string, number>;
  /** personId is the plugin's people-facet person, so /people/:id opens. */
  credits?: { name: string; role: MediaCreditRole | string; personId?: ID }[];
  /** Readable documents only. */ reading?: { format: ReadingFormat; pages?: number };
  /** Plain facts a page shows as written (label, publisher, ISBN). */ facts?: { label: string; value: string }[];
  /** Recording identity (ISRC or fingerprint) shared by every release of one recording (features.duplicates). */
  recordingId?: string;
  /** Tracks (features.loudness): for pages and levelling decisions; PlaybackPlan.loudness is authoritative. */ loudness?: Loudness;
  /** Beats per minute, when the provider knows it. */ bpm?: number;
}
/** Opaque locator (EPUB CFI, page index) plus the share of the whole document; shared Ether watch state. */
export interface ReadingProgress { locator: string; fraction: number; label?: string; updatedAt: Timestamp }
export interface WatchState { positionSeconds: number; played: boolean; favorite: boolean; watchlisted: boolean; notInterested?: boolean; thumbsUp?: boolean; /** Most recent viewing activity, RFC3339. */ lastViewedAt?: Timestamp;
  /** Readable titles: where the viewer is. fraction >= 0.98 marks the title played. */ reading?: ReadingProgress }
/** Actual server-sourced rating; scale is the maximum possible value. */
export interface TitleRating { source: string; kind: 'critic' | 'audience'; value: number; scale: number; state?: string; votes?: number; url?: string }
export interface ThemeMusic { url: string; expiresAt: Timestamp; durationSeconds?: number;
  /** Measured integrated loudness in LUFS; omitted when unmeasured. */ loudness?: number }
export interface Title {
  id: ID; kind: TitleKind; name: string; summary: string; year?: number; /** Original air/release date, YYYY-MM-DD. */ airDate?: string; dateDisplay?: 'date'; genres: string[];
  durationSeconds?: number; rating?: string;
  /** The country `rating` is from (ISO 3166-1 alpha-2), when the server knows it; optional. */ ratingCountry?: string;
  ratings?: TitleRating[]; artwork: ArtworkRef[]; watch?: WatchState; themeMusic?: ThemeMusic;
  showId?: ID; showName?: string; seasonId?: ID; seasonNumber?: number; episodeNumber?: number;
  /** Media class, role and relations; omitted for video by servers that predate it. */ media?: TitleMedia;
}
/** Where an extra comes from, when the server knows: `youtube` (a TMDB trailer). Omitted otherwise. */
export type ExtraSource = 'youtube';
/** An extra the client may play itself, in YouTube's privacy-enhanced embed. `embedUrl` is exactly
 * `https://www.youtube-nocookie.com/embed/<videoId>`, and `videoId` is YouTube's 11-character id. */
export interface ExtraClientPlayback { provider: 'youtube'; videoId: string; embedUrl: string }
export interface Extra { id: ID; parentId: ID; kind: 'trailer' | 'clip' | 'featurette' | 'other'; name: string;
  durationSeconds?: number; artwork?: ArtworkRef; cachedPlayback?: { status: 'ready'; url: string; expiresAt: Timestamp };
  /** The server-played option (POST /playback extraId), also the fallback when an embed fails. */
  availability: 'ready' | 'unresolved' | 'unavailable';
  source?: ExtraSource;
  /** Only when features.trailerEmbed allows client embeds and this is a YouTube trailer or teaser with a valid id. */
  clientPlayback?: ExtraClientPlayback }
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
export type RowEntry = { id: ID; receiptToken: string; /** Stable playlist member identity when read from playlist contents. */ entryId?: ID } & (
  { kind: 'title'; title: Title; role?: string } | { kind: 'person'; person: LibraryPersonEntry['person']; itemCount: number } | { kind: 'channel'; channel: Channel } |
  { kind: 'collection' | 'playlist' | 'directory'; name: string; artwork: ArtworkRef[]; targetId: ID; itemCount?: number });
export type RowPurpose = 'continue' | 'nextUp' | 'recent' | 'recentlyReleased' | 'recentlyAdded' | 'collection' | 'recommendation' | 'live' | 'watchlist'
  | 'recentContexts' | 'liked';
/** How a row draws (Ether's Recommendations pages). Unknown values draw as `standard`. */
export type RowLayout = 'standard' | 'hero' | 'wide' | 'tiles' | 'tracks';
/** The card a row's items draw with; on library pages Ether falls back to the library's card. Unknown values: the skin's default. */
export type RowCard = 'poster' | 'landscape' | 'square' | 'round';
export type RowExperience = 'watch' | 'listen' | 'read' | 'gallery' | 'live';
/** A row of titles (Home, a library's rows tab, /rows). Each presentation field is sent only when set. */
export interface Row { id: ID;
  /** Opaque, and the same row across bootstraps, /rows, /rows/{id} and library rows (its id changes with the
   * row-view snapshot; a superseded id answers 409 cursor_expired). Compared, never parsed. Not on surface rows. */
  key?: ID;
  name: string; purpose: RowPurpose;
  receiptToken: string; presentation?: 'ranked'; previewOnFocus?: boolean; items: RowEntry[]; nextCursor?: Cursor; continuation: 'more' | 'exhausted' | 'unknown';
  /** `tracks`: the items are track leaves with a duration and an album or artist parent (title.media.parents). */
  layout?: RowLayout; card?: RowCard;
  /** The items' media role (movie, show, episode, album, artist, track, playlist, audiobook, book, collection, channel, …). */
  role?: string;
  /** The titles differ per viewer. */ personal?: true;
  /** The library of a one-row-per-library row. */ library?: ID;
  experience?: RowExperience }
export type HeroReason = 'resume' | 'nextEpisode' | 'newRelease' | 'forYou' | 'trending' | 'featured';
export interface HeroAction { kind: 'resume' | 'play' | 'details'; titleId: ID; positionSeconds?: number }
export interface Hero { title: Title; receiptToken: string; reason: HeroReason; action: HeroAction;
  /** Short supporting/reason text, not the primary action button label. */
  label?: string; previewOnFocus?: boolean; trailer?: Extra }
export interface Bootstrap { viewer: Viewer; capabilities: ServerCapabilities; defaultSkinId: ID; heroes?: Hero[];
  /** Feed rows, and `surface` rows (a plugin's homeRow surface) in page order. */ rows: (Row | SurfaceRow)[]; nextCursor?: Cursor;
  /** Plugin screens the viewer may open, as top-level sections after Live TV. An entry without a
   * `document` is not drawn. */ navigation?: ScreenNavigationEntry[];
  /** Plugin surfaces this client may show (player overlays, toasts, Home rows, title panels), filtered, capped and ordered by Ether. */
  surfaces?: SurfaceContribution[] }
export interface RowsQuery { cursor?: Cursor; limit?: number; placement?: 'home' | 'detail' | 'library'; titleId?: ID; libraryId?: ID }
/** `auto` (only with features.unifiedSearch): one ranked list; the server decides when description matches lead. */
export interface SearchRequest extends Mutation, SearchOptions { query: string; generation: number; mode: 'fast' | 'descriptive' | 'auto'; cursor?: Cursor; limit?: number }
export interface LiveSearchResults { channels: Channel[]; programmes: Programme[]; programmeChannels?: Channel[] }
export interface DescriptiveSearchState { state: 'ready' | 'pending' | 'partial' | 'busy' | 'failed'; retry?: { allowed: boolean; afterSeconds?: number } }
export interface SearchResponse extends Page<Title> { query: string; generation: number; receiptToken?: string; live?: LiveSearchResults; descriptive?: DescriptiveSearchState;
  /** `auto` mode: what the one list matched. */
  match?: 'title' | 'description' | 'mixed' | 'none';
  /** `auto` mode: `pending` while slower lookups (remote catalogues, description matching) still run;
   * ask again with the same query and generation, after `retry.afterSeconds`, and replace the list. */
  state?: 'complete' | 'pending'; retry?: { allowed: boolean; afterSeconds?: number } }
export interface AISearchRequest extends Mutation { query: string; generation: number; previousJobId?: ID }
export interface AISearchJob { id: ID; generation: number; status: 'queued' | 'running' | 'partial' | 'complete' | 'cancelled' | 'failed';
  /** Required for partial: provisional results replaced by the final response. */
  results?: SearchResponse; error?: ProtocolError }
export interface CancelRequest extends Mutation { generation: number }
export interface Interaction { receiptToken: string; kind: 'visible' | 'selected' | 'played'; occurredAt: Timestamp;
  /** Visible means actually in the visible viewport; never merely prefetched. */
  visibleMilliseconds?: number; sessionId?: ID }
export interface InteractionsRequest extends Mutation { interactions: Interaction[] }
/** External `ass`: the authored ASS/SSA file itself (styles, positions, effects), offered only to a
 * client whose `subtitleFormats` names the track's codec; otherwise the same track is WebVTT. */
export type SubtitleDelivery = { kind: 'external'; format: 'webvtt' | 'webvtt-window' | 'ass'; url: string } |
  { kind: 'embedded' } | { kind: 'burn-in' };
export interface Track { streamIndex?: number; id: ID; kind: 'audio' | 'subtitle'; language: string; name: string; codec: string;
  channels?: number; forced?: boolean; hearingImpaired?: boolean; default?: boolean; url?: string;
  /** Subtitle delivery only; streamIndex remains the full source stream index. */
  delivery?: SubtitleDelivery }
/** One subtitle a search found: a file from a subtitle site, or a track Ether makes (aiTranslated). */
export interface SubtitleOffer { id: ID; language: string; name: string; provider: string;
  format?: string; author?: string; downloads?: number;
  /** 0 to 10, as the subtitle site rates it. */ rating?: number;
  /** Made for this release (a file hash or release-name match). */ releaseMatch?: boolean;
  hearingImpaired?: boolean; forced?: boolean;
  /** Ether translates the title's own subtitles with its language model once chosen. */ aiTranslated?: boolean }
/** GET /sessions/:id/subtitles/search?language= (features.subtitleSearch). Without `language` the
 * server searches the viewer's first preferred subtitle language; `language` says what it searched. */
export interface SubtitleSearchResponse { language: string; offers: SubtitleOffer[];
  /** The viewer's subtitle languages, most preferred first; listed first in a language picker. */
  preferredLanguages?: string[] }
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
export interface VersionItem {
  id: ID; label: string; recommended: boolean; remembered?: true; pinned?: true;
  resolution?: '4K' | '1080p' | '720p' | '576p' | '480p' | 'SD';
  dynamicRange?: 'sdr' | 'hdr10' | 'hdr10+' | 'hlg' | 'dv'; videoCodec?: string;
  audio?: { codec: string; channels?: string; atmos?: true };
  source?: 'Remux' | 'Blu-ray' | 'WEB-DL' | 'WEBRip' | 'HDTV' | 'DVD' | 'Local';
  edition?: string; sizeBytes?: number; languages?: string[];
  availability: 'instant' | 'cached' | 'fetch' | 'unavailable'; note?: string;
}
export interface RememberedVersionChoice { scope: 'title' | 'show'; active: boolean; label: string }
export interface TitleVersions { titleId: ID; selectedVersionId: ID | null; rememberedChoice?: RememberedVersionChoice; versions: VersionItem[] }
export interface ClearVersionChoiceRequest extends Mutation { scope?: 'all' | 'title' | 'show' }
export interface ClearVersionChoiceResponse extends TitleVersions { cleared: boolean }
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
/** A stretch of a title the viewer may skip, on the plan's timeline: the opening titles, or credits.
 * `final` (credits only): the last credits, running to the end of the title. */
export interface SkipMarker { kind: 'intro' | 'credits'; startSeconds: number; endSeconds: number; final?: boolean }
export interface PlaybackPlan extends Generations { sessionId: ID; revision: number; titleId?: ID; channelId?: ID; extraId?: ID; libraryId?: ID; liveItemId?: ID; title?: string; purpose?: 'playback' | 'preview';
  state: 'ready' | 'playing' | 'paused' | 'recovering' | 'ended'; positionSeconds: number; durationSeconds?: number;
  /** Audio-only plans say so; omitted: 'video'. */ media?: 'video' | 'audio';
  /** features.loudness: measured on the exact source this plan plays; omitted when unmeasured. */ loudness?: Loudness;
  paths: PlaybackPath[]; selectedPathId: ID; audioTracks: Track[]; subtitleTracks: Track[];
  selectedAudioTrackId?: ID; selectedSubtitleTrackId: ID | null; chapters: Chapter[]; fallback: Fallback;
  /** Also carried by SessionSnapshot.plan and full plan events. */
  trickplay?: TrickplayMetadata;
  /** Intro and credits ranges, sorted by start; never empty (omitted when unknown). */
  markers?: SkipMarker[];
  qualityLimitations?: { height: number; reason: string }[];
  selectedVersionId?: ID; versions?: VersionItem[]; rememberedChoice?: RememberedVersionChoice;
  /** The release actually playing: its versions-row id, or null when it has no row (Auto
   * resolving to a release the menu does not list); with its label ("1080p WEB-DL · DD+ 5.1 ·
   * 4.2 GB"). selectedVersionId stays the viewer's choice (the Auto row's id when Auto was
   * chosen). Absent when nothing plays or the server does not say; a mid-stream failover to
   * another release publishes a plan of a higher revision. */
  playingVersionId?: ID | null; playingLabel?: string;
  /** Why the selected release cannot produce another source. `version_unavailable` keeps an
   * explicit version pick pinned; clients offer the version picker at the held position. */
  sourceFailure?: 'version_unavailable';
  livePolicy?: { latencyProfile: 'auto' | 'low' | 'stable'; targetLatencySeconds: number };
  /** A live channel, or a start-over plan (`mode: 'startOver'`, a growing programme from its start: window
   * start 0, a growing edge). Positions and the window share the plan's timeline. */
  live?: { mode: 'adaptive' | 'low-delay' | 'startOver'; anchor?: LiveAnchor; windowStartSeconds?: number; liveEdgeSeconds?: number; maxDriftSeconds?: number;
    /** The server's view of how far the viewer is behind the live edge. */ behindLiveSeconds?: number;
    /** Wall-clock time of liveEdgeSeconds when the plan was issued; the edge grows in real time from it. */ edgeAt?: Timestamp;
    /** Present when the session has a rewind window: pause, seek inside the window and goLive. */ timeshift?: { maxMinutes: number } };
  /** A programme from the provider's archive (catch-up or start over). Such a plan has no top-level
   * channelId; a finite catch-up plays as on-demand media with positions relative to startAt. */
  catchUp?: { channelId: ID; programmeId?: ID; startAt: Timestamp; endAt?: Timestamp } }
export type PlaybackTarget = { titleId: ID; channelId?: never; extraId?: never } |
  { channelId: ID; titleId?: never; extraId?: never; /** features.liveCatchUp: an archived programme (ended), or with
   * from 'start' the programme on air from its beginning. */ programmeId?: ID; from?: 'start';
    /** features.liveCatchUp: an explicit archive range instead of a programme. */ startAt?: Timestamp; durationSeconds?: number } |
  { extraId: ID; titleId?: never; channelId?: never };
/** What a play started from, for Recently played (features.playContexts): a title (album, artist), a playlist, or a liked list by role. */
export interface PlayContext { kind: 'title' | 'playlist' | 'favorites'; id: string }
export type PlaybackRequest = Mutation & PlaybackTarget & { client: ClientCapabilities; positionSeconds?: number; mediaSourceId?: ID; context?: PlayContext;
  versionId?: ID; audioTrackId?: ID; subtitleTrackId?: ID | null; allowTranscode?: boolean; liveMode?: 'adaptive' | 'low-delay';
  /** A live-channel tile of a multiview group (features.multiview). */ multiview?: MultiviewTile;
  /** features.queuedPlayback: the next queued track, opened ahead of time (gapless). It leaves the
   * device's playing session alone until it is first observed playing; an ordinary request still
   * supersedes it, and a newer queued one replaces an older unplayed one. */ queued?: boolean };
export type SessionCommand = Mutation & Generations & (
  { kind: 'seek'; positionSeconds: number } | { kind: 'pause' | 'resume' | 'stop' } |
  /** A live session jumps to the live edge; a start-over session switches to the channel's live session. */
  { kind: 'goLive' } |
  { kind: 'tracks'; audioTrackId?: ID; subtitleTrackId?: ID | null } |
  { kind: 'switch'; pathId: ID; atSeconds: number } | { kind: 'version'; versionId: ID; positionSeconds?: number } | { kind: 'prepare-fallback'; maxBitrate: number } |
  /** A multiview tile's new height (spec B): the same session is replanned; its old output plays until the
   * new plan is ready, and the answer is the unchanged plan when the source cannot go higher. */
  { kind: 'replan'; maxHeight: number });
export interface TimeRange { startSeconds: number; endSeconds: number }
export interface PlayerObservation extends Mutation, Generations { sequence: number; observedAt: Timestamp;
  positionSeconds: number; state: 'playing' | 'paused' | 'buffering' | 'ended'; playableRanges: TimeRange[];
  throughputBps?: number; droppedFrames?: number; totalFrames?: number; selectedPathId: ID;
  audioTrackId?: ID; subtitleTrackId?: ID | null; transferredBytes?: number;
  error?: { class: 'source' | 'decoder' | 'transient'; message: string } }
export interface SessionSnapshot extends PlayingRelease { cursor: Cursor; revision: number; plan: PlaybackPlan;
  /** Server publication does not prove transfer, accepted buffer, or playback progress. */
  publishedRanges: TimeRange[]; lastObservationSequence?: number;
  /** The live event on air on a live channel; null when none matches. Also streamed as `event: liveEvent`. */
  liveEvent?: LiveEventRef | null }
/** The release playing, as a session snapshot or event may also carry it at its top level (PlaybackPlan.playingVersionId). */
export interface PlayingRelease { playingVersionId?: ID | null; playingLabel?: string }
export type SessionEvent = { cursor: Cursor; revision: number; sessionId: ID } & PlayingRelease & (
  { type: 'snapshot'; snapshot: SessionSnapshot } | { type: 'plan'; plan: PlaybackPlan } |
  { type: 'error'; error: ProtocolError } | { type: 'ended'; reason: string });
export interface ProtocolError { class: 'auth' | 'policy' | 'not-found' | 'source' | 'decoder' | 'playback' | 'capacity' | 'transient' | 'request' | 'conflict';
  code: string; message: string; retry: { allowed: boolean; afterSeconds?: number; maxAttempts?: number };
  requestId?: ID; currentGenerations?: Generations;
  /** Archive and rewind bounds included with section C6 playback refusals. */
  archiveDays?: number; earliestAt?: Timestamp; windowStartSeconds?: number; liveEdgeSeconds?: number;
  suggest?: { maxChannels: number; maxWindowMinutes: number };
  /** Attempted delivery labels (not path IDs) and human-readable diagnostics. */
  rejectedPaths?: { path: string; reasons: string[] }[];
  /** Typed facts for some codes: `provider_connection_cap` carries ProviderCapDetails. */
  details?: ProviderCapDetails | Record<string, unknown> }
export interface ErrorResponse { error: ProtocolError }
export interface LiveGuide { id: ID; name: string }
export interface Channel { id: ID; number: string; name: string; kind: string; artwork: ArtworkRef[]; favorite: boolean; rating?: string; group?: string; guides?: LiveGuide[];
  /** Days of provider archive (features.liveCatchUp); absent: none. */ archiveDays?: number }
export interface Programme { id: ID; channelId: ID; name: string; summary: string; start: Timestamp; end: Timestamp;
  titleId?: ID; episodeTitle?: string; seasonNumber?: number; episodeNumber?: number; artwork: ArtworkRef[]; rating?: string; genres?: string[];
  /** Hints from the server, absent when false: ended and inside the archive (catchUp), or on air with its
   * start inside the archive (startOver). Clients recompute from archiveDays as time passes. */
  catchUp?: boolean; startOver?: boolean }
export interface GuideQuery { from: Timestamp; until: Timestamp; channelIds?: ID[]; cursor?: Cursor; limit?: number }
export interface GuideResponse extends Page<Programme> { from: Timestamp; until: Timestamp }
export interface GuideWindowRequest { channelIds: ID[]; from: Timestamp; until: Timestamp }
export interface GuideWindowResponse {
  from: Timestamp; until: Timestamp; revision: string; validUntil: Timestamp;
  channels: { channelId: ID; state: 'ready' | 'unavailable'; programmes: Programme[]; archiveDays?: number }[];
}
export interface ExtrasResponse extends PartialAnswer { items: Extra[] }
export interface ChildrenPage extends Page<Title>, PartialAnswer {}
/** One-use console Watch hand-off; redeem against the same Ether instance. */
export interface WebCodeRedeemRequest extends Mutation { code: string; device: Device }

/** `client`: the device's playback capabilities, as on PlaybackRequest, so the server grants an original it can play. */
export interface DownloadRequest extends Mutation { versionId?: ID; client?: ClientCapabilities }
export interface DownloadGrant {
  url: string; mimeType: string; container: string; byteLength?: number;
  /** Stable file identity, shared by fresh tickets for the same original. */
  etag: string; expiresAt: Timestamp; sourceId?: ID; originalVideo?: OriginalVideo;
  audioTracks: Track[]; subtitleTracks: Track[]; chapters: Chapter[]; markers?: SkipMarker[];
}
export interface OfflineWatchRequest extends Mutation {
  positionSeconds: number; observedAt: Timestamp; offline: true; played?: true;
}
export interface WatchResponse extends Ack { watch?: WatchState }
export interface WatchRequest extends Mutation { played?: boolean; favorite?: boolean; watchlisted?: boolean; continueWatching?: false; notInterested?: boolean; thumbsUp?: boolean }

export interface Collection { id: ID; kind: 'collection' | 'playlist' | 'directory'; name: string; summary?: string; artwork: ArtworkRef[];
  /** Playlist-only fields. */ smart?: boolean; entryCount?: number; updatedAt?: Timestamp }
export interface CollectionContents extends Page<RowEntry> { collection: Collection }

/** One page of a viewer's likes of one role, newest first (or the viewer's own order). */
export interface FavoriteTitlesPage extends Page<{ id: ID; kind: 'title'; title: Title; likedAt: Timestamp; receiptToken: string }> { total: number }
/** GET /recent: what the viewer last played from, newest first. */
export interface RecentPlayContexts { items: ({ kind: 'title'; title: Title; playedAt: Timestamp } | { kind: 'playlist'; playlist: PlaylistCard; playedAt: Timestamp } | { kind: 'favorites'; role: string; playedAt: Timestamp })[] }
/** A playable title's lyrics: timed lines when the source has them, else plain text. */
export interface TitleLyrics { lines: { startMs: number; text: string }[]; plain?: string; instrumental: boolean; source?: string }
export interface PlaylistCard { id: ID; kind: 'playlist'; name: string; artwork: ArtworkRef[]; itemCount: number; smart: boolean; updatedAt: Timestamp; summary?: string }
export interface CreatePlaylistRequest extends Mutation { name: string; titleIds?: ID[] }
/** Name and/or description (Ether 0.3.21+ accepts summary). */
export interface RenamePlaylistRequest extends Mutation { name?: string; summary?: string }
export interface AddPlaylistEntriesRequest extends Mutation { titleIds: ID[] }
export interface MovePlaylistEntryRequest extends Mutation { afterEntryId: ID | null }
export interface PlaylistEntryCount { entryCount: number }
export interface TitlePlaylistMembership { id: ID; name: string; smart: boolean; entryIds: ID[] }
export interface TitlePlaylists { items: TitlePlaylistMembership[] }

/** One entry in a period listening recap (features.historyRecap). */
export interface RecapEntry { title: Title; plays: number; minutes: number }
/** GET /history/recap?period=week|month|year|all&at=YYYY-MM-DD&library=<id> (features.historyRecap). */
export interface HistoryRecap {
  period: HistoryRecapPeriod; from: Timestamp; to: Timestamp;
  minutes: number; plays: number; distinctTracks: number; distinctArtists: number;
  /** Up to 10 each, ordered by plays descending. */
  topArtists: RecapEntry[]; topTracks: RecapEntry[]; topAlbums: RecapEntry[];
  /** Consecutive days with at least one play. */
  streak: { current: number; longest: number };
  /** Every day in the period, zeros included (year: 365 entries), YYYY-MM-DD. */
  byDay: { date: string; minutes: number }[];
  firstPlayAt?: Timestamp; generatedAt: Timestamp;
}

/** Source track metadata parsed from an imported playlist link or file (features.playlistImport). */
export interface ImportSource { title: string; artist: string; album?: string; isrc?: string; durationSeconds?: number }
export interface PlaylistImportMatch { index: number; source: ImportSource; title: Title; by: 'isrc' | 'title' }
export interface PlaylistImportUnmatched { index: number; source: ImportSource; reason: 'not_found' | 'ambiguous'; candidates?: Title[] }
/** GET /playlists/import/:id (features.playlistImport). */
export interface PlaylistImport {
  id: ID; state: 'reading' | 'matching' | 'done' | 'failed'; name: string; description?: string; artwork?: ArtworkRef[];
  total: number; done: number;
  matched: PlaylistImportMatch[];
  unmatched: PlaylistImportUnmatched[];
  error?: string;
  /** The source listed fewer tracks than the playlist holds (Spotify's public embed stops near 100;
   * Ether keeps at most features.playlistImport.maxTracks). `sourceTotal` is the playlist's real
   * count when the source says it (Deezer does, Spotify never). */
  truncated?: boolean; sourceTotal?: number;
}
/** POST /playlists/import (features.playlistImport); returns 202 PlaylistImportJobRef. */
export interface PlaylistImportRequest extends Mutation {
  library: ID;
  url?: string;
  file?: { name: string; format: PlaylistImportFormat; text: string };
}
export interface PlaylistImportJobRef { id: ID }
/** POST /playlists/import/:id/save (features.playlistImport); returns the new PlaylistCard in source order. */
export interface SavePlaylistImportRequest extends Mutation { name?: string; exclude?: number[]; choose?: Record<string, ID> }

/** One duplicate recording group within a library (features.duplicates). */
export interface DuplicateGroup { recordingId: string; count: number; titles: Title[]; preferredTitleId?: ID }
export interface DuplicateGroupsPage extends Page<DuplicateGroup> { total?: number }
/** GET /titles/:id/recording (features.duplicates): every release of that recording, this one included. */
export interface RecordingReleases { recordingId: string; count?: number; preferredTitleId?: ID; titles: Title[] }
/** POST /libraries/:id/duplicates/:recordingId (features.duplicates): viewer-scoped preferred release and optional hidden releases. */
export interface DuplicatePreferenceRequest extends Mutation { preferredTitleId: ID; hideOtherIds?: ID[] }

export type LibrarySort = 'index' | 'server' | 'title' | 'added' | 'released' | 'year' | 'rating' | 'duration' | 'popularity' | 'updated' | 'lastViewed';
export type SortDirection = 'asc' | 'desc';
export type LibraryCard = 'poster' | 'landscape' | 'square';
/** How a client presents a whole library, by name. Vela's experiences: 'watch' (films and TV, the
 * standard library), 'listen' (the audio app: music, audiobooks, podcasts), 'read' (books and comics),
 * 'gallery' (photos and home videos), 'live' (guide, multiview, sports). The set is open: a client
 * draws an id it does not know as 'watch'. Unrelated to `LibraryTab.layout` (grid, list, timeline). */
export type LibraryExperience = 'watch' | 'listen' | 'read' | 'gallery' | 'live' | (string & {});
export interface LibraryTab { /** A library or view tab listing one level (a level key) instead of the root. */ level?: string; search?: boolean; searchPlaceholder?: string; id: string; label: string; kind: 'recommended' | 'library' | 'collections' | 'people' | 'live' | 'view'; layout?: 'grid' | 'list' | 'timeline';
  /** The tab's own card shape for its rows and items, over the library's presentation.card (a recommended tab too, with features.pluginLevels). */ card?: LibraryCard; facet?: string; order?: 'name' | 'count'; sort?: LibrarySort; direction?: SortDirection }
/** All types return discrete value IDs; numeric/date/duration facets may be server-bucketed. */
export interface LibraryFacet { id: string; label: string; type: 'enum' | 'strings' | 'people' | 'int' | 'date' | 'duration'; multi: boolean }
export interface FacetValue { id: string; label: string; count: number }
export interface LibraryBrowseOptions {
  sorts: { id: LibrarySort; directions: SortDirection[] }[];
  defaultSort: LibrarySort; defaultDirection: SortDirection;
  /** Boolean fields declare support; kind lists supported values. */
  filters: { facets?: LibraryFacet[]; kind?: TitleKind[]; genre?: boolean; genres?: string[]; year?: boolean; played?: boolean; favorite?: boolean; collectionId?: boolean };
}
export interface Library { /** Omitted: 'video'. */ media?: MediaClass;
  /** How the library opens (features.libraryExperiences); omitted: chosen by `media` and `kind`. */ experience?: LibraryExperience;
  presentation?: { card: LibraryCard }; dateDisplay?: 'year' | 'date'; tabs?: LibraryTab[]; id: ID; name: string; kind: 'movies' | 'shows' | 'live' | 'mixed'; artwork: ArtworkRef[]; browse: LibraryBrowseOptions }
export interface LibrariesQuery { cursor?: Cursor; limit?: number }
export interface LibraryBrowseQuery extends LibrariesQuery {
  tab?: string; query?: string; facets?: Record<string, string[]>;
  sort?: LibrarySort; direction?: SortDirection; kind?: TitleKind; genre?: string; year?: number; played?: boolean; favorite?: boolean; collectionId?: ID;
}
export interface LibraryContents extends Page<RowEntry> {
  library: Library; sort: LibrarySort; direction: SortDirection;
  /** Titles matching the whole query (all pages), when the server counts them; optional. */
  total?: number;
}
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
export interface ReadingRequest extends Mutation {}
/** A short-lived, range-capable document URL (Ether's kind-media ticket); fetched without the bearer. */
export interface ReadingGrant { titleId: ID; format: ReadingFormat; mimeType: string; url: string; expiresAt: Timestamp; byteLength?: number; progress?: ReadingProgress }
/** observedAt: when the reader was there (client clock). The server keeps the newest observed write, clamping
 * observedAt to its own time + 5 min; a write without it is accepted on arrival. */
export interface ReadingProgressRequest extends Mutation { locator: string; fraction: number; label?: string; observedAt?: Timestamp }
