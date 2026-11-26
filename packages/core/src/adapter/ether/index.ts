import type * as V from '../../wire';
import type { SkinDocument } from '../../wire';
import type { EventHandler } from '../../protocol/sse';
import type { CatalogueSearch, Credentials, Home, ServerAdapter, ServerDescription, TransportCommand } from '../index';
import type {
  AiSearch,
  Appearance,
  AudioFallback,
  ClientDeclaration,
  DescriptiveSearch,
  DownloadResolution,
  MediaDownloads,
  OfflineProgress,
  ResolveDownloadOptions,
  DeviceGrantSignIn,
  EventStream,
  FallbackCommand,
  HistoryRecap,
  Interactions,
  LibraryDuplicates,
  LibraryLive,
  LiveTv,
  Multiview,
  PlaylistImports,
  TileReplan,
  PasswordSignIn,
  PathSwitching,
  PluginScreens,
  ProactiveFallback,
  ScreenDataRead,
  QuickConnectSignIn,
  SwitchCommand,
  TrackChanges,
  TrackCommand,
  TrailerPreviews,
  UnloadRequest,
  UnloadStop,
  Versions,
  WebCodeSignIn,
} from '../capabilities';
import type { OfflineProgressEntry, TitleActions } from '../capabilities';
import type { SubtitleSearch } from '../media-actions';
import { VelaError } from '../errors';
import { EtherTransport } from './transport';
import { randomId } from '../../protocol/id';
import { localeContext } from '../../i18n';
import type { ScreenTarget } from '../../screens/keys';
import { streamSearch, type ScreenStreamQuery } from '../../screens/stream';
import { plexHomeSelection, plexTokens } from './plex';
import { etherSubtitleLanguages, etherSubtitleSearch, SUBTITLE_PREPARE_LIMIT_MS, subtitleRetryDelayMs } from './subtitles';

const CACHED = { cacheable: true };
const BOOTSTRAP_CACHED = { cacheable: true, persistent: true };
/** Past every cache, ours and the platform's (RequestOptions.fresh). */
const FRESH = { fresh: true };
const PUBLIC = { auth: false };
const PUBLIC_CACHED = { auth: false, cacheable: true };

/** How long a title page waits for the first person-page probe before it is drawn without credit links. */
const PERSON_PROBE_WAIT_MS = 1500;

/** Ether speaks the v0 protocol natively, so it offers every capability Vela knows. */
const DESCRIBE_REUSE_MS = 5000;

