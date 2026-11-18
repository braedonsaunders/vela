import type { TitleActions } from '../media-actions';
import { homeHeroes } from '../home-heroes';
import type * as V from '../../wire';
import type { CatalogueSearch, Credentials, Home, ServerAdapter, ServerDescription, TransportCommand } from '../index';
import type { LiveTv, PathSwitching, SwitchCommand, TrackChanges, TrackCommand } from '../capabilities';
import { VelaError } from '../errors';
import { plexHeaders } from './auth';
import { seriesOrder } from '../series';
import { randomId } from '../../protocol/id';
export * from './auth';

// Plex JSON uses the same metadata envelope for videos, directories and hubs.
type Node = Record<string, any>;
interface PlexSession {
  plan: V.PlaybackPlan;
  part: Node;
  metadata: Node;
  sequence: number;
  pending: Promise<unknown>;
  transcodeId?: string;
  scrobbled?: boolean;
  /** Each mutation's answer by idempotency key, so a repeated command is not applied twice. */
  mutations: Map<string, V.PlaybackPlan>;
}
export interface PlexConfig { origin: string; credentials: Credentials; clientIdentifier: string; /** The name the server was added under (plex.tv's resource name). */ name?: string }
const ack: V.Ack = { accepted: true };
const no = (reason: string): V.Feature => ({ available: false, reason });
const yes: V.Feature = { available: true };
const enc = encodeURIComponent;
const seconds = (n: unknown) => Math.max(0, Number(n || 0) / 1000);
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
/** Plex Media Server. Sign-in is plex.tv PIN linking (`./link`), outside the per-server adapter. */
export class PlexAdapter implements ServerAdapter, PathSwitching, LiveTv, TrackChanges {
  readonly origin: string;
  private sessions = new Map<string, PlexSession>();
  private liveConfig?: { dvr: string; grid: string };
  private delegation?: Promise<string>;
  constructor(private config: PlexConfig) {
    const u = new URL(config.origin);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.pathname !== '/' || u.search || u.hash) throw new Error('Plex requires a server origin');
    this.origin = u.origin;
    plexHeaders(config.clientIdentifier);
  }
  /** Credential-free media URL; the private host bridge attaches mediaHeaders only at this origin. */
  mediaURL(path: string): string {
    const u = new URL(path, this.origin);
    if (u.origin !== this.origin || u.username || u.password || u.hash || !/^\/(library|video|audio|subtitles|photo|livetv)\//.test(u.pathname)) fail('Plex media outside selected server');
    for (const key of u.searchParams.keys()) if (/token|api_key/i.test(key)) fail('Persistent Plex token in media URL');
    return u.href;
  }
  async mediaHeaders(): Promise<Record<string, string>> {
    const tokens = await this.config.credentials.get();
    if (!tokens) fail('Sign in required', 'auth');
    return { ...plexHeaders(this.config.clientIdentifier), 'X-Plex-Token': tokens.accessToken };
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
  async transientMediaURL(path: string): Promise<string> {
    const url = new URL(this.mediaURL(path));
    url.searchParams.set('X-Plex-Token', await this.transientToken());
    return url.href;
  }
  private async request(path: string, query: Record<string, unknown> = {}, method = 'GET', auth = true): Promise<Node> {
    const u = new URL(path, this.origin);
    if (u.origin !== this.origin || u.username || u.password) fail('Plex request outside selected server');
    for (const [k, v] of Object.entries(query)) if (v !== undefined) u.searchParams.set(k, String(v));
    const headers = auth ? await this.mediaHeaders() : plexHeaders(this.config.clientIdentifier);
    const response = await fetch(u.href, { method, headers, redirect: 'error', credentials: 'omit' });
    if (response.status === 401) this.rotateTransientToken();
    if (!response.ok) throw new VelaError({ class: response.status === 401 || response.status === 403 ? 'auth' : response.status === 404 ? 'not-found' : 'source',
      code: 'plex_http', message: `Plex request failed (${response.status})`, retry: { allowed: false } }, response.status);
    if (response.status === 204) return {};
    const text = await response.text();
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
    try { await this.request('/library/sections'); }
    catch (error) {
      if (!(error instanceof VelaError) || error.status !== 401) throw error;
      const latest = await this.config.credentials.get();
      if (latest?.accessToken === tokens.accessToken) { this.sessions.clear(); await this.config.credentials.set(null); }
      return null;
    }
    return tokens;
  }
  async describe(): Promise<ServerDescription> {
    const root = await this.request('/identity', {}, 'GET', false);
    let live: V.Feature = no('No accessible Plex DVR');
    // /identity carries no name (PMS and Ether alike): the server's name is its root container's.
    let name = '';
    if (await this.config.credentials.get()) {
      try { name = (await this.request('/')).friendlyName || ''; } catch { /* the name the server was added under stands */ }
      try {
        const dvrs = await this.request('/livetv/dvrs');
        const providers = await this.request('/media/providers');
        const grid = (providers.MediaProvider || []).flatMap((p: Node) => p.Feature || []).find((f: Node) => f.type === 'grid')?.key;
        if (dvrs.Dvr?.length && grid) { this.liveConfig = { dvr: String(dvrs.Dvr[0].key), grid }; live = yes; }
      } catch (error) { if (!(error instanceof VelaError) || ![403, 404].includes(error.status)) throw error; }
    }
    return { protocolVersion: 0, server: { id: root.machineIdentifier || this.origin, name: name || this.config.name || 'Plex Media Server', version: root.version || '' },
      features: { liveTV: live, extras: yes, extraPlayback: yes, themeMusic: yes, initialTrackSelection: yes, sessionTrackChanges: yes },
      skins: [{ id: 'cinematic', name: 'Cinematic' }], defaultSkinId: 'cinematic' };
  }
  async revokeSession(_r: V.RevokeRequest): Promise<V.Ack> {
    for (const [id, s] of this.sessions) if (s.plan.state !== 'ended') await this.command(id, { kind: 'stop', ...s.plan, idempotencyKey: `revoke-${id}` });
    this.sessions.clear(); this.rotateTransientToken(); await this.config.credentials.set(null); return ack;
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
  private title(n: Node): V.Title {
    const ratings: V.TitleRating[] = [];
    for (const [field, image, kind] of [['rating', 'ratingImage', 'critic'], ['audienceRating', 'audienceRatingImage', 'audience']] as const)
      if (n[field] !== undefined) ratings.push({ source: n[image] || 'Plex', kind, value: Number(n[field]), scale: 10 });
    let themeMusic: V.ThemeMusic | undefined;
    if (n.theme) { try { themeMusic = { url: this.mediaURL(n.theme), expiresAt: '9999-12-31T23:59:59Z' }; } catch {} }
    return { id: String(n.ratingKey), kind: n.type, name: n.title || '', summary: n.summary || '', year: n.year, airDate: n.originallyAvailableAt,
      genres: (n.Genre || []).map((g: Node) => g.tag), durationSeconds: seconds(n.duration), rating: n.contentRating, ratings,
      artwork: this.artwork(n), watch: { positionSeconds: seconds(n.viewOffset), played: Number(n.viewCount || 0) > 0, favorite: false, watchlisted: false },
      ...(themeMusic ? { themeMusic } : {}), showId: n.grandparentRatingKey ? String(n.grandparentRatingKey) : n.type === 'season' && n.parentRatingKey != null ? String(n.parentRatingKey) : undefined,
      showName: n.type === 'episode' ? n.grandparentTitle : n.type === 'season' ? n.parentTitle : undefined,
      seasonId: n.type === 'episode' && n.parentRatingKey != null ? String(n.parentRatingKey) : undefined, seasonNumber: n.type === 'season' ? n.index : n.parentIndex, episodeNumber: n.type === 'episode' ? n.index : undefined };
  }
  private entry(n: Node): V.RowEntry {
    if (['collection', 'playlist'].includes(n.type)) return { id: String(n.ratingKey), kind: n.type, targetId: `${n.type}:${n.ratingKey}`, name: n.title, artwork: this.artwork(n), receiptToken: '' };
    return { id: String(n.ratingKey), kind: 'title', title: this.title(n), receiptToken: '' };
  }
  private nodes(c: Node): Node[] { return c.Metadata || c.Video || c.Directory || []; }
  private hub(h: Node): V.Row {
    const key = h.key || h.hubIdentifier;
    const purpose: V.Row['purpose'] = /continue/i.test(key) ? 'continue' : /onDeck|nextUp/i.test(key) ? 'nextUp' : /recentlyAdded/i.test(key) ? 'recentlyAdded' : 'recommendation';
    return { id: key, name: h.title || '', purpose, receiptToken: '', ...page(this.nodes(h).filter(n => ['movie','show','season','episode','collection','playlist'].includes(n.type)).map(n => this.entry(n)), Number(h.offset || 0), h.totalSize ?? (h.more ? undefined : h.size)) };
  }
  async home(): Promise<Home> {
    this.rotateTransientToken();
    const tokens = await this.config.credentials.get(); if (!tokens) fail('Sign in required', 'auth');
    const [capabilities, rows] = await Promise.all([this.describe(), this.rows({})]);
    const featured = homeHeroes(rows.items, 'plex', (path, width, height) => {
      const url = new URL('/photo/:/transcode', this.origin);
      for (const [key, value] of Object.entries({ url: path, width, height, minSize: 1, upscale: 0 })) url.searchParams.set(key, String(value));
      return url.href;
    });
    return { viewer: tokens.viewer, capabilities, defaultSkinId: 'cinematic', ...featured };
  }
  async rows(q: V.RowsQuery): Promise<V.Page<V.Row>> {
    const path = q.placement === 'detail' && q.titleId ? `/library/metadata/${enc(q.titleId)}/related` : '/hubs';
    const c = await this.request(path, { count: q.limit || 20 });
    // PMS lists every hub type, including ones with nothing in them; an empty, finished hub is not a row.
    const hubs = (c.Hub || []).map((h: Node) => this.hub(h)).filter((row: V.Row) => row.items.length > 0 || row.continuation === 'more');
    return page(hubs, 0, hubs.length);
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
      return genres.length ? { ...row, ...page([...row.items, ...genres], Number(h.offset || 0), h.totalSize ?? (h.more ? undefined : h.size)) } : row;
  }
  async libraryCollections(id: string, cursor?: string): Promise<V.Page<V.RowEntry>> {
    const start = offset(cursor);
    const c = await this.request(`/library/sections/${enc(id)}/collections`, { 'X-Plex-Container-Start': start, 'X-Plex-Container-Size': 100 });
    return page(this.nodes(c).filter(n => n.type === 'collection').map(n => this.entry(n)), start, c.totalSize ?? c.size);
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
    return { id: String(n.key), name: n.title, kind: n.type === 'movie' ? 'movies' : n.type === 'show' ? 'shows' : 'mixed', artwork: this.artwork(n),
      browse: { sorts: sorts.map(id => ({ id, directions: ['asc', 'desc'] })), defaultSort: 'title', defaultDirection: 'asc', filters: { genre: true, year: true, played: true } } };
  }
  async libraries(q: V.LibrariesQuery): Promise<V.Page<V.Library>> {
    const c = await this.request('/library/sections'); const all = (c.Directory || []).filter((n: Node) => ['movie','show'].includes(n.type));
    return page(all.slice(offset(q.cursor), offset(q.cursor) + (q.limit || 100)).map((n: Node) => this.libraryNode(n)), offset(q.cursor), all.length);
  }
  async library(id: string, q: V.LibraryBrowseQuery): Promise<V.LibraryContents> {
    const libraries = await this.libraries({}); const library = libraries.items.find(l => l.id === id); if (!library) fail('Plex library not found', 'not-found');
    const sorts: Record<string,string> = { title: 'titleSort', added: 'addedAt', released: 'originallyAvailableAt', year: 'year', rating: 'rating', duration: 'duration' };
    const sort = q.sort || 'title'; if (!sorts[sort] || q.favorite !== undefined || q.kind !== undefined) fail('Unsupported Plex library filter or sort');
    const direction = q.direction || 'asc';
    const c = await this.request(`/library/sections/${enc(id)}/all`, { sort: `${sorts[sort]}:${direction}`, genre: q.genre, year: q.year, unwatched: q.played === undefined ? undefined : q.played ? 0 : 1,
      'X-Plex-Container-Start': offset(q.cursor), 'X-Plex-Container-Size': q.limit || 100 });
    return { library, sort, direction, ...page(this.nodes(c).map(n => this.entry(n)), offset(q.cursor), c.totalSize ?? c.size) };
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
    const [kind, key] = id.includes(':') ? id.split(':') : ['collection', id];
    const base = kind === 'playlist' ? `/playlists/${enc(key)}` : `/library/collections/${enc(key)}`;
    const start = offset(cursor);
    const c = await this.request(base); const n = this.nodes(c)[0] || c;
    const children = await this.request(`${base}/${kind === 'playlist' ? 'items' : 'children'}`, { 'X-Plex-Container-Start': start, 'X-Plex-Container-Size': limit });
    // PMS reports the whole collection's totalSize; size alone is only this page.
    return { collection: { id, kind: kind === 'playlist' ? 'playlist' : 'collection', name: n.title || '', summary: n.summary, artwork: this.artwork(n) }, ...page(this.nodes(children).map(n => this.entry(n)), start, children.totalSize) };
  }
  private async metadata(id: string): Promise<Node> {
    const c = await this.request(`/library/metadata/${enc(id)}`, { includeExtras: 1, includeChapters: 1, includeOnDeck: 1 });
    const n = this.nodes(c)[0]; if (!n) fail('Plex title not found', 'not-found'); return n;
  }
  async detail(id: string): Promise<V.TitleDetail> {
    const n = await this.metadata(id);
    const series = n.type === 'show' || n.type === 'season';
    const children = series ? await this.children(id, 'children') : [];
    const episodes = n.type === 'show' ? await this.children(id, 'allLeaves') : n.type === 'season' ? children : undefined;
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
    return { title: this.title(n), canPlay: ['movie','episode'].includes(n.type) && !!n.Media?.length, seasons: n.type === 'show' ? seriesOrder(children) : undefined, episodes: episodes ? seriesOrder(episodes) : undefined, nextUp,
      cast: (n.Role || []).map((p: Node) => person(p)), crew: [...(n.Director || []).map((p: Node) => person(p, 'Director')), ...(n.Writer || []).map((p: Node) => person(p, 'Writer'))],
      chapters: this.chapters(n), extras: (n.Extras?.Metadata || []).map((e: Node) => ({ id: String(e.ratingKey), parentId: id, kind: Number(e.extraType) === 1 ? 'trailer' : 'other', name: e.title, durationSeconds: seconds(e.duration), artwork: this.artwork(e)[0], availability: e.Media?.length ? 'ready' : 'unresolved' })),
      mediaSummary: {
        video: streams.filter(s => Number(s.streamType) === 1).map(s => ({ codec: s.codec, width: s.width, height: s.height, bitDepth: s.bitDepth, colorTransfer: s.colorTrc,
          ...(s.DOVIProfile !== undefined ? { dolbyVisionProfile: Number(s.DOVIProfile) } : {}) })),
        audio: audio.map(s => ({ codec: s.codec, channels: s.channels, language: s.languageCode, ...(s === mainAudio ? { default: true } : {}) })),
        ...(part?.Stream ? { subtitleCount: streams.filter(s => Number(s.streamType) === 3).length } : {}),
      } };
  }
  private async children(id: string, kind: 'children' | 'allLeaves'): Promise<V.Title[]> {
    const items: V.Title[] = [];
    for (;;) {
      const c = await this.request(`/library/metadata/${enc(id)}/${kind}`, { 'X-Plex-Container-Start': items.length, 'X-Plex-Container-Size': 200, excludeAllLeaves: kind === 'children' ? 1 : undefined });
      const nodes = this.nodes(c);
      items.push(...nodes.map(n => this.title(n)));
      if (!nodes.length || (c.totalSize !== undefined ? items.length >= c.totalSize : nodes.length < 200)) return items;
    }
  }
  private chapters(n: Node): V.Chapter[] { return (n.Chapter || []).map((c: Node) => ({ id: String(c.id), name: c.tag || `Chapter ${Number(c.index || 0) + 1}`, startSeconds: seconds(c.startTimeOffset), endSeconds: c.endTimeOffset === undefined ? undefined : seconds(c.endTimeOffset) })); }
  async search(r: CatalogueSearch): Promise<V.SearchResponse> {
    const c = await this.request('/hubs/search', { query: r.query, limit: r.limit || 30 });
    const seen = new Set<string>(); const all = (c.Hub || []).flatMap((h: Node) => this.nodes(h)).filter((n: Node) => ['movie','show','season','episode'].includes(n.type) && !seen.has(String(n.ratingKey)) && !!seen.add(String(n.ratingKey)));
    return { query: r.query, generation: r.generation, ...page(all.map((n: Node) => this.title(n)), 0, all.length) };
  }
  async titleActions(id: string): Promise<TitleActions> {
    const n = await this.metadata(id);
    const versions = (n.Media || []).flatMap((m: Node, index: number) => {
      const release = [m.editionTitle || n.editionTitle, m.videoResolution && `${m.videoResolution}p`].filter(Boolean).join(' · ') || `Version ${index + 1}`;
      const audio = (m.Part || []).flatMap((p: Node) => (p.Stream || []).filter((t: Node) => Number(t.streamType) === 2));
      return audio.length > 1 ? audio.map((t: Node) => ({ id: String(m.id ?? index), audioTrackId: String(t.id), name: `${release} · ${t.displayTitle || t.language || t.languageCode || t.codec}` })) : [{ id: String(m.id ?? index), name: release }];
    });
    return { watched: true, list: null, watch: this.title(n).watch!, versions };
  }

  async setTitleWatch(id: string, change: { played?: boolean; listed?: boolean }) {
    if (change.listed !== undefined) fail('Plex list management is unavailable');
    if (change.played !== undefined) await this.request(change.played ? '/:/scrobble' : '/:/unscrobble', { key: id, identifier: 'com.plexapp.plugins.library' }, 'PUT');
  }
  async searchSubtitles(sessionId: string, language: string) {
    const s = this.session(sessionId);
    const result = await this.request(`/library/metadata/${enc(s.plan.titleId!)}/subtitles`, { language });
    return (result.Stream || []).map((t: Node) => ({ id: String(t.key), name: t.displayTitle || t.title || t.language || language, language: t.languageCode || language }));
  }
  async downloadSubtitle(sessionId: string, id: string): Promise<V.PlaybackPlan> {
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
      const url = new URL(this.mediaURL(t.key)); url.searchParams.set('format', 'vtt');
      s.plan.subtitleTracks.push({ id: String(t.id), kind: 'subtitle', name: t.displayTitle || t.language || 'Subtitle', language: t.languageCode || 'und', codec: 'webvtt', delivery: { kind: 'external', format: 'webvtt', url: url.href } });
    }
    s.plan.revision++;
    return structuredClone(s.plan);
  }
  async startPlayback(r: V.PlaybackRequest): Promise<V.PlaybackPlan> {
    for (const s of this.sessions.values()) if (s.mutations.has(r.idempotencyKey)) return s.mutations.get(r.idempotencyKey)!;
    if (r.channelId) return this.livePlayback(r);
    const id = r.titleId || r.extraId!; const n = await this.metadata(id);
    const media = r.mediaSourceId ? n.Media?.find((m: Node, index: number) => String(m.id ?? index) === r.mediaSourceId) : n.Media?.[0]; const part = media?.Part?.[0];
    if (!part || media.Part.length !== 1) fail('Plex title has no supported single-part media', 'playback');
    const sessionId = `vela-${randomId()}`;
    const streams: Node[] = part.Stream || [];
    const tracks = (type: number): V.Track[] => streams.filter(s => Number(s.streamType) === type).map(s => {
      const textSidecar = !!s.key && ['srt', 'subrip', 'ass', 'ssa', 'vtt', 'webvtt', 'text'].includes(s.codec);
      const external = textSidecar ? new URL(this.mediaURL(s.key)) : undefined;
      if (external) external.searchParams.set('format', 'vtt');
      return { id: String(s.id), streamIndex: s.index,
        kind: type === 2 ? 'audio' : 'subtitle', language: s.languageCode || 'und', name: s.displayTitle || s.title || s.language || s.codec || '', codec: s.codec || '', channels: s.channels,
        default: !!s.selected, forced: !!s.forced, hearingImpaired: !!s.hearingImpaired,
        ...(type === 3 ? external
          ? { url: external.href, delivery: { kind: 'external' as const, format: 'webvtt' as const, url: external.href } }
          : { delivery: s.key ? { kind: 'burn-in' as const } : { kind: 'embedded' as const } } : {}) };
    });
    const audioTracks = tracks(2), subtitleTracks = tracks(3);
    const audio = r.audioTrackId || audioTracks.find(t => t.default)?.id;
    const subtitle = r.subtitleTrackId === undefined ? subtitleTracks.find(t => t.default)?.id || null : r.subtitleTrackId;
    if (audio && !audioTracks.some(t => t.id === audio) || subtitle && !subtitleTracks.some(t => t.id === subtitle)) fail('Unknown Plex track');
    const burnSubtitle = subtitle ? subtitleTracks.find(t => t.id === subtitle)?.delivery?.kind === 'burn-in' : false;
    // Plex part stream selection is viewer state; perform only explicit preferences.
    if (r.audioTrackId !== undefined || r.subtitleTrackId !== undefined) await this.request(`/library/parts/${enc(String(part.id))}`, { audioStreamID: r.audioTrackId, subtitleStreamID: r.subtitleTrackId === null ? 0 : r.subtitleTrackId, allParts: 1 }, 'PUT');
    const original = r.client.originalPlayback;
    const compatible = !!original && original.demuxContainers.includes(media.container) &&
      (!media.videoCodec || original.videoDecoders.includes(media.videoCodec)) && (!media.audioCodec || original.audioDecoders.includes(media.audioCodec));
    const nativeCompatible = r.client.containers.includes(media.container) && (!media.videoCodec || r.client.videoCodecs.includes(media.videoCodec)) && (!media.audioCodec || r.client.audioCodecs.includes(media.audioCodec));
    const direct = (compatible || nativeCompatible) && !burnSubtitle;
    if (!direct && r.allowTranscode === false) fail(burnSubtitle ? 'Selected Plex subtitle requires transcoding' : 'Original media is incompatible and transcoding is disabled', 'playback');
    const paths: V.PlaybackPath[] = [];
    if (direct) paths.push({ id: 'original', kind: 'direct', transport: 'file', mimeType: media.container === 'mp4' ? 'video/mp4' : media.container === 'webm' ? 'video/webm' : 'video/x-matroska',
      readiness: 'ready', url: this.mediaURL(part.key), original: true, range: true, byteLength: Number(part.size) || undefined, sourceId: String(part.id), timelineId: String(part.id), timelineOriginSeconds: 0,
      originalVideo: { codec: media.videoCodec, width: media.width, height: media.height }, qualities: [], boundaries: [] });
    if (r.allowTranscode !== false && (r.client.hls || r.client.mse)) {
      const u = new URL('/video/:/transcode/universal/start.m3u8', this.origin);
      const query = { path: `/library/metadata/${id}`, mediaIndex: n.Media.indexOf(media), partIndex: 0, protocol: 'hls', directPlay: 0, directStream: 1,
        session: sessionId, offset: 0, fastSeek: 1, 'X-Plex-Client-Identifier': this.config.clientIdentifier,
        maxVideoBitrate: Math.floor((r.client.maxBitrate || 20000000) / 1000), videoResolution: `${r.client.maxWidth || 1920}x${r.client.maxHeight || 1080}`,
        subtitleStreamID: subtitle || 0, subtitles: burnSubtitle ? 'burn' : 'auto', subtitleSize: 100, audioBoost: 100 };
      for (const [key, value] of Object.entries(query)) u.searchParams.set(key, String(value));
      paths.push({ id: 'plex-hls', kind: 'transcode', transport: 'hls', mimeType: 'application/vnd.apple.mpegurl', readiness: 'ready', url: u.href,
        sourceId: String(part.id), timelineId: String(part.id), timelineOriginSeconds: 0, qualities: [], boundaries: [] });
    }
    if (!paths.length) fail('No compatible Plex playback path', 'playback');
    const plan: V.PlaybackPlan = { sessionId, revision: 1, sourceGeneration: 0, seekGeneration: 0,
      ...(r.extraId ? { extraId: id } : { titleId: id }), state: 'ready', positionSeconds: r.positionSeconds ?? seconds(n.viewOffset), durationSeconds: seconds(n.duration),
      paths, selectedPathId: paths[0].id, audioTracks, subtitleTracks, selectedAudioTrackId: audio, selectedSubtitleTrackId: subtitle, chapters: this.chapters(n),
      fallback: { state: 'unsupported', reason: 'Plex does not expose proactive preparation; select the HLS path to start transcoding' } };
    this.sessions.set(sessionId, { plan, part, metadata: n, sequence: -1, pending: Promise.resolve(), mutations: new Map([[r.idempotencyKey, structuredClone(plan)]]) });
    return structuredClone(plan);
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
  private async stopTranscode(id: string) {
    try { await this.request('/video/:/transcode/universal/stop', { session: id }); }
    catch (error) { if (!(error instanceof VelaError) || error.status !== 404) throw error; }
  }
  private async timeline(s: PlexSession, state: string) {
    if (s.plan.channelId) return;
    await this.request('/:/timeline', { ratingKey: s.metadata.ratingKey, key: `/library/metadata/${s.metadata.ratingKey}`, time: Math.round(s.plan.positionSeconds * 1000),
      duration: s.metadata.duration, state, session: s.plan.sessionId, hasMDE: 1, identifier: 'com.plexapp.plugins.library', 'X-Plex-Session-Identifier': s.plan.sessionId }, 'POST');
  }
  async reportObservation(id: string, r: V.PlayerObservation): Promise<V.Ack> {
    const s = this.session(id);
    return this.serialize(s, async () => {
      this.generations(s.plan, r);
      if (r.sequence <= s.sequence || s.plan.state === 'ended') return ack;
      if (!Number.isFinite(r.positionSeconds) || r.positionSeconds < 0) fail('Invalid playback position');
      s.plan.positionSeconds = r.positionSeconds;
      await this.timeline(s, r.state === 'ended' ? 'stopped' : r.state === 'buffering' ? 'buffering' : r.state);
      // A natural end is completion; a user's partial stop is only a timeline update.
      if (r.state === 'ended' && s.plan.titleId && !s.scrobbled) {
        await this.request('/:/scrobble', { key: s.metadata.ratingKey, identifier: 'com.plexapp.plugins.library' }, 'PUT');
        s.scrobbled = true;
      }
      s.sequence = r.sequence; s.plan.state = r.state === 'ended' ? 'ended' : r.state === 'paused' ? 'paused' : 'playing'; s.plan.revision++;
      if (r.state === 'ended') await this.stopTranscode(s.transcodeId ?? id);
      return ack;
    });
  }
  command(id: string, r: TransportCommand): Promise<V.PlaybackPlan> {
    return this.mutate(id, r, async s => {
      switch (r.kind) {
        case 'seek':
          if (!Number.isFinite(r.positionSeconds) || r.positionSeconds < 0) fail('Invalid seek');
          s.plan.positionSeconds = r.positionSeconds;
          s.plan.seekGeneration++;
          await this.timeline(s, s.plan.state === 'paused' ? 'paused' : 'playing');
          break;
        case 'stop':
          await this.timeline(s, 'stopped');
          await this.stopTranscode(s.transcodeId ?? id);
          if (s.plan.channelId) await this.request(`/media/subscriptions/${enc(s.metadata.subscriptionId)}`, {}, 'DELETE');
          s.plan.state = 'ended';
          break;
        case 'pause':
          await this.timeline(s, 'paused');
          s.plan.state = 'paused';
          break;
        case 'resume':
          await this.timeline(s, 'playing');
          s.plan.state = 'playing';
          break;
      }
    });
  }

  changeTracks(id: string, r: TrackCommand): Promise<V.PlaybackPlan> {
    return this.mutate(id, r, async s => {
      const audio = r.audioTrackId ?? s.plan.selectedAudioTrackId;
      const subtitle = r.subtitleTrackId === undefined ? s.plan.selectedSubtitleTrackId : r.subtitleTrackId;
      if (audio !== undefined && !s.plan.audioTracks.some(t => t.id === audio)) fail('Unknown Plex audio track');
      if (subtitle != null && !s.plan.subtitleTracks.some(t => t.id === subtitle)) fail('Unknown Plex subtitle track');
      const burn = s.plan.subtitleTracks.find(t => t.id === subtitle)?.delivery?.kind === 'burn-in';
      const path = s.plan.paths.find(p => p.id === s.plan.selectedPathId);
      const restart = path?.kind !== 'direct' || burn;
      const hls = s.plan.paths.find(p => p.id === 'plex-hls');
      if (restart && (!hls || !hls.url)) fail('Selected Plex tracks require an unavailable transcode');
      await this.request(`/library/parts/${enc(String(s.part.id))}`, {
        audioStreamID: r.audioTrackId, subtitleStreamID: r.subtitleTrackId === null ? 0 : r.subtitleTrackId, allParts: 1,
      }, 'PUT');
      if (restart && hls) {
        await this.stopTranscode(s.transcodeId ?? id);
        const url = new URL(hls.url!);
        const transcodeId = `${id}-${s.plan.sourceGeneration + 1}`;
        url.searchParams.set('session', transcodeId);
        url.searchParams.set('offset', String(s.plan.positionSeconds));
        url.searchParams.set('subtitleStreamID', subtitle ?? '0');
        url.searchParams.set('subtitles', burn ? 'burn' : 'auto');
        if (audio !== undefined) url.searchParams.set('audioStreamID', audio);
        s.plan.paths = s.plan.paths.map(p => p.id === hls.id ? { ...p, readiness: 'ready' as const, url: url.href, timelineOriginSeconds: s.plan.positionSeconds } : p);
        s.plan.selectedPathId = hls.id;
        s.plan.sourceGeneration++;
        s.transcodeId = transcodeId;
      }
      s.plan.selectedAudioTrackId = audio;
      s.plan.selectedSubtitleTrackId = subtitle;
    });
  }

  /** A plan offers the original file and the universal transcode; the session moves between them. */
  switchPath(id: string, r: SwitchCommand): Promise<V.PlaybackPlan> {
    return this.mutate(id, r, s => {
      if (!s.plan.paths.some(p => p.id === r.pathId)) fail('Unknown Plex path');
      if (!Number.isFinite(r.atSeconds) || r.atSeconds < 0) fail('Invalid switch position');
      s.plan.selectedPathId = r.pathId;
      s.plan.positionSeconds = r.atSeconds;
      s.plan.sourceGeneration++;
    });
  }

  /** Apply one session mutation once per idempotency key, at the generations it was issued for. */
  private async mutate(
    id: string,
    r: V.SessionCommand,
    apply: (s: PlexSession) => Promise<void> | void,
  ): Promise<V.PlaybackPlan> {
    const s = this.session(id);
    return this.serialize(s, async () => {
      const saved = s.mutations.get(r.idempotencyKey);
      if (saved) return saved;
      this.generations(s.plan, r);
      if (s.plan.state === 'ended') fail('Plex playback session ended', 'conflict');
      await apply(s);
      s.plan.revision++;
      const result = structuredClone(s.plan);
      s.mutations.set(r.idempotencyKey, result);
      return result;
    });
  }

  // Commands and observations share one order, including the final stopped timeline.
  private serialize<T>(s: PlexSession, run: () => Promise<T>): Promise<T> {
    const work = s.pending.then(run);
    s.pending = work.catch(() => undefined);
    return work;
  }

  async sessionSnapshot(id: string): Promise<V.SessionSnapshot> {
    const s = this.session(id);
    return {
      cursor: String(s.plan.revision),
      revision: s.plan.revision,
      plan: structuredClone(s.plan),
      publishedRanges: [],
      lastObservationSequence: s.sequence < 0 ? undefined : s.sequence,
    };
  }

  private async requireLive() {
    if (!this.liveConfig) await this.describe();
    if (!this.liveConfig) fail('No accessible Plex DVR');
    return this.liveConfig;
  }
  async channels(cursor?: string, limit = 100): Promise<V.Page<V.Channel>> {
    await this.requireLive();
    const c = await this.request('/livetv/epg/channels');
    const all: V.Channel[] = (c.Channel || []).map((n: Node) => ({ id: String(n.id), number: String(n.vcn || ''), name: n.title || n.callSign || '', kind: 'tv',
      artwork: this.artwork(n).sort((a, b) => Number(b.kind === 'logo') - Number(a.kind === 'logo')).map(a => ({ ...a, kind: 'channel' as const })), favorite: false }));
    return page(all.slice(offset(cursor), offset(cursor) + limit), offset(cursor), all.length);
  }
  async guide(q: V.GuideQuery): Promise<V.GuideResponse> {
    const live = await this.requireLive();
    const from = Date.parse(q.from), until = Date.parse(q.until);
    if (!Number.isFinite(from) || !Number.isFinite(until) || until <= from || until - from > 7 * 86400000) fail('Invalid Plex guide window');
    const c = await this.request(live.grid, { beginsAt: Math.floor(from / 1000), endsAt: Math.floor(until / 1000), channelGridKey: q.channelIds?.join(','),
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
    this.sessions.set(sessionId, { plan, part, metadata: { ...n, subscriptionId: String(sub.key) }, sequence: -1, pending: Promise.resolve(), mutations: new Map([[r.idempotencyKey, structuredClone(plan)]]) });
    return structuredClone(plan);
  }
}
