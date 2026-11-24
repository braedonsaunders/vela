import type * as V from '../wire';
import type { SkinDocument } from '../wire';
import type { EventHandler } from '../protocol/sse';
import type { ServerAdapter } from './index';
import type { ScreenTarget } from '../screens/keys';
import type { ScreenStreamQuery } from '../screens/stream';

export interface MediaVersion { id: string; name: string; audioTrackId?: string }
export interface TitleActions {
  watched: boolean;
  favorite: boolean;
  watchlist: boolean;
  removeFromContinue: boolean;
  watch: V.WatchState;
  versions: MediaVersion[];
}
/** Viewer-specific title mutations. Each independently advertised boolean hides unsupported UI. */
export interface TitleManagement {
  titleActions(id: string): Promise<TitleActions>;
  setTitleWatch(id: string, request: V.WatchRequest): Promise<V.Ack | void>;
}
export function hasTitleManagement(api: ServerAdapter): api is ServerAdapter & TitleManagement {
  return 'titleActions' in api && typeof api.titleActions === 'function'
    && 'setTitleWatch' in api && typeof api.setTitleWatch === 'function';
}

/*
 * Optional capabilities. An adapter implements one only when its server really offers it, and
 * callers find it by presence with the guards below. A feature only one server has (today,
 * usually Ether) belongs here as a new capability, never as a core obligation.
 */

export interface PasswordSignIn {
  signInWithPassword(request: V.SignInRequest): Promise<V.Tokens>;
}

/** One-time codes that hand a session to another origin of the same server. */
export interface WebCodeSignIn {
  issueWebCode(request: V.WebCodeIssueRequest): Promise<V.WebCodeIssueResponse>;
  redeemWebCode(request: V.WebCodeRedeemRequest): Promise<V.Tokens>;
}

/** A code shown here and approved at a verification address. */
export interface DeviceGrantSignIn {
  startDeviceGrant(request: V.DeviceGrantRequest): Promise<V.DeviceGrant>;
  pollDeviceGrant(request: V.DevicePollRequest): Promise<V.GrantPoll>;
}

/** A code shown here and approved by a signed-in session of the same server. */
export interface QuickConnectSignIn {
  startQuickConnect(request: V.DeviceGrantRequest): Promise<V.QuickConnect>;
  pollQuickConnect(request: V.QuickPollRequest): Promise<V.GrantPoll>;
}

/** The server tailors plans to the client's declared media capabilities. */
export interface ClientDeclaration {
  declareClient(request: V.NegotiateRequest): Promise<void>;
}

/** One ranked search list (`mode: 'auto'`): titles first, description matches as the server's fallback. */
export interface UnifiedSearch {
  searchAuto(request: Omit<V.SearchRequest, 'mode'>, signal?: AbortSignal): Promise<V.SearchResponse>;
}

export interface DescriptiveSearch {
  searchByDescription(request: Omit<V.SearchRequest, 'mode'>, signal?: AbortSignal): Promise<V.SearchResponse>;
}

/** Server-provided recommendation rows scoped to a single library. */
export interface LibraryRecommendations {
  /** `tab`: a recommended tab's own shelves, sent only with features.pluginLevels.tabRows. */
  libraryRows(id: string, kind: V.Library['kind'], fresh?: boolean, tab?: string): Promise<(V.Row | V.SurfaceRow)[]>;
  libraryCollections(id: string, cursor?: string, tab?: string, search?: string): Promise<V.Page<V.RowEntry>>;
  libraryGenres(id: string): Promise<{ id: string; label: string }[]>;
}

/** Static live streams exposed inside a content library, separate from Live TV and its guide. */
export interface LibraryLive {
  libraryLive(id: string, query: V.LibraryLiveQuery): Promise<V.LibraryLiveContents>;
  startLibraryLive(id: string, request: V.LibraryLivePlaybackRequest): Promise<V.PlaybackPlan>;
}

export function hasLibraryLive(adapter: ServerAdapter): adapter is ServerAdapter & LibraryLive {
  return 'libraryLive' in adapter && typeof adapter.libraryLive === 'function'
    && 'startLibraryLive' in adapter && typeof adapter.startLibraryLive === 'function';
}

