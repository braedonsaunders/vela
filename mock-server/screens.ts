// Plugin screens and surfaces, shaped exactly like Ether's design (plugin-screens/ether-design.md
// sections 3b, 5.4, 6 and 7; docs/plugin-screens.md): bootstrap navigation and surfaces, immutable
// documents (served from packages/protocol/fixtures/screens with `deps` added), per-viewer data
// with the section 5.4 view-model records, the ether.* actions, and /live/stream page topics
// (`records`, `source`, `alert` frames). The records are derived from the Sports simulation in
// sports.ts, so a goal there is a record push here.
//
// Knobs: VELA_MOCK_FROM_START=1 adds programme/fromStart to watch targets (not in Ether E1/E2);
// VELA_MOCK_SCREEN_FIXTURES=<dir> reads the documents from another directory (same layout);
// VELA_MOCK_NEWS=1 adds the news-desk example (a plugin with plugin sources and a plugin action);
// Studio's live preview: X-Vela-Screen-Preview equal to VELA_MOCK_SCREEN_PREVIEW_TOKEN (default
// preview-test) reads drafts from VELA_MOCK_SCREEN_DRAFTS=<dir> (same layout; a page without a draft
// is the published one), never cached; any other token is 403 preview_expired.
// A client that sends no X-Vela-Screen-Renderer gets no screens and no surfaces (hard cut).
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type * as V from '../packages/protocol/types';
import { mediaChildren, mediaTitle } from '../packages/protocol/fixtures/media';
import { entityKey, sportsEnabled, sportsGate, sportsModel, sportsNow, type SportsSim } from './sports';

type Fail = (cls: V.ProtocolError['class'], code: string, message: string, extra?: Partial<V.ProtocolError>, status?: number) => never;
type Json = Record<string, unknown>;

const FIXTURES = process.env.VELA_MOCK_SCREEN_FIXTURES || join(import.meta.dir, '../packages/protocol/fixtures/screens');
const noFromStart = process.env.VELA_MOCK_FROM_START !== '1';
const H = 3600_000;

// Documents

interface Page { screen: string; page: string; file: string }
interface SurfaceSpec { id: string; file: string; contribution: Omit<V.SurfaceContribution, 'id' | 'document'> }

/** Sports' screen pages and surfaces. A surface is offered only once its document exists. */
const PAGES: Page[] = [
  { screen: 'sports', page: 'index', file: 'sports/index.json' },
  { screen: 'sports', page: 'game', file: 'sports/game.json' },
];
const newsEnabled = process.env.VELA_MOCK_NEWS === '1';
if (newsEnabled) PAGES.push({ screen: 'news', page: 'index', file: 'news/index.json' });
const NAVIGATION = [{ id: 'sports', title: 'Sports', icon: 'sports', page: 'index' }, ...(newsEnabled ? [{ id: 'news', title: 'News', icon: 'news', page: 'index' }] : [])];
const SURFACES: SurfaceSpec[] = [
  { id: 'sports.scorebug', file: 'sports/surfaces/scorebug.json', contribution: { presentation: 'playerOverlay', anchor: 'topLeft', when: { event: { feed: 'sports' } }, visibility: 'always',
    setting: { id: 'scorebug', label: 'Score', default: true } } },
  { id: 'sports.ticker', file: 'sports/surfaces/ticker.json', contribution: { presentation: 'playerOverlay', anchor: 'bottom', when: { kind: 'channel' }, visibility: 'toggle',
    setting: { id: 'ticker', label: 'Scores ticker', default: false } } },
  { id: 'sports.alert', file: 'sports/surfaces/alert.json', contribution: { presentation: 'toast', when: { alert: { plugin: 'sports' } }, ttl: 12 } },
  { id: 'sports.tonight', file: 'sports/surfaces/tonight.json', contribution: { presentation: 'homeRow' } },
  // The mock music plugin's album panel: a slot surface (listen.album.panel) reading a vela.* source
  // with its context hole beside its own route's p:note record.
  { id: 'music.albumNote', file: 'music/surfaces/album-note.json', contribution: { presentation: 'slot', slot: 'listen.album.panel' } },
];

interface Compiled { document: V.ScreenDocument; hash: string; mtime: number; draft?: boolean }
const compiled = new Map<string, Compiled>();

/** As Ether serves it: a screen's index is a section and its other pages are pages; a surface's
 * document is page "main" with its kind as presentation. */
function served(file: string): Partial<V.ScreenDocument> {
  const page = PAGES.find(p => p.file === file);
  if (page) return { screen: page.screen, page: page.page, presentation: page.page === 'index' ? 'section' : 'page' };
  const surface = SURFACES.find(spec => spec.file === file);
  return surface ? { screen: surface.id, page: 'main', presentation: surface.contribution.presentation, ...(surface.contribution.slot ? { slot: surface.contribution.slot } : {}) } : {};
}

/** A fixture with `deps` added to each source (its {param.x} holes), hashed; read again when the file changes. */
const DRAFTS = process.env.VELA_MOCK_SCREEN_DRAFTS || '';
const PREVIEW_TOKEN = process.env.VELA_MOCK_SCREEN_PREVIEW_TOKEN || 'preview-test';

/** Whether this request previews drafts: no header, published; the live token, drafts; any other token is refused. */
function previewOf(req: Request, fail: Fail): boolean {
  const token = req.headers.get('x-vela-screen-preview');
  if (!token) return false;
  if (token !== PREVIEW_TOKEN) fail('policy', 'preview_expired', 'Preview expired, reload from Studio', {}, 403);
  return true;
}

function load(file: string, draft = false): Compiled | undefined {
  const drafted = draft && DRAFTS ? join(DRAFTS, file) : '';
  let path = drafted || join(FIXTURES, file);
  let mtime: number;
  try { mtime = statSync(path).mtimeMs; } catch {
    if (!drafted) return undefined;
    path = join(FIXTURES, file);
    try { mtime = statSync(path).mtimeMs; } catch { return undefined; }
  }
  const key = path;
  const known = compiled.get(key);
  if (known && known.mtime === mtime) return known;
  const document = { ...JSON.parse(readFileSync(path, 'utf8')), ...served(file) } as V.ScreenDocument;
  for (const spec of Object.values(document.sources ?? {})) spec.deps = holes(spec, 'param');
  const hash = createHash('sha256').update(JSON.stringify(document)).digest('hex').slice(0, 16);
  const entry = { document, hash, mtime, draft: path !== join(FIXTURES, file) };
  compiled.set(key, entry);
  return entry;
}

function holes(spec: V.SourceSpec, scope: 'param' | 'context'): string[] {
  const { deps: _deps, from: _from, lazy: _lazy, ...args } = spec;
  const found = new Set<string>();
  for (const match of JSON.stringify(args).matchAll(new RegExp(`\\{${scope}\\.([A-Za-z0-9_.-]+)\\}`, 'g'))) found.add(match[1]!);
  return [...found].sort();
}

const rendererOf = (req: Request) => { const n = Number(req.headers.get('x-vela-screen-renderer')); return Number.isInteger(n) && n > 0 ? n : 0; };
/** The display language: X-Vela-Language, else Accept-Language; the first tag. */
export function languageOf(req: Request): string {
  const header = req.headers.get('x-vela-language') || req.headers.get('accept-language') || '';
  const tag = header.split(',')[0]!.split(';')[0]!.trim();
  return /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/.test(tag) ? tag : 'en';
}
const pageHref = (page: Page, doc: Compiled, l = 'en') => `/vela/v0/screens/${page.screen}/pages/${page.page}/document?v=${doc.hash}&r=${doc.document.renderer}&l=${encodeURIComponent(l)}`;
const surfaceHref = (spec: SurfaceSpec, doc: Compiled, l = 'en') => `/vela/v0/surfaces/${spec.id}/document?v=${doc.hash}&r=${doc.document.renderer}&l=${encodeURIComponent(l)}`;

/** Screens and surfaces the owner has hidden from viewers (POST /__admin/screens): 404, and their streams end. */
const hidden = new Set<string>();

/** Surface rows' names (the page row's title). */
const SURFACE_NAMES: Record<string, string> = { 'sports.tonight': 'Sports Tonight' };

// Viewer state that is the screens' own: surface switches.
const surfaceSettings = new Map<string, Map<string, boolean>>();
const settingOf = (viewerId: string, spec: SurfaceSpec) => surfaceSettings.get(viewerId)?.get(spec.id) ?? spec.contribution.setting?.default ?? true;

