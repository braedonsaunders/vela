import type { RemoteSubtitle, SubtitleLanguages, SubtitleSearchResult, TitleActions } from '../media-actions';
import { deviceLanguages, iso6391, KNOWN_SUBTITLE_LANGUAGES, pickSubtitleLanguage } from '../../subtitle-languages';
import { homeHeroes } from '../home-heroes';
import type * as V from '../../wire';
import type { CatalogueSearch, Credentials, Home, ServerAdapter, ServerDescription, TransportCommand } from '../index';
import type { DownloadResolution, DownloadSidecar, LibraryJumpIndex, LibraryRecommendations, LiveTv, MediaDownloads, OfflineProgressEntry, PathSwitching, ResolveDownloadOptions, SwitchCommand, TitleChildren, TrackChanges, TrackCommand, TrickplaySheet, TrickplaySheets, UnloadRequest, UnloadStop, Versions } from '../capabilities';
import type { LibraryJumpBucket } from '../../models';
import { parsePlexJumpIndex } from './jump-index';
import { VelaError } from '../errors';
import { plexHeaders, plexMediaHeaders, type PlexDevice } from './auth';
import { fetchTextBounded } from '../../protocol/timeout';
import { markPlexUnreachable, PLEX_VALIDATE_TIMEOUT_MS } from './relocate';
import { seriesOrder } from '../series';
import { randomId } from '../../protocol/id';
import { withinStreamingCap } from '../../streaming';
import { copiesVideo, decidedMedia, decidedQuality, deliversProfile, directAudio, isAudiobookSection, isPhotoAlbum, isPhotoAlbumKey, isTextSidecar, mediaId, partAt, partOffsets, playingAudio, plexAudioMime, plexMarkers, plexProjection, plexSidecar, plexStreamProfiles, plexVersion, refusesStream } from './media';
import { bifFrameAt, bifFrames, bifHeader, bifInterval, bifOffer, bifTableRange, BIF_HEADER_BYTES, jpegSize, type BifFrame } from './bif';
export * from './auth';

// Plex JSON uses the same metadata envelope for videos, directories and hubs.
type Node = Record<string, any>;
interface PlexSession {
  plan: V.PlaybackPlan;
  part: Node;
  metadata: Node;
  sequence: number;
  pending: Promise<unknown>;
  /** Pagehide ends session work without waiting for the serial queue. */
  readonly sessionWork: AbortController;
  /** The progress report queued last, not started yet: a later one in its state and generations takes its place and
   * its answer, and a command at its generations queued after it, one that will run, keeps its position and sequence without its post (`by`),
   * its answer then that of the command's first timeline post, or, when the command posts none, accepted once its position is applied. */
  waiting?: { r: V.PlayerObservation; work?: Promise<V.Ack>; by?: Promise<unknown> };
  /** The state of the last timeline posted. */
  posted?: string;
  /** The transcode session of the server's stream while one is started (none while the stream is deferred). */
  transcodeId?: string;
  /** The stopped timeline has been sent; stream cleanup can still be pending. */
  timelineStopped?: boolean;
  scrobbled?: boolean;
  /** Each mutation's answer by idempotency key, so a repeated command is not applied twice. */
  mutations: Map<string, V.PlaybackPlan>;
  /** The idempotency keys of the mutations queued and not settled yet, each with how many calls carry it. */
  queued?: Map<string, number>;
  /** While a command that took over a waiting report runs: answers that report with the command's first timeline post. */
  carry?: (post: Promise<unknown>) => void;
  /** A title that started without intro or credits markers: when they were last asked for, and how often. */
  markers?: { at: number; asked: number; reading: boolean };
  /** A multi-part item (several files stacked as one title): its parts, the one playing, and the
   * transcode request each part is played through. */
  stack?: { parts: Node[]; index: number; query: Record<string, string> };
  /** The server's stream offered beside an original that plays, not asked for yet: its transcode
   * request, decided when the session first needs the stream. */
  deferred?: Record<string, string>;
  /** The part's scrub thumbnail index as last read (`trickplayOffer`): its frames, the size of one,
   * the offer made of it, and the whole file when the server would not answer a byte range. */
  thumbnails?: { frames: BifFrame[]; offer: V.TrickplayMetadata; whole?: Uint8Array };
  /** What a video start declared, so a version switch (and a subtitle added later) is chosen the same way. */
  request?: Pick<V.PlaybackRequest, 'client' | 'allowTranscode'>;
  /** The audio stream known to be selected on the playing part (by Plex at the start, the start's request or a track change); unset while it is not known. */
  partAudio?: string;
}
/** A title's markers missing at the start are asked for again this often, this many times (Ether
 * knows them once the session's source is probed). */
const MARKERS_AGAIN_MS = 30_000;
const MARKERS_ASKS = 6;
/** A thumbnail index larger than this is not read whole (a server that ignores byte ranges). */
const MAX_INDEX_BYTES = 50 * 1024 * 1024;
export interface PlexConfig { origin: string; credentials: Credentials; clientIdentifier: string; /** The name the server was added under (plex.tv's resource name). */ name?: string }
const ack: V.Ack = { accepted: true };
const no = (reason: string): V.Feature => ({ available: false, reason });
const yes: V.Feature = { available: true };
const enc = encodeURIComponent;
const seconds = (n: unknown) => Math.max(0, Number(n || 0) / 1000);
/** Plex media rates are in kb/s. A decision can state a rate without giving output dimensions. */
function fitsStreamingCap(media: Node | undefined, client: V.ClientCapabilities): boolean {
  return withinStreamingCap({ bitrate: Number(media?.bitrate) * 1000, width: Number(media?.width), height: Number(media?.height) }, client);
}
/** Whether the client plays a file as it is, with the audio codec of the track that will play: in its
 * original-file engine or its native player. A codec Plex does not state does not refuse it. */
function playsOriginal(client: V.ClientCapabilities, media: Node, audioCodec: string | undefined): boolean {
  const original = client.originalPlayback;
  return !!original && original.demuxContainers.includes(media.container) && (!media.videoCodec || original.videoDecoders.includes(media.videoCodec)) && (!audioCodec || original.audioDecoders.includes(audioCodec)) ||
    client.containers.includes(media.container) && (!media.videoCodec || client.videoCodecs.includes(media.videoCodec)) && (!audioCodec || client.audioCodecs.includes(audioCodec));
}
/** A file's own length where Plex states it (a title's files can differ), else the title's. */
const fileSeconds = (media: Node, n: Node) => seconds(media.duration ?? n.duration);
/** A position kept inside a file of known length. */
const inside = (at: number, duration: number) => duration > 0 ? Math.min(at, duration) : at;
function fail(message: string, kind: V.ProtocolError['class'] = 'request'): never {
  throw new VelaError({ class: kind, code: 'plex_unsupported', message, retry: { allowed: false } }, 400);
}
function offset(cursor?: string): number {
  if (cursor !== undefined && !/^\d+$/.test(cursor)) fail('Invalid Plex continuation');
  return Number(cursor || 0);
}
function page<T>(items: T[], start = 0, total?: number): V.Page<T> {
  const more = total !== undefined && start + items.length < total;
  return { items, continuation: more ? 'more' : total === undefined ? 'unknown' : 'exhausted', ...(more && items.length ? { nextCursor: String(start + items.length) } : {}) };
}
const DISCOVER = 'https://discover.provider.plex.tv';
/** A movie's or show's plex.tv key (its plex:// guid's id), what the watchlist is keyed by. */
export function discoverKey(n: Node): string | undefined {
  return typeof n.guid === 'string' ? /^plex:\/\/(movie|show)\/([A-Za-z0-9]+)$/.exec(n.guid)?.[2] : undefined;
}
/** Node types rows show: titles, and directories (collections, playlists, albums of photos). */
const SHOWN = ['movie', 'show', 'season', 'episode', 'collection', 'playlist', 'artist', 'album', 'track', 'photo', 'clip'];
const SEARCHED = ['movie', 'show', 'season', 'episode', 'artist', 'album', 'track'];
/** A series or season is played once every episode is (viewCount there counts episode plays). */
function plexPlayed(n: Node): boolean {
  if ((n.type === 'show' || n.type === 'season') && n.leafCount !== undefined) return Number(n.leafCount) > 0 && Number(n.viewedLeafCount || 0) >= Number(n.leafCount);
  return Number(n.viewCount || 0) > 0;
}