/** A title's children (an artist's albums, an album's tracks, a series' books), page by page. */
export interface TitleChildren {
  /** `role`: one child level's children, sent only with features.pluginLevels.childRoles.
   * `signal` abandons the read (an adapter may ignore it). */
  children(id: string, cursor?: string, limit?: number, role?: string, signal?: AbortSignal): Promise<V.ChildrenPage>;
}
export function hasTitleChildren(adapter: ServerAdapter): adapter is ServerAdapter & TitleChildren {
  return 'children' in adapter && typeof adapter.children === 'function';
}

/** Readable documents (docs/media-kinds.md): a short-lived document URL and shared reading progress. */
export interface Reading {
  openReading(id: string, request: V.ReadingRequest): Promise<V.ReadingGrant>;
  saveReadingProgress(id: string, request: V.ReadingProgressRequest): Promise<V.Ack>;
}
export function hasReading(adapter: ServerAdapter): adapter is ServerAdapter & Reading {
  return 'openReading' in adapter && typeof adapter.openReading === 'function'
    && 'saveReadingProgress' in adapter && typeof adapter.saveReadingProgress === 'function';
}

/** Filmography by server person identifier, optionally within one library. */
export interface PersonFilmography {
  personTitles(id: string, libraryId?: string, cursor?: string): Promise<V.Page<V.RowEntry>>;
}

/** Viewer-owned playlists, present only when both the server feature and adapter methods exist. */
export interface ViewerPlaylists {
  playlists(cursor?: string, limit?: number): Promise<V.Page<V.PlaylistCard>>;
  playlist(id: string, cursor?: string, limit?: number): Promise<V.CollectionContents>;
  createPlaylist(request: V.CreatePlaylistRequest): Promise<V.PlaylistCard>;
  renamePlaylist(id: string, request: V.RenamePlaylistRequest): Promise<V.PlaylistCard>;
  deletePlaylist(id: string, request: V.Mutation): Promise<V.Ack>;
  addPlaylistEntries(id: string, request: V.AddPlaylistEntriesRequest): Promise<V.PlaylistEntryCount>;
  removePlaylistEntry(id: string, entryId: string, request: V.Mutation): Promise<V.Ack>;
  movePlaylistEntry(id: string, entryId: string, request: V.MovePlaylistEntryRequest): Promise<V.Ack>;
  titlePlaylists(titleId: string): Promise<V.TitlePlaylists>;
}

/** A viewer's likes listed by role, and lyrics (features.favoritesList, features.lyrics). */
export interface MusicLibrary {
  favoriteTitles(role: string, cursor?: string, limit?: number): Promise<V.FavoriteTitlesPage>;
  /** Null when the title has none. */
  titleLyrics(id: string): Promise<V.TitleLyrics | null>;
  recentPlayContexts(limit?: number): Promise<V.RecentPlayContexts>;
  /** Empty when the title's source has no continuation. */
  titleContinuation(id: string, limit?: number): Promise<V.Page<V.RowEntry>>;
}

/** Listening recap ("Rewind") across a period and optional library (features.historyRecap). */
export interface HistoryRecap {
  historyRecap(query: { period: V.HistoryRecapPeriod; at?: string; library?: string; tz?: string }): Promise<V.HistoryRecap>;
}
export function hasHistoryRecap(adapter: ServerAdapter): adapter is ServerAdapter & HistoryRecap {
  return 'historyRecap' in adapter && typeof (adapter as unknown as HistoryRecap).historyRecap === 'function';
}

/** Playlist import from external URLs or M3U/CSV files (features.playlistImport). */
export interface PlaylistImports {
  startPlaylistImport(request: V.PlaylistImportRequest): Promise<V.PlaylistImportJobRef>;
  playlistImport(id: string): Promise<V.PlaylistImport>;
  savePlaylistImport(id: string, request: V.SavePlaylistImportRequest): Promise<V.PlaylistCard>;
}
export function hasPlaylistImports(adapter: ServerAdapter): adapter is ServerAdapter & PlaylistImports {
  const a = adapter as unknown as Record<string, unknown>;
  return typeof a.startPlaylistImport === 'function' && typeof a.playlistImport === 'function' && typeof a.savePlaylistImport === 'function';
}

