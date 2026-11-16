import type * as V from '../../wire';
import type { CatalogueSearch, Credentials, Home, ServerAdapter, ServerDescription, TransportCommand } from '../index';
import type { LiveTv, PathSwitching, SwitchCommand } from '../capabilities';
import { VelaError } from '../errors';
import { plexHeaders } from './auth';
import { randomId } from '../../protocol/id';
export * from './auth';

// Plex JSON uses the same metadata envelope for videos, directories and hubs.
type Node = Record<string, any>;
interface PlexSession {
  plan: V.PlaybackPlan;
  part: Node;
  metadata: Node;
  sequence: number;
  /** Each mutation's answer by idempotency key, so a repeated command is not applied twice. */
  mutations: Map<string, V.PlaybackPlan>;
}
export interface PlexConfig { origin: string; credentials: Credentials; clientIdentifier: string }
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
export class PlexAdapter implements ServerAdapter, PathSwitching, LiveTv {
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
    if (await this.config.credentials.get()) {
      try {
        const dvrs = await this.request('/livetv/dvrs');
        const providers = await this.request('/media/providers');
        const grid = (providers.MediaProvider || []).flatMap((p: Node) => p.Feature || []).find((f: Node) => f.type === 'grid')?.key;
        if (dvrs.Dvr?.length && grid) { this.liveConfig = { dvr: String(dvrs.Dvr[0].key), grid }; live = yes; }
      } catch (error) { if (!(error instanceof VelaError) || ![403, 404].includes(error.status)) throw error; }
    }
    return { protocolVersion: 0, server: { id: root.machineIdentifier || this.origin, name: root.friendlyName || 'Plex Media Server', version: root.version || '' },
      features: { liveTV: live, extras: yes, extraPlayback: yes, themeMusic: yes, initialTrackSelection: yes },
      skins: [{ id: 'cinematic', name: 'Cinematic' }], defaultSkinId: 'cinematic' };
  }
  async revokeSession(_r: V.RevokeRequest): Promise<V.Ack> {
    for (const [id, s] of this.sessions) if (s.plan.state !== 'ended') await this.command(id, { kind: 'stop', ...s.plan, idempotencyKey: `revoke-${id}` });
    this.sessions.clear(); this.rotateTransientToken(); await this.config.credentials.set(null); return ack;
  }
  private artwork(n: Node): V.ArtworkRef[] {
    const poster = n.type === 'episode' ? n.grandparentThumb
      : n.type === 'season' ? n.parentThumb || n.grandparentThumb || n.thumb : n.thumb;
    const refs: [string | undefined, V.ArtworkRef['kind']][] = [
      [poster, 'poster'],
      [n.type === 'episode' ? n.thumb : undefined, 'still'],
      [n.art, 'backdrop'],
    ];
    return refs.flatMap(([path, kind]) => {
      if (!path) return [];
      try { return [{ id: String(path), kind, tag: String(n.updatedAt || ''), sizes: [{ width: 0, height: 0, url: this.mediaURL(path) }] }]; } catch { return []; }
    });
  }

  private title(n: Node): V.Title {
    const ratings: V.TitleRating[] = [];
    for (const [field, image, kind] of [['rating', 'ratingImage', 'critic'], ['audienceRating', 'audienceRatingImage', 'audience']] as const)
      if (n[field] !== undefined) ratings.push({ source: n[image] || 'Plex', kind, value: Number(n[field]), scale: 10 });
    let themeMusic: V.ThemeMusic | undefined;
    if (n.theme) { try { themeMusic = { url: this.mediaURL(n.theme), expiresAt: '9999-12-31T23:59:59Z' }; } catch {} }
    return { id: String(n.ratingKey), kind: n.type, name: n.title || '', summary: n.summary || '', year: n.year,
      genres: (n.Genre || []).map((g: Node) => g.tag), durationSeconds: seconds(n.duration), rating: n.contentRating, ratings,
      artwork: this.artwork(n), watch: { positionSeconds: seconds(n.viewOffset), played: Number(n.viewCount || 0) > 0, favorite: false, watchlisted: false },
      ...(themeMusic ? { themeMusic } : {}), showId: n.grandparentRatingKey ? String(n.grandparentRatingKey) : n.type === 'season' ? String(n.parentRatingKey) : undefined,
      showName: n.type === 'episode' ? n.grandparentTitle : n.type === 'season' ? n.parentTitle : undefined,
      seasonId: n.type === 'episode' ? String(n.parentRatingKey) : undefined, seasonNumber: n.type === 'season' ? n.index : n.parentIndex, episodeNumber: n.type === 'episode' ? n.index : undefined };
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
    return { viewer: tokens.viewer, capabilities: await this.describe(), defaultSkinId: 'cinematic', rows: (await this.rows({})).items, heroes: [] };
  }
  async rows(q: V.RowsQuery): Promise<V.Page<V.Row>> {
    const path = q.placement === 'detail' && q.titleId ? `/library/metadata/${enc(q.titleId)}/related` : '/hubs';
    const c = await this.request(path, { count: q.limit || 20 });
    // PMS lists every hub type, including ones with nothing in them; an empty, finished hub is not a row.
    const hubs = (c.Hub || []).map((h: Node) => this.hub(h)).filter((row: V.Row) => row.items.length > 0 || row.continuation === 'more');
    return page(hubs, 0, hubs.length);
  }
  async row(id: string, cursor?: string, limit = 20): Promise<V.Row> {
    if (!id.startsWith('/hubs/') && !id.startsWith('/library/')) fail('Invalid Plex hub');
    const c = await this.request(id, { 'X-Plex-Container-Start': offset(cursor), 'X-Plex-Container-Size': limit });
    return this.hub({ ...c, key: id, title: c.title || c.title2 });
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
    const c = await this.request(`/library/metadata/${enc(id)}`, { includeExtras: 1, includeChapters: 1 });
    const n = this.nodes(c)[0]; if (!n) fail('Plex title not found', 'not-found'); return n;
  }
  async detail(id: string): Promise<V.TitleDetail> {
    const n = await this.metadata(id);
    const children = ['show','season'].includes(n.type) ? this.nodes(await this.request(`/library/metadata/${enc(id)}/children`)).map(n => this.title(n)) : undefined;
    const streams: Node[] = (n.Media || []).flatMap((m: Node) => (m.Part || []).flatMap((p: Node) => p.Stream || []));
    const person = (p: Node, role?: string) => ({ name: p.tag, role: role || p.role, artwork: p.thumb ? { ...this.artwork({ thumb: p.thumb })[0], kind: 'person' as const } : undefined });
    return { title: this.title(n), canPlay: ['movie','episode'].includes(n.type) && !!n.Media?.length, seasons: n.type === 'show' ? children : undefined, episodes: n.type === 'season' ? children : undefined,
      cast: (n.Role || []).map((p: Node) => person(p)), crew: [...(n.Director || []).map((p: Node) => person(p, 'Director')), ...(n.Writer || []).map((p: Node) => person(p, 'Writer'))],
      chapters: this.chapters(n), extras: (n.Extras?.Metadata || []).map((e: Node) => ({ id: String(e.ratingKey), parentId: id, kind: Number(e.extraType) === 1 ? 'trailer' : 'other', name: e.title, durationSeconds: seconds(e.duration), artwork: this.artwork(e)[0], availability: e.Media?.length ? 'ready' : 'unresolved' })),
      mediaSummary: { video: streams.filter(s => Number(s.streamType) === 1).map(s => ({ codec: s.codec, width: s.width, height: s.height, bitDepth: s.bitDepth, colorTransfer: s.colorTrc })), audio: streams.filter(s => Number(s.streamType) === 2).map(s => ({ codec: s.codec, channels: s.channels, language: s.languageCode })) } };
  }
  private chapters(n: Node): V.Chapter[] { return (n.Chapter || []).map((c: Node) => ({ id: String(c.id), name: c.tag || `Chapter ${Number(c.index || 0) + 1}`, startSeconds: seconds(c.startTimeOffset), endSeconds: c.endTimeOffset === undefined ? undefined : seconds(c.endTimeOffset) })); }
  async search(r: CatalogueSearch): Promise<V.SearchResponse> {
    const c = await this.request('/hubs/search', { query: r.query, limit: r.limit || 30 });
    const seen = new Set<string>(); const all = (c.Hub || []).flatMap((h: Node) => this.nodes(h)).filter((n: Node) => ['movie','show','season','episode'].includes(n.type) && !seen.has(String(n.ratingKey)) && !!seen.add(String(n.ratingKey)));
    return { query: r.query, generation: r.generation, ...page(all.map((n: Node) => this.title(n)), 0, all.length) };
  }
  async startPlayback(r: V.PlaybackRequest): Promise<V.PlaybackPlan> {
    for (const s of this.sessions.values()) if (s.mutations.has(r.idempotencyKey)) return s.mutations.get(r.idempotencyKey)!;
    if (r.channelId) return this.livePlayback(r);
    const id = r.titleId || r.extraId!; const n = await this.metadata(id);
    const media = n.Media?.[0]; const part = media?.Part?.[0];
    if (!part || media.Part.length !== 1) fail('Plex title has no supported single-part media', 'playback');
    const sessionId = `vela-${randomId()}`;
    const streams: Node[] = part.Stream || [];
    const tracks = (type: number): V.Track[] => streams.filter(s => Number(s.streamType) === type).map(s => ({ id: String(s.id), streamIndex: s.index,
      kind: type === 2 ? 'audio' : 'subtitle', language: s.languageCode || 'und', name: s.displayTitle || s.title || s.language || s.codec || '', codec: s.codec || '', channels: s.channels,
      default: !!s.selected, forced: !!s.forced, hearingImpaired: !!s.hearingImpaired,
      ...(type === 3 ? { delivery: s.key ? s.codec === 'webvtt'
        ? { kind: 'external' as const, format: 'webvtt' as const, url: this.mediaURL(s.key) }
        : { kind: 'burn-in' as const }
        : { kind: 'embedded' as const }, ...(s.key && s.codec === 'webvtt' ? { url: this.mediaURL(s.key) } : {}) } : {}) }));
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
      const query = { path: `/library/metadata/${id}`, mediaIndex: 0, partIndex: 0, protocol: 'hls', directPlay: 0, directStream: 1,
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
    this.sessions.set(sessionId, { plan, part, metadata: n, sequence: -1, mutations: new Map([[r.idempotencyKey, structuredClone(plan)]]) });
    return plan;
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
      duration: s.metadata.duration, state, session: s.plan.sessionId, hasMDE: 1 });
  }
  async reportObservation(id: string, r: V.PlayerObservation): Promise<V.Ack> {
    const s = this.session(id); this.generations(s.plan, r);
    if (r.sequence <= s.sequence || s.plan.state === 'ended') return ack;
    if (!Number.isFinite(r.positionSeconds) || r.positionSeconds < 0) fail('Invalid playback position');
    s.plan.positionSeconds = r.positionSeconds;
    await this.timeline(s, r.state === 'ended' ? 'stopped' : r.state === 'buffering' ? 'buffering' : r.state);
    // PMS uses timeline progress to maintain resume/watched thresholds; never mark a partial stop watched.
    s.sequence = r.sequence; s.plan.state = r.state === 'ended' ? 'ended' : r.state === 'paused' ? 'paused' : 'playing'; s.plan.revision++;
    if (r.state === 'ended') await this.stopTranscode(id);
    return ack;
  }
  command(id: string, r: TransportCommand): Promise<V.PlaybackPlan> {
    return this.mutate(id, r, async s => {
      switch (r.kind) {
        case 'seek':
          if (!Number.isFinite(r.positionSeconds) || r.positionSeconds < 0) fail('Invalid seek');
          s.plan.positionSeconds = r.positionSeconds;
          s.plan.seekGeneration++;
          await this.timeline(s, 'playing');
          break;
        case 'stop':
          await this.timeline(s, 'stopped');
          await this.stopTranscode(id);
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
    const saved = s.mutations.get(r.idempotencyKey);
    if (saved) return saved;
    this.generations(s.plan, r);
    if (s.plan.state === 'ended') fail('Plex playback session ended', 'conflict');
    await apply(s);
    s.plan.revision++;
    const result = structuredClone(s.plan);
    s.mutations.set(r.idempotencyKey, result);
    return result;
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
      artwork: this.artwork(n).map(a => ({ ...a, kind: 'channel' as const })), favorite: false }));
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
    this.sessions.set(sessionId, { plan, part, metadata: { ...n, subscriptionId: String(sub.key) }, sequence: -1, mutations: new Map([[r.idempotencyKey, structuredClone(plan)]]) });
    return plan;
  }
}