/** Bootstrap's navigation, surfaces and the surface Home row, for a client that draws screens. */
export function screensBootstrap(req: Request, viewerId: string): { navigation?: V.ScreenNavigationEntry[]; surfaces?: V.SurfaceContribution[]; homeRows: V.SurfaceRow[] } {
  const renderer = rendererOf(req);
  if (!sportsEnabled || !renderer) return { homeRows: [] };
  const language = languageOf(req);
  // A live preview token lists the drafts (an expired one is ignored here: bootstrap still answers).
  const draft = req.headers.get('x-vela-screen-preview') === PREVIEW_TOKEN;
  const navigation = NAVIGATION.flatMap(entry => {
    const page = PAGES.find(p => p.screen === entry.id && p.page === entry.page)!;
    const doc = load(page.file, draft);
    return doc && !hidden.has(entry.id) && doc.document.renderer <= renderer ? [{ kind: 'screen' as const, ...entry, document: { href: pageHref(page, doc, language), renderer: doc.document.renderer } }] : [];
  });
  const surfaces = SURFACES.flatMap(spec => {
    const doc = load(spec.file, draft);
    if (!doc || hidden.has(spec.id) || doc.document.renderer > renderer) return [];
    const setting = spec.contribution.setting ? { ...spec.contribution.setting, enabled: settingOf(viewerId, spec) } : undefined;
    return [{ id: spec.id, ...spec.contribution, ...(setting ? { setting } : {}), document: { href: surfaceHref(spec, doc, language), renderer: doc.document.renderer } } as V.SurfaceContribution];
  });
  // A published homeRow surface is a row stub on Home, in page order (main.ts places it); the id is opaque.
  const homeRows = surfaces.filter(surface => surface.presentation === 'homeRow').map((surface): V.SurfaceRow => ({
    kind: 'surface', id: `surface:sports:${surface.id}`, name: SURFACE_NAMES[surface.id] ?? surface.id, plugin: 'sports', surface: surface.id }));
  return { ...(navigation.length ? { navigation } : {}), ...(surfaces.length ? { surfaces } : {}), homeRows };
}

function serveDocument(req: Request, url: URL, doc: Compiled, fail: Fail): Response {
  if (doc.document.renderer > rendererOf(req)) fail('not-found', 'update_required', 'No variant of this page fits this client');
  // Immutable when v names this version; without v, or with a stale one, the current document is
  // served (200, its ETag) and may change. There is no redirect.
  const current = url.searchParams.get('v') === doc.hash;
  const etag = `"${doc.hash}"`;
  // A draft (Studio preview) is never cached, whatever v says.
  const headers = { ETag: etag, 'Cache-Control': doc.draft ? 'no-store' : current ? 'private, max-age=31536000, immutable' : 'private, no-cache', 'Content-Type': 'application/json' };
  if (doc.draft) return new Response(JSON.stringify(doc.document), { headers });
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(JSON.stringify(doc.document), { headers });
}

// Revisions: rev = max(last + 1, now), bumped only when the content hash changes (Ether section 7).

const revs = new Map<string, { hash: string; rev: number }>();
let lastRev = 0;
function revOf(scope: string, value: unknown): number {
  const hash = createHash('sha1').update(JSON.stringify(value) ?? 'undefined').digest('base64');
  const known = revs.get(scope);
  if (known && known.hash === hash) return known.rev;
  lastRev = Math.max(lastRev + 1, Date.now());
  revs.set(scope, { hash, rev: lastRev });
  return lastRev;
}

// Time, in the viewer's zone

function zone(tz: string | null): string {
  if (tz) try { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz; } catch { /* the server zone */ }
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
const dayFormats = new Map<string, Intl.DateTimeFormat>();
/** The local date (YYYY-MM-DD) of an instant in a zone. */
function localDay(at: number, tz: string): string {
  let format = dayFormats.get(tz);
  if (!format) dayFormats.set(tz, format = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }));
  return format.format(at);
}
function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// View models (Ether section 5.4), from the event as the viewer reads it (spoiler mask applied)

const recordKey = (id: string) => `event:${id}`;
const detailKey = (id: string) => `detail:${id}`;
const entityRecord = (favKey: string) => `entity:${favKey}`;
const ref = (key: string) => ({ $record: key });

export function leagueLabel(league: { name: string; abbr?: string }): string {
  const name = league.name.trim(), abbr = (league.abbr ?? '').trim();
  if (!abbr || !name || abbr.toLowerCase() === name.toLowerCase()) return name || abbr;
  const words = name.split(/\s+/);
  if (words[0]!.toLowerCase() === abbr.toLowerCase()) return abbr;
  const initials = words.map(word => /^\d+$/.test(word) ? word : word[0]!).join('');
  if (initials.toLowerCase() === abbr.toLowerCase() && (abbr.length >= 3 || name.length > 8)) return abbr;
  if (name.length <= 12) return name;
  return abbr;
}
const leagueOf = (league: V.LiveLeague) => ({ id: league.id, name: league.name, ...(league.abbr ? { abbr: league.abbr } : {}), label: leagueLabel(league), ...(league.logo ? { logo: relative(league.logo) } : {}) });

const POSSESSION = /^(possession|ball|serving|serve|batting|at bat)$/i;
const same = (a: string | undefined, b: string) => !!a && a.trim().toLowerCase() === b.trim().toLowerCase();
/** The situation entry that names which side has the ball (Ether's possession rule): a possession key
 * whose value is exactly a side's abbr, short name, name or id. "NYG 38" only mentions a side. */
export function possessor(situation: Record<string, string> | undefined, pair: readonly V.LiveCompetitor[]): { id?: string; key?: string } {
  for (const [key, value] of Object.entries(situation ?? {})) {
    if (!POSSESSION.test(key.trim()) || typeof value !== 'string') continue;
    const side = pair.find(c => [c.abbr, c.short, c.name, c.id].some(name => same(name, value)));
    if (side) return { id: side.id, key };
  }
  return {};
}

export function phaseOf(state: V.LiveEventState): 'live' | 'upcoming' | 'final' | 'off' {
  return state === 'in' ? 'live' : state === 'pre' || state === 'delayed' ? 'upcoming' : state === 'post' ? 'final' : 'off';
}
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return words.slice(0, 3).map(w => w[0]!).join('').toUpperCase();
  return (words[0] ?? '').slice(0, 3).toUpperCase();
}
const hex = (value: string | undefined) => {
  if (!value) return undefined;
  const h = value.startsWith('#') ? value.slice(1) : value;
  return /^[0-9a-f]{6}$/i.test(h) ? `#${h.toLowerCase()}` : undefined;
};
const tunable = (t: V.WatchTarget) => !!t.channelId && t.available !== false;
const watchScore = (t: V.WatchTarget) => (t.live ? 2 : 0) + (t.kind === 'channel' && t.channelId ? 1 : 0) + t.confidence;