/** What a server's playlist import reads: link sources ("deezer"), file formats, and the most tracks
 * it keeps from one playlist (0 when it states no limit). */
export interface PlaylistImportSources { links: string[]; files: V.PlaylistImportFormat[]; maxTracks: number }
const IMPORT_FORMATS: readonly V.PlaylistImportFormat[] = ['m3u', 'csv'];

/** The sources an advertised features.playlistImport offers, or null when the server offers none.
 * Only what the server lists counts: a missing list offers nothing, unknown formats are dropped. */
export function playlistImportSources(feature: V.ServerCapabilities['features']['playlistImport']): PlaylistImportSources | null {
  if (feature?.available !== true) return null;
  const links = Array.isArray(feature.links)
    ? [...new Set(feature.links.filter((link): link is string => typeof link === 'string').map(link => link.trim().toLowerCase()).filter(Boolean))]
    : [];
  const files = Array.isArray(feature.files) ? IMPORT_FORMATS.filter(format => feature.files.includes(format)) : [];
  const maxTracks = typeof feature.maxTracks === 'number' && Number.isFinite(feature.maxTracks) && feature.maxTracks > 0 ? Math.floor(feature.maxTracks) : 0;
  return { links, files, maxTracks };
}

/** Whether a pasted link could come from one of `links`, by the rule Ether applies before reading it:
 * an http(s) URL whose host names the source ("www.deezer.com" for "deezer"). A link that passes can
 * still be refused by the server, which stays the authority; one that fails cannot be imported. */
export function importLinkFromSources(raw: string, links: readonly string[]): boolean {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return false;
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname) return false;
  const host = url.hostname.toLowerCase();
  return links.some(link => link !== '' && host.includes(link));
}

/** Duplicate recording groups and per-viewer preferred release selection (features.duplicates). */
export interface LibraryDuplicates {
  libraryDuplicates(libraryId: string, cursor?: string, limit?: number): Promise<V.DuplicateGroupsPage>;
  titleRecording(id: string): Promise<V.RecordingReleases>;
  setDuplicatePreference(libraryId: string, recordingId: string, request: V.DuplicatePreferenceRequest): Promise<V.DuplicateGroup>;
}
export function hasLibraryDuplicates(adapter: ServerAdapter): adapter is ServerAdapter & LibraryDuplicates {
  const a = adapter as unknown as Record<string, unknown>;
  return typeof a.libraryDuplicates === 'function' && typeof a.titleRecording === 'function' && typeof a.setDuplicatePreference === 'function';
}

export function hasMusicLibrary(adapter: ServerAdapter): adapter is ServerAdapter & MusicLibrary {
  const a = adapter as unknown as Record<string, unknown>;
  return typeof a.favoriteTitles === 'function' && typeof a.titleLyrics === 'function' && typeof a.recentPlayContexts === 'function';
}

export function hasViewerPlaylists(adapter: ServerAdapter): adapter is ServerAdapter & ViewerPlaylists {
  return ['playlists', 'playlist', 'createPlaylist', 'renamePlaylist', 'deletePlaylist', 'addPlaylistEntries',
    'removePlaylistEntry', 'movePlaylistEntry', 'titlePlaylists'].every(name =>
      name in adapter && typeof (adapter as unknown as Record<string, unknown>)[name] === 'function');
}

export function hasPersonFilmography(adapter: ServerAdapter): adapter is ServerAdapter & PersonFilmography {
  return 'personTitles' in adapter && typeof adapter.personTitles === 'function'
    && (!('supportsPersonFilmography' in adapter) || adapter.supportsPersonFilmography === true);
}

