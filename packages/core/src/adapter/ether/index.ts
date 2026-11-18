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
  DeviceGrantSignIn,
  EventStream,
  FallbackCommand,
  Interactions,
  LiveTv,
  PasswordSignIn,
  PathSwitching,
  ProactiveFallback,
  QuickConnectSignIn,
  SwitchCommand,
  TrackChanges,
  TrackCommand,
  TrailerPreviews,
  WebCodeSignIn,
} from '../capabilities';
import { VelaError } from '../errors';
import { EtherTransport } from './transport';

const CACHED = { cacheable: true };
const PUBLIC = { auth: false };
const PUBLIC_CACHED = { auth: false, cacheable: true };

/** Ether speaks the v0 protocol natively, so it offers every capability Vela knows. */
export class EtherAdapter implements ServerAdapter, PasswordSignIn, WebCodeSignIn, DeviceGrantSignIn,
  QuickConnectSignIn, ClientDeclaration, DescriptiveSearch, AiSearch, TrailerPreviews, Interactions,
  AudioFallback, TrackChanges, PathSwitching, ProactiveFallback, LiveTv, EventStream, Appearance {
  private readonly http: EtherTransport;
  private readonly credentials: Credentials;
  supportsPersonFilmography = false;
  supportsLibraryRecommendations = false;
  private personSupport: 'unknown' | 'yes' | 'no' = 'unknown';
  private librarySupport: 'unknown' | 'yes' | 'no' = 'unknown';
  private readonly missingPeople = new Set<string>();

  resetOptionalCapabilities(): void {
    this.personSupport = this.librarySupport = 'unknown';
    this.missingPeople.clear();
    this.supportsPersonFilmography = this.supportsLibraryRecommendations = false;
  }

  /** Probe with a visible library: a 404 here identifies an older collections route. */
  async probeLibraryViews(id: string): Promise<void> {
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
  async libraryRows(id: string, _kind: V.Library['kind']): Promise<V.Row[]> {
    const result: V.Row[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let n = 0; n < 100; n++) {
      const page = await this.rows({ placement: 'library', libraryId: id, cursor, limit: 100 });
      result.push(...page.items);
      if (page.continuation !== 'more') return result;
      if (!page.nextCursor || seen.has(page.nextCursor)) throw new Error('Invalid library row continuation');
      cursor = page.nextCursor;
      seen.add(cursor);
    }
    throw new Error('Library rows exceed page limit');
  }
  async libraryCollections(id: string, cursor?: string): Promise<V.Page<V.RowEntry>> {
    const response = await this.http.request<V.Page<V.LibraryCollectionEntry>>('GET', `/libraries/${segment(id)}/collections${query({ cursor })}`, undefined, CACHED);
    return { ...response, items: response.items.map(({ id: entryId, receiptToken, collection }) => ({ id: entryId, receiptToken, kind: 'collection' as const, targetId: collection.id, name: collection.name, artwork: collection.artwork })) };
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

  constructor(origin: string, credentials: Credentials, capabilityContext: string, onSessionRejected?: () => void) {
    this.credentials = credentials;
    this.http = new EtherTransport(origin, credentials, capabilityContext, onSessionRejected);
  }

  setCapabilityContext(context: string): void {
    this.http.setCapabilityContext(context);
  }

  // Session

  /** Validate a stored session by rotating it before the auth resource presents it. */
  async validateSession(): Promise<V.Tokens | null> {
    const tokens = await this.credentials.get();
    return tokens ? this.http.refresh(tokens) : null;
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

  // The server and its look

  describe(): Promise<ServerDescription> {
    return this.http.request<V.ServerCapabilities>('GET', '/capabilities', undefined, PUBLIC_CACHED);
  }

  async declareClient(request: V.NegotiateRequest): Promise<void> {
    await this.http.request<V.NegotiateResponse>('POST', '/negotiate', request);
  }

  appearance() {
    return this.http.request<V.Appearance>('GET', '/appearance', undefined, PUBLIC_CACHED);
  }

  skinDocument(path: string) {
    return this.http.request<SkinDocument>('GET', path, undefined, PUBLIC_CACHED);
  }

  /** The viewer-level server event stream; its first event is the current appearance. */
  streamViewerEvents(onEvent: EventHandler, signal?: AbortSignal): Promise<void> {
    return this.http.stream('/events', {}, onEvent, signal);
  }

  // Catalogue

  /** A home whose continuation the server has expired is read again without revalidation. */
  async home(fresh = false): Promise<Home> {
    try {
      return await this.http.request<V.Bootstrap>('GET', '/bootstrap', undefined, { ...CACHED, fresh });
    } catch (error) {
      const expired = error instanceof VelaError && error.status === 409 && error.detail.code === 'cursor_expired';
      if (!expired) throw error;
      return this.http.request<V.Bootstrap>('GET', '/bootstrap');
    }
  }

  rows(rowsQuery: V.RowsQuery) {
    return this.http.request<V.Page<V.Row>>('GET', `/rows${query(rowsQuery)}`, undefined, CACHED);
  }

  row(id: string, cursor?: string, limit?: number) {
    return this.http.request<V.Row>('GET', `/rows/${segment(id)}${query({ cursor, limit })}`, undefined, CACHED);
  }

  libraries(librariesQuery: V.LibrariesQuery) {
    return this.http.request<V.Page<V.Library>>('GET', `/libraries${query(librariesQuery)}`, undefined, CACHED);
  }

  library(id: string, browse: V.LibraryBrowseQuery) {
    const path = `/libraries/${segment(id)}/items${query(browse)}`;
    return this.http.request<V.LibraryContents>('GET', path, undefined, CACHED);
  }

  collection(id: string, cursor?: string, limit?: number) {
    const path = `/collections/${segment(id)}${query({ cursor, limit })}`;
    return this.http.request<V.CollectionContents>('GET', path, undefined, CACHED);
  }

  async detail(id: string, fresh = false) {
    const data = await this.http.request<V.TitleDetail>('GET', `/titles/${segment(id)}`, undefined, { ...CACHED, fresh });
    if (this.personSupport === 'unknown') {
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
          else throw error;
        }
      }
    }
    // Older Ether servers supply the show's id but omit its display name.
    if (data.title?.showId && data.title.showId !== id && !data.title.showName) {
      try {
        const show = await this.http.request<V.TitleDetail>('GET', `/titles/${segment(data.title.showId)}`, undefined, CACHED);
        return { ...data, title: { ...data.title, showName: show.title.name } };
      } catch (error) {
        // A removed parent must not hide a still-playable episode.
        if (!(error instanceof VelaError) || error.status !== 404) throw error;
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

  startPlayback(request: V.PlaybackRequest) {
    return this.http.request<V.PlaybackPlan | V.PlaybackPreparing>('POST', '/playback', request);
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

  prepareFallback(sessionId: string, command: FallbackCommand) {
    return this.sessionCommand(sessionId, command);
  }

  sessionSnapshot(sessionId: string) {
    return this.http.request<V.SessionSnapshot>('GET', `/sessions/${segment(sessionId)}`);
  }

  streamSession(sessionId: string, cursor: string, onEvent: EventHandler, signal?: AbortSignal): Promise<void> {
    const path = `/sessions/${segment(sessionId)}/events`;
    return this.http.stream(path, { 'Last-Event-ID': cursor }, onEvent, signal);
  }

  createAudioFallback(sessionId: string, request: V.AudioFallbackRequest, signal?: AbortSignal) {
    const path = `/sessions/${segment(sessionId)}/audio-fallback`;
    return this.http.request<V.AudioFallbackResponse>('POST', path, request, { signal });
  }

  cancelAudioFallback(sessionId: string, audioId: string, request: V.Mutation, signal?: AbortSignal) {
    const path = `/sessions/${segment(sessionId)}/audio-fallback/${segment(audioId)}`;
    return this.http.request<V.Ack>('DELETE', path, request, { signal });
  }

  // Live TV

  channels(cursor?: string, limit?: number) {
    return this.http.request<V.Page<V.Channel>>('GET', `/live/channels${query({ cursor, limit })}`, undefined, CACHED);
  }

  guide(guideQuery: V.GuideQuery) {
    const path = `/live/guide${query({ ...guideQuery, channelIds: guideQuery.channelIds?.join(',') })}`;
    return this.http.request<V.GuideResponse>('GET', path, undefined, CACHED);
  }

  private sessionCommand(sessionId: string, command: V.SessionCommand) {
    return this.http.request<V.PlaybackPlan>('POST', `/sessions/${segment(sessionId)}/commands`, command);
  }
}

const segment = encodeURIComponent;

function query(values: object): string {
  const pairs = Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
  return pairs.length ? `?${pairs.join('&')}` : '';
}