/** Where to watch: tunable targets best first, the first as `primary`, and at most two other places it airs. */
export function watchOf(event: V.LiveEvent) {
  const all = event.watch ?? [];
  const targets = all.filter(tunable).sort((a, b) => watchScore(b) - watchScore(a)).map(t => {
    const fromStart = noFromStart || !t.programme ? undefined : t.programme.catchUp ? 'catchUp' : t.programme.startOver ? 'startOver' : undefined;
    return { kind: t.kind, channelId: t.channelId!, name: t.name, ...(t.number ? { number: t.number } : {}), ...(t.logo ? { logo: t.logo } : {}), live: t.live, confidence: t.confidence,
      ...(fromStart && t.programme ? { fromStart, programme: { id: t.programme.id, start: t.programme.start, end: t.programme.end } } : {}) };
  });
  const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9+]/g, '');
  const tuned = new Set(targets.map(t => key(t.name)));
  const unavailable = all.filter(t => t.channelId && t.available === false).map(t => ({ name: t.number ? `${t.name} · ${t.number}` : t.name, unavailable: true }));
  const addons = all.filter(t => !tunable(t) && t.kind === 'addon').map(t => ({ name: t.name }));
  const rank = { tv: 0, stream: 1, radio: 2 } as const;
  const broadcasts = [...(event.broadcasts ?? [])].sort((a, b) => (rank[a.kind] ?? 3) - (rank[b.kind] ?? 3)).map(b => ({ name: b.name }));
  const seen = new Set<string>();
  const airing = [...unavailable, ...addons, ...broadcasts].filter(item => {
    const k = key(item.name);
    if (!item.name.trim() || tuned.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 2);
  const primary = targets[0];
  return { targets, ...(primary ? { primary } : {}), airing };
}

/** The `event:` record: facts the documents compose sentences from. */
export function eventView(event: V.LiveEvent, favourites: ReadonlySet<string>): Json {
  const phase = phaseOf(event.status.state);
  const spoiler = event.spoiler === true;
  const isFav = (c: V.LiveCompetitor) => !!c.entityId && [...favourites].some(key => key === c.entityId || key.endsWith(`:${c.entityId}`));
  const [a, b] = event.competitors;
  const pair = a && b && event.competitors.length === 2 ? (a.home && !b.home ? [b, a] : [a, b]) : null;
  const final = phase === 'final';
  // Probability: the home side's chance, the side the series is about, and who leads.
  const p = !spoiler && pair && event.probability && Number.isFinite(event.probability.value) ? event.probability : undefined;
  const subject = p ? Math.max(0, pair!.findIndex(c => c.id === (p.competitorId ?? pair![0]!.id))) : 0;
  const value = p ? Math.min(1, Math.max(0, p.value)) : 0;
  const home = p ? (subject === 1 ? value : 1 - value) : undefined;
  const homeShare = home !== undefined ? Math.round(home * 100) : undefined;
  const ball = !spoiler && pair ? possessor(event.situation, pair) : {};
  const sides = pair?.map((c, n) => {
    const other = pair[n ? 0 : 1]!;
    const score = c.score ?? '';
    const lost = final && (c.winner === false && other.winner === true || (!c.winner && !other.winner && Number(score) < Number(other.score ?? '')));
    const share = homeShare !== undefined ? (n === 1 ? homeShare : 100 - homeShare) : undefined;
    return {
      id: c.id, name: c.name, short: c.short || c.name, abbr: c.abbr || initials(c.short || c.name), ...(c.logo ? { logo: relative(c.logo) } : {}),
      ...(hex(c.color) ? { color: hex(c.color) } : {}), ...(hex(c.altColor) ? { altColor: hex(c.altColor) } : {}),
      score, record: c.record ?? '', ...(c.entityId ? { entityId: c.entityId } : {}), favourite: isFav(c), possession: ball.id === c.id,
      winner: final && (c.winner === true || !lost && Number(score) > Number(other.score ?? '')), loser: lost,
      ...(share !== undefined ? { share, leads: n === 1 ? home! >= 0.5 : home! < 0.5 } : {}),
    };
  });
  const scored = !!sides && !spoiler && phase !== 'upcoming' && sides.every(s => s.score !== '');
  const shown = new Set([event.status.detail, event.status.clock].filter(Boolean).map(text => String(text).trim()));
  const situation = spoiler ? [] : Object.entries(event.situation ?? {}).filter(([label]) => label !== ball.key).filter(([, v]) => typeof v === 'string' && v.trim() !== '' && !shown.has(v.trim())).map(([label, v]) => ({ label, value: v }));
  const counts = new Map<number, number>();
  for (const row of event.ranking ?? []) counts.set(row.pos, (counts.get(row.pos) ?? 0) + 1);
  const venue = !event.venue ? '' : typeof event.venue === 'string' ? event.venue : [event.venue.name, event.venue.city].filter(Boolean).join(', ');
  return {
    id: event.id, feed: event.feed, category: event.category, phase, state: event.status.state, detail: event.status.detail,
    ...(event.status.clock ? { clock: event.status.clock } : {}), ...(event.status.period !== undefined ? { period: event.status.period } : {}),
    spoiler, close: !spoiler && event.status.close === true, scored, start: event.start,
    league: leagueOf(event.league), ...(event.title ? { title: event.title } : {}), ...(venue ? { venue } : {}),
    favourite: !!sides?.some(s => s.favourite),
    ...(sides ? { sides } : {}),
    situation,
    // The situation label that named the side with possession ("Possession", "Serving", "Batting").
    ...(ball.key ? { possessionLabel: ball.key.trim() } : {}),
    watch: watchOf(event),
    ...(p && sides && home !== undefined ? { probability: { home, away: Math.round((1 - home) * 1000) / 1000, subjectSide: subject,
      leader: { abbr: home >= 0.5 ? sides[1]!.abbr : sides[0]!.abbr, share: Math.round(Math.max(home, 1 - home) * 100) } } } : {}),
    ...(event.ranking && !spoiler ? { ranking: event.ranking.filter(row => row && typeof row.name === 'string').map(row => ({
      place: Number.isFinite(row.pos) ? `${(counts.get(row.pos) ?? 0) > 1 ? 'T' : ''}${row.pos}` : '', pos: row.pos, name: row.name, ...(row.abbr ? { abbr: row.abbr } : {}),
      detail: (row.detail ?? '').trim(), secondary: (row.secondary ?? '').trim(), ...(row.entityId ? { entityId: row.entityId } : {}),
      favourite: !!row.entityId && [...favourites].some(key => key.endsWith(`:${row.entityId}`)),
    })) } : {}),
  };
}

/** The `detail:` record: plays (oldest first, with at/score; and newest first), tables, the series and links. */
export function detailView(detail: V.LiveEventDetail, abbrs: ReadonlySet<string>): Json {
  // The two sides in reading order (away, home), for each timed play's `scores`.
  const [a, b] = detail.competitors;
  const pair = a && b && detail.competitors.length === 2 ? (a.home && !b.home ? [b, a] : [a, b]) : null;
  const plays = detail.plays.map(play => ({ ...(play.clock ? { clock: play.clock } : {}), ...(play.period !== undefined ? { period: play.period } : {}), text: play.text,
    emphasis: play.emphasis, ...(play.competitorId ? { competitorId: play.competitorId } : {}), ...(play.at ? { at: play.at } : {}), ...(play.score ? { score: play.score } : {}),
    ...(play.score && pair ? { scores: pair.map(side => play.score![side.id] ?? '') } : {}) }));
  // Oldest first on the wire, unless the periods already run backwards.
  const first = plays[0]?.period, last = plays.at(-1)?.period;
  const oldest = plays.length > 1 && first !== undefined && last !== undefined && first > last ? [...plays].reverse() : plays;
  return {
    id: detail.id, plays: oldest, playsNewest: [...oldest].reverse(),
    tables: detail.tables.map(table => tableView(table, row => row.some(cell => abbrs.has(cell)))),
    probabilitySeries: detail.probabilitySeries,
    links: detail.links.flatMap(link => { const value = linkOf(link.url); return value ? [{ label: link.label, url: value }] : []; }),
  };
}

export function tableView(table: V.LiveTable, highlight: (row: readonly string[]) => boolean) {
  return { title: table.title, columns: table.columns, rows: table.rows.map(cells => ({ cells, ...(highlight(cells) ? { highlight: true } : {}) })) };
}

/** Ether's `$link` envelope after rewriting: https only, no credentials. */
function linkOf(url: string): { href: string; host: string } | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? { href: parsed.href, host: parsed.host } : undefined;
  } catch { return undefined; }
}
/** Images as Ether serves them: same-origin paths under /vela/v0/. */
function relative(url: string): string {
  try { const parsed = new URL(url, 'http://x'); return parsed.pathname.startsWith('/vela/v0/') ? `${parsed.pathname}${parsed.search}` : ''; } catch { return ''; }
}

// Sources

interface Read { viewerId: string; tz: string; records: Record<string, V.RecordEntry>; scope: string; locale?: string; plugin?: Plugin }

const viewerScope = (viewerId: string, key: string) => `${viewerId}|${key}`;
function putRecord(read: Read, key: string, value: unknown): void {
  read.records[key] = { rev: revOf(viewerScope(read.viewerId, key), value), value };
}
function eventRef(read: Read, sim: SportsSim): { $record: string } {
  const key = recordKey(sim.id);
  if (!read.records[key]) putRecord(read, key, eventView(sportsModel.event(sim, read.viewerId), sportsModel.favourites(read.viewerId)));
  return ref(key);
}
function detailRef(read: Read, sim: SportsSim): { $record: string } {
  const key = detailKey(sim.id);
  if (!read.records[key]) {
    const favourites = sportsModel.favourites(read.viewerId);
    const abbrs = new Set(sportsModel.teams().filter(t => favourites.has(entityKey(t.id))).map(t => t.abbr));
    putRecord(read, key, detailView(sportsModel.detail(sim, read.viewerId), abbrs));
  }
  return ref(key);
}
function entityRef(read: Read, team: ReturnType<typeof sportsModel.teams>[number]): { $record: string } {
  const favKey = entityKey(team.id);
  const key = entityRecord(favKey);
  if (!read.records[key]) putRecord(read, key, { key: favKey, id: team.id, name: team.name, abbr: team.abbr, logo: relative(sportsModel.logo(team.id)), league: team.league,
    color: `#${team.color}`, favourite: sportsModel.favourites(read.viewerId).has(favKey) });
  return ref(key);
}