export function hasLibraryRecommendations(adapter: ServerAdapter): adapter is ServerAdapter & LibraryRecommendations {
  return 'libraryRows' in adapter && typeof adapter.libraryRows === 'function'
    && 'libraryCollections' in adapter && typeof adapter.libraryCollections === 'function'
    && 'libraryGenres' in adapter && typeof adapter.libraryGenres === 'function'
    && (!('supportsLibraryRecommendations' in adapter) || adapter.supportsLibraryRecommendations === true);
}

export interface AiSearch {
  startAiSearch(request: V.AISearchRequest): Promise<V.AISearchJob>;
  aiSearchJob(id: string): Promise<V.AISearchJob>;
  cancelAiSearch(id: string, request: V.CancelRequest): Promise<V.AISearchJob>;
}

/** Short muted trailer previews behind a scoped grant. */
export interface TrailerPreviews {
  requestTrailerPreview(titleId: string, request: V.TrailerPreviewRequest): Promise<V.TrailerPreviewResponse>;
  /** The state of a preview already requested; never starts preparation. */
  trailerPreviewState(titleId: string): Promise<V.TrailerPreviewResponse>;
}

export interface Versions {
  titleVersions(id: string): Promise<V.TitleVersions>;
  clearVersionChoice(id: string, request: V.ClearVersionChoiceRequest): Promise<V.ClearVersionChoiceResponse>;
  switchVersion(sessionId: string, command: Extract<V.SessionCommand, { kind: 'version' }>): Promise<V.PlaybackPlan>;
}

export function hasVersions(adapter: ServerAdapter): adapter is ServerAdapter & Versions {
  return 'titleVersions' in adapter && 'clearVersionChoice' in adapter && 'switchVersion' in adapter;
}

/** One trickplay sprite sheet as read, or `unchanged` when the server confirmed the held copy (304). */
export type TrickplaySheet = { bytes: Uint8Array; mimeType: string; etag?: string } | 'unchanged';

/**
 * Scrub thumbnails for a playing session. The offer rides on the plan (`plan.trickplay`); a
 * server whose offer can appear only once the session streams also re-reads it on request.
 */
export interface TrickplaySheets {
  /** Sheet `index` of the session's offer, or null when the server has none (yet). `etag`
   * revalidates a sheet already held. Sheets are private: read with the session's credentials. */
  trickplaySheet(sessionId: string, offer: V.TrickplayMetadata, index: number, etag?: string, signal?: AbortSignal): Promise<TrickplaySheet | null>;
  /** The session's current offer, read again; null when it has none. */
  trickplayOffer?(sessionId: string): Promise<V.TrickplayMetadata | null>;
}
export function hasTrickplaySheets(adapter: ServerAdapter): adapter is ServerAdapter & TrickplaySheets {
  return 'trickplaySheet' in adapter && typeof (adapter as unknown as TrickplaySheets).trickplaySheet === 'function';
}

/** Multiview tile upgrade: a tile's session replanned at a new height (spec B). */
export interface TileReplan {
  replanTile(sessionId: string, command: Extract<V.SessionCommand, { kind: 'replan' }>): Promise<V.PlaybackPlan>;
}
export function hasTileReplan(adapter: ServerAdapter): adapter is ServerAdapter & TileReplan {
  return 'replanTile' in adapter && typeof (adapter as unknown as TileReplan).replanTile === 'function';
}

/** Live timeshift (features.liveCatchUp): a live session to its live edge, a start-over session to live. */
export interface GoLive {
  goLive(sessionId: string, command: Extract<V.SessionCommand, { kind: 'goLive' }>): Promise<V.PlaybackPlan>;
}
export function hasGoLive(adapter: ServerAdapter): adapter is ServerAdapter & GoLive {
  return 'goLive' in adapter && typeof (adapter as unknown as GoLive).goLive === 'function';
}

/** Ranking receipts: what the viewer saw, selected and played. */
export interface Interactions {
  sendInteractions(request: V.InteractionsRequest): Promise<V.Ack>;
}

