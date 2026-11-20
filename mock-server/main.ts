import { matchesLibrarySearch } from './library-search';
import { renderArtwork } from './artwork';
import { previewSessions, stopPreview, trailerPreview } from './previews';
import { libraries as fixtureLibraries, libraryEntries as fixtureLibraryEntries } from '../packages/protocol/fixtures/libraries';
import { createHmac } from 'node:crypto';
import type * as V from '../packages/protocol/types';
import { allTitles, artwork, channels as defaultChannels, detail, extras, featuredSources, featuredTitles, guide as defaultGuide, rows, titles } from '../packages/protocol/fixtures/catalogue';
import { faults, mediaRoot, fixtureDurationSeconds, serveMedia } from './media';
import { serveLive, liveFaults } from './live';
import { applyCommand, createSession, events, observe, requestedInit, sessions, snapshot, type Session } from './sessions';
import { appearance, packAsset, serverEvents, setAppearance } from './appearance';

import { scaleGuide } from './guide-fixture';
const scaleCount = Number(process.env.VELA_MOCK_GUIDE_SCALE);
const scaleFixture = scaleCount === 1000 || scaleCount === 10000 ? scaleGuide(scaleCount) : undefined;
const channels = scaleFixture?.channels ?? defaultChannels;
const fixtureGuide = scaleFixture?.guide ?? defaultGuide;
const gapChannels = new Set((process.env.VELA_MOCK_GUIDE_GAPS ?? '').split(','));
const gapHour = Math.floor(Date.now() / 3600000) * 3600000;
const guide = (from: number, until: number, ids: string[]) => fixtureGuide(from, until, ids).filter(programme =>
  !gapChannels.has(programme.channelId) || Date.parse(programme.end) <= gapHour - 3 * 3600000 || Date.parse(programme.start) >= gapHour + 5 * 3600000);