const list = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && !!v) : typeof value === 'string' && value ? value.split(',').filter(Boolean) : [];
const simId = (value: string) => value.startsWith('event:') ? value.slice('event:'.length) : value;

/** Ether's `featured` order: a favourite in progress, then in progress (earliest started first),
 * upcoming soonest first, finals most recent first. */
function featured(viewerId: string) {
  const rank = (sim: SportsSim) => sim.state === 'in' ? (sportsModel.isFavourite(sim, viewerId) ? 0 : 1) : sim.state === 'pre' || sim.state === 'delayed' ? 2 : 3;
  return (a: SportsSim, b: SportsSim) => rank(a) - rank(b) || (rank(a) === 3 ? b.start - a.start : a.start - b.start);
}

/** One source's value for the viewer, its records added to `read`. Throws a code for a source the mock cannot read. */
function resolveSource(spec: V.SourceSpec, args: Json, read: Read): unknown {
  const now = sportsNow();
  const today = localDay(now, read.tz);
  switch (spec.from) {
    case 'viewer': {
      const favourites = sportsModel.favourites(read.viewerId);
      return { spoilerFree: sportsModel.spoilerFree(read.viewerId), canSetSpoilerFree: true, locale: read.locale ?? 'en', favouriteCount: favourites.size };
    }
    case 'liveLeagues':
      return { leagues: sportsModel.leagues().map(({ category: _c, ...league }) => ({ ...leagueOf(league), ...(league.logo ? { logo: league.logo } : {}) })), selected: '' };
    case 'liveEvents': {
      const query = (args.query && typeof args.query === 'object' ? args.query : {}) as Json;
      const states = list(query.state), ids = list(query.ids).map(simId);
      const league = typeof query.league === 'string' ? query.league : '';
      const exclude = typeof args.exclude === 'string' ? simId(args.exclude) : '';
      let sims = sportsModel.sims().filter(sim => (!league || sim.league === league) && (!states.length || states.includes(sim.state)) && (!ids.length || ids.includes(sim.id)) && sim.id !== exclude
        && (!query.category || sportsModel.league(sim.league)?.category === query.category)
        && (query.favorites !== true || sportsModel.isFavourite(sim, read.viewerId)));
      if (query.window === 'today') sims = sims.filter(sim => sim.state === 'in' || localDay(sim.start, read.tz) === today);
      if (query.window === 'week') sims = sims.filter(sim => Math.abs(sim.start - now) < 7 * 24 * H);
      if (query.window === 'recent') sims = sims.filter(sim => sim.state === 'post' && now - sim.start < 48 * H);
      // The ticker: in progress, finals started under 30 h ago, upcoming within 6 h.
      if (query.window === 'ticker') sims = sims.filter(sim => sim.state === 'in' || (sim.state === 'post' && now - sim.start < 30 * H) || ((sim.state === 'pre' || sim.state === 'delayed') && sim.start - now < 6 * H));
      sims.sort(args.sort === 'start' ? (a, b) => a.start - b.start : featured(read.viewerId));
      const limit = Math.max(1, Math.min(100, Number(args.limit) || 100));
      return { events: sims.slice(0, limit).map(sim => eventRef(read, sim)) };
    }
    case 'liveSchedule': {
      const league = typeof args.league === 'string' ? args.league : '';
      const sims = sportsModel.sims().filter(sim => !league || sim.league === league);
      const days = [-2, -1, 0, 1, 2, 3, 4].map(n => addDays(today, n));
      const date = typeof args.date === 'string' && days.includes(args.date) ? args.date : typeof args.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.date) ? args.date : today;
      const index = days.indexOf(date);
      return {
        date, ...(index > 0 ? { previous: days[index - 1] } : index < 0 ? { previous: addDays(date, -1) } : {}),
        ...(index >= 0 && index < days.length - 1 ? { next: days[index + 1] } : index < 0 ? { next: addDays(date, 1) } : {}),
        days: days.map(day => ({ date: day, count: sims.filter(sim => localDay(sim.start, read.tz) === day).length })),
        events: sims.filter(sim => localDay(sim.start, read.tz) === date).sort((a, b) => a.start - b.start).map(sim => eventRef(read, sim)),
      };
    }
    case 'liveEvent': {
      const id = typeof args.id === 'string' ? simId(args.id) : '';
      const sim = id ? sportsModel.sim(id) : undefined;
      if (!sim) throw new SourceFailure('not_found');
      return { event: eventRef(read, sim), detail: detailRef(read, sim) };
    }
    case 'liveTables': {
      const asked = typeof args.league === 'string' ? args.league : '';
      const league = asked && sportsModel.standings(asked) ? asked : 'nfl';
      const favourites = sportsModel.favourites(read.viewerId);
      // The mock's standings name teams by their short name: a favourite's row is lit by it.
      const names = new Set(sportsModel.teams().filter(t => favourites.has(entityKey(t.id))).map(t => t.short));
      const info = sportsModel.league(league)!;
      return { league: { id: info.id, name: info.name, label: leagueLabel(info) }, tables: (sportsModel.standings(league) ?? []).map(table => tableView(table, row => row.some(cell => names.has(cell)))) };
    }
    case 'liveEntities': {
      const favourites = sportsModel.favourites(read.viewerId);
      const leagues = sportsModel.leagues().map(({ category: _c, ...league }) => leagueOf(league));
      const teams = sportsModel.teams();
      const followed = (t: (typeof teams)[number]) => favourites.has(entityKey(t.id));
      const known = (id: unknown) => typeof id === 'string' && !!id && leagues.some(l => l.id === id) ? id : '';
      const opening = known(args.league) || known(args.prefer) || teams.find(followed)?.league || leagues.find(l => teams.some(t => t.league === l.id))?.id || leagues[0]?.id || '';
      const q = typeof args.q === 'string' ? args.q.toLowerCase() : '';
      const entities = teams.filter(t => t.league === opening && (!q || `${t.name} ${t.abbr}`.toLowerCase().includes(q)))
        .sort((a, b) => Number(followed(b)) - Number(followed(a)) || a.name.localeCompare(b.name));
      return { entities: entities.map(t => entityRef(read, t)), leagues, opening };
    }
    case 'watch': {
      const sim = typeof args.event === 'string' ? sportsModel.sim(simId(args.event)) : undefined;
      if (!sim) throw new SourceFailure('not_found');
      return watchOf(sportsModel.event(sim, read.viewerId));
    }
    case 'plugin': {
      const plugin = read.plugin;
      const route = typeof args.route === 'string' ? plugin?.routes[args.route] : undefined;
      if (!plugin || !route) throw new SourceFailure('not_found');
      const routeArgs = Object.fromEntries(Object.entries((args.args && typeof args.args === 'object' ? args.args : {}) as Json).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
      const answer = route(routeArgs, read);
      return rewritePlugin(answer.value, answer.records ?? [], plugin, read);
    }
    default:
      // items, liveItems and channels are not in Ether E1/E2.
      throw new SourceFailure('unsupported');
  }
}

class SourceFailure extends Error { constructor(readonly code: string) { super(code); } }

/** A source's arguments with {param.x} and {context.x} filled (a missing one reads ''). */
function fill(value: unknown, values: Record<string, string>): unknown {
  if (typeof value === 'string') {
    const whole = /^\{((?:param|context)\.[A-Za-z0-9_.-]+)\}$/.exec(value);
    if (whole) return values[whole[1]!] ?? '';
    return value.replace(/\{((?:param|context)\.[A-Za-z0-9_.-]+)\}/g, (_, name: string) => values[name] ?? '');
  }
  if (Array.isArray(value)) return value.map(item => fill(item, values));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, values)]));
  return value;
}

// Plugins: the screens' owners, their feeds and image hosts, and (for the news-desk example) the
// plugin's own source routes and actions, answering raw plugin answers that Ether rewrites.