/** A separate audio rendition for a session whose original audio the client cannot decode. */
export interface AudioFallback {
  createAudioFallback(
    sessionId: string,
    request: V.AudioFallbackRequest,
    signal?: AbortSignal,
  ): Promise<V.AudioFallbackResponse>;
  cancelAudioFallback(sessionId: string, audioId: string, request: V.Mutation, signal?: AbortSignal): Promise<V.Ack>;
}

export type TrackCommand = Extract<V.SessionCommand, { kind: 'tracks' }>;
export type SwitchCommand = Extract<V.SessionCommand, { kind: 'switch' }>;
export type FallbackCommand = Extract<V.SessionCommand, { kind: 'prepare-fallback' }>;

/** Audio and subtitle changes inside a running session. */
export interface TrackChanges {
  changeTracks(sessionId: string, command: TrackCommand): Promise<V.PlaybackPlan>;
}

/** Moving a running session to another of its plan's paths. */
export interface PathSwitching {
  switchPath(sessionId: string, command: SwitchCommand): Promise<V.PlaybackPlan>;
}

/** A lower-bitrate path prepared ahead of need. */
export interface ProactiveFallback {
  prepareFallback(sessionId: string, command: FallbackCommand): Promise<V.PlaybackPlan>;
}

export interface LiveTv {
  channels(cursor?: string, limit?: number): Promise<V.Page<V.Channel>>;
  guide(query: V.GuideQuery): Promise<V.GuideResponse>;
  guideWindow?(query: V.GuideWindowRequest): Promise<V.GuideWindowResponse | null>;
}

/** Server-pushed events: a playback session's changes, and the viewer's (appearance first).
 * Each call is one connection; it resolves when the server closes it and rejects on failure. */
export interface EventStream {
  streamSession(sessionId: string, cursor: string, onEvent: EventHandler, signal?: AbortSignal): Promise<void>;
  streamViewerEvents(onEvent: EventHandler, signal?: AbortSignal): Promise<void>;
}

/** The server's chosen look and the skin documents it distributes. */
export interface Appearance {
  appearance(): Promise<V.Appearance>;
  /** A skin document by its appearance path (`/appearance/skins/...`). */
  skinDocument(path: string): Promise<SkinDocument>;
}

export function hasPasswordSignIn(adapter: ServerAdapter): adapter is ServerAdapter & PasswordSignIn {
  return 'signInWithPassword' in adapter;
}

export function hasWebCodeSignIn(adapter: ServerAdapter): adapter is ServerAdapter & WebCodeSignIn {
  return 'issueWebCode' in adapter && 'redeemWebCode' in adapter;
}

export function hasDeviceGrantSignIn(adapter: ServerAdapter): adapter is ServerAdapter & DeviceGrantSignIn {
  return 'startDeviceGrant' in adapter && 'pollDeviceGrant' in adapter;
}

export function hasQuickConnectSignIn(adapter: ServerAdapter): adapter is ServerAdapter & QuickConnectSignIn {
  return 'startQuickConnect' in adapter && 'pollQuickConnect' in adapter;
}

export function hasClientDeclaration(adapter: ServerAdapter): adapter is ServerAdapter & ClientDeclaration {
  return 'declareClient' in adapter;
}

export function hasDescriptiveSearch(adapter: ServerAdapter): adapter is ServerAdapter & DescriptiveSearch {
  return 'searchByDescription' in adapter;
}

export function hasUnifiedSearch(adapter: ServerAdapter): adapter is ServerAdapter & UnifiedSearch {
  return 'searchAuto' in adapter;
}

export function hasAiSearch(adapter: ServerAdapter): adapter is ServerAdapter & AiSearch {
  return 'startAiSearch' in adapter && 'aiSearchJob' in adapter && 'cancelAiSearch' in adapter;
}

export function hasTrailerPreviews(adapter: ServerAdapter): adapter is ServerAdapter & TrailerPreviews {
  return 'requestTrailerPreview' in adapter && 'trailerPreviewState' in adapter;
}

export function hasInteractions(adapter: ServerAdapter): adapter is ServerAdapter & Interactions {
  return 'sendInteractions' in adapter;
}

