import type * as V from '../wire';
import type { SkinDocument } from '../wire';
import type { EventHandler } from '../protocol/sse';
import type { ServerAdapter } from './index';

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

export interface DescriptiveSearch {
  searchByDescription(request: Omit<V.SearchRequest, 'mode'>, signal?: AbortSignal): Promise<V.SearchResponse>;
}

/** Server-provided recommendation rows scoped to a single library. */
export interface LibraryRecommendations {
  libraryRows(id: string, kind: V.Library['kind']): Promise<V.Row[]>;
  libraryCollections(id: string, cursor?: string): Promise<V.Page<V.RowEntry>>;
  libraryGenres(id: string): Promise<{ id: string; label: string }[]>;
}

/** Filmography by server person identifier, optionally within one library. */
export interface PersonFilmography {
  personTitles(id: string, libraryId?: string, cursor?: string): Promise<V.Page<V.RowEntry>>;
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
