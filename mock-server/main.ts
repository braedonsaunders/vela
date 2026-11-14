import { renderArtwork } from './artwork';
import { previewSessions, stopPreview, trailerPreview } from './previews';
import { libraries, libraryEntries } from '../protocol/v0/fixtures/libraries';
import { createHmac } from 'node:crypto';
import type * as V from '../protocol/v0/types';
import { allTitles, channels, detail, extras, featuredSources, featuredTitles, guide, rows, titles } from '../protocol/v0/fixtures/catalogue';
import { faults, mediaRoot, fixtureDurationSeconds, serveMedia } from './media';
import { serveLive, liveFaults } from './live';
import { applyCommand, createSession, events, observe, requestedInit, sessions, snapshot, type Session } from './sessions';
import { appearance, packAsset, serverEvents, setAppearance } from './appearance';

const port = Number(process.env.PORT ?? 7777), origin = process.env.DEV_ORIGIN ?? 'http://localhost:3000';
const secret = crypto.randomUUID();
const viewer: V.Viewer = { id: 'viewer-demo', name: 'Demo Viewer', policyRevision: 'mock-1' };
const yes = { available: true }, no = { available: false, reason: 'Not implemented by this mock' };
const capabilities: V.ServerCapabilities = { protocolVersion: 0, compatibleClientBuilds: { minInclusive: '0.1.0', maxExclusive: '0.2.0' }, server: { id: 'ether-mock', name: 'Vela Studio', version: 'mock-v0' }, features: { passwordSignIn: yes, deviceGrant: yes, quickConnect: yes, descriptiveSearch: yes, aiSearch: no, proactiveFallback: no, liveTV: yes, extras: yes, trailerPreview: yes, initialTrackSelection: no, sessionTrackChanges: no, extraPlayback: yes }, skins: [{ id: 'cinematic', name: 'Cinematic' }, { id: 'editorial', name: 'Editorial' }], defaultSkinId: 'cinematic' };
interface Grant { id: string; device: V.Device; access: string; refresh: string; expires: number; revoked: boolean; client?: V.ClientCapabilities }
const grants = new Map<string, Grant>(), access = new Map<string, Grant>(), refresh = new Map<string, Grant>();
function issue(device: V.Device): V.Tokens {
  if (!device?.id) fail('request', 'device_required', 'A device id is required');
  const g: Grant = { id: crypto.randomUUID(), device, access: crypto.randomUUID(), refresh: crypto.randomUUID(), expires: Date.now() + 3600000, revoked: false };
  grants.set(g.id, g); access.set(g.access, g); refresh.set(g.refresh, g);
  return tokens(g);
}
function tokens(g: Grant): V.Tokens { return { accessToken: g.access, refreshToken: g.refresh, expiresAt: new Date(g.expires).toISOString(), viewer }; }
if (process.env.VELA_MOCK_TOKEN) { const t = issue({ id: 'vela-dev', name: 'Development', platform: 'web', appVersion: '0.1' }); const g = access.get(t.accessToken)!; access.delete(g.access); g.access = process.env.VELA_MOCK_TOKEN; access.set(g.access, g); }
function authenticate(req: Request): Grant {
  const g = access.get(req.headers.get('authorization')?.replace(/^Bearer /, '') ?? '');
  if (!g || g.revoked || g.expires <= Date.now() || req.headers.get('x-vela-device-id') !== g.device.id) fail('auth', 'unauthorized', 'Valid bearer and X-Vela-Device-Id required');
  return g;
}
function fail(cls: V.ProtocolError['class'], code: string, message: string, extra: Partial<V.ProtocolError> = {}): never {
  const status = { auth: 401, policy: 403, 'not-found': 404, source: 502, decoder: 422, capacity: 503, transient: 503, request: 400, conflict: 409 }[cls];
  throw Response.json({ error: { class: cls, code, message, retry: { allowed: ['capacity', 'transient'].includes(cls), ...(cls === 'capacity' ? { afterSeconds: 3, maxAttempts: 3 } : {}) }, ...extra } } satisfies V.ErrorResponse, { status, headers: { 'Cache-Control': 'no-store', ...(cls === 'capacity' ? { 'Retry-After': '3' } : {}) } });
}
const mac = (value: string) => createHmac('sha256', secret).update(value).digest('base64url');
function receipt(g: Grant, value: string) { const p = Buffer.from(`${g.id}|${value}`).toString('base64url'); return `${p}.${mac(p)}`; }
function validReceipt(g: Grant, value: string) { if (typeof value !== 'string') return false; const [p, s] = value.split('.'); try { return s === mac(p) && Buffer.from(p, 'base64url').toString().startsWith(`${g.id}|`); } catch { return false; } }
function boundRow(g: Grant, row: V.Row): V.Row { return { ...row, receiptToken: receipt(g, row.id), items: row.items.map(i => ({ ...i, receiptToken: receipt(g, i.id) })) }; }
function page<T>(items: T[], url: URL, g: Grant, scope: string, defaultLimit = 50): V.Page<T> {
  const n = Number(url.searchParams.get('limit') ?? defaultLimit); if (!Number.isInteger(n) || n < 1 || n > 100) fail('request', 'invalid_limit', 'Limit must be 1–100');
  let offset = 0, expires = Date.now() + 3600000; const cursor = url.searchParams.get('cursor');
  if (cursor) {
    const [p, signature] = cursor.split('.');
    try { const c = JSON.parse(Buffer.from(p, 'base64url').toString()); if (signature !== mac(p) || c.owner !== g.id || c.scope !== scope || !Number.isInteger(c.offset) || c.offset < 0 || c.offset > items.length || !Number.isFinite(c.expires) || c.expires <= Date.now()) throw 0; offset = c.offset; expires = c.expires; } catch { fail('conflict', 'cursor_expired', 'Refresh from first page'); }
  }
  const more = offset + n < items.length;
  const p = Buffer.from(JSON.stringify({ owner: g.id, scope, offset: offset + n, expires })).toString('base64url');
  return { items: items.slice(offset, offset + n), continuation: more ? 'more' : 'exhausted', ...(more ? { nextCursor: `${p}.${mac(p)}` } : {}) };
}
function homeScope() { return `${viewer.policyRevision}:${mac(JSON.stringify([featuredTitles.map(t => t.id), rows]))}`; }
function homeRow(g: Grant, row: V.Row, url: URL): V.Row {
  const bound = boundRow(g, row);
  return { ...bound, ...page(bound.items, url, g, `home-items:${row.id}:${homeScope()}`, 20) };
}
function homeRows(g: Grant, url: URL): V.Page<V.Row> {
  const result = page(rows, url, g, `home-rows:${homeScope()}`, 2);
  const firstItems = new URL(url); firstItems.search = '';
  return { ...result, items: result.items.map(row => homeRow(g, row, firstItems)) };
}
function cached(req: Request, data: unknown, scope: string): Response {
  const body = JSON.stringify(data), etag = `"${mac(scope + body)}"`;
  const headers = { ETag: etag, 'Cache-Control': 'private, max-age=0, must-revalidate', Vary: 'Authorization, X-Vela-Device-Id', 'Content-Type': 'application/json' };
  return new Response(req.headers.get('if-none-match') === etag ? null : body, { status: req.headers.get('if-none-match') === etag ? 304 : 200, headers });
}
const json = (data: unknown) => Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
interface Pairing { device: V.Device; code: string; expires: number; approved: boolean; result?: V.Tokens }
const devices = new Map<string, Pairing>(), quick = new Map<string, Pairing>(), webCodes = new Map<string, number>();
const idempotency = new Map<string, { body: string; response: Promise<Response>; expires: number }>();
function revoke(g: Grant) { g.revoked = true; for (const p of previewSessions.values()) if (p.owner === g.id) p.ended = true; for (const s of sessions.values()) if (s.owner === g.id) { for (const close of s.listeners.values()) close(); s.listeners.clear(); } }
function currentSession(id: string, g: Grant): Session { const s = sessions.get(id); if (!s || s.owner !== g.id || s.expires <= Date.now()) fail('not-found', 'session_not_found', 'Session not found'); return s; }