export class EtherAdapter implements ServerAdapter, PasswordSignIn, WebCodeSignIn, DeviceGrantSignIn,
  QuickConnectSignIn, ClientDeclaration, DescriptiveSearch, AiSearch, TrailerPreviews, Interactions,
  AudioFallback, TrackChanges, PathSwitching, ProactiveFallback, LiveTv, LibraryLive, EventStream, Appearance, Versions,
  Multiview, TileReplan, SubtitleSearch, PluginScreens, HistoryRecap, PlaylistImports, LibraryDuplicates, UnloadStop, MediaDownloads, OfflineProgress {
  private readonly http: EtherTransport;
  private guideWindowLimits: V.ServerCapabilities['liveGuideWindow'];
  private readonly credentials: Credentials;
  supportsPersonFilmography = false;
  supportsLibraryRecommendations = false;
  private personSupport: 'unknown' | 'yes' | 'no' = 'unknown';
  private librarySupport: 'unknown' | 'yes' | 'no' = 'unknown';
  private readonly declaredLibraries = new Map<string, V.Library>();
  private readonly missingPeople = new Set<string>();
  private personProbe: Promise<void> | undefined;

  resetOptionalCapabilities(): void {
    this.guideWindowLimits = undefined;
    this.personSupport = this.librarySupport = 'unknown';
    this.personProbe = undefined;
    this.missingPeople.clear();
    this.declaredLibraries.clear();
    this.supportsPersonFilmography = this.supportsLibraryRecommendations = false;
  }

  /** Probe with a visible library: a 404 here identifies an older collections route. */
  async probeLibraryViews(id: string): Promise<void> {
    if (this.declaredLibraries.get(id)?.tabs) { this.librarySupport = 'yes'; this.supportsLibraryRecommendations = true; return; }
    if (this.librarySupport !== 'unknown') return;
    try {
      await this.http.request('GET', `/libraries/${segment(id)}/collections?limit=1`);
      await this.http.request('GET', `/rows${query({ placement: 'library', libraryId: id, limit: 1 })}`);
      this.librarySupport = 'yes'; this.supportsLibraryRecommendations = true;
    } catch (error) {
      if (error instanceof VelaError && (error.status === 404 || error.status === 405)) { this.librarySupport = 'no'; return; }
      throw error;
    }
  }

  async personDetails(id: string): Promise<V.PersonDetail> {
    return this.http.request<V.PersonDetail>('GET', `/people/${segment(id)}`);
  }
  async personTitles(id: string, libraryId?: string, cursor?: string): Promise<V.Page<V.RowEntry>> {
    return this.http.request<V.Page<V.RowEntry>>('GET', `/people/${segment(id)}/titles${query({ libraryId, cursor })}`, undefined, CACHED);
  }
  /** Every shelf of a library, page by page. A cursor the server has expired mid-read restarts
   * the read once from the first page, uncached, so no shelf is skipped or repeated. */
  async libraryRows(id: string, kind: V.Library['kind'], fresh = false, tab?: string): Promise<(V.Row | V.SurfaceRow)[]> {
    try { return await this.readLibraryRows(id, kind, fresh, tab); }
    catch (error) {
      if (!(error instanceof VelaError && error.status === 409 && error.detail.code === 'cursor_expired')) throw error;
      return this.readLibraryRows(id, kind, true, tab);
    }
  }
  /** `tab` names a recommended tab's own shelves (features.pluginLevels.tabRows); the caller sends it only then. */
  private async readLibraryRows(id: string, _kind: V.Library['kind'], fresh: boolean, tab?: string): Promise<(V.Row | V.SurfaceRow)[]> {
    const tabs = this.declaredLibraries.get(id)?.tabs;
    if (tabs && !tabs.some(tab => tab.kind === 'recommended')) return [];
    const result: (V.Row | V.SurfaceRow)[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let n = 0; n < 100; n++) {
      const page = this.declaredLibraries.get(id)?.tabs
        ? await this.http.request<V.Page<V.Row | V.SurfaceRow>>('GET', `/libraries/${segment(id)}/rows${query({ tab, cursor, limit: 100 })}`, undefined, { ...(fresh ? FRESH : CACHED), headers: this.screenHeaders })
        : await this.rows({ placement: 'library', libraryId: id, cursor, limit: 100 }, fresh);
      result.push(...page.items);
      if (page.continuation !== 'more') return result;
      if (!page.nextCursor || seen.has(page.nextCursor)) throw new Error('Invalid library row continuation');
      cursor = page.nextCursor;
      seen.add(cursor);
    }
    throw new Error('Library rows exceed page limit');
  }
  async libraryCollections(id: string, cursor?: string, tab?: string, search?: string): Promise<V.Page<V.RowEntry>> {
    const tabs = this.declaredLibraries.get(id)?.tabs;
    if (tabs && !tabs.some(candidate => (candidate.kind === 'collections' || candidate.kind === 'people') && (!tab || candidate.id === tab))) return { items: [], continuation: 'exhausted' };
    const response = await this.http.request<V.Page<V.LibraryCollectionEntry | V.LibraryFacetCollection | V.LibraryPersonEntry>>('GET', `/libraries/${segment(id)}/collections${query({ cursor, tab, query: search || undefined, limit: 100 })}`, undefined, CACHED);
    return { ...response, items: response.items.map(item => {
      if ('kind' in item && item.kind === 'person') return { ...item, receiptToken: '' };
      const collection = 'collection' in item ? item.collection : item;
      return { id: item.id, receiptToken: 'receiptToken' in item ? item.receiptToken : '', kind: 'collection' as const, targetId: collection.id, name: collection.name, artwork: collection.artwork, itemCount: collection.itemCount };
    }) };
  }
  async libraryGenres(id: string): Promise<{ id: string; label: string }[]> {
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (let n = 0; n < 100; n++) {
      const page = await this.libraries({ cursor, limit: 100 });
      const library = page.items.find(item => item.id === id);
      if (library) return (library.browse.filters.genres ?? []).map(name => ({ id: name, label: name }));
      if (page.continuation !== 'more') break;
      if (!page.nextCursor || seen.has(page.nextCursor)) throw new Error('Invalid library continuation');
      cursor = page.nextCursor; seen.add(cursor);
    }
    return [];
  }

  /** `rendererVersion`: the skin renderer this client draws (RENDERER_VERSION), sent as
   * X-Vela-Screen-Renderer on bootstrap and every screen call. Without it Ether lists no screens. */
  constructor(private readonly origin: string, credentials: Credentials, capabilityContext: string, onSessionRejected?: () => void, private readonly rendererVersion?: number,
    /** The Studio live preview token while previewing (sent as X-Vela-Screen-Preview: drafts instead of published documents). */
    private readonly screenPreview: () => string | undefined = () => undefined) {
    this.credentials = credentials;
    this.http = new EtherTransport(origin, credentials, capabilityContext, onSessionRejected);
  }

  /** The renderer (Ether lists screens only to a client that says it) and the display language
   * (Ether localises documents and data to its first tag). */
  private get screenHeaders(): Record<string, string> {
    if (!this.rendererVersion) return {};
    const language = localeContext().locale;
    const preview = this.screenPreview();
    return { 'X-Vela-Screen-Renderer': String(this.rendererVersion), ...(language ? { 'X-Vela-Language': language } : {}), ...(preview ? { 'X-Vela-Screen-Preview': preview } : {}) };
  }

  setCapabilityContext(context: string): void {
    this.http.setCapabilityContext(context);
  }

  // Session

  /** Validate a stored session by rotating it before the auth resource presents it (one attempt; the caller paces retries). */
  async validateSession(): Promise<V.Tokens | null> {
    const tokens = await this.credentials.get();
    return tokens ? this.http.refresh(tokens, true) : null;
  }

  /** A revocation the server refuses as expired is retried once with freshly rotated tokens. */
  async revokeSession(request: V.RevokeRequest): Promise<V.Ack> {
    const before = await this.credentials.get();
    const revoke = (body: V.RevokeRequest) =>
      this.http.request<V.Ack>('POST', '/auth/revoke', body, { retryAuth: false });
    try {
      return await revoke(request);
    } catch (error) {
      if (!(error instanceof VelaError) || error.status !== 401 || !before) throw error;
      const rotated = await this.http.refresh(before);
      return revoke({ refreshToken: rotated.refreshToken, idempotencyKey: this.credentials.refreshKey() });
    }
  }

  signInWithPassword(request: V.SignInRequest) {
    return this.http.request<V.Tokens>('POST', '/auth/sign-in', request, PUBLIC);
  }

  issueWebCode(request: V.WebCodeIssueRequest) {
    return this.http.request<V.WebCodeIssueResponse>('POST', '/auth/web-code', request);
  }

  redeemWebCode(request: V.WebCodeRedeemRequest) {
    return this.http.request<V.Tokens>('POST', '/auth/web-code/redeem', request, PUBLIC);
  }

  startDeviceGrant(request: V.DeviceGrantRequest) {
    return this.http.request<V.DeviceGrant>('POST', '/auth/device', request, PUBLIC);
  }

  pollDeviceGrant(request: V.DevicePollRequest) {
    return this.http.request<V.GrantPoll>('POST', '/auth/device/poll', request, PUBLIC);
  }

  startQuickConnect(request: V.DeviceGrantRequest) {
    return this.http.request<V.QuickConnect>('POST', '/auth/quick-connect', request, PUBLIC);
  }

  pollQuickConnect(request: V.QuickPollRequest) {
    return this.http.request<V.GrantPoll>('POST', '/auth/quick-connect/poll', request, PUBLIC);
  }

  async startPlexProfileSwitch(request: V.PlexHomeChallengeRequest): Promise<V.PlexHomeSelection> {
    const answer = await this.http.request<V.PlexAccountSignIn>('POST', '/auth/plex/profiles/challenge', request, { retryAuth: false });
    return plexHomeSelection(this.origin, answer);
  }

  /** Completion revokes the bearer used to create the challenge; save its replacement atomically. */
  completePlexProfileSwitch(request: V.PlexHomeSignInRequest): Promise<V.Tokens> {
    return this.http.replaceSession(async () => {
      const answer = await this.http.request<V.PlexAccountSignIn>('POST', '/auth/plex/profile', request, { auth: false });
      const tokens = plexTokens(answer);
      await this.credentials.set(tokens);
      return tokens;
    });
  }

  // The server and its look

  /** Concurrent and back-to-back reads (sign-in, the server list and the catalogue all ask while a
   * page loads) share one request; a read a few seconds later asks the server again. */
  private description?: { at: number; answer: Promise<V.ServerCapabilities> };
  async describe(): Promise<ServerDescription> {
    const now = Date.now();
    if (!this.description || now - this.description.at > DESCRIBE_REUSE_MS) {
      const answer = this.http.request<V.ServerCapabilities>('GET', '/capabilities', undefined, PUBLIC_CACHED);
      const entry = { at: now, answer };
      this.description = entry;
      answer.catch(() => { if (this.description === entry) this.description = undefined; });
    }
    const answer = await this.description.answer;
    this.guideWindowLimits = answer.liveGuideWindow;
    return answer;
  }

  async viewerLiveFeatures(): Promise<V.ServerCapabilities['features']> {
    const answer = await this.http.request<V.ServerCapabilities>('GET', '/capabilities', undefined, CACHED);
    this.guideWindowLimits = answer.liveGuideWindow;
    return answer.features;
  }

  async declareClient(request: V.NegotiateRequest): Promise<void> {
    const answer = await this.http.request<V.NegotiateResponse>('POST', '/negotiate', request);
    if (answer.capabilities) this.guideWindowLimits = answer.capabilities.liveGuideWindow;
  }

  async appearance(signal?: AbortSignal) {
    return this.http.request<V.Appearance>('GET', '/appearance', undefined, { cacheable: true, auth: !!(await this.credentials.get()), signal });
  }

  async skinDocument(path: string) {
    return this.http.request<SkinDocument>('GET', path, undefined, { cacheable: true, auth: !!(await this.credentials.get()) });
  }

  async titleActions(id: string): Promise<TitleActions> {
    const [detail, capabilities] = await Promise.all([this.detail(id, true), this.describe()]);
    return { watched: true, favorite: true, watchlist: true, removeFromContinue: capabilities.features.removeFromContinue?.available === true, watch: detail.title.watch ?? { positionSeconds: 0, played: false, favorite: false, watchlisted: false }, versions: [] };
  }

  setTitleWatch(id: string, request: V.WatchRequest): Promise<V.Ack> {
    return this.http.request<V.Ack>('POST', `/titles/${segment(id)}/watch`, request);
  }

  async downloadsAvailable(): Promise<boolean> {
    const capabilities = await this.http.request<V.ServerCapabilities>('GET', '/capabilities', undefined, CACHED);
    return capabilities.features.downloads?.enabled === true;
  }

  async resolveDownload(id: string, options?: ResolveDownloadOptions): Promise<DownloadResolution> {
    const { title } = await this.detail(id);
    const request: V.DownloadRequest = {
      idempotencyKey: options?.idempotencyKey ?? randomId(),
      ...(options?.versionId ? { versionId: options.versionId } : {}),
    };
    const grant = await this.http.request<V.DownloadGrant>('POST', `/titles/${segment(id)}/download`, request);
    const origin = new URL(this.origin).origin;
    const url = new URL(grant.url, origin);
    if (url.origin !== origin || url.username || url.password || !/^\/vela\/v0\/download\/[^/]+$/.test(url.pathname)) {
      throw new Error('Invalid original download URL');
    }
    if (typeof grant.etag !== 'string' || !grant.etag.trim() || !Number.isFinite(Date.parse(grant.expiresAt))) {
      throw new Error('The download grant has no valid file identity or expiration');
    }
    const localAsset = (path: string): string | undefined => {
      const asset = new URL(path, origin);
      return asset.origin === origin && !asset.username && !asset.password ? asset.href : undefined;
    };
    const sidecars = grant.subtitleTracks.flatMap(track => {
      if (track.delivery?.kind !== 'external') return [];
      const { format } = track.delivery;
      if ((format !== 'webvtt' && format !== 'ass') || (options?.subtitleFormats && !options.subtitleFormats.includes(format))) return [];
      const url = localAsset(track.delivery.url);
      return url ? [{ trackId: track.id, url, format }] : [];
    });
    const poster = title.artwork.find(art => art.kind === 'poster')?.sizes[0]?.url;
    return {
      ...grant,
      title,
      url: url.href,
      versionId: options?.versionId,
      headers: {},
      selectedAudioTrackId: grant.audioTracks.find(track => track.default)?.id,
      selectedSubtitleTrackId: null,
      sidecars,
      posterUrl: poster ? localAsset(poster) : undefined,
    };
  }

  replayWatchProgress(id: string, entry: OfflineProgressEntry): Promise<V.Ack> {
    const request: V.OfflineWatchRequest = {
      positionSeconds: entry.positionSeconds,
      observedAt: entry.observedAt,
      offline: true,
      idempotencyKey: entry.idempotencyKey,
      ...(entry.completed ? { played: true } : {}),
    };
    return this.http.request<V.Ack>('POST', `/titles/${segment(id)}/watch`, request);
  }

  /** The viewer-level server event stream; its first event is the current appearance. */
  streamViewerEvents(onEvent: EventHandler, signal?: AbortSignal): Promise<void> {
    return this.http.stream('/events', {}, onEvent, signal);
  }

  // Catalogue

  /** A home whose continuation the server has expired is read again without revalidation. */
  async home(fresh = false, signal?: AbortSignal): Promise<Home> {
    try {
      const answer = await this.http.request<V.Bootstrap>('GET', '/bootstrap', undefined, { ...BOOTSTRAP_CACHED, fresh, signal, headers: this.screenHeaders });
      if (answer.capabilities) this.guideWindowLimits = answer.capabilities.liveGuideWindow;
      return answer;
    } catch (error) {
      const expired = error instanceof VelaError && error.status === 409 && error.detail.code === 'cursor_expired';
      if (!expired) throw error;
      const answer = await this.http.request<V.Bootstrap>('GET', '/bootstrap', undefined, { ...FRESH, signal, headers: this.screenHeaders });
      if (answer.capabilities) this.guideWindowLimits = answer.capabilities.liveGuideWindow;
      return answer;
    }
  }

  /** Rows lists may hold plugin surface rows, which Ether sends only to a client that says its renderer. */
  rows(rowsQuery: V.RowsQuery, fresh = false) {
    return this.http.request<V.Page<V.Row | V.SurfaceRow>>('GET', `/rows${query(rowsQuery)}`, undefined, { ...(fresh ? FRESH : CACHED), headers: this.screenHeaders });
  }

  row(id: string, cursor?: string, limit?: number) {
    return this.http.request<V.Row>('GET', `/rows/${segment(id)}${query({ cursor, limit })}`, undefined, CACHED);
  }

  async libraries(librariesQuery: V.LibrariesQuery) {
    const page = await this.http.request<V.Page<V.Library>>('GET', `/libraries${query(librariesQuery)}`, undefined, CACHED);
    for (const library of page.items) {
      this.declaredLibraries.set(library.id, library);
      if (library.tabs?.some(tab => tab.kind === 'people')) { this.personSupport = 'yes'; this.supportsPersonFilmography = true; }
    }
    return page;
  }

  libraryFacets(id: string, field: string, search = '', cursor?: string) {
    return this.http.request<V.Page<V.FacetValue>>('GET', `/libraries/${segment(id)}/facets/${segment(field)}${query({ query: search, cursor, limit: 50 })}`, undefined, CACHED);
  }

  async library(id: string, browse: V.LibraryBrowseQuery, { fresh = false, snapshot = false } = {}) {
    const path = `/libraries/${segment(id)}/items${libraryBrowseQuery(browse)}`;
    let contents: V.LibraryContents;
    try {
      contents = await this.http.request<V.LibraryContents>('GET', path, undefined, fresh ? FRESH : CACHED);
    } catch (error) {
      const expired = browse.cursor && error instanceof VelaError && error.status === 409 && error.detail.code === 'cursor_expired';
      if (!expired || snapshot) throw error;
      // Standalone page readers can restart here. Snapshot readers restart the entire sequence.
      const { cursor: _cursor, ...first } = browse;
      contents = await this.http.request<V.LibraryContents>('GET', `/libraries/${segment(id)}/items${libraryBrowseQuery(first)}`, undefined, FRESH);
    }
    return { ...contents, library: { ...this.declaredLibraries.get(id), ...contents.library } };
  }

  libraryLive(id: string, live: V.LibraryLiveQuery) {
    return this.http.request<V.LibraryLiveContents>('GET', `/libraries/${segment(id)}/live${query(live)}`, undefined, CACHED);
  }

  startLibraryLive(id: string, request: V.LibraryLivePlaybackRequest) {
    return this.http.request<V.PlaybackPlan>('POST', `/libraries/${segment(id)}/live/play`, request);
  }

  collection(id: string, cursor?: string, limit?: number) {
    const path = `/collections/${segment(id)}${query({ cursor, limit })}`;
    return this.http.request<V.CollectionContents>('GET', path, undefined, CACHED);
  }

  favoriteTitles(role: string, cursor?: string, limit?: number) {
    return this.http.request<V.FavoriteTitlesPage>('GET', `/favorites/titles${query({ role, cursor, limit })}`);
  }

  async titleContinuation(id: string, limit?: number): Promise<V.Page<V.RowEntry>> {
    try {
      return await this.http.request<V.Page<V.RowEntry>>('GET', `/titles/${segment(id)}/continuation${query({ limit })}`);
    } catch (error) {
      if (error instanceof VelaError && error.status === 404) return { items: [], continuation: 'exhausted' } as unknown as V.Page<V.RowEntry>;
      throw error;
    }
  }

  recentPlayContexts(limit?: number) {
    return this.http.request<V.RecentPlayContexts>('GET', `/recent${query({ limit })}`);
  }

  historyRecap(recapQuery: { period: V.HistoryRecapPeriod; at?: string; library?: string; tz?: string }) {
    return this.http.request<V.HistoryRecap>('GET', `/history/recap${query(recapQuery)}`);
  }

  startPlaylistImport(request: V.PlaylistImportRequest) {
    return this.http.request<V.PlaylistImportJobRef>('POST', '/playlists/import', request);
  }

  playlistImport(id: string) {
    return this.http.request<V.PlaylistImport>('GET', `/playlists/import/${segment(id)}`);
  }

  savePlaylistImport(id: string, request: V.SavePlaylistImportRequest) {
    return this.http.request<V.PlaylistCard>('POST', `/playlists/import/${segment(id)}/save`, request);
  }

  libraryDuplicates(libraryId: string, cursor?: string, limit?: number) {
    return this.http.request<V.DuplicateGroupsPage>('GET', `/libraries/${segment(libraryId)}/duplicates${query({ cursor, limit })}`);
  }

  titleRecording(id: string) {
    return this.http.request<V.RecordingReleases>('GET', `/titles/${segment(id)}/recording`);
  }

  setDuplicatePreference(libraryId: string, recordingId: string, request: V.DuplicatePreferenceRequest) {
    return this.http.request<V.DuplicateGroup>('POST', `/libraries/${segment(libraryId)}/duplicates/${segment(recordingId)}`, request);
  }

  async titleLyrics(id: string): Promise<V.TitleLyrics | null> {
    try {
      return await this.http.request<V.TitleLyrics>('GET', `/titles/${segment(id)}/lyrics`, undefined, CACHED);
    } catch (error) {
      if (error instanceof VelaError && error.status === 404) return null;
      throw error;
    }
  }

  playlists(cursor?: string, limit?: number) {
    return this.http.request<V.Page<V.PlaylistCard>>('GET', `/playlists${query({ cursor, limit })}`, undefined, CACHED);
  }

  playlist(id: string, cursor?: string, limit?: number) {
    return this.http.request<V.CollectionContents>('GET', `/playlists/${segment(id)}${query({ cursor, limit })}`, undefined, CACHED);
  }

  createPlaylist(request: V.CreatePlaylistRequest) {
    return this.http.request<V.PlaylistCard>('POST', '/playlists', request);
  }

  renamePlaylist(id: string, request: V.RenamePlaylistRequest) {
    return this.http.request<V.PlaylistCard>('PATCH', `/playlists/${segment(id)}`, request);
  }

  deletePlaylist(id: string, request: V.Mutation) {
    return this.http.request<V.Ack>('DELETE', `/playlists/${segment(id)}`, request);
  }

  addPlaylistEntries(id: string, request: V.AddPlaylistEntriesRequest) {
    return this.http.request<V.PlaylistEntryCount>('POST', `/playlists/${segment(id)}/entries`, request);
  }

  removePlaylistEntry(id: string, entryId: string, request: V.Mutation) {
    return this.http.request<V.Ack>('DELETE', `/playlists/${segment(id)}/entries/${segment(entryId)}`, request);
  }

  movePlaylistEntry(id: string, entryId: string, request: V.MovePlaylistEntryRequest) {
    return this.http.request<V.Ack>('POST', `/playlists/${segment(id)}/entries/${segment(entryId)}/move`, request);
  }

  titlePlaylists(titleId: string) {
    return this.http.request<V.TitlePlaylists>('GET', `/titles/${segment(titleId)}/playlists`, undefined, CACHED);
  }

  /** `role` reads one child level (features.pluginLevels.childRoles); the caller sends it only then. */
  children(id: string, cursor?: string, limit?: number, role?: string, signal?: AbortSignal) {
    return this.http.request<V.ChildrenPage>('GET', `/titles/${segment(id)}/children${query({ role: role || undefined, cursor, limit: limit === undefined ? undefined : String(limit) })}`, undefined, { ...CACHED, signal });
  }

  openReading(id: string, request: V.ReadingRequest) {
    return this.http.request<V.ReadingGrant>('POST', `/titles/${segment(id)}/read`, request);
  }

  saveReadingProgress(id: string, request: V.ReadingProgressRequest) {
    return this.http.request<V.Ack>('POST', `/titles/${segment(id)}/reading-progress`, request);
  }

  async detail(id: string, fresh = false) {
    const data = await this.http.request<V.TitleDetail>('GET', `/titles/${segment(id)}`, undefined, { ...CACHED, fresh });
    if (this.personSupport === 'unknown') {
      // One probe at a time; one that has not settled yet is retried by a later title.
      const probe = this.personProbe ??= this.probePeople(data).finally(() => { if (this.personProbe === probe) this.personProbe = undefined; });
      // Person discovery decorates credit links; it may not hold the title back for long
      // (a cold person filmography can take many seconds to answer).
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([probe, new Promise<void>(resolve => { timer = setTimeout(resolve, PERSON_PROBE_WAIT_MS); })]);
      clearTimeout(timer);
    }
    // Older Ether servers supply the show's id but omit its display name.
    if (data.title?.showId && data.title.showId !== id && !data.title.showName) {
      try {
        const show = await this.http.request<V.TitleDetail>('GET', `/titles/${segment(data.title.showId)}`, undefined, CACHED);
        return { ...data, title: { ...data.title, showName: show.title.name } };
      } catch {
        // Parent-name decoration is secondary; a removed or temporarily unavailable show must
        // not hide a still-playable episode.
      }
    }
    return data;
  }

  requestTrailerPreview(titleId: string, request: V.TrailerPreviewRequest) {
    return this.http.request<V.TrailerPreviewResponse>('POST', `/titles/${segment(titleId)}/trailer-preview`, request);
  }

  trailerPreviewState(titleId: string) {
    return this.http.request<V.TrailerPreviewResponse>('GET', `/titles/${segment(titleId)}/trailer-preview`);
  }

  sendInteractions(request: V.InteractionsRequest) {
    return this.http.request<V.Ack>('POST', '/interactions', request);
  }

  // Search

  search(request: CatalogueSearch, signal?: AbortSignal) {
    return this.http.request<V.SearchResponse>('POST', '/search', { ...request, mode: 'fast' }, { signal });
  }

  /** Only with features.unifiedSearch: one ranked list, the server deciding when description matches lead. */
  searchAuto(request: CatalogueSearch, signal?: AbortSignal) {
    return this.http.request<V.SearchResponse>('POST', '/search', { ...request, mode: 'auto' }, { signal });
  }

  searchByDescription(request: CatalogueSearch, signal?: AbortSignal) {
    return this.http.request<V.SearchResponse>('POST', '/search', { ...request, mode: 'descriptive' }, { signal });
  }

  startAiSearch(request: V.AISearchRequest) {
    return this.http.request<V.AISearchJob>('POST', '/search/ai', request);
  }

  aiSearchJob(id: string) {
    return this.http.request<V.AISearchJob>('GET', `/search/ai/${segment(id)}`);
  }

  cancelAiSearch(id: string, request: V.CancelRequest) {
    return this.http.request<V.AISearchJob>('POST', `/search/ai/${segment(id)}/cancel`, request);
  }

  // Playback

  titleVersions(id: string) {
    return this.http.request<V.TitleVersions>('GET', `/titles/${segment(id)}/versions`);
  }

  clearVersionChoice(id: string, request: V.ClearVersionChoiceRequest) {
    return this.http.request<V.ClearVersionChoiceResponse>('DELETE', `/titles/${segment(id)}/versions/choice`, request);
  }

  startPlayback(request: V.PlaybackRequest) {
    const archive = request.channelId && (request.programmeId !== undefined || request.startAt !== undefined);
    return this.http.request<V.PlaybackPlan | V.PlaybackPreparing>('POST', '/playback',
      archive ? { ...request, kind: 'channel' } : request);
  }

  reportObservation(sessionId: string, observation: V.PlayerObservation) {
    return this.http.request<V.Ack>('POST', `/sessions/${segment(sessionId)}/observations`, observation);
  }

  command(sessionId: string, command: TransportCommand) {
    return this.sessionCommand(sessionId, command);
  }

  changeTracks(sessionId: string, command: TrackCommand) {
    return this.sessionCommand(sessionId, command);
  }

  switchPath(sessionId: string, command: SwitchCommand) {
    return this.sessionCommand(sessionId, command);
  }

  switchVersion(sessionId: string, command: Extract<V.SessionCommand, { kind: 'version' }>) {
    return this.sessionCommand(sessionId, command);
  }

  goLive(sessionId: string, command: Extract<V.SessionCommand, { kind: 'goLive' }>) {
    return this.sessionCommand(sessionId, command);
  }

  replanTile(sessionId: string, command: Extract<V.SessionCommand, { kind: 'replan' }>) {
    return this.sessionCommand(sessionId, command);
  }

  prepareFallback(sessionId: string, command: FallbackCommand) {
    return this.sessionCommand(sessionId, command);
  }

  sessionSnapshot(sessionId: string, signal?: AbortSignal) {
    // Playback recovery is authority-sensitive (including original_lost): never let a platform
    // HTTP cache hand the player the generation whose grant just failed.
    return this.http.request<V.SessionSnapshot>('GET', `/sessions/${segment(sessionId)}`, undefined, { ...FRESH, signal });
  }

  /** A session's trickplay sheet (bearer and device, revalidated by ETag); the route width is the offer's. */
  trickplaySheet(sessionId: string, offer: V.TrickplayMetadata, index: number, etag?: string, signal?: AbortSignal) {
    if (!Number.isInteger(index) || index < 0 || !Number.isInteger(offer.width) || offer.width <= 0) return Promise.resolve(null);
    return this.http.bytes(`/sessions/${segment(sessionId)}/trickplay/${offer.width}/${index}.jpg`, etag, signal);
  }

  streamSession(sessionId: string, cursor: string, onEvent: EventHandler, signal?: AbortSignal, onActivity?: () => void): Promise<void> {
    const path = `/sessions/${segment(sessionId)}/events`;
    return this.http.stream(path, { 'Last-Event-ID': cursor }, onEvent, signal, onActivity);
  }

  createAudioFallback(sessionId: string, request: V.AudioFallbackRequest, signal?: AbortSignal) {
    const path = `/sessions/${segment(sessionId)}/audio-fallback`;
    return this.http.request<V.AudioFallbackResponse>('POST', path, request, { signal });
  }

  cancelAudioFallback(sessionId: string, audioId: string, request: V.Mutation, signal?: AbortSignal) {
    const path = `/sessions/${segment(sessionId)}/audio-fallback/${segment(audioId)}`;
    return this.http.request<V.Ack>('DELETE', path, request, { signal });
  }

  // Subtitle search (features.subtitleSearch): an older Ether, or one with the flag off, has none.

  async subtitleLanguages(_sessionId: string) {
    return etherSubtitleLanguages(await this.describe());
  }

  /** Without a language the server searches the viewer's most preferred one and says which. */
  async searchSubtitles(sessionId: string, language?: string) {
    const answer = await this.http.request<V.SubtitleSearchResponse>('GET', `/sessions/${segment(sessionId)}/subtitles/search${query({ language })}`);
    return etherSubtitleSearch(answer, language);
  }

  /** A subtitle the server prepares first (an AI translation) answers 202 until it is ready. Each
   * ask is its own mutation (a replayed 202 would never finish); the server makes an offer's track
   * once per session, so asking again joins the same work. */
  async downloadSubtitle(sessionId: string, offerId: string, idempotencyKey: string): Promise<V.PlaybackPlan> {
    const path = `/sessions/${segment(sessionId)}/subtitles/${segment(offerId)}`;
    const until = Date.now() + SUBTITLE_PREPARE_LIMIT_MS;
    for (let attempt = 0; ; attempt++) {
      const reply = await this.http.request<V.PlaybackPlan | V.PlaybackPreparing>('POST', path, { idempotencyKey: attempt ? `${idempotencyKey}:${attempt}` : idempotencyKey });
      if (reply && 'sessionId' in reply) return reply;
      if (!reply || reply.state !== 'preparing' || Date.now() >= until) throw new VelaError({ class: 'transient', code: 'subtitle_not_ready', message: 'The subtitle is still being prepared', retry: { allowed: true } }, 504);
      await new Promise(resolve => setTimeout(resolve, subtitleRetryDelayMs(reply)));
    }
  }

  /** Whether this server has person pages: credits link to them when it does. */
  private async probePeople(data: V.TitleDetail): Promise<void> {
    const ids = [...new Set([...(data.cast ?? []), ...(data.crew ?? [])].flatMap(person => person.id && !this.missingPeople.has(person.id) ? [person.id] : []))];
    for (const personId of ids) {
      try {
        await this.personDetails(personId);
        await this.http.request('GET', `/people/${segment(personId)}/titles?limit=1`);
        this.personSupport = 'yes'; this.supportsPersonFilmography = true;
        break;
      }
      catch (error) {
        if (error instanceof VelaError && (error.status === 405 || error.status === 404 && ['endpoint_not_found', 'http_error'].includes(error.detail.code))) { this.personSupport = 'no'; break; }
        if (error instanceof VelaError && error.status === 404) this.missingPeople.add(personId);
        // Person discovery decorates credit links; it is never allowed to hide the title.
        else break;
      }
    }
  }

  // Live TV

  channels(cursor?: string, limit?: number) {
    return this.http.request<V.Page<V.Channel>>('GET', `/live/channels${query({ cursor, limit })}`, undefined, CACHED);
  }

  guide(guideQuery: V.GuideQuery) {
    const path = `/live/guide${query({ ...guideQuery, channelIds: guideQuery.channelIds?.join(',') })}`;
    return this.http.request<V.GuideResponse>('GET', path, undefined, CACHED);
  }

  async guideWindow(request: V.GuideWindowRequest): Promise<V.GuideWindowResponse | null> {
    const limits = this.guideWindowLimits;
    if (!limits || request.channelIds.length > limits.maxChannels || Date.parse(request.until) - Date.parse(request.from) > limits.maxWindowMinutes * 60000) return null;
    // Conditional POST answers are keyed by the complete body as well as viewer/policy.
    return this.http.request<V.GuideWindowResponse>('POST', '/live/guide/window', request, CACHED);
  }

  // Plugin screens and surfaces (docs/plugin-screens.md; Ether design sections 6 and 7)

  /** A document by its href. Ether serves the current document for a stale `v` (200, no-cache),
   * never a redirect. `fresh`: read past the cache (a Studio reload); drafts are never cached. */
  async screenDocument(href: string, signal?: AbortSignal, fresh = false): Promise<V.ScreenDocument> {
    const path = this.http.boundPath(href);
    if (!path) throw new VelaError({ class: 'request', code: 'invalid_document_href', message: 'A screen document must come from this server.', retry: { allowed: false } }, 400);
    return this.http.request<V.ScreenDocument>('GET', path, undefined, { cacheable: !this.screenPreview() && !fresh, fresh, signal, headers: this.screenHeaders });
  }

  screenData(target: ScreenTarget, read: ScreenDataRead, signal?: AbortSignal): Promise<V.ScreenData> {
    const params = new URLSearchParams();
    if (read.sources) params.set('sources', read.sources.join(','));
    // Context first, then params: both are p.<name>; a page never declares a param a context names.
    for (const [name, value] of Object.entries(read.context ?? {})) params.set(`p.${name}`, value);
    for (const [name, value] of Object.entries(read.params)) params.set(`p.${name}`, value);
    if (read.tz) params.set('tz', read.tz);
    const search = params.size ? `?${params}` : '';
    return this.http.request<V.ScreenData>('GET', `${screenBase(target)}/data${search}`, undefined, { signal, headers: this.screenHeaders });
  }

  screenAction(target: ScreenTarget, action: string, request: V.ScreenActionRequest, mutation: V.Mutation): Promise<V.ScreenActionAnswer> {
    const base = target.kind === 'screen' ? `/screens/${segment(target.id)}` : `/surfaces/${segment(target.id)}`;
    // The key travels as the header Ether's design names and, as every other Vela mutation, in the body.
    return this.http.request<V.ScreenActionAnswer>('POST', `${base}/actions/${segment(action)}`, { ...request, idempotencyKey: mutation.idempotencyKey },
      { headers: { ...this.screenHeaders, 'Idempotency-Key': mutation.idempotencyKey } }).then(answer => answer ?? {});
  }

  async setSurfaceSetting(id: string, enabled: boolean, mutation: V.Mutation): Promise<void> {
    await this.http.request<unknown>('PUT', `/surfaces/${segment(id)}/setting`, { enabled, idempotencyKey: mutation.idempotencyKey }, { headers: { ...this.screenHeaders, 'Idempotency-Key': mutation.idempotencyKey } });
  }

  streamScreens(live: ScreenStreamQuery, onEvent: EventHandler, signal?: AbortSignal): Promise<void> {
    return this.http.stream(`/live/stream${streamSearch(live)}`, this.screenHeaders, onEvent, signal);
  }


  createMultiview(request: V.MultiviewRequest) {
    return this.http.request<V.MultiviewGroup>('POST', '/multiview', request);
  }

  endMultiview(groupId: string, request: V.Mutation) {
    return this.http.request<unknown>('DELETE', `/multiview/${segment(groupId)}`, request);
  }

  /** A stop command for a page being unloaded, sent with the last request's credentials. */
  unloadStop(sessionId: string, at: V.Generations): UnloadRequest[] {
    const request = this.http.unloadRequest(`/sessions/${segment(sessionId)}/commands`, {
      kind: 'stop', ...at, idempotencyKey: `unload-${sessionId}-${at.sourceGeneration}-${at.seekGeneration}` });
    return request ? [request] : [];
  }

  private sessionCommand(sessionId: string, command: V.SessionCommand) {
    return this.http.request<V.PlaybackPlan>('POST', `/sessions/${segment(sessionId)}/commands`, command);
  }
}

export function libraryBrowseQuery(browse: V.LibraryBrowseQuery): string {
  const { facets, ...rest } = browse;
  const params = new URLSearchParams(query(rest).slice(1));
  for (const [field, values] of Object.entries(facets ?? {})) for (const value of new Set(values)) params.append(`facet.${field}`, value);
  return params.size ? `?${params}` : '';
}

const segment = encodeURIComponent;

/** `/screens/{id}/pages/{page}` or `/surfaces/{id}`. */
function screenBase(target: ScreenTarget): string {
  return target.kind === 'screen' ? `/screens/${segment(target.id)}/pages/${segment(target.page)}` : `/surfaces/${segment(target.id)}`;
}

function query(values: object): string {
  const pairs = Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
  return pairs.length ? `?${pairs.join('&')}` : '';
}