interface PluginAnswer { value: unknown; records?: { type: string; id: string; value: unknown }[]; nextRefreshSec?: number }
interface PluginActionAnswer { records?: { type: string; id: string; value: unknown }[]; sources?: Record<string, unknown>; refresh?: string[]; toast?: string; navigate?: unknown }
interface ArgSpec { type: 'string' | 'int' | 'bool' | 'date' | 'ref' | 'strings'; max?: number; enum?: string[] }
interface Plugin {
  pluginID: string; version: string; feeds: string[]; hosts: string[];
  routes: Record<string, (args: Record<string, string>, read: Read) => PluginAnswer>;
  actions: Record<string, { args: Record<string, ArgSpec>; run(args: Record<string, unknown>, viewerId: string): PluginActionAnswer }>;
}

const following = new Map<string, Set<string>>();
const followsOf = (viewerId: string) => { let set = following.get(viewerId); if (!set) following.set(viewerId, set = new Set()); return set; };
const TOPICS = [{ id: 'top', name: 'Top stories' }, { id: 'local', name: 'Local' }, { id: 'tech', name: 'Tech' }];
const STORIES: Record<string, { id: string; title: string; section: string }[]> = {
  top: [{ id: 'harbour', title: 'Harbour bridge reopens after a year of repairs', section: 'City' }, { id: 'budget', title: 'Budget vote set for Thursday', section: 'Politics' },
    { id: 'storm', title: 'Early storm brings the first snow of the season', section: 'Weather' }, { id: 'library', title: 'Central library extends its hours', section: 'Culture' }],
  local: [{ id: 'market', title: 'Night market returns to the waterfront', section: 'Community' }, { id: 'transit', title: 'New bus lanes open on King Street', section: 'Transit' }],
  tech: [{ id: 'chips', title: 'A smaller, cooler chip for home servers', section: 'Hardware' }, { id: 'open', title: 'An open format for screen documents', section: 'Software' }],
};

const PLUGINS: Record<string, Plugin> = {
  sports: { pluginID: 'sports', version: '2.0.0', feeds: ['sports'], hosts: [], routes: {}, actions: {} },
  music: {
    pluginID: 'org.example.music', version: '1.0.0', feeds: [], hosts: [], actions: {},
    routes: {
      // A liner note for an album (the slot's title context, `item:<id>`), as a p:note record.
      albumNote: args => {
        const id = (args.title ?? '').replace(/^item:/, '');
        const album = mediaTitle(id);
        if (!album || album.media?.role !== 'album') return { value: { note: null } };
        const tracks = mediaChildren(id, 'track').length;
        return {
          value: { note: { $record: { type: 'note', id } } },
          records: [{ type: 'note', id, value: { text: `${album.name}: ${tracks} tracks, recorded live to tape over one long weekend.` } }],
        };
      },
    },
  },
  news: {
    pluginID: 'org.example.news', version: '1.0.0', feeds: [], hosts: ['images.news.example'],
    routes: {
      front: args => {
        const topic = TOPICS.some(t => t.id === args.topic) ? args.topic! : 'top';
        const stories = STORIES[topic]!;
        return {
          value: {
            breaking: topic === 'top' ? { title: 'Power restored across the east end' } : null,
            topics: TOPICS, topicName: TOPICS.find(t => t.id === topic)!.name,
            lead: [{ $record: { type: 'story', id: stories[0]!.id } }],
            stories: stories.slice(1).map(story => ({ $record: { type: 'story', id: story.id } })),
            source: { $link: 'https://news.example/front' },
          },
          records: stories.map((story, n) => ({ type: 'story', id: story.id, value: {
            title: story.title, section: story.section, published: new Date(sportsNow() - (n + 1) * 47 * 60_000).toISOString(),
            image: { $image: `https://images.news.example/${story.id}.jpg` }, link: { $link: `https://news.example/story/${story.id}` },
          } })),
          nextRefreshSec: 60,
        };
      },
      following: (_args, read) => ({ value: { followsTopic: false, topics: [...followsOf(read.viewerId)].sort() } }),
    },
    actions: {
      'follow-topic': {
        args: { topic: { type: 'string', max: 64, enum: TOPICS.map(t => t.id) }, on: { type: 'bool' } },
        run(args, viewerId) {
          const topic = args.topic as string;
          if (args.on) followsOf(viewerId).add(topic); else followsOf(viewerId).delete(topic);
          const name = TOPICS.find(t => t.id === topic)!.name;
          return { refresh: ['mine'], toast: args.on ? `Following ${name}` : `Stopped following ${name}` };
        },
      },
    },
  },
};
const pluginOf = (target: Target): Plugin | undefined => PLUGINS[target.kind === 'screen' ? target.screen : target.surface.split('.')[0]!];

const BARE_URL = /^\s*((https?:)?\/\/|data:|javascript:)\S*\s*$/i;
const RECORD_TYPE = /^[a-z][a-z0-9-]{0,31}$/;
const RECORD_ID = /^[A-Za-z0-9._~:-]{1,128}$/;

/**
 * A plugin's answer as Ether rewrites it for the viewer: `$image` becomes a same-origin image
 * (only on the plugin's own hosts; `asset:` paths become screen-assets URLs), `$link` an https
 * {href, host}, `$record` a `p:<type>:<id>` reference to a record the answer carries, `$event` and
 * `$entity` references to resolved records of the plugin's own feeds. Bare URLs, unknown envelopes
 * and `$` keys are dropped; a dropped envelope closes its gap in a list (a field becomes null).
 * `$item` and `$channel` are dropped (not in E1/E2).
 */
export function rewritePlugin(value: unknown, records: { type: string; id: string; value: unknown }[], plugin: Plugin, read: Read): unknown {
  if (records.length > 500) throw new SourceFailure('too_large');
  const known = new Set(records.filter(r => RECORD_TYPE.test(r.type) && RECORD_ID.test(r.id)).map(r => `p:${r.type}:${r.id}`));
  const isEnvelope = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && Object.keys(v)[0]!.startsWith('$');
  const envelope = (kind: string, inner: unknown): unknown => {
    const m = (inner && typeof inner === 'object' ? inner : {}) as Record<string, unknown>;
    switch (kind) {
      case '$image': {
        const src = typeof inner === 'string' ? inner : '';
        if (src.startsWith('asset:')) {
          const path = src.slice(6).replace(/^\//, '');
          return path && !path.includes('..') ? `/vela/v0/screen-assets/${encodeURIComponent(plugin.pluginID)}/${encodeURIComponent(plugin.version)}/${path}` : null;
        }
        try {
          const url = new URL(src);
          if (!/^https?:$/.test(url.protocol) || url.username || url.password || src.length > 2048 || !plugin.hosts.includes(url.hostname)) return null;
          // The mock's "signed grant": a synthetic picture named by the URL.
          return `/vela/v0/artwork/${createHash('sha1').update(src).digest('hex').slice(0, 12)}?kind=backdrop&width=640`;
        } catch { return null; }
      }
      case '$link': {
        const text = typeof inner === 'string' ? inner.trim() : '';
        try {
          const url = new URL(text);
          return url.protocol === 'https:' && url.host && !url.username && !url.password && text.length <= 2048 ? { href: url.href, host: url.hostname } : null;
        } catch { return null; }
      }
      case '$record': {
        const key = `p:${m.type}:${m.id}`;
        return known.has(key) ? { $record: key } : null;
      }
      case '$event': {
        const feed = typeof m.feed === 'string' ? m.feed : '', id = typeof m.id === 'string' ? m.id : '';
        const sim = plugin.feeds.includes(feed) && RECORD_ID.test(id) ? sportsModel.sim(`${plugin.pluginID}:${feed}:${id}`) : undefined;
        return sim ? eventRef(read, sim) : null;
      }
      case '$entity': {
        const feed = typeof m.feed === 'string' ? m.feed : '', id = typeof m.id === 'string' ? m.id : '';
        const team = plugin.feeds.includes(feed) && m.kind === 'team' ? sportsModel.teams().find(t => t.id === id) : undefined;
        return team ? entityRef(read, team) : null;
      }
      default:
        return null;
    }
  };
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.flatMap(child => { const w = walk(child); return w === null && isEnvelope(child) ? [] : [w]; });
    if (v && typeof v === 'object') {
      const entries = Object.entries(v as Record<string, unknown>);
      if (entries.length === 1 && entries[0]![0].startsWith('$')) return envelope(entries[0]![0], entries[0]![1]);
      return Object.fromEntries(entries.filter(([k]) => !k.startsWith('$')).map(([k, child]) => [k, walk(child)]));
    }
    if (typeof v === 'string') return BARE_URL.test(v) || v.length > 4096 ? null : v;
    return v;
  };
  const out = walk(value);
  for (const record of records) {
    const key = `p:${record.type}:${record.id}`;
    if (known.has(key)) putRecord(read, key, walk(record.value));
  }
  return out;
}