const port = Number(process.env.PORT ?? 7777), origin = process.env.DEV_ORIGIN ?? 'http://localhost:3000';
const bootstrapDelayMs = Math.min(120_000, Math.max(0, Number(process.env.VELA_MOCK_BOOTSTRAP_DELAY_MS) || 0));
const secret = crypto.randomUUID();
const viewer: V.Viewer = { id: 'viewer-demo', name: 'Demo Viewer', policyRevision: 'mock-1' };
let viewerRevision = 1;
const yes = { available: true }, no = { available: false, reason: 'Not implemented by this mock' };
const capabilities: V.ServerCapabilities = { searchLibraries: true, searchKinds: [{ id: 'movie', label: 'Movies' }, { id: 'show', label: 'Shows' }, { id: 'game', label: 'Video games' }], searchSorts: [{ id: 'relevance', directions: [] }, ...(['title', 'released'] as const).map(id => ({ id, directions: ['asc', 'desc'] as V.SearchDirection[] }))], protocolVersion: 0, compatibleClientBuilds: { minInclusive: '0.1.0', maxExclusive: '0.3.0' }, server: { id: 'ether-mock', name: 'Vela Studio', version: 'mock-v0' }, plexAccountSignIn: process.env.VELA_MOCK_NO_PLEX !== '1', features: { passwordSignIn: yes, deviceGrant: yes, quickConnect: yes, descriptiveSearch: yes, aiSearch: no, proactiveFallback: no, liveTV: yes, ...(process.env.VELA_MOCK_OLD !== '1' ? { libraryLive: yes, removeFromContinue: yes } : {}), extras: yes, trailerPreview: yes, initialTrackSelection: no, sessionTrackChanges: no, extraPlayback: yes }, skins: [{ id: 'cinematic', name: 'Cinematic' }, { id: 'editorial', name: 'Editorial' }], defaultSkinId: 'cinematic' };
if (process.env.VELA_MOCK_GUIDE_WINDOW === '1') capabilities.liveGuideWindow = { maxChannels: 128, maxWindowMinutes: 180 };
const labPreset = process.env.VELA_MOCK_LAB === '1';
const libraries: V.Library[] = labPreset ? [
  { ...fixtureLibraries[0]!, id: '1', browse: { ...fixtureLibraries[0]!.browse, filters: { ...fixtureLibraries[0]!.browse.filters, genres: undefined } } },
  { ...fixtureLibraries[1]!, id: '2', browse: { ...fixtureLibraries[1]!.browse, filters: { ...fixtureLibraries[1]!.browse.filters, genres: undefined } } },
  { ...fixtureLibraries[1]!, id: '4', name: 'Anime Shows', browse: { ...fixtureLibraries[1]!.browse, filters: { ...fixtureLibraries[1]!.browse.filters, genres: undefined } } },
] : fixtureLibraries;
const libraryEntries = (id: string) => fixtureLibraryEntries(labPreset ? id === '1' ? 'movies' : id === '2' || id === '4' ? 'shows' : id : id);
const libraryLiveItems = Array.from({ length: 75 }, (_, index): V.LibraryLiveItem => ({
  id: `stream-${index + 1}`, title: ['Conference keynote', 'City harbour camera', 'Creator Q&A'][index % 3]!,
  subtitle: ['Main stage', 'Waterfront', 'Community stream'][index % 3]!, badge: index % 2 ? 'Public webcam' : 'LIVE',
  viewers: 320 + index * 137, tags: [index % 2 ? 'Travel' : 'Technology'], live: true, artwork: [],
}));
const visibleLibraries: V.Library[] = process.env.VELA_MOCK_OLD === '1' ? libraries.map(library => {
  const { dateDisplay: _dateDisplay, ...legacy } = library;
  const { collectionId: _collectionId, ...filters } = library.browse.filters;
  return { ...legacy, tabs: undefined, presentation: undefined, browse: { ...library.browse, filters: { ...filters, facets: undefined } } };
}) : libraries;
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
  const status = { auth: 401, policy: 403, 'not-found': 404, source: 502, decoder: 422, playback: 422, capacity: 503, transient: 503, request: 400, conflict: 409 }[cls];
  throw Response.json({ error: { class: cls, code, message, retry: { allowed: ['capacity', 'transient'].includes(cls), ...(cls === 'capacity' ? { afterSeconds: 3, maxAttempts: 3 } : {}) }, ...extra } } satisfies V.ErrorResponse, { status, headers: { 'Cache-Control': 'no-store', ...(cls === 'capacity' ? { 'Retry-After': '3' } : {}) } });
}
const mac = (value: string) => createHmac('sha256', secret).update(value).digest('base64url');
function signedArtwork(g: Grant, id: string, kind: V.ArtworkRef['kind']): V.ArtworkRef {
  const ref = artwork(id, kind);
  const token = `${g.id}.${mac(`${g.id}|${kind}|${id}`)}`;
  return { ...ref, sizes: ref.sizes.map(size => ({ ...size, url: `${size.url}&grant=${token}` })) };
}
const personArtwork = (g: Grant) => signedArtwork(g, 'mara-vale', 'person');
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
const removedContinue = new Set<string>();
function progressRows(): V.Row[] {
  const continuing = allTitles.filter(title => (title.kind === 'movie' || title.kind === 'episode') && !title.watch?.played && (title.watch?.positionSeconds ?? 0) > 0 && !removedContinue.has(title.id));
  const next = episodesByShow().map(items => items.find(title => !title.watch?.played)).filter((title): title is V.Title => !!title);
  const row = (id: string, name: string, purpose: V.Row['purpose'], items: V.Title[]): V.Row => ({
    id, name, purpose, receiptToken: '', continuation: 'exhausted',
    items: items.map(title => ({ id: `${id}:${title.id}`, kind: 'title', title, receiptToken: '' })),
  });
  return [
    ...(continuing.length ? [row('progress-continue', 'Continue Watching', 'continue', continuing)] : []),
    ...(next.length ? [row('progress-next-up', 'Next Up', 'nextUp', next)] : []),
  ];
}
function episodesByShow(): V.Title[][] {
  const grouped = new Map<string, V.Title[]>();
  for (const title of allTitles) if (title.kind === 'episode') {
    const items = grouped.get(title.showId ?? '') ?? [];
    items.push(title); grouped.set(title.showId ?? '', items);
  }
  return [...grouped.values()];
}
function recordPlayback(session: Session, ended: boolean): void {
  const title = allTitles.find(value => value.id === session.plan.titleId);
  if (!title) return;
  const position = session.plan.positionSeconds ?? 0;
  const finished = ended || position >= (title.durationSeconds ?? fixtureDurationSeconds) - 1;
  title.watch = { ...(title.watch ?? { favorite: false, watchlisted: false }), positionSeconds: finished ? 0 : position, played: finished };
  viewer.policyRevision = `mock-${++viewerRevision}`;
}
function homeScope() { return `${viewer.policyRevision}:${mac(JSON.stringify([featuredTitles.map(t => t.id), progressRows(), rows]))}`; }
function homeRow(g: Grant, row: V.Row, url: URL): V.Row {
  const source = row.purpose === 'continue' ? { ...row, items: row.items.filter(item => item.kind !== 'title' || !removedContinue.has(item.title.id)) } : row;
  const bound = boundRow(g, source);
  return { ...bound, ...page(bound.items, url, g, `home-items:${row.id}:${homeScope()}`, 20) };
}
const labRows: V.Row[] = [
  ['Trending Now', 30], ['Top 10 on Ether On Air Lab Today', 10], ['New & Noteworthy', 17],
  ['Acclaimed Thrillers', 30], ['Acclaimed Romances', 30], ['Acclaimed History', 30],
  ['Under 100 Minutes', 30], ['Top Rated', 19],
].map(([name, count], i) => ({ ...rows[i % rows.length]!, id: `lab-row-${i}`, name: name as string,
  presentation: i === 1 ? 'ranked' : undefined, items: Array.from({ length: count as number }, (_, n) => {
    const title = titles.filter(t => t.kind === 'movie')[(i * 17 + n) % titles.filter(t => t.kind === 'movie').length]!;
    return { id: `lab-${i}-${n}`, kind: 'title' as const, title, receiptToken: '' };
  }), continuation: 'exhausted' as const }));