async function api(req: Request, url: URL, body: any): Promise<Response> {
  const path = url.pathname.replace(/^\/vela\/v0/, ''), method = req.method;
  if (method === 'GET' && path === '/capabilities') return cached(req, capabilities, 'public');
  if (method === 'GET' && path === '/appearance') return cached(req, appearance(), 'public');
  if (method === 'POST' && path === '/auth/sign-in') { if (body.username !== 'demo' || body.password !== 'vela') fail('auth', 'invalid_credentials', 'Invalid sign-in'); return json(issue(body.device)); }
  if (method === 'POST' && path === '/auth/refresh') {
    const g = refresh.get(body.refreshToken); if (!g || g.revoked || g.device.id !== body.device?.id) fail('auth', 'invalid_refresh', 'Refresh invalid');
    access.delete(g.access); refresh.delete(g.refresh); g.access = crypto.randomUUID(); g.refresh = crypto.randomUUID(); g.expires = Date.now() + 3600000; access.set(g.access, g); refresh.set(g.refresh, g); return json(tokens(g));
  }
  if (method === 'POST' && path === '/auth/web-code/redeem') { const expiry = webCodes.get(body.code); if (!expiry || expiry < Date.now()) fail('auth', 'invalid_web_code', 'Code expired or consumed'); webCodes.delete(body.code); return json(issue(body.device)); }
  if (method === 'POST' && ['/auth/device', '/auth/quick-connect'].includes(path)) {
    if (!body.device?.id) fail('request', 'device_required', 'Device required');
    const id = crypto.randomUUID(), code = crypto.randomUUID().slice(0, 8).toUpperCase(), expires = Date.now() + 600000;
    const pairing: Pairing = { device: body.device, code, expires, approved: false };
    (path.endsWith('/device') ? devices : quick).set(id, pairing);
    return json(path.endsWith('/device') ? { deviceCode: id, userCode: code, verificationUrl: '/vela/pair', expiresAt: new Date(expires).toISOString(), pollIntervalSeconds: 3 } : { secret: id, code, expiresAt: new Date(expires).toISOString(), pollIntervalSeconds: 3 });
  }
  if (method === 'POST' && ['/auth/device/poll', '/auth/quick-connect/poll'].includes(path)) {
    const p = (path.includes('/device/') ? devices : quick).get(body.deviceCode ?? body.secret);
    if (!p || p.expires < Date.now()) return json({ status: 'expired' });
    if (p.device.id !== body.device?.id) fail('auth', 'device_mismatch', 'Device mismatch');
    if (!p.approved) return json({ status: 'pending' });
    p.result ??= issue(p.device); return json({ status: 'approved', tokens: p.result });
  }
  if (method === 'POST' && path === '/negotiate') {
    if (!body.client?.device?.id || !body.client?.protocolVersions?.includes(0)) fail('request', 'unsupported_version', 'Protocol v0 and device required');
    if (req.headers.has('authorization')) { const grant = authenticate(req); grant.client = body.client; }
    return json({ capabilities, client: body.client });
  }
  const g = authenticate(req);
  if (method === 'GET' && path === '/libraries') return cached(req, page(libraries, url, g, `libraries:${viewer.policyRevision}:${mac(JSON.stringify(libraries))}`), g.id);
  const libraryMatch = /^\/libraries\/([^/]+)\/items$/.exec(path);
  if (method === 'GET' && libraryMatch) {
    const library = libraries.find(l => l.id === libraryMatch[1]);
    if (!library) fail('not-found', 'library_not_found', 'Library not found');
    const q = url.searchParams, options = library.browse;
    const invalid = () => fail('request', 'invalid_library_query', 'Unsupported or malformed library query');
    for (const key of q.keys()) if (!['cursor','limit','sort','direction','kind','genre','year','played','favorite'].includes(key) || q.getAll(key).length !== 1) invalid();
    const sort = q.get('sort') ?? options.defaultSort, direction = q.get('direction') ?? options.defaultDirection;
    if (!options.sorts.some(s => s.id === sort && s.directions.includes(direction as V.SortDirection))) invalid();
    const kind = q.get('kind'), genre = q.get('genre'), year = q.get('year');
    if (kind !== null && !options.filters.kind?.includes(kind as V.TitleKind)) invalid();
    if (genre !== null && (!options.filters.genre || !genre.trim() || genre.length > 100)) invalid();
    if (year !== null && (!options.filters.year || !/^\d{1,4}$/.test(year) || Number(year) < 1)) invalid();
    for (const key of ['played','favorite'] as const) if (q.has(key) && (!options.filters[key] || !['true','false'].includes(q.get(key)!))) invalid();
    let items = libraryEntries(library.id).filter(e => {
      if (e.kind !== 'title') return true;
      const t = e.title;
      return (!kind || kind === t.kind) && (!genre || t.genres.some(g => g.toLowerCase() === genre.trim().toLowerCase()))
        && (!year || t.year === Number(year)) && (!q.has('played') || !!t.watch?.played === (q.get('played') === 'true'))
        && (!q.has('favorite') || !!t.watch?.favorite === (q.get('favorite') === 'true'));
    });
    if (sort !== 'server') items.sort((a, b) => {
      if (a.kind !== 'title' || b.kind !== 'title') return 0;
      const cmp = sort === 'title' ? a.title.name.localeCompare(b.title.name, 'en') : (a.title.year ?? 0) - (b.title.year ?? 0);
      return (cmp || a.id.localeCompare(b.id)) * (direction === 'desc' ? -1 : 1);
    });
    const query = [sort, direction, kind, genre?.trim().toLowerCase(), year, q.get('played'), q.get('favorite'), q.get('limit') ?? '50'];
    const scope = `library:${library.id}:${viewer.policyRevision}:${mac(JSON.stringify([query, items]))}`;
    items = items.map(i => ({ ...i, receiptToken: receipt(g, `library:${scope}:${i.id}`) }));
    return cached(req, { library, sort: sort as V.LibrarySort, direction: direction as V.SortDirection, ...page(items, url, g, scope) } satisfies V.LibraryContents, g.id);
  }
  if (method === 'POST' && path.endsWith('/approve')) { const p = [...(path.includes('/device/') ? devices : quick).values()].find(p => p.code === (body.userCode ?? body.code) && p.expires > Date.now()); if (!p) fail('not-found', 'grant_not_found', 'Pairing not found'); p.approved = true; return json({ accepted: true }); }
  if (method === 'GET' && path === '/events') return serverEvents(req, () => !g.revoked && g.expires > Date.now());
  if (method === 'POST' && path === '/auth/revoke') { if (body.refreshToken !== g.refresh) fail('auth', 'invalid_refresh', 'Refresh does not belong to this grant'); revoke(g); return json({ accepted: true }); }
  if (method === 'GET' && path === '/bootstrap') {
    const heroes = featuredSources.map(({ rowId, ...hero }): V.Hero => ({ ...hero, receiptToken: receipt(g, `hero:${hero.title.id}`), previewOnFocus: rows.find(row => row.id === rowId)?.previewOnFocus === true }));
    const firstPage = new URL(url); firstPage.search = '';
    const home = homeRows(g, firstPage);
    return cached(req, { viewer, capabilities, defaultSkinId: capabilities.defaultSkinId, heroes, rows: home.items, ...(home.nextCursor ? { nextCursor: home.nextCursor } : {}) } satisfies V.Bootstrap, g.id);
  }
  if (method === 'GET' && path === '/rows') {
    const placement = url.searchParams.get('placement') ?? 'home';
    if (!['home','detail','library'].includes(placement)) fail('request', 'invalid_placement', 'Unknown row placement');
    if (placement === 'detail') {
      if (!detail(url.searchParams.get('titleId') ?? '')) fail('not-found', 'title_not_found', 'Detail title not found');
      return cached(req, { items: [], continuation: 'exhausted' }, g.id);
    }
    return cached(req, placement === 'home' ? homeRows(g, url) : page([], url, g, `rows:${placement}`), g.id);
  }
  const collectionMatch = /^\/collections\/([^/]+)$/.exec(path);
  if (method === 'GET' && collectionMatch) {
    const row = rows.find(r => r.id === collectionMatch[1]);
    if (!row) fail('not-found', 'collection_not_found', 'Collection not found');
    return cached(req, { collection: { id: row.id, kind: 'collection', name: row.name, artwork: [] }, ...page(boundRow(g, row).items, url, g, `collection:${row.id}`) } satisfies V.CollectionContents, g.id);
  }
  const rowMatch = /^\/rows\/([^/]+)$/.exec(path);
  if (method === 'GET' && rowMatch) { const r = rows.find(r => r.id === rowMatch[1]); if (!r) fail('not-found', 'row_not_found', 'Row not found'); return cached(req, homeRow(g, r, url), g.id); }
  const titleMatch = /^\/titles\/([^/]+)(?:\/(children|extras|watch))?$/.exec(path);
  const previewMatch = /^\/titles\/([^/]+)\/trailer-preview$/.exec(path);
  if (method === 'POST' && previewMatch) {
    const title = allTitles.find(t => t.id === previewMatch[1]);
    if (!title) fail('not-found', 'title_not_found', 'Title not found');
    const client = body.client;
    if (!client || client.device?.id !== g.device.id || !['containers','videoCodecs','audioCodecs'].every(key => Array.isArray(client[key]) && client[key].every((v: unknown) => typeof v === 'string'))) fail('request', 'invalid_client', 'A matching device and media capabilities are required');
    const result = await trailerPreview(g.id, viewer.id, title, client, g.expires);
    const response = json(result);
    if (result.state === 'preparing') response.headers.set('Retry-After', String(result.retryAfterSeconds));
    return response;
  }
  if (titleMatch) {
    const d = detail(titleMatch[1]); if (!d) fail('not-found', 'title_not_found', 'Title not found');
    if (method === 'POST' && titleMatch[2] === 'watch') { const t = allTitles.find(t => t.id === titleMatch[1])!; t.watch ??= { positionSeconds: 0, played: false, favorite: false, watchlisted: false }; for (const key of ['played','favorite','watchlisted'] as const) if (typeof body[key] === 'boolean') t.watch[key] = body[key]; return json({ accepted: true }); }
    if (method === 'GET') return cached(req, titleMatch[2] === 'children' ? page(d.seasons ?? d.episodes ?? [], url, g, d.title.id) : titleMatch[2] === 'extras' ? { items: d.extras } : d, g.id);
  }
  if (method === 'POST' && path === '/search') {
    if (typeof body.query !== 'string' || !Number.isInteger(body.generation) || !['fast', 'descriptive'].includes(body.mode)) fail('request', 'invalid_search', 'Query, generation and mode required');
    const terms = body.query.toLowerCase().split(/\s+/).filter(Boolean);
    const items = titles.filter(t => terms.every((term: string) => (body.mode === 'fast' ? t.name : `${t.name} ${t.summary} ${t.genres.join(' ')}`).toLowerCase().includes(term)));
    const paging = new URL(url); if (body.cursor) paging.searchParams.set('cursor', body.cursor); if (body.limit) paging.searchParams.set('limit', String(body.limit));
    return json({ ...page(items, paging, g, `search:${body.mode}:${body.query}`), query: body.query, generation: body.generation });
  }
  if (path.startsWith('/search/ai')) fail('policy', 'feature_unavailable', 'AI search unavailable');
  if (method === 'POST' && path === '/interactions') {
    if (!Array.isArray(body.interactions) || body.interactions.length > 100 || body.interactions.some((i: V.Interaction) => !validReceipt(g, i.receiptToken) || !['visible', 'selected', 'played'].includes(i.kind))) fail('request', 'invalid_receipt', 'Invalid interaction receipt');
    return json({ accepted: true });
  }
  if (method === 'GET' && path === '/live/channels') return cached(req, page(channels, url, g, 'channels'), g.id);
  if (method === 'GET' && path === '/live/guide') {
    const from = Date.parse(url.searchParams.get('from') ?? ''), until = Date.parse(url.searchParams.get('until') ?? '');
    if (!Number.isFinite(from) || !Number.isFinite(until) || until <= from || until - from > 86400000) fail('request', 'invalid_window', 'Guide window must be positive and <=24h');
    const ids = (url.searchParams.get('channelIds') ?? '').split(',').filter(Boolean);
    return cached(req, { ...page(guide(from, until, ids), url, g, `guide:${from}:${until}:${ids.join(',')}`), from: new Date(from).toISOString(), until: new Date(until).toISOString() }, g.id);
  }
  if (method === 'POST' && path === '/playback') {
    if (body.audioTrackId !== undefined || body.subtitleTrackId != null) fail('policy', 'feature_unavailable', 'Initial track selection is unavailable; use native HLS audio and sidecar subtitles');
    if (!body.client || [body.titleId, body.channelId, body.extraId].filter(Boolean).length !== 1) fail('request', 'invalid_target', 'Exactly one playback target required');
    const channel = channels.find(c => c.id === body.channelId);
    const title = allTitles.find(t => t.id === body.titleId), extra = extras.find(e => e.id === body.extraId);
    if (!title && !extra && !channel) fail('not-found', 'title_not_found', 'Playback target not found');
    if (title && !['movie', 'episode'].includes(title.kind)) fail('request', 'not_playable', 'Select an episode to play');
    if (faults.capacityExhausted) fail('capacity', 'capacity_exhausted', 'Mock capacity exhausted');
    if (!await Bun.file(`${mediaRoot}/master.m3u8`).exists()) fail('source', 'media_not_generated', 'Run mock-server/scripts/make-media.ts first');
    if (body.positionSeconds === undefined) body = { ...body, positionSeconds: title?.watch?.positionSeconds ?? 0 };
    if (body.positionSeconds !== undefined && (!Number.isFinite(body.positionSeconds) || body.positionSeconds < 0 || body.positionSeconds > fixtureDurationSeconds)) fail('request', 'invalid_position', `Synthetic fixture is ${fixtureDurationSeconds} seconds`);
    const pendingMode = url.searchParams.get('pendingCodecs');
    let pending: { neverVerify: boolean; pathId: string } | undefined;
    if (pendingMode !== null) {
      if (!['true', 'never'].includes(pendingMode)) fail('request', 'invalid_pending_codecs', 'Use pendingCodecs=true or never');
      const pathId = url.searchParams.get('pendingCodecPath') ?? 'transcode';
      if (!['transcode', 'transcode-mse'].includes(pathId) || body.channelId || !body.client.mse || body.allowTranscode === false || faults.fallbackUnavailable) fail('request', 'invalid_pending_codecs', 'Pending-codec fixture requires a VOD MSE transcode path');
      if (pathId === 'transcode-mse' && !await Bun.file(`${mediaRoot}/mse.json`).exists()) fail('source', 'media_not_generated', 'Generate the separate audio MSE fixture first');
      pending = { neverVerify: pendingMode === 'never', pathId };
    }
    const s = await createSession(g.id, body, pending);
    if (pending && !s.plan.paths.some(p => p.id === pending.pathId)) { sessions.delete(s.plan.sessionId); fail('source', 'media_not_generated', 'Requested MSE fixture is unavailable'); }
    return json(s.plan);
  }
  const match = /^\/sessions\/([^/]+)(?:\/(events|commands|observations))?$/.exec(path);
  if (match) {
    const preview = previewSessions.get(match[1]);
    if (preview) {
      if (preview.owner !== g.id) fail('not-found', 'session_not_found', 'Preview not found');
      if (method !== 'POST' || match[2] !== 'commands' || body.kind !== 'stop') fail('policy', 'preview_command_unavailable', 'Preview sessions accept only stop');
      if (body.sourceGeneration !== preview.grant.sourceGeneration || body.seekGeneration !== preview.grant.seekGeneration) fail('conflict', 'stale_generation', 'Use preview grant generations', { currentGenerations: { sourceGeneration: preview.grant.sourceGeneration, seekGeneration: preview.grant.seekGeneration } });
      return json(stopPreview(preview));
    }
    const s = currentSession(match[1], g);
    if (method === 'GET') return match[2] === 'events' ? events(s, req, () => !g.revoked && g.expires > Date.now()) : json(snapshot(s));
    if (method === 'POST' && ['commands', 'observations'].includes(match[2])) {
      if (body.sourceGeneration !== s.plan.sourceGeneration || body.seekGeneration !== s.plan.seekGeneration) fail('conflict', 'stale_generation', 'Refresh session state', { currentGenerations: { sourceGeneration: s.plan.sourceGeneration, seekGeneration: s.plan.seekGeneration } });
      if (s.plan.state === 'ended') fail('conflict', 'session_ended', 'Session ended');
      if (match[2] === 'observations') { if (!Number.isInteger(body.sequence) || body.sequence < 1 || !Array.isArray(body.playableRanges) || !Number.isFinite(body.positionSeconds) || !['playing','paused','buffering','ended'].includes(body.state)) fail('request', 'invalid_observation', 'Invalid observation'); observe(s, body); return json({ accepted: true }); }
      if (body.kind === 'prepare-fallback') fail(faults.capacityExhausted ? 'capacity' : 'policy', faults.capacityExhausted ? 'capacity_exhausted' : 'feature_unavailable', 'Proactive fallback not implemented');
      if (!['seek', 'pause', 'resume', 'stop', 'tracks', 'switch'].includes(body.kind)) fail('request', 'invalid_command', 'Unknown command');
      if (body.kind === 'seek' && (!Number.isFinite(body.positionSeconds) || body.positionSeconds < 0 || body.positionSeconds > fixtureDurationSeconds)) fail('request', 'invalid_position', `Position must be 0–${fixtureDurationSeconds}`);
      if (body.kind === 'tracks') fail('policy', 'feature_unavailable', 'Changing active tracks needs a new source');
      if (body.kind === 'switch') { const p = s.plan.paths.find(p => p.id === body.pathId); if (!p) fail('not-found', 'path_not_found', 'Unknown path'); if (p.kind === 'transcode' && faults.capacityExhausted) fail('capacity', 'capacity_exhausted', 'Mock capacity exhausted'); if (p.kind === 'transcode' && faults.fallbackUnavailable) fail('source', 'fallback_unavailable', 'Fallback unavailable'); if (!p.boundaries.some(b => b.atSeconds === body.atSeconds && (!s.plan.selectedAudioTrackId || b.audioTrackIds.includes(s.plan.selectedAudioTrackId)) && (!s.plan.selectedSubtitleTrackId || b.subtitleTrackIds.includes(s.plan.selectedSubtitleTrackId)))) fail('conflict', 'unsafe_boundary', 'No proven switch boundary'); }
      applyCommand(s, body); return json(s.plan);
    }
  }
  fail('not-found', 'endpoint_not_found', 'Endpoint not found');
}