/** Ether's check of a declared plugin action argument: raw JSON of the declared type, or text
 * coerced to it ("true"/"false"/"1"/"0" a bool, "12" an int, "a,b" a list of texts). */
export function checkArg(spec: ArgSpec, value: unknown): unknown {
  switch (spec.type) {
    case 'bool':
      if (typeof value === 'boolean') return value;
      if (value === 'true' || value === '1') return true;
      if (value === 'false' || value === '0') return false;
      throw new Error('must be true or false');
    case 'int': {
      const n = typeof value === 'number' ? value : typeof value === 'string' && /^\s*-?\d+\s*$/.test(value) ? Number(value) : NaN;
      if (!Number.isInteger(n)) throw new Error('must be a whole number');
      return n;
    }
    case 'strings': {
      const list = typeof value === 'string' ? (value === '' ? [] : value.split(',')) : value;
      if (!Array.isArray(list) || list.length > 50 || list.some(v => typeof v !== 'string' || v.length > (spec.max ?? 512))) throw new Error('must be a list of at most 50 texts');
      return list;
    }
    default:
      if (typeof value !== 'string') throw new Error('must be text');
      if (spec.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('must be a date');
      if (spec.type === 'ref' && !REF.test(value)) throw new Error('must be a record key');
      if (value.length > (spec.max ?? 512) || (spec.enum && !spec.enum.includes(value))) throw new Error('is not allowed');
      return value;
  }
}

/** Ether's navigate check: {action: navigate, args: short text values, route from the fixed list}. */
function validNavigate(value: unknown): V.NavigateAction | undefined {
  const n = value as { action?: unknown; args?: unknown } | undefined;
  if (!n || n.action !== 'navigate') return undefined;
  const args = (n.args && typeof n.args === 'object' ? n.args : {}) as Record<string, unknown>;
  if (Object.keys(args).length > 12) return undefined;
  for (const [k, v] of Object.entries(args)) {
    if (typeof v !== 'string' || k.length > 32 || v.length > 256 || BARE_URL.test(v)) return undefined;
    if (k === 'route' && !['title', 'live', 'guide', 'search', 'home', 'library'].includes(v)) return undefined;
  }
  return { action: 'navigate', args: args as V.NavigateAction['args'] };
}

const forcedTimeouts = new Map<string, number>();

// Pages (screens and surfaces) as one shape

interface Owner { kind: 'screen'; screen: string; page: string; doc: Compiled }
interface SurfaceOwner { kind: 'surface'; surface: string; doc: Compiled }
type Target = Owner | SurfaceOwner;

/** What a sealed topic binds: viewer, page or surface, canonical params and context, time zone, live sources. */
interface Topic { v: string; t: { kind: 'screen'; screen: string; page: string } | { kind: 'surface'; surface: string }; p: Record<string, string>; tz: string; s: string[]; l?: string; d?: 1 }

function targetOf(t: Topic['t'], draft = false): Target | undefined {
  if (t.kind === 'screen') {
    const page = PAGES.find(p => p.screen === t.screen && p.page === t.page);
    const doc = page && load(page.file, draft);
    return doc ? { kind: 'screen', screen: t.screen, page: t.page, doc } : undefined;
  }
  const spec = SURFACES.find(s => s.id === t.surface);
  const doc = spec && load(spec.file, draft);
  return doc ? { kind: 'surface', surface: t.surface, doc } : undefined;
}
const sealTopic = (topic: Topic) => `lt1.${Buffer.from(JSON.stringify(topic)).toString('base64url')}`;
function openTopic(token: string): Topic | undefined {
  if (!token.startsWith('lt1.')) return undefined;
  try { const topic = JSON.parse(Buffer.from(token.slice(4), 'base64url').toString()) as Topic; return topic?.t && topic.p && Array.isArray(topic.s) ? topic : undefined; } catch { return undefined; }
}

const CONTEXT = ['event', 'channel', 'title', 'kind', 'alert.ref'];
/** A `ref` is a record key Ether issued (a bare id is refused). */
export const REF = /^(event|entity|item|channel|p):\S{1,256}$/;
/** The record kind each surface context ref must name. */
const CONTEXT_REF: Record<string, RegExp> = { event: /^event:\S+$/, 'alert.ref': /^event:\S+$/, channel: /^channel:\S+$/, title: /^item:\S+$/ };

/** Validated page params (declared, typed, defaults applied) and the surface's context, as
 * `param.x` / `context.x`. An unknown name or a bad value is 400 invalid_request. A ref naming an
 * event the viewer cannot read is not refused here: its source answers errors.<id> = not_found. */
function inputs(target: Target, given: Iterable<[string, string]>, fail: Fail): Record<string, string> {
  const declared = target.doc.document.params ?? {};
  const values: Record<string, string> = {};
  for (const [key, value] of given) {
    if (typeof value !== 'string') fail('request', 'invalid_request', `Invalid value for ${key}`);
    if (target.kind === 'surface' && CONTEXT.includes(key)) {
      if (value && CONTEXT_REF[key] && !CONTEXT_REF[key]!.test(value)) fail('request', 'invalid_request', `${key} must be a record key`);
      values[`context.${key}`] = value;
      continue;
    }
    const spec = declared[key];
    if (!spec) fail('request', 'invalid_request', `Unknown param ${key}`);
    if (value === '') continue;
    const bad = (spec.max !== undefined && value.length > spec.max) || value.length > 512
      || (spec.enum && !spec.enum.includes(value)) || (spec.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value))
      || (spec.type === 'int' && !/^-?\d+$/.test(value)) || (spec.type === 'bool' && value !== 'true' && value !== 'false')
      || (spec.type === 'ref' && !REF.test(value));
    if (bad) fail('request', 'invalid_request', `Invalid value for ${key}`);
    values[`param.${key}`] = value;
  }
  for (const [name, spec] of Object.entries(declared)) if (values[`param.${name}`] === undefined && spec.default) values[`param.${name}`] = spec.default;
  return values;
}

/** Resolve the asked sources (every one that is not lazy when none is named) into a data answer. */
function resolve(target: Target, values: Record<string, string>, viewerId: string, tz: string, asked: string[] | undefined, locale = 'en'): V.ScreenData & { names: string[] } {
  const specs = target.doc.document.sources ?? {};
  const names = asked ?? Object.entries(specs).filter(([, spec]) => !spec.lazy).map(([name]) => name);
  const pageScope = target.kind === 'screen' ? `screen:${target.screen}/${target.page}` : `surface:${target.surface}`;
  const canonical = Object.entries(values).sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => `${k}=${v}`).join('&');
  const read: Read = { viewerId, tz, records: {}, scope: `${pageScope}?${canonical}|${tz}|${locale}`, locale, plugin: pluginOf(target) };
  const sources: Record<string, unknown> = {};
  const errors: Record<string, V.SourceError> = {};
  let rev = 0;
  for (const name of names) {
    const spec = specs[name];
    if (!spec) continue;
    // Vela's own sources are the client's: no value and no error here.
    if (typeof spec.from === 'string' && spec.from.startsWith('vela.')) continue;
    try {
      const forced = forcedTimeouts.get(name) ?? 0;
      if (forced > 0) { forcedTimeouts.set(name, forced - 1); throw new SourceFailure('timeout'); }
      const value = resolveSource(spec, fill(spec, values) as Json, read);
      sources[name] = value;
      rev = Math.max(rev, revOf(viewerScope(viewerId, `${read.scope}|${name}`), value));
    } catch (error) {
      errors[name] = error instanceof SourceFailure ? { code: error.code, ...(error.code === 'timeout' ? { retry: true } : {}) } : { code: 'unavailable', retry: true };
    }
  }
  for (const entry of Object.values(read.records)) rev = Math.max(rev, entry.rev);
  return { rev, sources, records: read.records, ...(Object.keys(errors).length ? { errors } : {}), names };
}

function sourceRev(target: Target, values: Record<string, string>, viewerId: string, tz: string, name: string, locale = 'en'): number {
  const pageScope = target.kind === 'screen' ? `screen:${target.screen}/${target.page}` : `surface:${target.surface}`;
  const canonical = Object.entries(values).sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => `${k}=${v}`).join('&');
  return revs.get(viewerScope(viewerId, `${pageScope}?${canonical}|${tz}|${locale}|${name}`))?.rev ?? 0;
}