const labHomeRows: V.Row[] = [
  { ...labRows[0]!, id: 'lab-home-continue', name: 'Continue Watching', purpose: 'continue', items: labRows[0]!.items.slice(0, 1) },
  { ...labRows[1]!, id: 'lab-home-top10', name: 'Top 10', items: labRows[1]!.items.slice(0, 8) },
  { ...labRows[2]!, id: 'lab-home-new', items: labRows[0]!.items.slice(0, 20) },
  { ...labRows[3]!, id: 'lab-home-because', name: 'Because You Watched…', items: labRows[3]!.items.slice(0, 12) },
  { ...labRows[0]!, id: 'lab-home-trending', items: labRows[0]!.items.slice(0, 20) },
];
function homeRows(g: Grant, url: URL): V.Page<V.Row> {
  const result = page(labPreset ? labHomeRows : [...progressRows(), ...rows], url, g, `home-rows:${homeScope()}`, labPreset ? 5 : 2);
  const firstItems = new URL(url); firstItems.search = '';
  return { ...result, items: result.items.map(row => homeRow(g, row, firstItems)) };
}
function cached(req: Request, data: unknown, scope: string): Response {
  const body = JSON.stringify(data), etag = `"${mac(scope + body)}"`;
  const headers = { ETag: etag, 'Cache-Control': 'private, max-age=0, must-revalidate', Vary: 'Authorization, X-Vela-Device-Id', 'Content-Type': 'application/json' };
  return new Response(req.headers.get('if-none-match') === etag ? null : body, { status: req.headers.get('if-none-match') === etag ? 304 : 200, headers });
}
const json = (data: unknown) => Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
// VELA_MOCK_COLD=1: a title's first detail read is partial (its extras still being made), as
// Ether answers a title it is still filling: pending parts, refreshAfterMs, never cached.
const coldServed = new Set<string>();
function coldTitle(id: string): boolean {
  if (process.env.VELA_MOCK_COLD !== '1' || coldServed.has(id)) return false;
  coldServed.add(id);
  return true;
}
const partial = (data: unknown) => Response.json(data, { headers: { 'Cache-Control': 'private, no-store', ETag: `W/"partial-${Date.now()}"` } });
interface Pairing { device: V.Device; code: string; expires: number; approved: boolean; result?: V.Tokens }
const devices = new Map<string, Pairing>(), quick = new Map<string, Pairing>(), webCodes = new Map<string, number>();
const idempotency = new Map<string, { body: string; response: Promise<Response>; expires: number }>();
function revoke(g: Grant) { g.revoked = true; for (const p of previewSessions.values()) if (p.owner === g.id) p.ended = true; for (const s of sessions.values()) if (s.owner === g.id) { for (const close of s.listeners.values()) close(); s.listeners.clear(); } }
function currentSession(id: string, g: Grant): Session { const s = sessions.get(id); if (!s || s.owner !== g.id || s.expires <= Date.now()) fail('not-found', 'session_not_found', 'Session not found'); return s; }