export function hasAudioFallback(adapter: ServerAdapter): adapter is ServerAdapter & AudioFallback {
  return 'createAudioFallback' in adapter && 'cancelAudioFallback' in adapter;
}

export function hasTrackChanges(adapter: ServerAdapter): adapter is ServerAdapter & TrackChanges {
  return 'changeTracks' in adapter;
}

export function hasPathSwitching(adapter: ServerAdapter): adapter is ServerAdapter & PathSwitching {
  return 'switchPath' in adapter;
}

export function hasProactiveFallback(adapter: ServerAdapter): adapter is ServerAdapter & ProactiveFallback {
  return 'prepareFallback' in adapter;
}

export function hasLiveTv(adapter: ServerAdapter): adapter is ServerAdapter & LiveTv {
  return 'channels' in adapter && 'guide' in adapter;
}

export function hasEventStream(adapter: ServerAdapter): adapter is ServerAdapter & EventStream {
  return 'streamSession' in adapter && 'streamViewerEvents' in adapter;
}

export function hasAppearance(adapter: ServerAdapter): adapter is ServerAdapter & Appearance {
  return 'appearance' in adapter && 'skinDocument' in adapter;
}

/** Searchable discrete values; adapters without this operation advertise no facets. */
export interface LibraryFacets {
  libraryFacets(id: string, field: string, query?: string, cursor?: string): Promise<V.Page<V.FacetValue>>;
}
export function hasLibraryFacets(adapter: ServerAdapter): adapter is ServerAdapter & LibraryFacets {
  return 'libraryFacets' in adapter && typeof adapter.libraryFacets === 'function';
}
export function supportsLibraryBrowse(adapter: ServerAdapter, library: V.Library): boolean {
  return hasLibraryFacets(adapter) && (library.tabs !== undefined || library.browse.filters.facets !== undefined);
}

/** One data read of a screen page or a surface: the sources to read (all that are not lazy when
 * absent), the page's params and the surface's server context (both sent as `p.<name>`), and the
 * viewer's time zone. */
export interface ScreenDataRead { sources?: string[]; params: Record<string, string>; context?: Record<string, string>; tz: string }

/** Plugin screens and surfaces (docs/plugin-screens.md): documents, per-viewer data, actions and
 * the page topics of `/live/stream`. Every call carries the client's renderer version. */
export interface PluginScreens {
  /** A document by its href (immutable for its `v`; a stale `v` is answered with the current document). */
  screenDocument(href: string, signal?: AbortSignal, fresh?: boolean): Promise<V.ScreenDocument>;
  screenData(target: ScreenTarget, read: ScreenDataRead, signal?: AbortSignal): Promise<V.ScreenData>;
  screenAction(target: ScreenTarget, action: string, request: V.ScreenActionRequest, mutation: V.Mutation): Promise<V.ScreenActionAnswer>;
  setSurfaceSetting(id: string, enabled: boolean, mutation: V.Mutation): Promise<void>;
  /** One connection to `/live/stream` for page topics (and alerts); resolves when the server closes it. */
  streamScreens(query: ScreenStreamQuery, onEvent: EventHandler, signal?: AbortSignal): Promise<void>;
}
export function hasPluginScreens(adapter: ServerAdapter): adapter is ServerAdapter & PluginScreens {
  return ['screenDocument', 'screenData', 'screenAction', 'setSurfaceSetting', 'streamScreens'].every(name =>
    name in adapter && typeof (adapter as unknown as Record<string, unknown>)[name] === 'function');
}

/** Live TV multiview groups: tiles join with PlaybackRequest.multiview and count as one stream. */
export interface Multiview {
  createMultiview(request: V.MultiviewRequest): Promise<V.MultiviewGroup>;
  endMultiview(groupId: string, request: V.Mutation): Promise<unknown>;
}
export function hasMultiview(adapter: ServerAdapter): adapter is ServerAdapter & Multiview {
  return 'createMultiview' in adapter && typeof adapter.createMultiview === 'function'
    && 'endMultiview' in adapter && typeof adapter.endMultiview === 'function';
}