async function serveData(req: Request, url: URL, target: Target, viewerId: string, fail: Fail): Promise<Response> {
  if (target.doc.document.renderer > rendererOf(req)) fail('not-found', 'update_required', 'No variant of this page fits this client');
  await sportsGate(fail);
  for (const name of url.searchParams.keys()) if (name !== 'sources' && name !== 'tz' && !name.startsWith('p.')) fail('request', 'invalid_request', `Unknown query ${name}`);
  const tz = zone(url.searchParams.get('tz'));
  const values = inputs(target, [...url.searchParams].filter(([name]) => name.startsWith('p.')).map(([name, value]) => [name.slice(2), value] as [string, string]), fail);
  const specs = target.doc.document.sources ?? {};
  const asked = url.searchParams.has('sources') ? (url.searchParams.get('sources') ?? '').split(',').filter(Boolean) : undefined;
  if (asked && asked.length > 16) fail('request', 'invalid_request', 'At most 16 sources');
  for (const name of asked ?? []) if (!specs[name]) fail('request', 'invalid_request', `Unknown source ${name}`);
  const locale = languageOf(req);
  const { names, ...data } = resolve(target, values, viewerId, tz, asked, locale);
  // The topic covers what the page shows: its eager sources and any lazy one read now.
  const live = [...new Set([...Object.entries(specs).filter(([, spec]) => !spec.lazy).map(([name]) => name), ...names])].sort();
  const t = target.kind === 'screen' ? { kind: 'screen' as const, screen: target.screen, page: target.page } : { kind: 'surface' as const, surface: target.surface };
  const answer: V.ScreenData = { ...data, live: { topic: sealTopic({ v: viewerId, t, p: values, tz, s: live, l: locale, ...(target.doc.draft ? { d: 1 as const } : {}) }) } };
  const body = JSON.stringify(answer);
  const etag = `"${createHash('sha1').update(body).digest('base64url')}"`;
  const headers = { ETag: etag, 'Cache-Control': 'private, no-cache', 'Content-Type': 'application/json' };
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(body, { headers });
}

// Actions

const ACTION_FIELDS = new Set(['page', 'params', 'args', 'context', 'idempotencyKey', 'tz']);
const truthy = (value: unknown) => value === true || value === 'true';

function serveAction(req: Request, target: Target, action: string, body: unknown, viewerId: string, fail: Fail): Response {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(name => !ACTION_FIELDS.has(name))) fail('request', 'invalid_request', 'Only page, params, args, context, tz and idempotencyKey');
  const request = body as { page?: unknown; params?: unknown; args?: unknown; context?: unknown; tz?: unknown };
  if (!req.headers.get('idempotency-key') && !(body as { idempotencyKey?: unknown }).idempotencyKey) fail('request', 'idempotency_required', 'Idempotency-Key required');
  const args = (request.args && typeof request.args === 'object' ? request.args : {}) as Json;
  if (Object.keys(args).length > 8 || JSON.stringify(args).length > 8192) fail('request', 'invalid_args', 'Too many or too large arguments');
  const object = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, string>;
  const values = inputs(target, [...Object.entries(object(request.params)), ...Object.entries(object(request.context))], fail);
  const tz = zone(typeof request.tz === 'string' ? request.tz : null);
  const read: Read = { viewerId, tz, records: {}, scope: '' };
  const answer: V.ScreenActionAnswer = {};
  if (action === 'ether.favorite') {
    // Ether: ref must be an entity: record key; reveal takes the event with or without event:.
    const key = typeof args.ref === 'string' && args.ref.startsWith('entity:') ? args.ref.slice('entity:'.length) : '';
    if (!key) fail('request', 'invalid_request', 'ref must be an entity: record key');
    const team = sportsModel.teams().find(t => entityKey(t.id) === key);
    if (!team) fail('not-found', 'entity_not_found', 'Entity not found');
    const favourites = sportsModel.favourites(viewerId);
    if (truthy(args.on)) favourites.add(key); else favourites.delete(key);
    entityRef(read, team);
    for (const sim of sportsModel.sims()) if (sim.home === team.id || sim.away === team.id) eventRef(read, sim);
  } else if (action === 'ether.reveal') {
    const sim = typeof args.event === 'string' ? sportsModel.sim(simId(args.event)) : undefined;
    if (!sim) fail('not-found', 'event_not_found', 'Live event not found');
    sportsModel.reveal(viewerId, sim.id);
    eventRef(read, sim);
    detailRef(read, sim);
  } else if (action === 'ether.spoilerFree') {
    sportsModel.setSpoilerFree(viewerId, truthy(args.on));
    for (const sim of sportsModel.sims()) eventRef(read, sim);
  } else {
    return pluginAction(target, action, args, values, viewerId, tz, read, fail);
  }
  // Built-in answers: the changed records, and every source of the page re-read (lazy ones too).
  const all = Object.keys(target.doc.document.sources ?? {});
  const data = resolve(target, values, viewerId, tz, all, languageOf(req));
  answer.records = { ...data.records, ...read.records };
  answer.sources = data.sources;
  pump(viewerId);
  return Response.json(answer, { headers: { 'Cache-Control': 'no-store' } });
}

/** A plugin-declared action: arguments checked by their declared types, the plugin's answer
 * rewritten like a source answer, its `refresh` sources read again into `sources`, toast and
 * navigate validated. Undeclared actions are 404. */
function pluginAction(target: Target, action: string, args: Json, values: Record<string, string>, viewerId: string, tz: string, read: Read, fail: Fail): Response {
  const plugin = pluginOf(target);
  const spec = plugin?.actions[action];
  if (!plugin || !spec || !target.doc.document.actions?.[action]) fail('not-found', 'action_not_found', 'Action not found');
  const checked: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(args)) {
    const argSpec = spec.args[name];
    if (!argSpec) fail('request', 'invalid_request', `Unknown argument ${name}`);
    try { checked[name] = checkArg(argSpec, value); } catch (error) { fail('request', 'invalid_request', `${name} ${(error as Error).message}`); }
  }
  const raw = spec.run(checked, viewerId);
  read.plugin = plugin;
  rewritePlugin(null, raw.records ?? [], plugin, read);
  const sources: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(raw.sources ?? {})) if (target.doc.document.sources[id]) sources[id] = rewritePlugin(value, [], plugin, read);
  const refresh = (raw.refresh ?? []).filter(id => target.doc.document.sources[id]).slice(0, 16);
  const records = { ...read.records };
  if (refresh.length) {
    const data = resolve(target, values, viewerId, tz, refresh, read.locale);
    Object.assign(sources, data.sources);
    Object.assign(records, data.records);
  }
  const toast = typeof raw.toast === 'string' ? raw.toast.trim() : '';
  const navigate = validNavigate(raw.navigate);
  pump(viewerId);
  return Response.json({ ...(Object.keys(records).length ? { records } : {}), ...(Object.keys(sources).length ? { sources } : {}),
    ...(toast && !BARE_URL.test(toast) ? { toast: [...toast].slice(0, 200).join('') } : {}), ...(navigate ? { navigate } : {}) } satisfies V.ScreenActionAnswer, { headers: { 'Cache-Control': 'no-store' } });
}

// The stream: page topics

interface Listener { viewerId: string; topics: { token: string; topic: Topic; target: Target }[]; alerts: boolean; sent: Map<string, number>; send(name: string, data: unknown): void; close(): void }
const listeners = new Set<Listener>();

/** Send what changed for a listener's topics: records and sources whose rev is newer than what it has. */
function push(listener: Listener): void {
  const records: Record<string, V.RecordEntry> = {};
  const sources: V.StreamSource[] = [];
  for (const { topic, target } of listener.topics) {
    const data = resolve(target, topic.p, listener.viewerId, topic.tz, topic.s, topic.l);
    for (const [key, entry] of Object.entries(data.records)) if (entry.rev > (listener.sent.get(key) ?? 0)) { records[key] = entry; listener.sent.set(key, entry.rev); }
    for (const [name, value] of Object.entries(data.sources)) {
      const rev = sourceRev(target, topic.p, listener.viewerId, topic.tz, name, topic.l);
      const id = `${topic.t.kind === 'screen' ? `${topic.t.screen}/${topic.t.page}` : topic.t.surface}|${JSON.stringify(topic.p)}|${name}`;
      if (rev <= (listener.sent.get(id) ?? 0)) continue;
      listener.sent.set(id, rev);
      sources.push(topic.t.kind === 'screen' ? { screen: topic.t.screen, page: topic.t.page, source: name, rev, value } : { surface: topic.t.surface, source: name, rev, value });
    }
  }
  if (Object.keys(records).length) listener.send('records', { records } satisfies V.StreamRecords);
  for (const frame of sources) listener.send('source', frame);
}