async function dispatch(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (url.pathname.startsWith('/__admin/')) {
    if (req.method === 'GET' && url.pathname === '/__admin/live-faults') return json(liveFaults);
    if (req.method === 'POST' && url.pathname === '/__admin/live-faults') { const data = await req.json(); for (const key of Object.keys(liveFaults) as (keyof typeof liveFaults)[]) if (Number.isFinite(data[key]) && data[key] >= 0) liveFaults[key] = Math.min(60000, Math.floor(data[key])); return json(liveFaults); }
    if (req.method === 'GET' && url.pathname === '/__admin/faults') return json(faults);
    if (req.method === 'POST' && url.pathname === '/__admin/faults') { const data = await req.json(); for (const key of Object.keys(faults) as (keyof typeof faults)[]) if (key in data) { if (typeof faults[key] === 'boolean') (faults as any)[key] = data[key] === true; else if (Number.isFinite(data[key]) && data[key] >= 0) (faults as any)[key] = Math.min(data[key], 60_000_000); } return json(faults); }
    if (req.method === 'POST' && url.pathname === '/__admin/appearance') return json(setAppearance(await req.json()));
    if (req.method === 'POST' && url.pathname === '/__admin/web-code') { const code = crypto.randomUUID(); webCodes.set(code, Date.now() + 60000); return json({ code, expiresAt: new Date(Date.now() + 60000).toISOString() }); }
    fail('not-found', 'endpoint_not_found', 'Admin endpoint not found');
  }
  const media = /^\/sessions\/media\/([^/]+)\/([^/]+)\/(.+)$/.exec(url.pathname);
  if (media) {
    const preview = previewSessions.get(media[1]);
    if (preview) {
      const owner = grants.get(preview.owner);
      if (!owner || owner.revoked || owner.expires <= Date.now() || preview.expires <= Date.now() || preview.ended || preview.token !== media[2] || media[3] !== 'direct.mp4') fail('auth', 'invalid_preview_grant', 'Preview grant expired or revoked');
      return serveMedia(req, 'direct.mp4');
    }
    const s = sessions.get(media[1]), g = s && grants.get(s.owner);
    if (!s || !g || g.revoked || g.expires < Date.now() || s.expires <= Date.now() || s.mediaToken !== media[2] || s.plan.state === 'ended') fail('auth', 'invalid_media_grant', 'Invalid media grant');
    const response = await (media[3].startsWith('live/') ? serveLive(req, media[3].slice(5)) : serveMedia(req, media[3]));
    if (req.method === 'GET' && response.status === 200 && media[3].endsWith('/init.mp4')) requestedInit(s, media[3], () => !g.revoked && g.expires > Date.now());
    return response;
  }
  const art = /^\/vela\/v0\/artwork\/([a-z0-9-]+)$/.exec(url.pathname);
  if (art && req.method === 'GET') {
    // Only synthetic assets: no private or remotely fetched imagery.
    const width = Math.max(120, Math.min(1920, Number(url.searchParams.get('width')) || 480));
    return new Response(renderArtwork(art[1], url.searchParams.get('kind') ?? 'poster', width), { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' } });
  }
  const packFile = req.method === 'GET' ? await packAsset(url.pathname) : undefined;
  if (packFile) return packFile;
  if (!url.pathname.startsWith('/vela/v0/')) fail('not-found', 'endpoint_not_found', 'Endpoint not found');
  if (req.method !== 'POST') return api(req, url, undefined);
  let raw: string, body: any; try { raw = await req.text(); if (raw.length > 262144) fail('request', 'body_too_large', 'Body exceeds 256KiB'); body = JSON.parse(raw); } catch (e) { if (e instanceof Response) throw e; fail('request', 'invalid_json', 'JSON object required'); }
  if (!body || typeof body.idempotencyKey !== 'string' || !body.idempotencyKey || body.idempotencyKey.length > 200) fail('request', 'idempotency_required', 'Nonempty idempotencyKey required');
  if (url.pathname !== '/vela/v0/negotiate' && !/^\/vela\/v0\/auth\/(sign-in|refresh|device(?:\/poll)?|quick-connect(?:\/poll)?|web-code\/redeem)$/.test(url.pathname)) authenticate(req);
  const identity = access.get(req.headers.get('authorization')?.replace(/^Bearer /, '') ?? '')?.id ?? body.device?.id ?? body.client?.device?.id ?? 'anonymous';
  const key = `${identity}:${url.pathname}:${body.idempotencyKey}`, old = idempotency.get(key);
  if (old && old.expires > Date.now()) { if (old.body !== raw) fail('conflict', 'idempotency_conflict', 'Key reused with different body'); return (await old.response).clone(); }
  const response = api(req, url, body).catch(e => { if (e instanceof Response) return e; throw e; });
  idempotency.set(key, { body: raw, response, expires: Date.now() + 86400000 });
  return (await response).clone();
}
const server = Bun.serve({ hostname: '127.0.0.1', port, idleTimeout: 0, async fetch(req) {
  let response: Response;
  try { response = await dispatch(req); } catch (e) { if (e instanceof Response) response = e; else { console.error(e); response = Response.json({ error: { class: 'transient', code: 'internal', message: 'Internal mock error', retry: { allowed: false } } }, { status: 500 }); } }
  response.headers.set('Access-Control-Allow-Origin', origin); response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Vela-Device-Id, If-None-Match, Last-Event-ID, Range'); response.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS'); response.headers.set('Access-Control-Expose-Headers', 'ETag, Retry-After, Content-Range, Content-Length'); return response;
} });
console.log(`Vela mock: ${server.url} — demo / vela`);