async function api(req: Request, url: URL, body: any): Promise<Response> {
  const path = url.pathname.replace(/^\/vela\/v0/, ''), method = req.method;
  if (method === 'GET' && path === '/capabilities') return cached(req, capabilities, 'public');
  if (method === 'GET' && path === '/appearance') return cached(req, appearance(), 'public');
  if (method === 'POST' && path === '/auth/plex') { if (body.plexToken !== 'mock-plex-approved') return Response.json({ error: 'not_shared' }, {status: 403}); return json(issue(body.device)); }
  if (method === 'POST' && path === '/auth/sign-in') { if (body.username !== 'demo' || body.password !== 'vela') fail('auth', 'invalid_credentials', 'Invalid sign-in'); return json(issue(body.device)); }
  if (method === 'POST' && path === '/auth/refresh') {
    const g = refresh.get(body.refreshToken); if (!g || g.revoked || g.device.id !== body.device?.id) fail('auth', 'invalid_refresh', 'Refresh invalid');
    access.delete(g.access); refresh.delete(g.refresh); g.access = crypto.randomUUID(); g.refresh = crypto.randomUUID(); g.expires = Date.now() + 3600000; access.set(g.access, g); refresh.set(g.refresh, g); return json(tokens(g));
  }
  if (method === 'POST' && path === '/auth/web-code/redeem') {
    const id = body.device?.id;
    if (typeof id !== 'string' || id.length < 16 || id.length > 128) fail('auth', 'invalid_device', 'Device id must be 16–128 characters');
    const expiry = webCodes.get(body.code);
    if (!expiry || expiry <= Date.now()) fail('auth', 'invalid_web_code', 'Code expired or consumed');
    webCodes.delete(body.code);
    return json(issue(body.device));
  }
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
  if (method === 'GET' && path === '/libraries') return cached(req, page(visibleLibraries, url, g, `libraries:${viewer.policyRevision}:${mac(JSON.stringify(visibleLibraries))}`), g.id);
  const facetsMatch = /^\/libraries\/([^/]+)\/facets\/([^/]+)$/.exec(path);
  if (method === 'GET' && facetsMatch) {
    const library = libraries.find(l => l.id === decodeURIComponent(facetsMatch[1]!));
    const field = decodeURIComponent(facetsMatch[2]!);
    if (!library?.browse.filters.facets?.some(f => f.id === field)) fail('not-found', 'not_found', 'Facet not found');
    const counts = new Map<string, number>();
    for (const item of libraryEntries(library.id)) for (const value of facetValues(item, field)) counts.set(value, (counts.get(value) ?? 0) + 1);
    const search = (url.searchParams.get('query') ?? '').toLowerCase();
    return cached(req, page([...counts].filter(([id]) => id.toLowerCase().includes(search)).map(([id, count]) => ({ id, label: id, count })), url, g, `facets:${library.id}:${field}:${search}`), g.id);
  }
  const libraryRowsMatch = /^\/libraries\/([^/]+)\/rows$/.exec(path);
  if (method === 'GET' && libraryRowsMatch) {
    const library = libraries.find(l => l.id === decodeURIComponent(libraryRowsMatch[1]!));
    if (!library) fail('not-found', 'not_found', 'Library not found');
    if (labPreset) { const first = new URL(url); first.search = ''; return cached(req, page(labRows.map(row => homeRow(g, row, first)), url, g, `library-rows:${library.id}`), g.id); }
    const items = libraryEntries(library.id);
    const ids = new Set(items.filter(e => e.kind === 'title').map(e => e.kind === 'title' ? e.title.id : ''));
    // A plugin library declares its own default shelves, many more than a built-in library has.
    const selected: V.Row[] = library.id === 'videos'
      ? Array.from({ length: 30 }, (_, n) => ({ id: n ? `creator-picks-${n + 1}` : 'creator-picks', name: n ? `Creator shelf ${n + 1}` : 'From your creators', purpose: 'recommendation' as const, receiptToken: '', items: items.slice(n % 8, (n % 8) + 16), continuation: 'exhausted' as const }))
      : rows.map(row => ({ ...row, items: row.items.filter(e => e.kind === 'title' && ids.has(e.title.id)) })).filter(row => row.items.length);
    const paging = new URL(url);
    if (process.env.VELA_MOCK_LIBRARY_ROW_PAGE) paging.searchParams.set('limit', process.env.VELA_MOCK_LIBRARY_ROW_PAGE);
    return cached(req, page(selected.map(row => boundRow(g, row)), paging, g, `library-rows:${library.id}`), g.id);
  }
  const collectionsMatch = /^\/libraries\/([^/]+)\/collections$/.exec(path);
  if (method === 'GET' && collectionsMatch && process.env.VELA_MOCK_OLD !== '1') {
    const library = libraries.find(l => l.id === collectionsMatch[1]);
    if (!library) fail('not-found', 'not_found', 'Library not found');
    const tab = library.tabs?.find(tab => tab.id === url.searchParams.get('tab'));
    if (url.searchParams.has('tab') && (!tab || tab.kind !== 'collections' && tab.kind !== 'people')) fail('request', 'invalid_tab', 'Unknown collections tab');
    const query = (url.searchParams.get('query') ?? '').trim();
    if (query && tab?.search === false) fail('request', 'unsupported_library_query', 'Tab search is disabled');
    const matches = (name: string) => matchesLibrarySearch(name, query);
    if (tab?.kind === 'people') {
      const entries: V.LibraryPersonEntry[] = Array.from({ length: 105 }, (_, index) => ({
        id: `person:performer-${index}`, kind: 'person',
        person: { id: `performer-${index}`, name: `Performer ${String(index + 1).padStart(3, '0')}`, photo: index % 3 === 0 ? personArtwork(g) : null },
        itemCount: index + 1,
      }));
      entries.sort((a, b) => tab.order === 'count' ? b.itemCount - a.itemCount : a.person.name.localeCompare(b.person.name));
      const paged = new URL(url);
      if (process.env.VELA_MOCK_COLLECTION_PAGE_SIZE) paged.searchParams.set('limit', process.env.VELA_MOCK_COLLECTION_PAGE_SIZE);
      return cached(req, page(entries.filter(entry => matches(entry.person.name)), paged, g, `library-people:${library.id}:${tab.id}:${query}`), g.id);
    }
    if (tab?.facet) {
      const counts = new Map<string, { count: number; artwork: V.ArtworkRef[] }>();
      for (const item of libraryEntries(library.id)) for (const value of facetValues(item, tab.facet)) {
        const held = counts.get(value);
        counts.set(value, { count: (held?.count ?? 0) + 1, artwork: held?.artwork ?? (item.kind === 'title' ? [signedArtwork(g, item.title.id, 'poster')] : []) });
      }
      const entries = [...counts].sort((a, b) => (tab.order === 'name' ? 0 : b[1].count - a[1].count) || a[0].localeCompare(b[0])).map(([value, data]) => ({ id: `facet:${tab.facet}:${value}`, name: value, itemCount: data.count, artwork: data.artwork }));
      // Tests can simulate a server that caps pages below the client's requested size.
      const paged = new URL(url);
      if (process.env.VELA_MOCK_COLLECTION_PAGE_SIZE) paged.searchParams.set('limit', process.env.VELA_MOCK_COLLECTION_PAGE_SIZE);
      return cached(req, page(entries.filter(entry => matches(entry.name)), paged, g, `library-collections:${library.id}:${tab.id}:${query}`), g.id);
    }
    const members = libraryEntries(library.id).filter(e => e.kind === 'title' && e.title.id === titles[0]!.id);
    const entries: V.LibraryCollectionEntry[] = members.length ? [{ id: 'fixture-collection', kind: 'collection', receiptToken: '', collection: { id: 'fixture-collection', name: 'Observatory Collection', summary: 'Fixture collection', itemCount: members.length, artwork: [signedArtwork(g, titles[0]!.id, 'poster')] } }] : [];
    return cached(req, page(entries.filter(entry => matches(entry.collection.name)), url, g, `library-collections:${library.id}:${query}`), g.id);
  }
  const personMatch = /^\/people\/([^/]+)(\/titles)?$/.exec(path);
  if (method === 'GET' && personMatch && process.env.VELA_MOCK_OLD !== '1') {
    const performer = /^performer-(\d+)$/.exec(personMatch[1]!);
    const performerIndex = performer ? Number(performer[1]) : -1;
    if (performer && performerIndex < 105 && !personMatch[2]) return cached(req, { id: personMatch[1], name: `Performer ${String(performerIndex + 1).padStart(3, '0')}`, photo: performerIndex % 3 === 0 ? personArtwork(g) : null, roles: ['Acting'], knownFor: 'Acting' } satisfies V.PersonDetail, g.id);
    if (!(performer && performerIndex < 105) && personMatch[1] !== 'person-mara-vale') fail('not-found', 'not_found', 'Person not found');
    if (!personMatch[2]) return cached(req, { id: personMatch[1], name: 'Mara Vale', photo: personArtwork(g), roles: ['Acting'], knownFor: 'Acting', biography: 'Mara Vale is a fictional performer whose work spans film, television, and the stage. '.repeat(16), birthday: '1985-04-12' } satisfies V.PersonDetail, g.id);
    const libraryId = url.searchParams.get('libraryId');
    if (libraryId && !libraries.some(l => l.id === libraryId)) fail('not-found', 'not_found', 'Library not found');
    const visible = libraryId ? libraryEntries(libraryId) : libraryEntries('all');
    const items: V.RowEntry[] = (performer ? visible.filter(e => e.kind === 'title').slice(0, performerIndex + 1) : visible.filter(e => e.kind === 'title' && e.title.id === titles[0]!.id)).map(e => ({ ...e, receiptToken: '', role: 'Commander' }));
    return cached(req, page(items, url, g, `person:${personMatch[1]}:${libraryId ?? ''}`), g.id);
  }
  const libraryLiveMatch = /^\/libraries\/([^/]+)\/live(\/play)?$/.exec(path);
  if (libraryLiveMatch) {
    const library = visibleLibraries.find(l => l.id === libraryLiveMatch[1]);
    const tab = library?.tabs?.find(candidate => candidate.kind === 'live' && (!url.searchParams.get('tab') || candidate.id === url.searchParams.get('tab')));
    if (!library || !tab) fail('not-found', 'library_live_not_found', 'Library live tab not found');
    if (method === 'GET' && !libraryLiveMatch[2]) {
      const search = (url.searchParams.get('query') ?? '').trim().toLowerCase();
      const filter = url.searchParams.get('filter') ?? '';
      if (search.length > 256 || filter.length > 128) fail('request', 'invalid_library_live_query', 'Invalid live library query');
      let items = libraryLiveItems.filter(item => !search || `${item.title} ${item.subtitle ?? ''} ${(item.tags ?? []).join(' ')}`.toLowerCase().includes(search));
      if (filter === 'featured') items = items.filter((_, index) => index % 2 === 0);
      else if (filter) fail('request', 'invalid_library_live_filter', 'Unknown live library filter');
      items = items.map((item, index) => ({ ...item, artwork: [signedArtwork(g, titles[index % titles.length]!.id, 'thumb')] }));
      return cached(req, { library, filters: [{ key: 'featured', label: 'Featured' }], ...page(items, url, g, `library-live:${library.id}:${tab.id}:${search}:${filter}`, 6) } satisfies V.LibraryLiveContents, g.id);
    }
    if (method === 'POST' && libraryLiveMatch[2]) {
      if (!body.client || !libraryLiveItems.some(item => item.id === body.itemId) || body.tab && body.tab !== tab.id) fail('request', 'invalid_library_live_play', 'Invalid live library playback request');
      const s = await createSession(g.id, { channelId: channels[0]!.id, client: body.client, liveMode: body.liveMode, idempotencyKey: body.idempotencyKey });
      delete s.plan.channelId;
      Object.assign(s.plan, { libraryId: library.id, liveItemId: body.itemId, title: libraryLiveItems.find(item => item.id === body.itemId)!.title });
      return json(s.plan);
    }
  }
  const libraryMatch = /^\/libraries\/([^/]+)\/items$/.exec(path);
  if (method === 'GET' && libraryMatch) {
    const library = visibleLibraries.find(l => l.id === libraryMatch[1]);
    if (!library) fail('not-found', 'library_not_found', 'Library not found');
    const q = url.searchParams, options = library.browse;
    const invalid = () => fail('request', 'invalid_library_query', 'Unsupported or malformed library query');
    for (const key of q.keys()) if (key.startsWith('facet.') ? !options.filters.facets?.some(f => `facet.${f.id}` === key) : !['cursor','limit','sort','direction','kind','genre','year','played','favorite','collectionId','query'].includes(key) || q.getAll(key).length !== 1) invalid();
    const collectionId = q.get('collectionId');
    if (collectionId && (process.env.VELA_MOCK_OLD === '1' || !options.filters.collectionId || collectionId !== 'fixture-collection')) invalid();
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
      if (q.get('query') && !t.name.toLowerCase().includes(q.get('query')!.toLowerCase())) return false;
      for (const facet of options.filters.facets ?? []) { const wanted = q.getAll(`facet.${facet.id}`); if (wanted.length && !facetValues(e, facet.id).some(value => wanted.includes(value))) return false; }
      return (!collectionId || t.id === titles[0]!.id) && (!kind || kind === t.kind) && (!genre || t.genres.some(g => g.toLowerCase() === genre.trim().toLowerCase()))
        && (!year || t.year === Number(year)) && (!q.has('played') || !!t.watch?.played === (q.get('played') === 'true'))
        && (!q.has('favorite') || !!t.watch?.favorite === (q.get('favorite') === 'true'));
    });
    if (sort !== 'server' && sort !== 'index') items.sort((a, b) => {
      if (a.kind !== 'title' || b.kind !== 'title') return 0;
      const cmp = sort === 'title' ? a.title.name.localeCompare(b.title.name, 'en') : sort === 'released' ? (a.title.airDate ?? '').localeCompare(b.title.airDate ?? '') : (a.title.year ?? 0) - (b.title.year ?? 0);
      return (cmp || a.id.localeCompare(b.id)) * (direction === 'desc' ? -1 : 1);
    });
    const query = [sort, direction, kind, genre?.trim().toLowerCase(), year, q.get('played'), q.get('favorite'), q.get('limit') ?? '50', collectionId];
    const scope = `library:${library.id}:${viewer.policyRevision}:${mac(JSON.stringify([query, q.getAll('query'), [...q].filter(([key]) => key.startsWith('facet.')), items]))}`;
    items = items.map(i => ({ ...i, receiptToken: receipt(g, `library:${scope}:${i.id}`) }));
    return cached(req, { library, sort: sort as V.LibrarySort, direction: direction as V.SortDirection, ...page(items, url, g, scope) } satisfies V.LibraryContents, g.id);
  }
  if (method === 'POST' && path.endsWith('/approve')) { const p = [...(path.includes('/device/') ? devices : quick).values()].find(p => p.code === (body.userCode ?? body.code) && p.expires > Date.now()); if (!p) fail('not-found', 'grant_not_found', 'Pairing not found'); p.approved = true; return json({ accepted: true }); }
  if (method === 'GET' && path === '/events') return serverEvents(req, () => !g.revoked && g.expires > Date.now());
  if (method === 'POST' && path === '/auth/revoke') { if (body.refreshToken !== g.refresh) fail('auth', 'invalid_refresh', 'Refresh does not belong to this grant'); revoke(g); return json({ accepted: true }); }
  if (method === 'GET' && path === '/bootstrap') {
    if (bootstrapDelayMs) await Bun.sleep(bootstrapDelayMs);
    const heroes = featuredSources.map(({ rowId, ...hero }): V.Hero => ({ ...hero, receiptToken: receipt(g, `hero:${hero.title.id}`), previewOnFocus: rows.find(row => row.id === rowId)?.previewOnFocus === true }));
    const firstPage = new URL(url); firstPage.search = '';
    const home = homeRows(g, firstPage);
    return cached(req, { viewer, capabilities, defaultSkinId: capabilities.defaultSkinId, heroes, rows: home.items, ...(home.nextCursor ? { nextCursor: home.nextCursor } : {}) } satisfies V.Bootstrap, g.id);
  }
  if (method === 'GET' && path === '/rows') {
    const placement = url.searchParams.get('placement') ?? 'home';
    const libraryId = url.searchParams.get('libraryId');
    if (url.searchParams.getAll('libraryId').length > 1 || libraryId && placement !== 'library') fail('request', 'invalid_request', 'Invalid library placement');
    if (libraryId && !libraries.some(l => l.id === libraryId)) fail('not-found', 'not_found', 'Library not found');
    if (libraryId && process.env.VELA_MOCK_OLD !== '1') {
      if (labPreset) { const first = new URL(url); first.search = ''; return cached(req, page(labRows.map(row => homeRow(g, row, first)), url, g, `library-rows:${libraryId}`), g.id); }
      const ids = new Set(libraryEntries(libraryId).filter(e => e.kind === 'title').map(e => e.kind === 'title' ? e.title.id : ''));
      const matches = rows.map(row => ({ ...row, items: row.items.filter(e => e.kind === 'title' && ids.has(e.title.id)) })).filter(row => row.items.length);
      const paging = new URL(url);
      if (process.env.VELA_MOCK_LIBRARY_ROW_PAGE) paging.searchParams.set('limit', process.env.VELA_MOCK_LIBRARY_ROW_PAGE);
      return cached(req, page(matches.map(row => boundRow(g, row)), paging, g, `library-rows:${libraryId}`), g.id);
    }
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
  if (method === 'GET' && rowMatch) { const r = [...rows, ...(labPreset ? [...labRows, ...labHomeRows] : [])].find(r => r.id === rowMatch[1]); if (!r) fail('not-found', 'row_not_found', 'Row not found'); return cached(req, homeRow(g, r, url), g.id); }
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
    const raw = detail(titleMatch[1]); if (!raw) fail('not-found', 'title_not_found', 'Title not found');
    const d = { ...raw, cast: raw.cast.map(person => person.artwork ? { ...person, artwork: personArtwork(g) } : person) };
    if (method === 'POST' && titleMatch[2] === 'watch') {
      const t = allTitles.find(t => t.id === titleMatch[1])!;
      t.watch ??= { positionSeconds: 0, played: false, favorite: false, watchlisted: false };
      for (const key of ['played','favorite','watchlisted'] as const) if (typeof body[key] === 'boolean') t.watch[key] = body[key];
      if (body.continueWatching === false) removedContinue.add(t.id);
      viewer.policyRevision = `mock-${++viewerRevision}`;
      return json({ accepted: true });
    }
    if (method === 'GET' && !titleMatch[2] && coldTitle(d.title.id)) return partial({ ...d, extras: [], pending: ['extras'], refreshAfterMs: 2000 });
    if (method === 'GET') return cached(req, titleMatch[2] === 'children' ? page(d.seasons ?? d.episodes ?? [], url, g, d.title.id) : titleMatch[2] === 'extras' ? { items: d.extras } : d, g.id);
  }
  if (method === 'POST' && path === '/search') {
    if (typeof body.query !== 'string' || !Number.isInteger(body.generation) || !['fast', 'descriptive'].includes(body.mode)) fail('request', 'invalid_search', 'Query, generation and mode required');
    if (body.sort && !capabilities.searchSorts!.some(s => s.id === body.sort)) fail('request', 'invalid_sort', 'Invalid sort');
    if (body.direction !== undefined && !['asc', 'desc'].includes(body.direction)) fail('request', 'invalid_direction', 'Invalid direction');
    if (body.kind !== undefined && !capabilities.searchKinds!.some(k => (typeof k === 'string' ? k : k.id) === body.kind)) fail('request', 'invalid_kind', 'Invalid kind');
    if (body.library !== undefined && !visibleLibraries.some(l => l.id === body.library)) fail('request', 'invalid_library', 'Invalid library');
    const libraryIds = body.library ? new Set(libraryEntries(body.library).flatMap(e => e.kind === 'title' ? [e.title.id] : [])) : undefined;
    const terms = body.query.toLowerCase().split(/\s+/).filter(Boolean);
    const items = titles.filter(t => (!libraryIds || libraryIds.has(t.id)) && (!body.kind || t.kind === body.kind) && terms.every((term: string) => (body.mode === 'fast' ? t.name : `${t.name} ${t.summary} ${t.genres.join(' ')}`).toLowerCase().includes(term)));
    if (body.sort && body.sort !== 'relevance') items.sort((a, b) => (body.direction === 'desc' ? -1 : 1) * (body.sort === 'title' ? a.name.localeCompare(b.name) : (a.year ?? 0) - (b.year ?? 0)));
    const paging = new URL(url); if (body.cursor) paging.searchParams.set('cursor', body.cursor); if (body.limit) paging.searchParams.set('limit', String(body.limit));
    const titlePage = page(items, paging, g, `search:${body.mode}:${body.query}:${body.sort ?? ""}:${body.direction ?? ""}:${body.kind ?? ""}:${body.library ?? ""}`);
    const limit = Number(paging.searchParams.get('limit') ?? 50);
    const matches = (text: string) => terms.length > 0 && terms.every((term: string) => text.toLowerCase().includes(term));
    const now = Date.now();
    const programmes = body.mode === 'fast' && !body.library ? guide(now, now + 86400000, []).filter(p => matches(`${p.name} ${p.episodeTitle ?? ''} ${p.summary ?? ''} ${(p.genres ?? []).join(' ')}`)).slice(0, limit) : [];
    const parentIds = new Set(programmes.map(p => p.channelId));
    const live = body.mode === 'fast' && !body.library ? {
      channels: channels.filter(c => matches(`${c.number} ${c.name} ${c.group ?? ''} ${(c.guides ?? []).map(g => g.name).join(' ')}`)).slice(0, limit),
      programmes,
      programmeChannels: channels.filter(c => parentIds.has(c.id)),
    } : undefined;
    return json({ ...titlePage, query: body.query, generation: body.generation, ...(live ? { live } : {}) } satisfies V.SearchResponse);
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
  if (method === 'POST' && path === '/live/guide/window' && capabilities.liveGuideWindow) {
    const from = Date.parse(body.from), until = Date.parse(body.until);
    const ids = body.channelIds as string[];
    if (!Number.isFinite(from) || !Number.isFinite(until) || until <= from || until - from > 3 * 3600000
      || !Array.isArray(ids) || !ids.length || ids.length > 128 || new Set(ids).size !== ids.length
      || ids.some(id => !channels.some(channel => channel.id === id))) fail('request', 'invalid_window', 'Invalid complete guide window');
    const programmes = guide(from, until, ids);
    if (programmes.length > 20000) fail('request', 'guide_window_too_dense', 'Guide window is too dense', { suggest: { maxChannels: Math.max(1, Math.floor(ids.length / 2)), maxWindowMinutes: 90 } });
    const unavailable = new Set((process.env.VELA_MOCK_GUIDE_UNAVAILABLE ?? '').split(','));
    const now = Date.now();
    const answer: V.GuideWindowResponse = { from: new Date(from).toISOString(), until: new Date(until).toISOString(),
      revision: mac(JSON.stringify([from, until, ids, programmes.map(p => p.id), [...unavailable]])),
      validUntil: new Date(Math.min((Math.floor(now / 300000) + 1) * 300000, ids.some(id => unavailable.has(id)) ? now + 60000 : Infinity)).toISOString(),
      channels: ids.map(channelId => ({ channelId, state: unavailable.has(channelId) ? 'unavailable' : 'ready', programmes: unavailable.has(channelId) ? [] : programmes.filter(p => p.channelId === channelId) })),
    };
    return cached(req, answer, g.id);
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
      if (match[2] === 'observations') { if (!Number.isInteger(body.sequence) || body.sequence < 1 || !Array.isArray(body.playableRanges) || !Number.isFinite(body.positionSeconds) || !['playing','paused','buffering','ended'].includes(body.state)) fail('request', 'invalid_observation', 'Invalid observation'); observe(s, body); if (body.state === 'ended') recordPlayback(s, true); return json({ accepted: true }); }
      if (body.kind === 'prepare-fallback') fail(faults.capacityExhausted ? 'capacity' : 'policy', faults.capacityExhausted ? 'capacity_exhausted' : 'feature_unavailable', 'Proactive fallback not implemented');
      if (!['seek', 'pause', 'resume', 'stop', 'tracks', 'switch'].includes(body.kind)) fail('request', 'invalid_command', 'Unknown command');
      if (body.kind === 'seek' && (!Number.isFinite(body.positionSeconds) || body.positionSeconds < 0 || body.positionSeconds > fixtureDurationSeconds)) fail('request', 'invalid_position', `Position must be 0–${fixtureDurationSeconds}`);
      if (body.kind === 'tracks') fail('policy', 'feature_unavailable', 'Changing active tracks needs a new source');
      if (body.kind === 'switch') { const p = s.plan.paths.find(p => p.id === body.pathId); if (!p) fail('not-found', 'path_not_found', 'Unknown path'); if (p.kind === 'transcode' && faults.capacityExhausted) fail('capacity', 'capacity_exhausted', 'Mock capacity exhausted'); if (p.kind === 'transcode' && faults.fallbackUnavailable) fail('source', 'fallback_unavailable', 'Fallback unavailable'); if (!p.boundaries.some(b => b.atSeconds === body.atSeconds && (!s.plan.selectedAudioTrackId || b.audioTrackIds.includes(s.plan.selectedAudioTrackId)) && (!s.plan.selectedSubtitleTrackId || b.subtitleTrackIds.includes(s.plan.selectedSubtitleTrackId)))) fail('conflict', 'unsafe_boundary', 'No proven switch boundary'); }
      if (body.kind === 'stop') recordPlayback(s, false);
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
    if (req.method === 'POST' && url.pathname === '/__admin/web-code') { const code = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'); const expires = Date.now() + (url.searchParams.has('expired') ? -1 : 60000); webCodes.set(code, expires); return json({ code, expiresAt: new Date(expires).toISOString() }); }
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
    if (url.searchParams.get('kind') === 'person' || url.searchParams.has('grant')) {
      const [id, signature] = (url.searchParams.get('grant') ?? '').split('.');
      const g = grants.get(id ?? '');
      if (!g || g.revoked || g.expires <= Date.now() || signature !== mac(`${g.id}|${url.searchParams.get('kind')}|${art[1]}`)) fail('auth', 'invalid_image_grant', 'Invalid image grant');
    }
    // Only synthetic assets: no private or remotely fetched imagery.
    const width = Math.max(120, Math.min(1920, Number(url.searchParams.get('width')) || 480));
    return new Response(renderArtwork(art[1], url.searchParams.get('kind') ?? 'poster', width), { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': url.searchParams.has('grant') ? 'private, no-store' : 'public, max-age=86400' } });
  }
  const packFile = req.method === 'GET' ? await packAsset(url.pathname) : undefined;
  if (packFile) return packFile;
  if (!url.pathname.startsWith('/vela/v0/')) fail('not-found', 'endpoint_not_found', 'Endpoint not found');
  if (req.method !== 'POST') return api(req, url, undefined);
  let raw: string, body: any; try { raw = await req.text(); if (raw.length > 262144) fail('request', 'body_too_large', 'Body exceeds 256KiB'); body = JSON.parse(raw); } catch (e) { if (e instanceof Response) throw e; fail('request', 'invalid_json', 'JSON object required'); }
  if (url.pathname === '/vela/v0/live/guide/window') {
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail('request', 'invalid_json', 'JSON object required');
    return api(req, url, body);
  }
  if (!body || typeof body.idempotencyKey !== 'string' || !body.idempotencyKey || body.idempotencyKey.length > 200) fail('request', 'idempotency_required', 'Nonempty idempotencyKey required');
  if (url.pathname !== '/vela/v0/negotiate' && !/^\/vela\/v0\/auth\/(plex|sign-in|refresh|device(?:\/poll)?|quick-connect(?:\/poll)?|web-code\/redeem)$/.test(url.pathname)) authenticate(req);
  const identity = access.get(req.headers.get('authorization')?.replace(/^Bearer /, '') ?? '')?.id ?? body.device?.id ?? body.client?.device?.id ?? 'anonymous';
  const key = `${identity}:${url.pathname}:${body.idempotencyKey}`, old = idempotency.get(key);
  if (old && old.expires > Date.now()) { if (old.body !== raw) fail('conflict', 'idempotency_conflict', 'Key reused with different body'); return (await old.response).clone(); }
  const response = api(req, url, body).catch(e => { if (e instanceof Response) return e; throw e; });
  idempotency.set(key, { body: raw, response, expires: Date.now() + 86400000 });
  return (await response).clone();
}
const server = Bun.serve({ hostname: process.env.VELA_MOCK_HOST ?? '127.0.0.1', port, idleTimeout: 0, async fetch(req) {
  // Delay API answers without delaying preflight or artwork.
  const delay = Number(process.env.VELA_MOCK_DELAY_MS ?? 0);
  if (req.method !== 'OPTIONS' && new URL(req.url).pathname.startsWith('/vela/v0/') && !new URL(req.url).pathname.includes('/artwork/') && Number.isFinite(delay) && delay > 0) await Bun.sleep(Math.min(delay, 30000));
  let response: Response;
  try { response = await dispatch(req); } catch (e) { if (e instanceof Response) response = e; else { console.error(e); response = Response.json({ error: { class: 'transient', code: 'internal', message: 'Internal mock error', retry: { allowed: false } } }, { status: 500 }); } }
  response.headers.set('Access-Control-Allow-Origin', origin); response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Vela-Device-Id, If-None-Match, Last-Event-ID, Range'); response.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS'); response.headers.set('Access-Control-Expose-Headers', 'ETag, Retry-After, Content-Range, Content-Length'); return response;
} });
console.log(`Vela mock: ${server.url} — demo / vela`);

function facetValues(entry: V.RowEntry, field: string): string[] {
  if (entry.kind !== 'title') return [];
  if (field === 'studios') return [['Studio North', 'Pixel Workshop', 'Moonlight Pictures', 'Observatory Films'][(entry.title.year ?? 0) % 4]!];
  if (field === 'topic') return entry.title.genres;
  if (field === 'creator') return [(entry.title.year ?? 0) % 2 ? 'Studio North' : 'Pixel Workshop'];
  if (field === 'length') return [(entry.title.durationSeconds ?? 0) < 6000 ? 'Under 100 min' : '100 min or longer'];
  return [];
}