/** A viewer's state changed (a favourite, a reveal): their open streams hear it now, not at the next tick. */
function pump(viewerId: string): void {
  for (const listener of listeners) if (listener.viewerId === viewerId) push(listener);
}

let alertCount = 0;
let hooked = false;
function hook(): void {
  if (hooked) return;
  hooked = true;
  sportsModel.onChange(() => { for (const listener of listeners) push(listener); });
  sportsModel.onAlert((kind, sim, force) => {
    const toast = SURFACES.find(spec => spec.contribution.presentation === 'toast' && load(spec.file));
    for (const listener of listeners) {
      if (!listener.alerts) continue;
      const favourite = [sim.home, sim.away].some(id => sportsModel.favourites(listener.viewerId).has(entityKey(id)));
      if (!favourite && !force) continue;
      if (sportsModel.spoilered(sim, listener.viewerId) && kind !== 'started') continue;
      const { title, body } = sportsModel.alertText(kind, sim);
      listener.send('alert', { id: `screen-alert-${++alertCount}`, kind, title, body, at: new Date(sportsNow()).toISOString(), ref: recordKey(sim.id), plugin: sportsModel.plugin,
        ...(toast ? { surface: toast.id } : {}) } satisfies V.AlertFrame);
    }
  });
}


function stream(req: Request, url: URL, viewerId: string, authorized: () => boolean, fail: Fail): Response {
  hook();
  const draft = previewOf(req, fail);
  // As Ether: topic, since and alerts only (each topic seals its time zone); anything else is 400.
  for (const name of url.searchParams.keys()) if (name !== 'topic' && name !== 'since' && name !== 'alerts') fail('request', 'invalid_request', `Unknown query ${name}`);
  const tokens = url.searchParams.getAll('topic');
  if (tokens.length > 4) fail('request', 'too_many_topics', 'At most 4 topics');
  const topics = tokens.map(token => {
    const topic = openTopic(token);
    const target = topic && topic.v === viewerId ? targetOf(topic.t, draft && topic.d === 1) : undefined;
    if (!topic || !target) fail('request', 'invalid_topic', 'Unknown or expired topic');
    return { token, topic, target };
  });
  const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const encoder = new TextEncoder();
  const listener: Listener = {
    viewerId, topics, alerts: url.searchParams.get('alerts') === '1', sent: new Map(),
    send(name, data) { try { controller?.enqueue(encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { listener.close(); } },
    close() { if (heartbeat) clearInterval(heartbeat); listeners.delete(listener); try { controller?.close(); } catch {} },
  };
  const body = new ReadableStream<Uint8Array>({ start(c) {
    controller = c;
    listeners.add(listener);
    // Replay: everything of these topics above since (what changed between the data read and now).
    const seed = new Map<string, number>();
    for (const { topic, target } of topics) {
      const data = resolve(target, topic.p, viewerId, topic.tz, topic.s, topic.l);
      for (const key of Object.keys(data.records)) seed.set(key, since);
      for (const name of Object.keys(data.sources)) seed.set(`${topic.t.kind === 'screen' ? `${topic.t.screen}/${topic.t.page}` : topic.t.surface}|${JSON.stringify(topic.p)}|${name}`, since);
    }
    listener.sent = seed;
    // A comment first, so the response starts even when nothing is replayed.
    c.enqueue(encoder.encode(': open\n\n'));
    push(listener);
    heartbeat = setInterval(() => { if (!authorized()) listener.close(); else listener.send('heartbeat', {}); }, 25_000);
    req.signal.addEventListener('abort', () => listener.close(), { once: true });
  }, cancel: () => listener.close() });
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
}

// Routes

/** The plugin-screen routes under /vela/v0; undefined for any other path. */
export async function screensApi(req: Request, url: URL, method: string, path: string, viewerId: string, authorized: () => boolean, fail: Fail, body?: unknown): Promise<Response | undefined> {
  if (!sportsEnabled) return undefined;
  if (method === 'GET' && path === '/live/stream') return stream(req, url, viewerId, authorized, fail);
  const preview = /^\/(screens|surfaces)\//.test(path) ? previewOf(req, fail) : false;
  const screen = /^\/screens\/([^/]+)\/(?:pages\/([^/]+)\/(document|data)|actions\/([^/]+))$/.exec(path);
  if (screen) {
    const id = decodeURIComponent(screen[1]!);
    if (hidden.has(id)) fail('not-found', 'screen_not_found', 'Screen not found');
    if (screen[4]) {
      if (method !== 'POST') fail('request', 'method_not_allowed', 'POST only', {}, 405);
      const pageName = typeof (body as { page?: unknown })?.page === 'string' ? (body as { page: string }).page : 'index';
      const page = PAGES.find(p => p.screen === id && p.page === pageName);
      const doc = page && load(page.file, preview);
      if (!page || !doc) fail('not-found', 'screen_not_found', 'Screen not found');
      return serveAction(req, { kind: 'screen', screen: id, page: pageName, doc }, decodeURIComponent(screen[4]), body, viewerId, fail);
    }
    const pageName = decodeURIComponent(screen[2]!);
    const page = PAGES.find(p => p.screen === id && p.page === pageName);
    const doc = page && load(page.file, preview);
    if (!page || !doc || method !== 'GET') fail('not-found', 'screen_not_found', 'Screen not found');
    if (screen[3] === 'document') return serveDocument(req, url, doc, fail);
    return serveData(req, url, { kind: 'screen', screen: id, page: pageName, doc }, viewerId, fail);
  }
  const surface = /^\/surfaces\/([^/]+)\/(document|data|setting|actions\/([^/]+))$/.exec(path);
  if (surface) {
    const id = decodeURIComponent(surface[1]!);
    const spec = SURFACES.find(s => s.id === id);
    const doc = spec && load(spec.file, preview);
    if (!spec || !doc || hidden.has(id)) fail('not-found', 'surface_not_found', 'Surface not found');
    const target: SurfaceOwner = { kind: 'surface', surface: id, doc };
    if (surface[2] === 'document' && method === 'GET') return serveDocument(req, url, doc, fail);
    if (surface[2] === 'data' && method === 'GET') return serveData(req, url, target, viewerId, fail);
    if (surface[2] === 'setting' && method === 'PUT') {
      const enabled = (body as { enabled?: unknown } | undefined)?.enabled;
      if (typeof enabled !== 'boolean' || !spec.contribution.setting) fail('request', 'invalid_setting', 'enabled must be true or false');
      let settings = surfaceSettings.get(viewerId);
      if (!settings) surfaceSettings.set(viewerId, settings = new Map());
      settings.set(id, enabled);
      return new Response(null, { status: 204 });
    }
    if (surface[3] && method === 'POST') return serveAction(req, target, decodeURIComponent(surface[3]), body, viewerId, fail);
    fail('not-found', 'surface_not_found', 'Surface not found');
  }
  return undefined;
}

/** Admin (POST /__admin/screens {hide?: id[], show?: id[], timeout?: {source, times}}): the owner
 * hides a screen or surface from viewers (it leaves bootstrap, its reads answer 404, and every
 * stream following one of its topics ends, as Ether ends a stream when a topic's page is no longer
 * visible); or a source times out for its next reads (the client's automatic re-read). */
export function screensAdmin(body: { hide?: unknown; show?: unknown; timeout?: { source?: unknown; times?: unknown } }): { hidden: string[] } {
  // The next `times` reads of a source (by id, on any page) answer errors.<id> = {code: timeout, retry: true}.
  if (body.timeout && typeof body.timeout.source === 'string') forcedTimeouts.set(body.timeout.source, Math.max(0, Math.min(10, Number(body.timeout.times) || 1)));
  for (const id of Array.isArray(body.show) ? body.show : []) if (typeof id === 'string') hidden.delete(id);
  for (const id of Array.isArray(body.hide) ? body.hide : []) if (typeof id === 'string') hidden.add(id);
  for (const listener of [...listeners]) {
    if (listener.topics.some(({ topic }) => hidden.has(topic.t.kind === 'screen' ? topic.t.screen : topic.t.surface))) listener.close();
  }
  return { hidden: [...hidden] };
}

/** For tests: the topic a data read sealed, opened. */
export const topicOf = (token: string) => openTopic(token);
export { localDay, addDays, zone };