/** Plex Media Server. Sign-in is plex.tv PIN linking (`./link`), outside the per-server adapter. */
export class PlexAdapter implements ServerAdapter, PathSwitching, LiveTv, TrackChanges, TitleChildren, LibraryRecommendations, LibraryJumpIndex, Versions, TrickplaySheets, UnloadStop, MediaDownloads {
  readonly origin: string;
  private sessions = new Map<string, PlexSession>();
  /** Sections by key, from the last section list: a music section named for audiobooks holds books. */
  private sections = new Map<string, Node>();
  private watchlistProbe?: Promise<boolean>;
  private liveConfig?: { dvr: string; grid: string; channels: string };
  private delegation?: Promise<string>;
  /** Whether the signed-in account has sync/download permission on this server (`allowSync`). */
  private allowSync?: boolean;
  /** The token the last authorised request carried, for a request that cannot wait for credentials (`unloadStop`). */
  private lastToken?: string;
  constructor(private config: PlexConfig) {
    const u = new URL(config.origin);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.pathname !== '/' || u.search || u.hash) throw new Error('Plex requires a server origin');
    this.origin = u.origin;
    plexHeaders(this.device);
  }
  /** This device as Plex sees it: the configured client identifier with the device's own name and platform. */
  private get device(): PlexDevice {
    return { ...this.config.credentials.device, id: this.config.clientIdentifier };
  }
  /** Credential-free media URL; the private host bridge attaches mediaHeaders only at this origin. */
  mediaURL(path: string): string {
    const u = this.mediaTarget(path);
    for (const key of u.searchParams.keys()) if (/token|api_key/i.test(key)) fail('Persistent Plex token in media URL');
    return u.href;
  }
  private mediaTarget(path: string): URL {
    const u = new URL(path, this.origin);
    if (u.origin !== this.origin || u.username || u.password || u.hash || !/^\/(library|video|audio|music|subtitles|photo|livetv)\//.test(u.pathname)) fail('Plex media outside selected server');
    return u;
  }
  /** What the player sends with media reads at this origin: the header set every player host accepts. */
  async mediaHeaders(): Promise<Record<string, string>> {
    return { ...plexMediaHeaders(this.device), 'X-Plex-Token': await this.token() };
  }
  private async token(): Promise<string> {
    const tokens = await this.config.credentials.get();
    if (!tokens) fail('Sign in required', 'auth');
    this.lastToken = tokens.accessToken;
    return tokens.accessToken;
  }
  /** Delegation lifetime is set by PMS; never persist it or infer an expiry. */
  transientToken(): Promise<string> {
    if (!this.delegation) {
      const pending = this.request('/security/token', { type: 'delegation', scope: 'all' }).then(result => {
        const token = result.token || result.DelegationToken?.[0]?.token;
        if (typeof token !== 'string' || !token) return fail('Plex did not issue a transient media token', 'auth');
        return token;
      });
      this.delegation = pending;
      void pending.catch(() => { if (this.delegation === pending) this.delegation = undefined; });
    }
    return this.delegation;
  }
  rotateTransientToken(): void { this.delegation = undefined; }
  /**
   * A URL for a player that cannot send headers (the browser's own HLS, native players): the
   * delegation token in its query. `path` may be a URL the server itself wrote into a playlist,
   * whose own per-stream read parameters (Ether's X-Ether-Stream-Token and X-Ether-Read-Token)
   * stay; a Plex token it carries is replaced, so only the transient one ever leaves here.
   */
  async transientMediaURL(path: string): Promise<string> {
    const url = this.mediaTarget(path);
    for (const key of [...url.searchParams.keys()]) if (/^x-plex-token$/i.test(key)) url.searchParams.delete(key);
    url.searchParams.set('X-Plex-Token', await this.transientToken());
    return url.href;
  }
  private async request(path: string, query: Record<string, unknown> = {}, method = 'GET', auth = true, signal?: AbortSignal, timeoutMs?: number, keepaliveStarted?: () => void): Promise<Node> {
    const u = new URL(path, this.origin);
    if (u.origin !== this.origin || u.username || u.password) fail('Plex request outside selected server');
    for (const [k, v] of Object.entries(query)) if (v !== undefined) u.searchParams.set(k, String(v));
    const headers = auth ? { ...plexHeaders(this.device), 'X-Plex-Token': await this.token() } : plexHeaders(this.device);
    signal?.throwIfAborted();
    let response: Response;
    let text = '';
    try {
      const init = { method, headers, redirect: 'error', credentials: 'omit' } as const;
      if (!keepaliveStarted && (timeoutMs !== undefined || signal !== undefined)) {
        ({ response, text } = await fetchTextBounded(u.href, init, timeoutMs, signal));
      } else {
        keepaliveStarted?.();
        response = await fetch(u.href, { ...init, ...(keepaliveStarted && { keepalive: true }) });
        if (response.ok && response.status !== 204) text = await response.text();
      }
    } catch (error) {
      if (!signal?.aborted) markPlexUnreachable(error);
      throw error;
    }
    if (response.status === 401) this.rotateTransientToken();
    if (!response.ok) throw new VelaError({ class: response.status === 401 || response.status === 403 ? 'auth' : response.status === 404 ? 'not-found' : 'source',
      code: 'plex_http', message: `Plex request failed (${response.status})`, retry: { allowed: false } }, response.status);
    if (response.status === 204) return {};
    if (!text.trim()) return {};
    // Timeline/scrobble responses can be an empty XML envelope even with JSON Accept.
    if (text.trim().startsWith('<') && path.startsWith('/:/')) return {};
    const body = JSON.parse(text);
    return body.MediaContainer ?? body;
  }
  /** PMS tokens do not expire; a rejected one ends only this server's session. */
  async validateSession(): Promise<V.Tokens | null> {
    const tokens = await this.config.credentials.get();
    if (!tokens) return null;
    try { await this.request('/library/sections', {}, 'GET', true, undefined, PLEX_VALIDATE_TIMEOUT_MS); }
    catch (error) {
      if (!(error instanceof VelaError) || error.status !== 401) throw error;
      const latest = await this.config.credentials.get();
      if (latest?.accessToken === tokens.accessToken) { this.sessions.clear(); await this.config.credentials.set(null); }
      return null;
    }
    return tokens;
  }
  async describe(signal?: AbortSignal): Promise<ServerDescription> {
    const root = await this.request('/identity', {}, 'GET', false, signal);
    let live: V.Feature = no('No accessible Plex DVR');
    this.liveConfig = undefined;
    // /identity carries no name (PMS and Ether alike): the server's name is its root container's.
    let name = '';
    if (await this.config.credentials.get()) {
      try {
        const container = await this.request('/', {}, 'GET', true, signal);
        name = container.friendlyName || '';
        if (container.allowSync !== undefined) {
          this.allowSync = container.allowSync === true || container.allowSync === 1 || container.allowSync === '1';
        }
      } catch { /* the name the server was added under stands */ }
      try {
        const dvrs = await this.request('/livetv/dvrs', {}, 'GET', true, signal);
        if (dvrs.Dvr?.length) {
          const providers = await this.request('/media/providers', {}, 'GET', true, signal);
          const provider = (providers.MediaProvider || []).find((p: Node) => (p.Feature || []).some((f: Node) => f.type === 'grid' && f.key));
          const grid = provider?.Feature.find((f: Node) => f.type === 'grid')?.key;
          if (grid) {
            // PMS exposes configured channels under the grid's provider. /livetv/epg/channels
            // is lineup discovery and rejects a request without a lineup (HTTP 400).
            const channels = new URL(grid, this.origin);
            channels.pathname = channels.pathname.replace(/\/grid$/, '/lineups/dvr/channels');
            channels.search = '';
            this.liveConfig = { dvr: String(dvrs.Dvr[0].key), grid, channels: channels.href };
            live = yes;
          }
        }
      } catch (error) { if (!(error instanceof VelaError) || ![403, 404].includes(error.status)) throw error; }
    }
    return { searchLibraries: true, searchKinds: [{ id: 'movie', label: 'Movies' }, { id: 'show', label: 'Shows' }], protocolVersion: 0, server: { id: root.machineIdentifier || this.origin, name: name || this.config.name || 'Plex Media Server', version: root.version || '' },
      features: { liveTV: live, extras: yes, extraPlayback: yes, themeMusic: yes, initialTrackSelection: yes, sessionTrackChanges: yes, versions: yes },
      skins: [{ id: 'cinematic', name: 'Cinematic' }], defaultSkinId: 'cinematic' };
  }
  async revokeSession(_r: V.RevokeRequest): Promise<V.Ack> {
    for (const [id, s] of this.sessions) if (s.plan.state !== 'ended') await this.command(id, { kind: 'stop', ...s.plan, idempotencyKey: `revoke-${id}` });
    this.sessions.clear(); this.rotateTransientToken(); this.lastToken = undefined; await this.config.credentials.set(null); return ack;
  }
  /**
   * A page being unloaded stops a session as a stop command does: the timeline reports it stopped,
   * its transcode is stopped, a live tune's subscription is ended. Built now, from the last token
   * used, and the session ends here too, so a page brought back (the back/forward cache) reports
   * nothing more for it. Every parameter, the token included, rides in the query: a header would
   * need a CORS preflight, and a page going away cannot rely on one.
   */
  unloadStop(sessionId: string, _at: V.Generations): UnloadRequest[] {
    const s = this.sessions.get(sessionId);
    const token = this.lastToken;
    if (!s || s.plan.state === 'ended' || !token) return [];
    const { Accept: _, ...identity } = plexHeaders(this.device);
    const url = (path: string, query: Record<string, unknown> = {}) => {
      const u = new URL(path, this.origin);
      for (const [key, value] of Object.entries({ ...query, ...identity, 'X-Plex-Token': token })) if (value !== undefined) u.searchParams.set(key, String(value));
      return u.href;
    };
    const requests: UnloadRequest[] = [];
    if (!s.plan.channelId && !s.timelineStopped) requests.push({ method: 'POST', url: url('/:/timeline', { ratingKey: s.metadata.ratingKey, key: `/library/metadata/${s.metadata.ratingKey}`,
      time: Math.round(s.plan.positionSeconds * 1000), duration: s.metadata.duration, state: 'stopped', session: sessionId, hasMDE: 1,
      identifier: 'com.plexapp.plugins.library', 'X-Plex-Session-Identifier': sessionId }) });
    requests.push({ method: 'GET', url: url(`/${s.plan.media === 'audio' ? 'music' : 'video'}/:/transcode/universal/stop`, { session: s.transcodeId ?? sessionId }) });
    if (s.plan.channelId && s.metadata.subscriptionId) requests.push({ method: 'DELETE', url: url(`/media/subscriptions/${enc(s.metadata.subscriptionId)}`) });
    s.plan.state = 'ended';
    s.sessionWork.abort();
    return requests;
  }
  private artwork(n: Node): V.ArtworkRef[] {
    const image = (type: string) => (n.Image || []).find((i: Node) => i.type === type)?.url;
    const poster = n.type === 'episode' ? n.grandparentThumb
      : n.type === 'season' ? n.parentThumb || n.grandparentThumb || n.thumb : n.thumb || n.logo || n.composite || image('coverPoster');
    const refs: [string | undefined, V.ArtworkRef['kind']][] = [
      [poster, 'poster'],
      [n.type === 'episode' ? n.thumb : undefined, 'still'],
      [(n.type === 'episode' ? n.grandparentArt : undefined) || n.art || n.parentArt || n.grandparentArt || image('background') || (Number(n.thumbAspectRatio) >= 1.5 ? n.thumb : undefined), 'backdrop'],
      [(n.type === 'episode' ? n.grandparentClearLogo : undefined) || n.clearLogo || n.parentClearLogo || n.grandparentClearLogo || image('clearLogo'), 'logo'],
    ];
    return refs.flatMap(([path, kind]) => {
      if (!path) return [];
      try { return [{ id: String(path), kind, tag: String(n.updatedAt || ''), sizes: [{ width: 0, height: 0, url: this.artworkURL(path) }] }]; } catch { return []; }
    });
  }

  private artworkURL(path: string): string {
    const u = new URL(path, this.origin);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.hash) fail('Invalid Plex artwork');
    for (const key of u.searchParams.keys()) if (/token|api_key/i.test(key)) fail('Credential in Plex artwork');
    return u.href;
  }
  /** Whether a node lives in a music section that holds audiobooks. */
  private audiobooks(n: Node): boolean {
    const section = this.sections.get(String(n.librarySectionID ?? ''));
    return !!section && isAudiobookSection(section);
  }
  private title(n: Node): V.Title {
    const projection = plexProjection(n, this.audiobooks(n));
    const ratings: V.TitleRating[] = [];
    for (const [field, image, kind] of [['rating', 'ratingImage', 'critic'], ['audienceRating', 'audienceRatingImage', 'audience']] as const)
      if (n[field] !== undefined) ratings.push({ source: n[image] || 'Plex', kind, value: Number(n[field]), scale: 10 });
    let themeMusic: V.ThemeMusic | undefined;
    if (n.theme) { try { themeMusic = { url: this.mediaURL(n.theme), expiresAt: '9999-12-31T23:59:59Z' }; } catch {} }
    const lastViewedAt = Number(n.lastViewedAt) > 0 ? new Date(Number(n.lastViewedAt) * 1000).toISOString() : undefined;
    return { ...(projection?.media ? { media: projection.media } : {}), id: String(n.ratingKey), kind: projection?.kind ?? n.type, name: n.title || '', summary: n.summary || '', year: n.year, airDate: n.originallyAvailableAt,
      genres: (n.Genre || []).map((g: Node) => g.tag), durationSeconds: seconds(n.duration), rating: n.contentRating, ratings,
      artwork: this.artwork(n), watch: { positionSeconds: seconds(n.viewOffset), played: plexPlayed(n), favorite: false, watchlisted: false, ...(lastViewedAt ? { lastViewedAt } : {}) },
      ...(themeMusic ? { themeMusic } : {}), showId: n.grandparentRatingKey ? String(n.grandparentRatingKey) : n.type === 'season' && n.parentRatingKey != null ? String(n.parentRatingKey) : undefined,
      showName: n.type === 'episode' ? n.grandparentTitle : n.type === 'season' ? n.parentTitle : undefined,
      seasonId: n.type === 'episode' && n.parentRatingKey != null ? String(n.parentRatingKey) : undefined, seasonNumber: n.type === 'season' ? n.index : n.parentIndex, episodeNumber: n.type === 'episode' ? n.index : undefined };
  }
  private entry(n: Node): V.RowEntry {
    if (['collection', 'playlist'].includes(n.type)) return { id: String(n.ratingKey), kind: n.type, targetId: `${n.type}:${n.ratingKey}`, name: n.title, artwork: this.artwork(n), receiptToken: '' };
    // An album of photos opens as a directory of its photos and clips.
    if (isPhotoAlbum(n)) return { id: String(n.ratingKey), kind: 'directory', targetId: `album:${n.ratingKey}`, name: n.title, artwork: this.artwork(n), receiptToken: '' };
    return { id: String(n.ratingKey), kind: 'title', title: this.title(n), receiptToken: '' };
  }
  /** A container's items, each knowing its section (listings name it once, on the container). */
  private nodes(c: Node): Node[] {
    const items: Node[] = c.Metadata || c.Video || c.Directory || [];
    return c.librarySectionID === undefined ? items : items.map(n => n.librarySectionID === undefined ? { ...n, librarySectionID: c.librarySectionID } : n);
  }
  private hub(h: Node): V.Row {
    const key = h.key || h.hubIdentifier;
    const pageable = typeof h.key === 'string' && /^\/(hubs|library)\//.test(h.key);
    const purpose: V.Row['purpose'] = /continue/i.test(key) ? 'continue' : /onDeck|nextUp/i.test(key) ? 'nextUp' : /recentlyAdded/i.test(key) ? 'recentlyAdded' : 'recommendation';
    return { id: key, name: h.title || '', purpose, receiptToken: '', ...page(this.nodes(h).filter(n => SHOWN.includes(n.type)).map(n => this.entry(n)), Number(h.offset || 0), pageable ? h.totalSize ?? (h.more ? Number(h.offset || 0) + this.nodes(h).length + 1 : h.size) : this.nodes(h).length) };
  }
  async home(_fresh?: boolean, signal?: AbortSignal): Promise<Home> {
    this.rotateTransientToken();
    const tokens = await this.config.credentials.get(); if (!tokens) fail('Sign in required', 'auth');
    const [capabilities, rows] = await Promise.all([this.describe(signal), this.rows({}, false, signal)]);
    // The artwork stays the server's own path: the connection's image service sizes it through
    // /photo/:/transcode with the transient token, and refuses a URL that is already a transcode.
    const featured = homeHeroes(rows.items, 'plex', url => url);
    return { viewer: tokens.viewer, capabilities, defaultSkinId: 'cinematic', ...featured };
  }
  async rows(q: V.RowsQuery, _fresh?: boolean, signal?: AbortSignal): Promise<V.Page<V.Row>> {
    const path = q.placement === 'detail' && q.titleId ? `/library/metadata/${enc(q.titleId)}/related` : '/hubs';
    const c = await this.request(path, { count: q.limit || 20 }, 'GET', true, signal);
    // PMS lists every hub type, including ones with nothing in them; an empty, finished hub is not a row.
    const hubs = (c.Hub || []).map((h: Node) => this.hub(h)).filter((row: V.Row) => row.items.length > 0 || row.continuation === 'more');
    // Home: the account's plex.tv watchlist, as far as this server holds it, after Continue Watching.
    if (path === '/hubs') {
      const watchlist = await this.watchlistRow().catch(() => undefined);
      if (watchlist?.items.length) hubs.splice(hubs.findIndex((row: V.Row) => row.purpose !== 'continue') < 0 ? hubs.length : hubs.findIndex((row: V.Row) => row.purpose !== 'continue'), 0, watchlist);
    }
    return page(hubs, 0, hubs.length);
  }
  /** A request to plex.tv's discover service (the account's watchlist) with this server's token. */
  private async discover(path: string, query: Record<string, unknown> = {}, method = 'GET'): Promise<Node> {
    const u = new URL(path, DISCOVER);
    if (u.origin !== DISCOVER) fail('Plex request outside plex.tv');
    for (const [k, v] of Object.entries(query)) if (v !== undefined) u.searchParams.set(k, String(v));
    const tokens = await this.config.credentials.get();
    if (!tokens) fail('Sign in required', 'auth');
    const response = await fetch(u.href, { method, redirect: 'error', credentials: 'omit', headers: { ...plexHeaders(this.device), 'X-Plex-Token': tokens.accessToken } });
    if (!response.ok) throw new VelaError({ class: response.status === 401 || response.status === 403 ? 'auth' : 'source', code: 'plex_discover', message: `Plex watchlist request failed (${response.status})`, retry: { allowed: false } }, response.status);
    const text = await response.text();
    const body = text.trim() ? JSON.parse(text) : {};
    return body.MediaContainer ?? body;
  }
  /**
   * The watchlist belongs to the plex.tv account. Only the chosen server's token is kept (./link),
   * and it is the account's own when the viewer owns the server: then plex.tv answers with it.
   * For anyone else it refuses, and the watchlist stays hidden.
   */
  private watchlistAvailable(): Promise<boolean> {
    this.watchlistProbe ??= this.discover('/library/sections/watchlist/all', { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 1 }).then(() => true, () => false);
    return this.watchlistProbe;
  }
  private async watchlistRow(): Promise<V.Row | undefined> {
    if (!(await this.watchlistAvailable())) return undefined;
    const c = await this.discover('/library/sections/watchlist/all', { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 40, sort: 'watchlistedAt:desc' });
    // Each watchlisted title as this server holds it (by its plex:// guid); titles it lacks are left out.
    const local = await Promise.all(this.nodes(c).filter(n => typeof n.guid === 'string' && /^plex:\/\/(movie|show)\//.test(n.guid)).map(n =>
      this.request('/library/all', { guid: n.guid }).then(found => this.nodes(found)[0]).catch(() => undefined)));
    const items = local.filter((n): n is Node => !!n && SHOWN.includes(n.type)).map(n => this.entry(n));
    return { id: 'plex:watchlist', name: 'Watchlist', purpose: 'recommendation', receiptToken: '', items, continuation: 'exhausted' };
  }
  async libraryRows(id: string, _kind: V.Library['kind']): Promise<V.Row[]> {
    const c = await this.request(`/hubs/sections/${enc(id)}`, { count: 20 });
    return (c.Hub || []).map((h: Node) => this.libraryHub(h)).filter((row: V.Row) => row.items.length > 0 || row.continuation === 'more');
  }
  private libraryHub(h: Node): V.Row {
      const row = this.hub(h);
      const genres: V.RowEntry[] = this.nodes(h).flatMap(n => {
        if (n.type !== 'genre') return [];
        const genre = this.genreId(n);
        return genre && n.title ? [{ id: `genre:${genre}`, kind: 'directory' as const, targetId: `vela-library-genre:${encodeURIComponent(genre)}`, name: n.title, artwork: [], receiptToken: '' }] : [];
      });
      return genres.length ? { ...row, ...page([...row.items, ...genres], Number(h.offset || 0), h.totalSize ?? (h.more ? Number(h.offset || 0) + this.nodes(h).length + 1 : h.size)) } : row;
  }
  async libraryCollections(id: string, cursor?: string): Promise<V.Page<V.RowEntry>> {
    const start = offset(cursor);
    const c = await this.request(`/library/sections/${enc(id)}/collections`, { 'X-Plex-Container-Start': start, 'X-Plex-Container-Size': 100 });
    return page(this.nodes(c).filter(n => n.type === 'collection').map(n => this.entry(n)), start, c.totalSize ?? c.size);
  }
  async libraryJumpIndex(id: string, query?: Pick<V.LibraryBrowseQuery, 'tab' | 'sort' | 'direction'>): Promise<LibraryJumpBucket[]> {
    if ((query?.sort ?? 'title') !== 'title' || (query?.direction ?? 'asc') !== 'asc' || query?.tab) return [];
    if (!this.sections.has(id)) await this.libraries({});
    const section = this.sections.get(id);
    if (!section || (section.type !== 'movie' && section.type !== 'show')) return [];
    // Same parameters as /all for movie and show sections (no type or includeCollections), so offsets line up.
    const c = await this.request(`/library/sections/${enc(id)}/firstCharacter`);
    return parsePlexJumpIndex(c.Directory);
  }
  async libraryGenres(id: string): Promise<{ id: string; label: string }[]> {
    const c = await this.request(`/library/sections/${enc(id)}/genre`);
    return (c.Directory || []).flatMap((n: Node) => {
      if (!n.title) return [];
      const genre = this.genreId(n);
      return genre ? [{ id: genre, label: n.title }] : [];
    });
  }
  private genreId(n: Node): string {
    // PMS may return a relative key or a fastKey URL; /all's genre filter needs the tag ID.
    const key = String(n.fastKey ?? n.key ?? '');
    const parsed = new URL(key, this.origin);
    return parsed.searchParams.get('genre') ?? (/^\d+$/.test(key) ? key : '');
  }
  async row(id: string, cursor?: string, limit = 20): Promise<V.Row> {
    if (!id.startsWith('/hubs/') && !id.startsWith('/library/')) fail('Invalid Plex hub');
    const c = await this.request(id, { 'X-Plex-Container-Start': offset(cursor), 'X-Plex-Container-Size': limit });
    const hub = { ...c, key: id, title: c.title || c.title2 };
    return id.startsWith('/hubs/sections/') ? this.libraryHub(hub) : this.hub(hub);
  }
  private libraryNode(n: Node): V.Library {
    const sorts: V.LibrarySort[] = ['title', 'added', 'released', 'year', 'rating', 'duration'];
    const base = { id: String(n.key), name: n.title, artwork: this.artwork(n) };
    const browse = (filters: V.LibraryBrowseOptions['filters']): V.LibraryBrowseOptions => ({ sorts: sorts.map(id => ({ id, directions: ['asc', 'desc'] })), defaultSort: 'title', defaultDirection: 'asc', filters });
    const tab = (id: string, label: string, kind: V.LibraryTab['kind'], extra: Partial<V.LibraryTab> = {}): V.LibraryTab => ({ id, label, kind, ...extra });
    if (n.type === 'artist') return isAudiobookSection(n)
      ? { ...base, kind: 'mixed', media: 'audiobook', presentation: { card: 'square' }, browse: browse({ genre: true, year: true, played: true }),
          tabs: [tab('recommended', 'Recommended', 'recommended'), tab('library', 'Audiobooks', 'library'), tab('authors', 'Authors', 'library', { level: 'artist' })] }
      : { ...base, kind: 'mixed', media: 'music', presentation: { card: 'square' }, browse: browse({ genre: true, year: true, played: true }),
          tabs: [tab('recommended', 'Recommended', 'recommended'), tab('albums', 'Albums', 'library'), tab('artists', 'Artists', 'library', { level: 'artist' }), tab('tracks', 'Songs', 'library', { level: 'track', layout: 'list' })] };
    if (n.type === 'photo') return { ...base, kind: 'mixed', media: 'photo', presentation: { card: 'square' }, dateDisplay: 'date', browse: browse({ year: true }),
      tabs: [tab('recommended', 'Recommended', 'recommended'), tab('library', 'Library', 'library')] };
    return { ...base, kind: n.type === 'movie' ? 'movies' : n.type === 'show' ? 'shows' : 'mixed', browse: browse({ genre: true, year: true, played: true }) };
  }
  async libraries(q: V.LibrariesQuery): Promise<V.Page<V.Library>> {
    const c = await this.request('/library/sections'); const all = (c.Directory || []).filter((n: Node) => ['movie', 'show', 'artist', 'photo'].includes(n.type));
    this.sections = new Map(all.map((n: Node) => [String(n.key), n]));
    return page(all.slice(offset(q.cursor), offset(q.cursor) + (q.limit || 100)).map((n: Node) => this.libraryNode(n)), offset(q.cursor), all.length);
  }
  async library(id: string, q: V.LibraryBrowseQuery): Promise<V.LibraryContents> {
    const libraries = await this.libraries({}); const library = libraries.items.find(l => l.id === id); if (!library) fail('Plex library not found', 'not-found');
    const sorts: Record<string,string> = { title: 'titleSort', added: 'addedAt', released: 'originallyAvailableAt', year: 'year', rating: 'rating', duration: 'duration' };
    const sort = q.sort || 'title'; if (!sorts[sort] || q.favorite !== undefined || q.kind !== undefined) fail('Unsupported Plex library filter or sort');
    const direction = q.direction || 'asc';
    // A music section lists albums first; its tabs list artists (or a book section's authors) and songs.
    const section = this.sections.get(id);
    const type = section?.type === 'artist' ? (q.tab === 'artists' || q.tab === 'authors' ? 8 : q.tab === 'tracks' ? 10 : 9) : undefined;
    const c = await this.request(`/library/sections/${enc(id)}/all`, { type, sort: `${sorts[sort]}:${direction}`, genre: q.genre, year: q.year, unwatched: q.played === undefined ? undefined : q.played ? 0 : 1,
      'X-Plex-Container-Start': offset(q.cursor), 'X-Plex-Container-Size': q.limit || 100 });
    return { library, sort, direction, ...page(this.nodes(c).map(n => this.entry(n)), offset(q.cursor), c.totalSize ?? c.size), ...(c.totalSize !== undefined ? { total: Number(c.totalSize) } : {}) };
  }
  async personTitles(id: string, libraryId?: string, cursor?: string): Promise<V.Page<V.RowEntry>> {
    const libraries = libraryId ? [libraryId] : (await this.libraries({})).items.map(l => l.id);
    const start = offset(cursor);
    if (libraryId) {
      const c = await this.request(`/library/sections/${enc(libraryId)}/all`, { actor: id, 'X-Plex-Container-Start': start, 'X-Plex-Container-Size': 100 });
      return page(this.nodes(c).map(n => this.entry(n)), start, c.totalSize);
    }
    const results = await Promise.all(libraries.map(async library => {
      const entries: V.RowEntry[] = [];
      let next = 0;
      for (;;) {
        const c = await this.request(`/library/sections/${enc(library)}/all`, { actor: id, 'X-Plex-Container-Start': next, 'X-Plex-Container-Size': 100 });
        const items = this.nodes(c);
        entries.push(...items.map(n => this.entry(n)));
        next += items.length;
        if (!items.length || next >= (c.totalSize ?? next)) break;
      }
      return entries;
    }));
    const all = results.flat();
    return page(all.slice(start, start + 100), start, all.length);
  }
  async collection(id: string, cursor?: string, limit = 100): Promise<V.CollectionContents> {
    if (isPhotoAlbumKey(id)) {
      const key = id.slice(6), start = offset(cursor);
      const [album, children] = await Promise.all([this.metadata(key), this.request(`/library/metadata/${enc(key)}/children`, { 'X-Plex-Container-Start': start, 'X-Plex-Container-Size': limit })]);
      return { collection: { id, kind: 'directory', name: album.title || '', summary: album.summary, artwork: this.artwork(album) },
        ...page(this.nodes(children).filter(n => SHOWN.includes(n.type)).map(n => this.entry(n)), start, children.totalSize ?? children.size) };
    }
    const [kind, key] = id.includes(':') ? id.split(':') : ['collection', id];
    const base = kind === 'playlist' ? `/playlists/${enc(key)}` : `/library/collections/${enc(key)}`;
    const start = offset(cursor);
    const c = await this.request(base); const n = this.nodes(c)[0] || c;
    const children = await this.request(`${base}/${kind === 'playlist' ? 'items' : 'children'}`, { 'X-Plex-Container-Start': start, 'X-Plex-Container-Size': limit });
    // PMS reports the whole collection's totalSize; size alone is only this page.
    return { collection: { id, kind: kind === 'playlist' ? 'playlist' : 'collection', name: n.title || '', summary: n.summary, artwork: this.artwork(n) }, ...page(this.nodes(children).map(n => this.entry(n)), start, children.totalSize) };
  }
  private async metadata(id: string): Promise<Node> {
    const c = await this.request(`/library/metadata/${enc(id)}`, { includeExtras: 1, includeChapters: 1, includeOnDeck: 1, includeMarkers: 1 });
    const n = this.nodes(c)[0]; if (!n) fail('Plex title not found', 'not-found');
    if (n.librarySectionID !== undefined && !this.sections.has(String(n.librarySectionID))) await this.libraries({}).catch(() => undefined);
    return n;
  }
  /** An artist's albums (newest first), an album's tracks, a photo album's photos. */
  async children(id: string, cursor?: string, limit = 100): Promise<V.ChildrenPage> {
    const start = offset(cursor);
    if (!this.sections.size) await this.libraries({}).catch(() => undefined);
    const c = await this.request(`/library/metadata/${enc(id)}/children`, { 'X-Plex-Container-Start': start, 'X-Plex-Container-Size': limit, excludeAllLeaves: 1 });
    const nodes = this.nodes(c).filter(n => plexProjection(n) !== undefined);
    if (nodes[0]?.type === 'album') nodes.sort((a, b) => Number(b.year || 0) - Number(a.year || 0));
    return page(nodes.map(n => this.title(n)), start, c.totalSize ?? (nodes.length < limit ? start + nodes.length : undefined));
  }
  async detail(id: string): Promise<V.TitleDetail> {
    const n = await this.metadata(id);
    const series = n.type === 'show' || n.type === 'season';
    const children = series ? await this.every(id, 'children') : [];
    const episodes = n.type === 'show' ? await this.every(id, 'allLeaves') : n.type === 'season' ? children : undefined;
    let nextUp: V.Title | null | undefined;
    if (series) {
      const deck = n.OnDeck ?? {};
      const next = this.nodes(deck)[0];
      nextUp = next ? this.title(next) : null;
    }
    // Match the release/part initial playback uses, rather than counting every alternate release.
    const part = n.Media?.[0]?.Part?.[0];
    const streams: Node[] = part?.Stream ?? [];
    const audio = streams.filter(s => Number(s.streamType) === 2);
    const mainAudio = audio.find(s => Number(s.selected) === 1) ?? audio.find(s => Number(s.default) === 1);
    const person = (p: Node, role?: string) => ({ ...(p.id != null ? { id: String(p.id) } : {}), name: p.tag, role: role || p.role, artwork: p.thumb ? { ...this.artwork({ thumb: p.thumb })[0], kind: 'person' as const } : undefined });
    return { title: this.title(n), canPlay: ['movie', 'episode', 'track', 'clip'].includes(n.type) && !!n.Media?.length, seasons: n.type === 'show' ? seriesOrder(children) : undefined, episodes: episodes ? seriesOrder(episodes) : undefined, nextUp,
      cast: (n.Role || []).map((p: Node) => person(p)), crew: [...(n.Director || []).map((p: Node) => person(p, 'Director')), ...(n.Writer || []).map((p: Node) => person(p, 'Writer'))],
      chapters: this.chapters(n), extras: (n.Extras?.Metadata || []).map((e: Node) => ({ id: String(e.ratingKey), parentId: id, kind: Number(e.extraType) === 1 ? 'trailer' : 'other', name: e.title, durationSeconds: seconds(e.duration), artwork: this.artwork(e)[0], availability: e.Media?.length ? 'ready' : 'unresolved' })),
      mediaSummary: {
        video: streams.filter(s => Number(s.streamType) === 1).map(s => ({ codec: s.codec, width: s.width, height: s.height, bitDepth: s.bitDepth, colorTransfer: s.colorTrc,
          ...(s.DOVIProfile !== undefined ? { dolbyVisionProfile: Number(s.DOVIProfile) } : {}) })),
        audio: audio.map(s => ({ codec: s.codec, channels: s.channels, language: s.languageCode, ...(s === mainAudio ? { default: true } : {}) })),
        ...(part?.Stream ? { subtitleCount: streams.filter(s => Number(s.streamType) === 3).length } : {}),
      } };
  }
  private async every(id: string, kind: 'children' | 'allLeaves'): Promise<V.Title[]> {
    const items: V.Title[] = [];
    for (;;) {
      const c = await this.request(`/library/metadata/${enc(id)}/${kind}`, { 'X-Plex-Container-Start': items.length, 'X-Plex-Container-Size': 200, excludeAllLeaves: kind === 'children' ? 1 : undefined });
      const nodes = this.nodes(c);
      items.push(...nodes.map(n => this.title(n)));
      if (!nodes.length || (c.totalSize !== undefined ? items.length >= c.totalSize : nodes.length < 200)) return items;
    }
  }
  private chapters(n: Node): V.Chapter[] { return (n.Chapter || []).map((c: Node) => ({ id: String(c.id), name: c.tag || `Chapter ${Number(c.index || 0) + 1}`, startSeconds: seconds(c.startTimeOffset), endSeconds: c.endTimeOffset === undefined ? undefined : seconds(c.endTimeOffset) })); }
  async search(r: CatalogueSearch, signal?: AbortSignal): Promise<V.SearchResponse> {
    const c = await this.request(r.library ? `/library/sections/${enc(r.library)}/search` : '/hubs/search', { query: r.query, limit: r.limit || 30, type: r.kind === 'movie' ? 1 : r.kind === 'show' ? 2 : undefined }, 'GET', true, signal);
    const seen = new Set<string>(); const all = (r.library ? this.nodes(c) : (c.Hub || []).flatMap((h: Node) => this.nodes(h))).filter((n: Node) => (r.kind ? n.type === r.kind : SEARCHED.includes(n.type)) && plexProjection(n) !== undefined && !seen.has(String(n.ratingKey)) && !!seen.add(String(n.ratingKey)));
    return { query: r.query, generation: r.generation, ...page(all.map((n: Node) => this.title(n)), 0, all.length) };
  }
  async titleActions(id: string): Promise<TitleActions> {
    const n = await this.metadata(id);
    const versions = (n.Media || []).flatMap((m: Node, index: number) => {
      const release = [m.editionTitle || n.editionTitle, m.videoResolution && `${m.videoResolution}p`].filter(Boolean).join(' · ') || `Version ${index + 1}`;
      const audio = (m.Part || []).flatMap((p: Node) => (p.Stream || []).filter((t: Node) => Number(t.streamType) === 2));
      return audio.length > 1 ? audio.map((t: Node) => ({ id: String(m.id ?? index), audioTrackId: String(t.id), name: `${release} · ${t.displayTitle || t.language || t.languageCode || t.codec}` })) : [{ id: String(m.id ?? index), name: release }];
    });
    const key = discoverKey(n);
    const watchlist = !!key && await this.watchlistAvailable();
    const watchlisted = watchlist ? await this.discover(`/library/metadata/${enc(key)}/userState`).then(c => {
      const state = Array.isArray(c.UserState) ? c.UserState[0] : c.UserState;
      return !!state?.watchlistedAt;
    }).catch(() => false) : false;
    // Plex keeps no favourites: only watched state, Continue Watching and the account's watchlist.
    return { watched: true, favorite: false, watchlist, removeFromContinue: true, watch: { ...this.title(n).watch!, watchlisted }, versions };
  }

  async setTitleWatch(id: string, change: V.WatchRequest) {
    if (change.favorite !== undefined) fail('Plex keeps no favourites');
    if (change.watchlisted !== undefined) {
      const key = discoverKey(await this.metadata(id));
      if (!key || !(await this.watchlistAvailable())) fail('The Plex watchlist is unavailable for this account');
      await this.discover(`/actions/${change.watchlisted ? 'addToWatchlist' : 'removeFromWatchlist'}`, { ratingKey: key }, 'PUT');
    }
    if (change.played !== undefined) await this.request(change.played ? '/:/scrobble' : '/:/unscrobble', { key: id, identifier: 'com.plexapp.plugins.library' }, 'PUT');
    if (change.continueWatching === false) await this.request('/actions/removeFromContinueWatching', { ratingKey: id }, 'PUT');
  }
  /** Plex publishes no list: its search takes ISO 639-1 codes, so the ones Vela can name. */
  async subtitleLanguages(_sessionId: string): Promise<SubtitleLanguages> {
    return { languages: KNOWN_SUBTITLE_LANGUAGES.map(code => ({ code })), preferred: [] };
  }
  async searchSubtitles(sessionId: string, language?: string): Promise<SubtitleSearchResult> {
    const s = this.session(sessionId);
    const searched = iso6391(language ?? pickSubtitleLanguage(KNOWN_SUBTITLE_LANGUAGES.map(code => ({ code })), deviceLanguages()) ?? 'en');
    const result = await this.request(`/library/metadata/${enc(s.plan.titleId!)}/subtitles`, { language: searched });
    return { language: searched, preferred: [], offers: (result.Stream || []).map((t: Node) => plexSubtitleOffer(t, searched)) };
  }
  async downloadSubtitle(sessionId: string, id: string, _idempotencyKey?: string): Promise<V.PlaybackPlan> {
    const s = this.session(sessionId);
    // The selected provider key is opaque and sent as a parameter, never followed as a URL.
    await this.request(`/library/metadata/${enc(s.plan.titleId!)}/subtitles`, { key: id }, 'PUT');
    let n = await this.metadata(s.plan.titleId!);
    for (let attempt = 0; attempt < 20; attempt++) {
      const streams = (n.Media || []).flatMap((m: Node) => m.Part || []).filter((p: Node) => String(p.id) === String(s.part.id)).flatMap((p: Node) => p.Stream || []);
      if (streams.some((t: Node) => Number(t.streamType) === 3 && t.key && !s.plan.subtitleTracks.some(p => p.id === String(t.id)))) break;
      await new Promise(resolve => setTimeout(resolve, 500));
      n = await this.metadata(s.plan.titleId!);
    }
    const part = (n.Media || []).flatMap((m: Node) => m.Part || []).find((p: Node) => String(p.id) === String(s.part.id));
    for (const t of part?.Stream || []) {
      if (Number(t.streamType) !== 3 || !t.key || s.plan.subtitleTracks.some(p => p.id === String(t.id))) continue;
      const sidecar = plexSidecar(new URL(this.mediaURL(t.key)), t.codec, s.request?.client.subtitleFormats ?? []);
      s.plan.subtitleTracks.push({ id: String(t.id), kind: 'subtitle', name: t.displayTitle || t.language || 'Subtitle', language: t.languageCode || 'und',
        codec: sidecar.format === 'ass' ? String(t.codec).toLowerCase() : 'webvtt', delivery: { kind: 'external', format: sidecar.format, url: sidecar.url } });
    }
    s.plan.revision++;
    return structuredClone(s.plan);
  }
  /** A movie's or episode's files, when it has several: Plex has no remembered or pinned choice. */
  private versions(n: Node): V.VersionItem[] {
    const media: Node[] = ['movie', 'episode', 'clip'].includes(n.type) ? n.Media ?? [] : [];
    return media.length > 1 ? media.map(plexVersion) : [];
  }
  async titleVersions(id: string): Promise<V.TitleVersions> {
    return { titleId: id, selectedVersionId: null, versions: this.versions(await this.metadata(id)) };
  }
  async clearVersionChoice(id: string, _request: V.ClearVersionChoiceRequest): Promise<V.ClearVersionChoiceResponse> {
    return { ...(await this.titleVersions(id)), cleared: false };
  }
  /** Whether the signed-in account may download original files from this Plex server (`allowSync`). */
  async downloadsAvailable(): Promise<boolean> {
    if (this.allowSync !== undefined) return this.allowSync;
    try {
      const root = await this.request('/');
      if (root.allowSync !== undefined) {
        this.allowSync = root.allowSync === true || root.allowSync === 1 || root.allowSync === '1';
        return this.allowSync;
      }
    } catch {
      // If the root container does not state allowSync, let the part request enforce server policy.
    }
    return true;
  }
  /**
   * Resolve a movie or episode's original file for offline download: `GET {Part.key}?download=1`
   * with `mediaHeaders()`, plus external text subtitle sidecars and poster artwork. Multi-part
   * stacked items are refused because they play through the server's HLS stream.
   */
  async resolveDownload(titleId: string, options?: ResolveDownloadOptions): Promise<DownloadResolution> {
    const n = await this.metadata(titleId);
    if (!['movie', 'episode', 'clip'].includes(n.type)) {
      fail('Only movies and episodes can be downloaded for offline playback');
    }
    if (n.allowSync === false || n.allowSync === 0 || n.allowSync === '0' || this.allowSync === false) {
      throw new VelaError({ class: 'policy', code: 'download_not_allowed', message: 'Downloads are not allowed for this account on this Plex server', retry: { allowed: false } }, 403);
    }
    const mediaList: Node[] = n.Media ?? [];
    const chosen = options?.versionId;
    const media = chosen ? mediaList.find((m: Node, index: number) => mediaId(m, index) === chosen) : mediaList[0];
    if (chosen && !media) fail('Unknown Plex version');
    if (!media) fail('Plex title has no downloadable media', 'playback');
    const parts: Node[] = media.Part ?? [];
    if (!parts.length || !parts[0]?.key) fail('Plex title has no downloadable media', 'playback');
    if (parts.length > 1) fail('This title is in several parts, which play through the server\'s stream', 'playback');
    const part = parts[0]!;
    const mediaIndex = Math.max(0, mediaList.indexOf(media));
    const version = plexVersion(media, mediaIndex);
    const subtitleFormats = options?.subtitleFormats ?? ['ass', 'ssa', 'webvtt', 'vtt', 'srt'];
    const streams: Node[] = part.Stream ?? [];
    const sidecars: DownloadSidecar[] = [];
    const audioTracks: V.Track[] = streams.filter(s => Number(s.streamType) === 2).map(s => ({
      id: String(s.id),
      streamIndex: s.index,
      kind: 'audio',
      language: s.languageCode || 'und',
      name: s.displayTitle || s.title || s.language || s.codec || '',
      codec: s.codec || '',
      channels: s.channels,
      default: !!s.selected,
      forced: !!s.forced,
      hearingImpaired: !!s.hearingImpaired,
    }));
    const subtitleTracks: V.Track[] = [];
    for (const s of streams.filter(st => Number(st.streamType) === 3)) {
      const id = String(s.id);
      const base: V.Track = {
        id,
        streamIndex: s.index,
        kind: 'subtitle',
        language: s.languageCode || 'und',
        name: s.displayTitle || s.title || s.language || s.codec || '',
        codec: s.codec || '',
        default: !!s.selected,
        forced: !!s.forced,
        hearingImpaired: !!s.hearingImpaired,
      };
      if (s.key && isTextSidecar(s.codec)) {
        const external = plexSidecar(new URL(this.mediaURL(s.key)), s.codec, subtitleFormats);
        sidecars.push({ trackId: id, format: external.format, url: external.url });
        subtitleTracks.push({
          ...base,
          ...(external.format === 'webvtt' ? { url: external.url } : {}),
          delivery: { kind: 'external', format: external.format, url: external.url },
        });
      } else if (!s.key) {
        // Embedded text and bitmap (PGS/VobSub) tracks inside the original file are rendered by libmpv offline.
        subtitleTracks.push({ ...base, delivery: { kind: 'embedded' } });
      }
    }
    const playing = playingAudio(streams, media.audioCodec);
    const selectedAudioTrackId = audioTracks.find(t => t.default)?.id ?? playing.id ?? audioTracks[0]?.id;
    const selectedSubtitleTrackId = subtitleTracks.find(t => t.default)?.id ?? null;
    const downloadUrl = new URL(this.mediaURL(part.key));
    downloadUrl.searchParams.set('download', '1');
    const container = String(part.container || media.container || 'mkv').toLowerCase();
    const mimeType = container === 'mp4' || container === 'm4v' ? 'video/mp4' : container === 'webm' ? 'video/webm' : 'video/x-matroska';
    const title = this.title({ ...n, duration: media.duration ?? n.duration });
    const posterUrl = title.artwork.find(a => a.kind === 'poster')?.sizes[0]?.url ?? title.artwork[0]?.sizes[0]?.url;
    const markers = plexMarkers(n);
    const byteLength = Number(part.size) > 0 ? Number(part.size) : undefined;
    return {
      title,
      versionId: version.id,
      versionLabel: version.label,
      url: downloadUrl.href,
      headers: await this.mediaHeaders(),
      mimeType,
      container,
      ...(byteLength ? { byteLength } : {}),
      ...(part.id != null ? { sourceId: String(part.id) } : {}),
      ...(media.videoCodec ? { originalVideo: { codec: String(media.videoCodec), width: media.width, height: media.height } } : {}),
      audioTracks,
      subtitleTracks,
      ...(selectedAudioTrackId ? { selectedAudioTrackId } : {}),
      selectedSubtitleTrackId,
      chapters: this.chapters(n),
      ...(markers ? { markers } : {}),
      sidecars,
      ...(posterUrl ? { posterUrl } : {}),
    };
  }
  async startPlayback(r: V.PlaybackRequest): Promise<V.PlaybackPlan> {
    for (const s of this.sessions.values()) if (s.mutations.has(r.idempotencyKey)) return s.mutations.get(r.idempotencyKey)!;
    if (r.channelId) return this.livePlayback(r);
    const id = r.titleId || r.extraId!; const n = await this.metadata(id);
    const chosen = r.versionId ?? r.mediaSourceId;
    const media = chosen ? n.Media?.find((m: Node, index: number) => mediaId(m, index) === chosen) : n.Media?.[0];
    if (r.versionId && !media) fail('Unknown Plex version');
    const parts: Node[] = media?.Part ?? [];
    if (!parts.length) fail('Plex title has no playable media', 'playback');
    if (n.type === 'track') return this.audioPlayback(r, id, n, media, parts[0]!);
    const duration = fileSeconds(media, n);
    const start = inside(r.positionSeconds ?? seconds(n.viewOffset), duration);
    const sessionId = `vela-${randomId()}`;
    const source = await this.videoSource(r, id, n, media, start, sessionId);
    const versions = r.titleId ? this.versions(n) : [];
    const markers = r.extraId ? undefined : plexMarkers(n);
    const plan: V.PlaybackPlan = { sessionId, revision: 1, sourceGeneration: 0, seekGeneration: 0,
      ...(r.extraId ? { extraId: id } : { titleId: id }), ...(markers ? { markers } : {}), state: 'ready', positionSeconds: start, durationSeconds: duration, ...source.plan, chapters: this.chapters(n),
      fallback: { state: 'unsupported', reason: 'Plex does not expose proactive preparation; select the HLS path to start transcoding' },
      ...(versions.length ? { selectedVersionId: mediaId(media, n.Media.indexOf(media)), versions } : {}) };
    this.sessions.set(sessionId, { plan, part: source.part, metadata: n, sequence: -1, pending: Promise.resolve(), sessionWork: new AbortController(), mutations: new Map([[r.idempotencyKey, structuredClone(plan)]]),
      request: { client: r.client, allowTranscode: r.allowTranscode }, ...(source.stack ? { stack: source.stack } : {}), ...(source.deferred ? { deferred: source.deferred } : {}),
      ...(source.partAudio ? { partAudio: source.partAudio } : {}),
      ...(source.transcodeId ? { transcodeId: source.transcodeId } : {}), ...(markers || r.extraId ? {} : { markers: { at: Date.now(), asked: 0, reading: false } }) });
    return structuredClone(plan);
  }
  /**
   * The paths and tracks for one of a video title's files from a title position: the original
   * file where the client plays it, and the server's stream (as transcode session `transcodeId`).
   */
  private async videoSource(r: Pick<V.PlaybackRequest, 'client' | 'allowTranscode' | 'audioTrackId' | 'subtitleTrackId'>, id: string, n: Node, media: Node, start: number, transcodeId: string, signal?: AbortSignal) {
    const parts: Node[] = media.Part ?? [];
    if (!parts.length) fail('Plex title has no playable media', 'playback');
    // A movie stacked from several files plays them in turn through one session: each part is
    // transcoded (remuxed where it can be) on the title's timeline, and the session moves on at its end.
    const stacked = parts.length > 1;
    const at = partAt(parts, start);
    const part = stacked ? parts[at.index]! : parts[0]!;
    if (stacked && (r.allowTranscode === false || !(r.client.hls || r.client.mse))) fail('This title is in several parts, which play through the server\'s stream', 'playback');
    const streams: Node[] = part.Stream || [];
    const tracks = (type: number): V.Track[] => streams.filter(s => Number(s.streamType) === type).map(s => {
      const external = !!s.key && isTextSidecar(s.codec) ? plexSidecar(new URL(this.mediaURL(s.key)), s.codec, r.client.subtitleFormats ?? []) : undefined;
      return { id: String(s.id), streamIndex: s.index,
        kind: type === 2 ? 'audio' : 'subtitle', language: s.languageCode || 'und', name: s.displayTitle || s.title || s.language || s.codec || '', codec: s.codec || '', channels: s.channels,
        default: !!s.selected, forced: !!s.forced, hearingImpaired: !!s.hearingImpaired,
        ...(type === 3 ? external
          ? { ...(external.format === 'webvtt' ? { url: external.url } : {}), delivery: { kind: 'external' as const, format: external.format, url: external.url } }
          // A native-HLS-only web page cannot read subtitle packets from the original file. Mark
          // its embedded tracks server-rendered so a later selection switches to Plex HLS and
          // requests a burn instead of presenting an unusable local track.
          : { delivery: s.key || !r.client.originalPlayback ? { kind: 'burn-in' as const } : { kind: 'embedded' as const } } : {}) };
    });
    const audioTracks = tracks(2), subtitleTracks = tracks(3);
    const audio = r.audioTrackId || audioTracks.find(t => t.default)?.id;
    const subtitle = r.subtitleTrackId === undefined ? subtitleTracks.find(t => t.default)?.id || null : r.subtitleTrackId;
    if (audio && !audioTracks.some(t => t.id === audio) || subtitle && !subtitleTracks.some(t => t.id === subtitle)) fail('Unknown Plex track');
    const burnSubtitle = subtitle ? subtitleTracks.find(t => t.id === subtitle)?.delivery?.kind === 'burn-in' : false;
    const playing = playingAudio(streams, media.audioCodec, audio);
    const direct = playsOriginal(r.client, media, playing.codec) && !burnSubtitle && !stacked;
    // Plex states a file's rate in kb/s. An over-cap original requires an explicit switch.
    const capped = !fitsStreamingCap(media, r.client);
    if (!direct && r.allowTranscode === false) fail(burnSubtitle ? 'Selected Plex subtitle requires transcoding' : 'Original media is incompatible and transcoding is disabled', 'playback');
    // Plex part stream selection is viewer state; perform only explicit preferences.
    if (r.audioTrackId !== undefined || r.subtitleTrackId !== undefined) await this.request(`/library/parts/${enc(String(part.id))}`, { audioStreamID: r.audioTrackId, subtitleStreamID: r.subtitleTrackId === null ? 0 : r.subtitleTrackId, allParts: 1 }, 'PUT', true, signal);
    const paths: V.PlaybackPath[] = [];
    if (direct) paths.push({ id: 'original', kind: 'direct', transport: 'file', mimeType: media.container === 'mp4' ? 'video/mp4' : media.container === 'webm' ? 'video/webm' : 'video/x-matroska',
      readiness: 'ready', url: this.mediaURL(part.key), original: true, range: true, byteLength: Number(part.size) || undefined, sourceId: String(part.id), timelineId: String(part.id), timelineOriginSeconds: 0,
      originalVideo: { codec: media.videoCodec, width: media.width, height: media.height }, qualities: [], boundaries: [] });
    let deferred: Record<string, string> | undefined, streamed: string | undefined;
    if (r.allowTranscode !== false && (r.client.hls || r.client.mse)) {
      const query = Object.fromEntries(Object.entries({ path: `/library/metadata/${id}`, mediaIndex: n.Media.indexOf(media), partIndex: stacked ? at.index : 0, protocol: 'hls', directPlay: 0, directStream: 1,
        session: transcodeId, offset: stacked ? at.inPart : 0, fastSeek: 1, 'X-Plex-Client-Identifier': this.config.clientIdentifier,
        maxVideoBitrate: Math.floor((r.client.maxBitrate || 20000000) / 1000), videoResolution: `${r.client.maxWidth || 1920}x${r.client.maxHeight || 1080}`,
        subtitleStreamID: subtitle || 0, subtitles: burnSubtitle ? 'burn' : 'auto', subtitleSize: 100, audioBoost: 100 }).map(([key, value]) => [key, String(value)]));
      const hls = { id: 'plex-hls', kind: 'transcode' as const, transport: 'hls' as const, mimeType: 'application/vnd.apple.mpegurl',
        sourceId: String(part.id), timelineId: String(part.id), timelineOriginSeconds: stacked ? start : 0, qualities: [], boundaries: [] };
      if (direct && !capped) {
        // The original plays: the stream stays a choice, decided when a switch or a track first needs it.
        paths.push({ ...hls, readiness: 'on-demand' });
        deferred = query;
      } else {
        const stream = await this.serverStream(query, r.client, !!direct, signal);
        if (stream && direct) paths.unshift({ ...hls, readiness: 'ready', ...stream.path });
        else if (stream) paths.push({ ...hls, readiness: 'ready', ...stream.path });
        streamed = stream?.session;
      }
    }
    if (capped && !paths.some(path => path.id === 'plex-hls')) {
      throw new VelaError({ class: 'playback', code: 'plex_streaming_cap',
        message: 'Plex cannot stream this title within the selected quality cap. Choosing Original removes the cap for this network type.',
        retry: { allowed: false } }, 400);
    }
    if (!paths.length) fail('No compatible Plex playback path', 'playback');
    const hls = paths.find(p => p.id === 'plex-hls');
    // The track admission judged (an inferred default or first one too) is the one the player opens. A stacked
    // title's parts have their own stream ids, so an inferred one stays out of its plan and its part restarts.
    return { part, partAudio: audio, plan: { paths, selectedPathId: paths[0]!.id, audioTracks, subtitleTracks, selectedAudioTrackId: stacked ? audio : audio ?? playing.id, selectedSubtitleTrackId: subtitle },
      ...(stacked && hls?.url ? { stack: { parts, index: at.index, query: Object.fromEntries(new URL(hls.url).searchParams) } } : {}), ...(deferred ? { deferred } : {}),
      ...(streamed ? { transcodeId: streamed } : {}) };
  }
  /**
   * Another of the playing title's files, in the same session from the given position (else the
   * session's, kept inside the file): its paths and tracks chosen as at a start, then the stream that
   * may still run stopped.
   */
  switchVersion(sessionId: string, r: Extract<V.SessionCommand, { kind: 'version' }>): Promise<V.PlaybackPlan> {
    return this.mutate(sessionId, r, async (s, signal) => {
      const listed = s.plan.versions?.some(v => v.id === r.versionId);
      const media: Node | undefined = listed ? s.metadata.Media?.find((m: Node, index: number) => mediaId(m, index) === r.versionId) : undefined;
      if (!media || !s.request || !s.plan.titleId) fail('Unknown Plex version');
      const asked = r.positionSeconds ?? s.plan.positionSeconds;
      if (!Number.isFinite(asked) || asked < 0) fail('Invalid playback position');
      const duration = fileSeconds(media, s.metadata);
      const at = inside(asked, duration);
      const transcodeId = `${sessionId}-${s.plan.sourceGeneration + 1}`;
      const source = await this.videoSource(s.request, s.plan.titleId, s.metadata, media, at, transcodeId, signal);
      // The stream is stopped only where it plays: one left for the file was stopped when it was left.
      if (s.plan.selectedPathId === 'plex-hls') await this.stopTranscode(s.transcodeId ?? sessionId, false, signal);
      signal.throwIfAborted();
      s.part = source.part;
      s.transcodeId = source.transcodeId ?? transcodeId;
      // Scrub thumbnails are the file's own (its part's index); markers are the title's and stay.
      delete s.thumbnails;
      if (source.stack) s.stack = source.stack; else delete s.stack;
      if (source.deferred) s.deferred = source.deferred; else delete s.deferred;
      // Nothing was written to the part: the start's selection may no longer be the part's, so its audio is not known.
      delete s.partAudio;
      // Tracks belong to the file: the new one starts on its own defaults.
      s.plan = { ...s.plan, ...source.plan, positionSeconds: at, durationSeconds: duration, selectedVersionId: r.versionId, sourceGeneration: s.plan.sourceGeneration + 1 };
    });
  }
  /** A track: its file where every platform's audio player decodes it, else the server's MP3 stream. */
  private audioPlayback(r: V.PlaybackRequest, id: string, n: Node, media: Node, part: Node): V.PlaybackPlan {
    const sessionId = `vela-${randomId()}`;
    const paths: V.PlaybackPath[] = [];
    if (directAudio(media)) paths.push({ id: 'original', kind: 'direct', transport: 'file', mimeType: plexAudioMime(media.container), readiness: 'ready', url: this.mediaURL(part.key),
      original: true, range: true, byteLength: Number(part.size) || undefined, sourceId: String(part.id), qualities: [], boundaries: [] });
    else if (r.allowTranscode !== false) {
      const u = new URL('/music/:/transcode/universal/start.mp3', this.origin);
      for (const [key, value] of Object.entries({ path: `/library/metadata/${id}`, mediaIndex: n.Media.indexOf(media), partIndex: 0, protocol: 'http', directPlay: 0, directStream: 0,
        session: sessionId, offset: 0, musicBitrate: 320, 'X-Plex-Client-Identifier': this.config.clientIdentifier })) u.searchParams.set(key, String(value));
      paths.push({ id: 'plex-mp3', kind: 'transcode', transport: 'file', mimeType: 'audio/mpeg', readiness: 'ready', url: u.href, sourceId: String(part.id), qualities: [], boundaries: [] });
    }
    if (!paths.length) fail('No compatible Plex playback path', 'playback');
    const plan: V.PlaybackPlan = { sessionId, revision: 1, sourceGeneration: 0, seekGeneration: 0, titleId: id, media: 'audio', state: 'ready',
      positionSeconds: r.positionSeconds ?? seconds(n.viewOffset), durationSeconds: seconds(n.duration), paths, selectedPathId: paths[0]!.id,
      audioTracks: [], subtitleTracks: [], selectedSubtitleTrackId: null, chapters: this.chapters(n), fallback: { state: 'unsupported' } };
    this.sessions.set(sessionId, { plan, part, metadata: n, sequence: -1, pending: Promise.resolve(), sessionWork: new AbortController(), mutations: new Map([[r.idempotencyKey, structuredClone(plan)]]) });
    return structuredClone(plan);
  }
  /** Point a multi-part session at one part, from a place inside it: a new transcode on the title's timeline. */
  private async playPart(s: PlexSession, index: number, inPart: number, overrides: Record<string, string> = {}) {
    const signal = s.sessionWork.signal;
    const stack = s.stack!;
    const transcodeId = `${s.plan.sessionId}-${s.plan.sourceGeneration + 1}`;
    const stream = await this.serverStream({ ...stack.query, ...overrides, partIndex: String(index), offset: String(inPart), session: transcodeId }, s.request!.client, false, signal);
    if (!stream) fail('Plex will not stream this part', 'playback');
    // The replacement is accepted: only now is the running stream retired.
    await this.stopTranscode(s.transcodeId ?? s.plan.sessionId, false, signal);
    signal.throwIfAborted();
    // The accepted request, its profile included, is the one the next part is asked with.
    stack.query = stream.query;
    // Another part has its own stream ids: the audio known on it is only the one asked for it (the selection read at
    // the start may since have changed).
    if (index !== stack.index) s.partAudio = overrides.audioStreamID;
    stack.index = index;
    s.part = stack.parts[index]!;
    s.transcodeId = stream.session;
    const at = partOffsets(stack.parts)[index]! + inPart;
    // A decision that states no output size leaves the stream unnumbered rather than at the previous part's size.
    s.plan.paths = s.plan.paths.map(p => {
      if (p.id !== 'plex-hls') return p;
      const { quality: _, ...rest } = p;
      return { ...rest, readiness: 'ready' as const, ...stream.path, sourceId: String(s.part.id), timelineId: String(s.part.id), timelineOriginSeconds: at };
    });
    s.plan.selectedPathId = 'plex-hls';
    s.plan.positionSeconds = at;
    s.plan.sourceGeneration++;
  }
  private session(id: string): PlexSession {
    const s = this.sessions.get(id);
    if (!s) fail('Plex playback session not found', 'not-found');
    return s;
  }
  private generations(plan: V.PlaybackPlan, request: V.Generations) {
    if (plan.sourceGeneration !== request.sourceGeneration || plan.seekGeneration !== request.seekGeneration)
      throw new VelaError({ class: 'conflict', code: 'stale_generation', message: 'Plex playback generation changed', retry: { allowed: false }, currentGenerations: { sourceGeneration: plan.sourceGeneration, seekGeneration: plan.seekGeneration } }, 409);
  }
  private async stopTranscode(id: string, audio = false, signal?: AbortSignal) {
    try { await this.request(`/${audio ? 'music' : 'video'}/:/transcode/universal/stop`, { session: id }, 'GET', true, signal); }
    catch (error) { if (!(error instanceof VelaError) || error.status !== 404) throw error; }
  }
  /**
   * Ask for the playback decision for a video transcode URL before handing it to the player, as Plex's
   * own clients do: it says whether the server will stream it, and what it will deliver.
   */
  private async decide(start: URL, signal?: AbortSignal): Promise<Node> {
    const decision = new URL('/video/:/transcode/universal/decision', this.origin);
    decision.search = start.search;
    return await this.request(decision.pathname, Object.fromEntries(decision.searchParams), 'GET', true, signal) ?? {};
  }
  /**
   * The server's stream for a transcode request, once its decision allows it within the client's cap.
   * It is asked with the client's first delivery profile, and once more with the next in a fresh
   * transcode session when Plex refuses the request (400 or 500), answers a refusing decision code,
   * selects another container or codec, or answers an output above the cap. A request pinned to
   * MPEG-TS keeps it; a restart of an fMP4 one may fall back once. A decision not taken is not stopped:
   * on some servers that stop can end the source session the accepted stream shares, and the server
   * expires it. The accepted transcode session and request, and the path facts: the URL, `remux` when
   * the video is copied, and the quality where the decision states the output size. Null when Plex will
   * not stream it (and, `optional`, when it refuses the request).
   */
  private async serverStream(query: Record<string, string>, client: V.ClientCapabilities, optional = false, signal?: AbortSignal):
    Promise<{ session: string; query: Record<string, string>; path: { url: string; kind: 'remux' | 'transcode'; quality?: V.QualityTarget } } | null> {
    const profiles = query.segmentContainer === 'mpegts' ? [] : plexStreamProfiles(client);
    const attempts = profiles.length ? profiles : [{}];
    for (const [i, profile] of attempts.entries()) {
      const asked: Record<string, string> = { ...query, ...profile, ...(i ? { session: `${query.session}-ts` } : {}) };
      const u = new URL('/video/:/transcode/universal/start.m3u8', this.origin);
      for (const [key, value] of Object.entries(asked)) u.searchParams.set(key, value);
      const last = i === attempts.length - 1;
      let decided: Node;
      try { decided = await this.decide(u, signal); }
      catch (error) {
        signal?.throwIfAborted();
        // A refused request may be taken with the next profile; auth, a missing title, gateway and transport failures are not retried.
        if (!last && error instanceof VelaError && (error.status === 400 || error.status === 500)) continue;
        if (optional) return null;
        throw error;
      }
      if (!refusesStream(decided) && deliversProfile(decided, asked) && fitsStreamingCap(decidedMedia(decided), client)) {
        const quality = decidedQuality(decided);
        return { session: asked.session!, query: asked, path: { url: u.href, kind: copiesVideo(decided, Number(asked.partIndex) || 0) ? 'remux' : 'transcode', ...(quality ? { quality } : {}) } };
      }
    }
    return null;
  }
  async replayWatchProgress(id: string, entry: OfflineProgressEntry): Promise<V.Ack> {
    await this.request('/:/timeline', {
      ratingKey: id,
      key: `/library/metadata/${id}`,
      identifier: 'com.plexapp.plugins.library',
      state: 'stopped',
      time: Math.round(entry.positionSeconds * 1000),
      duration: Math.round(entry.durationSeconds * 1000),
      offline: 1,
      updated: Math.floor(Date.parse(entry.observedAt) / 1000),
    }, 'POST');
    if (entry.completed) await this.setTitleWatch(id, { played: true, idempotencyKey: entry.idempotencyKey });
    return { accepted: true };
  }

  private async timeline(s: PlexSession, state: string) {
    if (s.plan.channelId || s.timelineStopped) return;
    // Once dispatched, the terminal timeline outlives pagehide. Pagehide still stops the stream.
    const keepaliveStarted = state === 'stopped' ? () => { s.timelineStopped = true; } : undefined;
    const post = this.request('/:/timeline', { ratingKey: s.metadata.ratingKey, key: `/library/metadata/${s.metadata.ratingKey}`, time: Math.round(s.plan.positionSeconds * 1000),
      duration: s.metadata.duration, state, session: s.plan.sessionId, hasMDE: 1, identifier: 'com.plexapp.plugins.library', 'X-Plex-Session-Identifier': s.plan.sessionId },
    'POST', true, s.sessionWork.signal, undefined, keepaliveStarted).catch(error => {
      // An explicit HTTP refusal allows a retry. A missing reply may follow an accepted timeline.
      if (keepaliveStarted && error instanceof VelaError && error.detail.code === 'plex_http') s.timelineStopped = false;
      throw error;
    });
    s.carry?.(post);
    delete s.carry;
    await post;
    s.posted = state;
  }
  async reportObservation(id: string, r: V.PlayerObservation): Promise<V.Ack> {
    const s = this.session(id);
    const { signal } = s.sessionWork;
    const w = s.waiting;
    // An end, an invalid position and progress in a stacked title's part before the last are queued on their own.
    const alone = r.state === 'ended' || !Number.isFinite(r.positionSeconds) || r.positionSeconds < 0 || !!s.stack && s.stack.index < s.stack.parts.length - 1;
    if (w?.work && !alone && r.state === w.r.state && r.sourceGeneration === w.r.sourceGeneration && r.seekGeneration === w.r.seekGeneration) {
      if (r.sequence > w.r.sequence) w.r = r;
      return w.work;
    }
    const slot: PlexSession['waiting'] = alone ? undefined : { r };
    const sent = this.serialize(s, async (): Promise<boolean> => {
      if (slot) { if (s.waiting === slot) delete s.waiting; r = slot.r; }
      if (signal.aborted || s.timelineStopped || s.plan.state === 'ended') return true;
      this.generations(s.plan, r);
      if (r.sequence <= s.sequence) return true;
      if (!Number.isFinite(r.positionSeconds) || r.positionSeconds < 0) fail('Invalid playback position');
      // The end of a part that is not the last moves the session on to the next one.
      const stack = s.stack;
      if (stack && stack.index < stack.parts.length - 1 && (r.state === 'ended' || r.positionSeconds >= partOffsets(stack.parts)[stack.index + 1]! - 0.5)) {
        await this.playPart(s, stack.index + 1, 0);
        if (signal.aborted) return true;
        s.sequence = r.sequence; s.plan.state = 'playing'; s.plan.revision++;
        await this.timeline(s, 'playing');
        return true;
      }
      s.plan.positionSeconds = r.positionSeconds;
      // A command after it takes the position into its plan, posting it or not (a track or version change does
      // not); a change from the state last posted is still sent.
      const state = r.state === 'ended' ? 'stopped' : r.state;
      const posts = !slot?.by || state !== s.posted;
      if (posts) await this.timeline(s, state);
      if (signal.aborted) return true;
      // A natural end is completion; a user's partial stop is only a timeline update.
      if (r.state === 'ended' && s.plan.titleId && !s.scrobbled) {
        await this.request('/:/scrobble', { key: s.metadata.ratingKey, identifier: 'com.plexapp.plugins.library' }, 'PUT', true, signal);
        if (signal.aborted) return true;
        s.scrobbled = true;
      }
      if (r.state === 'ended') await this.stopTranscode(s.transcodeId ?? id, s.plan.media === 'audio', signal);
      s.sequence = r.sequence; s.plan.state = r.state === 'ended' ? 'ended' : r.state === 'paused' ? 'paused' : 'playing'; s.plan.revision++;
      return posts;
    });
    // Without its own post it is answered by the timeline post that carries its progress, or as accepted once
    // pagehide ends the session's work, also while that post is still pending.
    const work = sent.then(async posts => {
      if (!posts && !signal.aborted) {
        let onAbort = () => {};
        const aborted = new Promise<void>(resolve => { onAbort = () => resolve(); signal.addEventListener('abort', onAbort, { once: true }); });
        // Detach on settle: the session's signal lives as long as the session and would otherwise collect one listener per folded report.
        try { await Promise.race([slot!.by, aborted]); } finally { signal.removeEventListener('abort', onAbort); }
      }
      return ack;
    }).catch(error => {
      if (signal.aborted) return ack;
      throw error;
    });
    if (slot) s.waiting = Object.assign(slot, { work });
    return work;
  }
  command(id: string, r: TransportCommand): Promise<V.PlaybackPlan> {
    return this.mutate(id, r, async (s, signal) => {
      switch (r.kind) {
        case 'seek':
          if (!Number.isFinite(r.positionSeconds) || r.positionSeconds < 0) fail('Invalid seek');
          // A multi-part title's stream holds one part from where it started: a seek restarts it there.
          if (s.stack) { const at = partAt(s.stack.parts, r.positionSeconds); await this.playPart(s, at.index, at.inPart); }
          signal.throwIfAborted();
          s.plan.positionSeconds = r.positionSeconds;
          s.plan.seekGeneration++;
          await this.timeline(s, s.plan.state === 'paused' ? 'paused' : 'playing');
          break;
        case 'stop':
          await this.timeline(s, 'stopped');
          await this.stopTranscode(s.transcodeId ?? id, s.plan.media === 'audio', signal);
          if (s.plan.channelId) await this.request(`/media/subscriptions/${enc(s.metadata.subscriptionId)}`, {}, 'DELETE', true, signal);
          s.plan.state = 'ended';
          break;
        case 'pause':
          await this.timeline(s, 'paused');
          signal.throwIfAborted();
          s.plan.state = 'paused';
          break;
        case 'resume':
          await this.timeline(s, 'playing');
          signal.throwIfAborted();
          s.plan.state = 'playing';
          break;
      }
    }, true);
  }

  changeTracks(id: string, r: TrackCommand): Promise<V.PlaybackPlan> {
    return this.mutate(id, r, async (s, signal) => {
      const audio = r.audioTrackId ?? s.plan.selectedAudioTrackId;
      const subtitle = r.subtitleTrackId === undefined ? s.plan.selectedSubtitleTrackId : r.subtitleTrackId;
      if (audio !== undefined && !s.plan.audioTracks.some(t => t.id === audio)) fail('Unknown Plex audio track');
      if (subtitle != null && !s.plan.subtitleTracks.some(t => t.id === subtitle)) fail('Unknown Plex subtitle track');
      const burn = s.plan.subtitleTracks.find(t => t.id === subtitle)?.delivery?.kind === 'burn-in';
      const path = s.plan.paths.find(p => p.id === s.plan.selectedPathId);
      const restart = path?.kind !== 'direct' || burn || !this.audible(s, audio);
      const hls = s.plan.paths.find(p => p.id === 'plex-hls');
      if (restart && (!hls || !hls.url && !s.deferred)) fail('Selected Plex tracks require an unavailable transcode');
      const part = `/library/parts/${enc(String(s.part.id))}`;
      const select = () => this.request(part, { audioStreamID: r.audioTrackId, subtitleStreamID: r.subtitleTrackId === null ? 0 : r.subtitleTrackId, allParts: 1 }, 'PUT', true, signal);
      if (!restart || !hls) await select();
      else {
        // The replacement is decided before the running stream changes. Plex burns the part's subtitle rather than
        // the query's, and very likely takes the audio from the part too, so the whole new selection is written
        // first, once; when the stream is refused, what was selected before is put back (best-effort).
        if (r.audioTrackId !== undefined || r.subtitleTrackId !== undefined) await select();
        try {
          if (s.stack) {
            const at = partAt(s.stack.parts, s.plan.positionSeconds);
            await this.playPart(s, at.index, at.inPart, { subtitleStreamID: subtitle ?? '0', subtitles: burn ? 'burn' : 'auto', ...(audio !== undefined ? { audioStreamID: audio } : {}) });
          } else {
            const transcodeId = `${id}-${s.plan.sourceGeneration + 1}`;
            // The running stream's request, or the one deferred at the start.
            const query = hls.url ? Object.fromEntries(new URL(hls.url).searchParams) : s.deferred!;
            const stream = await this.serverStream({ ...query, session: transcodeId, offset: String(s.plan.positionSeconds), subtitleStreamID: subtitle ?? '0', subtitles: burn ? 'burn' : 'auto',
              ...(audio !== undefined ? { audioStreamID: audio } : {}) }, s.request!.client, false, signal);
            signal.throwIfAborted();
            if (!stream) fail('Plex will not stream the selected tracks', 'playback');
            // Only a stream that was started is stopped; a deferred one never was.
            const old = hls.url ? s.transcodeId ?? id : undefined;
            // A decision that states no output size leaves the stream unnumbered rather than at the old size.
            s.plan.paths = s.plan.paths.map(p => {
              if (p.id !== hls.id) return p;
              const { quality: _, ...rest } = p;
              return { ...rest, readiness: 'ready' as const, ...stream.path, timelineOriginSeconds: s.plan.positionSeconds };
            });
            s.plan.selectedPathId = hls.id;
            s.plan.sourceGeneration++;
            s.transcodeId = stream.session;
            delete s.deferred;
            // The new stream is accepted, selected and published: the old one is retired best-effort, not waited for.
            if (old) void this.stopTranscode(old, false, signal).catch(() => undefined);
          }
        } catch (error) {
          signal.throwIfAborted();
          return this.unselect(s, r, part, error);
        }
      }
      if (r.audioTrackId !== undefined) s.partAudio = r.audioTrackId;
      s.plan.selectedAudioTrackId = audio;
      s.plan.selectedSubtitleTrackId = subtitle;
    });
  }

  /** After a refused restart: puts back (best-effort) the part's known prior audio and subtitle streams (0 would turn
   * automatic subtitles off), and keeps the audio the part now has: the prior one, the new one where none was known,
   * unknown when the put-back failed. */
  private async unselect(s: PlexSession, r: TrackCommand, part: string, error: unknown): Promise<never> {
    const prior = { audioStreamID: r.audioTrackId !== undefined ? s.partAudio : undefined, subtitleStreamID: r.subtitleTrackId !== undefined ? s.plan.selectedSubtitleTrackId ?? undefined : undefined };
    const restored = !(prior.audioStreamID || prior.subtitleStreamID) || await this.request(part, { ...prior, allParts: 1 }, 'PUT', true, s.sessionWork.signal).then(() => true, () => false);
    if (r.audioTrackId !== undefined) s.partAudio = !prior.audioStreamID ? r.audioTrackId : restored ? prior.audioStreamID : undefined;
    throw error;
  }
  /** Whether the session's file plays on as it is with an audio track: the client decodes its codec there. */
  private audible(s: PlexSession, audio: string | undefined): boolean {
    const media: Node | undefined = s.metadata.Media?.find((m: Node) => (m.Part ?? []).some((p: Node) => String(p.id) === String(s.part.id)));
    return !s.request || !media || playsOriginal(s.request.client, media, playingAudio(s.part.Stream ?? [], media.audioCodec, audio).codec);
  }
  /** A plan offers the original file and the universal transcode; the session moves between them. */
  switchPath(id: string, r: SwitchCommand): Promise<V.PlaybackPlan> {
    return this.mutate(id, r, async (s, signal) => {
      const path = s.plan.paths.find(p => p.id === r.pathId);
      if (!path) fail('Unknown Plex path');
      if (!Number.isFinite(r.atSeconds) || r.atSeconds < 0) fail('Invalid switch position');
      if (path.kind === 'direct' && !this.audible(s, s.plan.selectedAudioTrackId)) fail('The selected audio track cannot play from the original file', 'playback');
      if (path.readiness === 'on-demand') {
        // The stream deferred at the start (or left for the file), decided now from its own request.
        const stream = s.deferred && s.request ? await this.serverStream(s.deferred, s.request.client, false, signal) : null;
        signal.throwIfAborted();
        if (!stream) fail('Plex will not stream this title', 'playback');
        // A decision that states no output size leaves the stream unnumbered rather than at an earlier one's size.
        s.plan.paths = s.plan.paths.map(p => {
          if (p.id !== path.id) return p;
          const { quality: _, ...rest } = p;
          return { ...rest, readiness: 'ready' as const, ...stream.path };
        });
        s.transcodeId = stream.session;
        delete s.deferred;
      }
      const left = s.plan.selectedPathId === 'plex-hls' && r.pathId !== 'plex-hls' ? this.deferStream(s) : undefined;
      s.plan.selectedPathId = r.pathId;
      s.plan.positionSeconds = r.atSeconds;
      s.plan.sourceGeneration++;
      // The stream left is stopped (Plex would run it until it expires it), best-effort and not waited for. That
      // stop can end the server's whole session, so the playing file's timeline is reported again after it.
      if (left) void this.stopTranscode(left, false, signal).then(() => this.serialize(s, async () => {
        if (s.plan.state !== 'ended') await this.timeline(s, s.plan.state === 'paused' ? 'paused' : 'playing');
      })).catch(() => undefined);
    });
  }
  /**
   * The server's stream, being left for the file, made a choice again: its accepted request kept (decided
   * again when it is next chosen) under a transcode session of its own, its URL dropped. The running
   * transcode session it was played under, for the caller to stop.
   */
  private deferStream(s: PlexSession): string | undefined {
    const hls = s.plan.paths.find(p => p.id === 'plex-hls');
    if (!hls?.url) return undefined;
    // Each generation's stream has its own session: this one is named for the switch's generation.
    s.deferred = { ...Object.fromEntries(new URL(hls.url).searchParams), session: `${s.plan.sessionId}-${s.plan.sourceGeneration + 1}` };
    s.plan.paths = s.plan.paths.map(p => {
      if (p.id !== hls.id) return p;
      const { url: _, ...rest } = p;
      return { ...rest, readiness: 'on-demand' as const };
    });
    const running = s.transcodeId ?? s.plan.sessionId;
    delete s.transcodeId;
    return running;
  }

  /** Apply one session mutation once per idempotency key, at the generations it was issued for. */
  private async mutate(
    id: string,
    r: V.SessionCommand,
    apply: (s: PlexSession, signal: AbortSignal) => Promise<void> | void,
    posts = false,
  ): Promise<V.PlaybackPlan> {
    const s = this.session(id);
    // A seek it will refuse, or a key it answers from its record or that another call still queued carries (which
    // may yet record it), runs nothing: the waiting report keeps its post.
    const queued = s.queued ??= new Map();
    const runs = !s.mutations.has(r.idempotencyKey) && !queued.get(r.idempotencyKey) && !(r.kind === 'seek' && !(Number.isFinite(r.positionSeconds) && r.positionSeconds >= 0));
    const w = runs && s.waiting?.r.sourceGeneration === r.sourceGeneration && s.waiting.r.seekGeneration === r.seekGeneration ? s.waiting : undefined;
    queued.set(r.idempotencyKey, (queued.get(r.idempotencyKey) ?? 0) + 1);
    let carry: ((post?: Promise<unknown>) => void) | undefined;
    // A command that posts no timeline (a track, path or version change) takes the report's position into its plan
    // and the report is answered at once; one that posts answers it with that post.
    if (w) { w.by = posts ? new Promise(resolve => { carry = resolve; }) : Promise.resolve(); void w.by.catch(() => undefined); }
    const work = this.serialize(s, async () => {
      const { signal } = s.sessionWork;
      if (signal.aborted) fail('Plex playback session ended', 'conflict');
      const saved = s.mutations.get(r.idempotencyKey);
      if (saved) return saved;
      this.generations(s.plan, r);
      if (s.plan.state === 'ended' || (s.timelineStopped && r.kind !== 'stop')) fail('Plex playback session ended', 'conflict');
      s.carry = carry;
      try { await apply(s, signal); } finally { delete s.carry; }
      signal.throwIfAborted();
      s.plan.revision++;
      const result = structuredClone(s.plan);
      s.mutations.set(r.idempotencyKey, result);
      return result;
    });
    // A command that ended without its timeline post answers the report it took over as accepted.
    void work.catch(() => undefined).then(() => {
      const left = queued.get(r.idempotencyKey)! - 1;
      if (left) queued.set(r.idempotencyKey, left); else queued.delete(r.idempotencyKey);
      carry?.();
    });
    return work;
  }

  // Commands and observations share one order, including the final stopped timeline. Anything queued after a
  // waiting progress report ends it: no later report takes its place.
  private serialize<T>(s: PlexSession, run: () => Promise<T>): Promise<T> {
    delete s.waiting;
    const work = s.pending.then(run);
    s.pending = work.catch(() => undefined);
    return work;
  }

  async sessionSnapshot(id: string): Promise<V.SessionSnapshot> {
    const s = this.session(id);
    this.askMarkers(s);
    return {
      cursor: String(s.plan.revision),
      revision: s.plan.revision,
      plan: structuredClone(s.plan),
      publishedRanges: [],
      lastObservationSequence: s.sequence < 0 ? undefined : s.sequence,
    };
  }

  /**
   * The playing part's scrub thumbnails, from its media index (a BIF file at
   * `/library/parts/{id}/indexes/sd`), read after playback starts rather than delaying the plan.
   * Each re-read takes the index's current table (Ether's grows while the session streams). Null
   * for a live channel, audio, a multi-part title (one index per part), or a part without an index.
   */
  async trickplayOffer(sessionId: string): Promise<V.TrickplayMetadata | null> {
    const s = this.session(sessionId);
    if (s.plan.channelId || s.plan.media === 'audio' || s.stack || s.part.id == null) return null;
    // An index read whole came from a server without byte ranges: a finished file, not read again.
    if (s.thumbnails?.whole) return structuredClone(s.thumbnails.offer);
    const path = `/library/parts/${enc(String(s.part.id))}/indexes/sd`;
    const head = await this.indexBytes(path, 0, BIF_HEADER_BYTES);
    if (!head) return null;
    const whole = head.whole ? head.bytes : undefined;
    const header = bifHeader(head.bytes);
    if (!header) return null;
    const range = bifTableRange(header);
    const table = whole ? whole.subarray(range.start, range.end) : (await this.indexBytes(path, range.start, range.end))?.bytes;
    const frames = table && bifFrames(header, table);
    if (!frames?.length) return null;
    const held = s.thumbnails;
    let size = held && { width: held.offer.width, height: held.offer.height };
    if (!size) {
      const first = frames[0]!;
      const image = whole ? whole.subarray(first.start, first.end) : (await this.indexBytes(path, first.start, first.end))?.bytes;
      size = (image && jpegSize(image)) ?? this.thumbnailSize(s);
    }
    // The same table is the same offer; a grown one is a new revision of it.
    const last = frames[frames.length - 1]!;
    const changed = !held || held.frames.length !== frames.length || held.frames[held.frames.length - 1]!.atMs !== last.atMs || bifInterval(held.frames) !== bifInterval(frames);
    const offer = bifOffer(frames, size, s.plan.durationSeconds ? Math.round(s.plan.durationSeconds * 1000) : undefined, changed ? (held?.offer.revision ?? 0) + 1 : held!.offer.revision);
    if (!offer) return null;
    s.thumbnails = { frames, offer, ...(whole ? { whole } : {}) };
    return structuredClone(offer);
  }

  /** One slot's thumbnail (the offer's sheets are single images), read by its byte range. */
  async trickplaySheet(sessionId: string, offer: V.TrickplayMetadata, index: number, etag?: string, signal?: AbortSignal): Promise<TrickplaySheet | null> {
    const s = this.session(sessionId);
    const held = s.thumbnails;
    if (!held || offer.cols !== 1 || offer.rows !== 1) return null;
    const frame = bifFrameAt(held.frames, offer.intervalMs, index);
    if (!frame) return null;
    // A slot shows the same image until the index gives it a nearer one.
    const tag = `"bif-${frame.atMs}"`;
    if (etag === tag) return 'unchanged';
    const bytes = held.whole ? held.whole.slice(frame.start, frame.end)
      : (await this.indexBytes(`/library/parts/${enc(String(s.part.id))}/indexes/sd`, frame.start, frame.end, signal))?.bytes;
    // Not an image: the index was rewritten since its table was read; the next offer read has the new one.
    if (!bytes || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    return { bytes, mimeType: 'image/jpeg', etag: tag };
  }

  /** A thumbnail's size when its image cannot be measured: 320 wide, in the video's shape. */
  private thumbnailSize(s: PlexSession): { width: number; height: number } {
    const media = s.metadata.Media?.find((m: Node) => (m.Part || []).some((p: Node) => p.id === s.part.id)) ?? s.metadata.Media?.[0];
    const aspect = Number(media?.width) > 0 && Number(media?.height) > 0 ? Number(media.width) / Number(media.height) : 16 / 9;
    return { width: 320, height: Math.round(320 / aspect) };
  }

  /**
   * Bytes `[from, to)` of a media index, with this server's token; null when there is none (404).
   * A server that ignores the range answers with the whole file (`whole`), read only when small enough.
   */
  private async indexBytes(path: string, from: number, to: number, signal?: AbortSignal): Promise<{ bytes: Uint8Array; whole: boolean } | null> {
    const response = await fetch(this.mediaTarget(path).href, { signal, redirect: 'error', credentials: 'omit',
      headers: { ...plexHeaders(this.device), Accept: '*/*', 'X-Plex-Token': await this.token(), Range: `bytes=${from}-${to - 1}` } });
    if (response.status === 404) return null;
    if (response.status === 401) this.rotateTransientToken();
    if (!response.ok) throw new VelaError({ class: response.status === 401 || response.status === 403 ? 'auth' : 'source', code: 'plex_http', message: `Plex request failed (${response.status})`, retry: { allowed: false } }, response.status);
    if (response.status === 206) return { bytes: new Uint8Array(await response.arrayBuffer()), whole: false };
    if (Number(response.headers.get('content-length')) > MAX_INDEX_BYTES) { await response.body?.cancel(); return null; }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.length > MAX_INDEX_BYTES ? null : { bytes, whole: true };
  }

  /**
   * A title that started without markers asks for them again now and then, in the background, while
   * its session is followed: a server may know them only once the session's source is probed. The
   * plan carries them from the next snapshot on.
   */
  private askMarkers(s: PlexSession): void {
    const state = s.markers;
    if (!state || state.reading || s.plan.state === 'ended' || state.asked >= MARKERS_ASKS || Date.now() - state.at < MARKERS_AGAIN_MS) return;
    state.reading = true;
    state.asked++;
    void this.metadata(String(s.metadata.ratingKey)).then(n => {
      const markers = plexMarkers(n);
      if (!markers || s.plan.state === 'ended') return;
      s.plan.markers = markers;
      s.plan.revision++;
      s.markers = undefined;
    }).catch(() => undefined).finally(() => { if (s.markers === state) { state.reading = false; state.at = Date.now(); } });
  }

  private async requireLive() {
    if (!this.liveConfig) await this.describe();
    if (!this.liveConfig) fail('No accessible Plex DVR');
    return this.liveConfig;
  }
  async channels(cursor?: string, limit = 100): Promise<V.Page<V.Channel>> {
    if (!this.liveConfig) await this.describe();
    if (!this.liveConfig) return page([], 0, 0);
    const c = await this.request(this.liveConfig.channels);
    const all: V.Channel[] = (c.Channel || []).map((n: Node) => ({ id: String(n.gridKey ?? n.id), number: String(n.vcn || ''), name: n.title || n.callSign || '', kind: 'tv',
      artwork: this.artwork(n).sort((a, b) => Number(b.kind === 'logo') - Number(a.kind === 'logo')).map(a => ({ ...a, kind: 'channel' as const })), favorite: false }));
    return page(all.slice(offset(cursor), offset(cursor) + limit), offset(cursor), all.length);
  }
  async guide(q: V.GuideQuery): Promise<V.GuideResponse> {
    const from = Date.parse(q.from), until = Date.parse(q.until);
    if (!Number.isFinite(from) || !Number.isFinite(until) || until <= from || until - from > 7 * 86400000) fail('Invalid Plex guide window');
    if (!this.liveConfig) await this.describe();
    if (!this.liveConfig) return { from: q.from, until: q.until, ...page<V.Programme>([], 0, 0) };
    const live = this.liveConfig;
    const c = await this.request(live.grid, { type: '1,4', sort: 'beginsAt', 'endsAt>': Math.floor(from / 1000), 'beginsAt<': Math.floor(until / 1000), channelGridKey: q.channelIds?.join(','),
      'X-Plex-Container-Start': offset(q.cursor), 'X-Plex-Container-Size': q.limit || 500 });
    const programmes: V.Programme[] = this.nodes(c).flatMap(n => (n.Media || []).map((m: Node) => ({ id: String(n.ratingKey), channelId: String(m.channelIdentifier || m.channelID || m.gridKey),
      name: n.grandparentTitle || n.title || '', episodeTitle: n.grandparentTitle ? n.title : undefined, summary: n.summary || '',
      start: new Date(Number(m.beginsAt) * 1000).toISOString(), end: new Date(Number(m.endsAt) * 1000).toISOString(), artwork: this.artwork(n),
      seasonNumber: n.parentIndex, episodeNumber: n.index, rating: n.contentRating, genres: (n.Genre || []).map((g: Node) => g.tag) })));
    return { from: q.from, until: q.until, ...page(programmes, offset(q.cursor), c.totalSize ?? c.size) };
  }
  private async livePlayback(r: V.PlaybackRequest): Promise<V.PlaybackPlan> {
    const live = await this.requireLive();
    if (r.liveMode === 'low-delay') fail('Plex exposes no Vela live latency policy');
    const dvr = live.dvr.split('/').filter(Boolean).pop()!;
    const c = await this.request(`/livetv/dvrs/${enc(dvr)}/channels/${enc(r.channelId!)}/tune`, {}, 'POST');
    const sub = c.MediaSubscription?.[0];
    const operation = sub?.MediaGrabOperation;
    const n = this.nodes(c)[0] || operation?.Metadata || operation?.[0]?.Metadata;
    const part = n?.Media?.[0]?.Part?.[0];
    if (!sub || !part?.key) fail('Plex returned an unsupported DVR tuning response', 'playback');
    const sessionId = `vela-live-${randomId()}`;
    const plan: V.PlaybackPlan = { sessionId, channelId: r.channelId, revision: 1, sourceGeneration: 0, seekGeneration: 0, state: 'ready', positionSeconds: 0,
      paths: [{ id: 'live-hls', kind: 'direct', transport: 'hls', mimeType: 'application/vnd.apple.mpegurl', readiness: 'ready', url: this.mediaURL(part.key), qualities: [], boundaries: [] }],
      selectedPathId: 'live-hls', audioTracks: [], subtitleTracks: [], selectedSubtitleTrackId: null, chapters: [], fallback: { state: 'unsupported' }, live: { mode: 'adaptive' } };
    this.sessions.set(sessionId, { plan, part, metadata: { ...n, subscriptionId: String(sub.key) }, sequence: -1, pending: Promise.resolve(), sessionWork: new AbortController(), mutations: new Map([[r.idempotencyKey, structuredClone(plan)]]) });
    return structuredClone(plan);
  }
}

/** A Plex subtitle search result: the stream key is the offer, with the provider's facts. */
export function plexSubtitleOffer(t: Node, searched: string): RemoteSubtitle {
  const offer: RemoteSubtitle = { id: String(t.key), name: t.title || t.displayTitle || t.language || searched, language: t.languageCode || searched };
  const flag = (value: unknown) => value === true || value === 1 || value === '1' || value === 'true';
  if (t.providerTitle) offer.provider = String(t.providerTitle);
  const format = t.format || t.codec;
  if (format) offer.format = String(format);
  if (flag(t.perfectMatch)) offer.releaseMatch = true;
  if (flag(t.hearingImpaired)) offer.hearingImpaired = true;
  if (flag(t.forced)) offer.forced = true;
  return offer;
}
