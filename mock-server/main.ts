import { librarySortTitle, matchesLibrarySearch } from './library-search';
import { renderArtwork } from './artwork';
import { previewSessions, stopPreview, trailerPreview } from './previews';
import { libraries as fixtureLibraries, libraryEntries as fixtureLibraryEntries } from '../packages/protocol/fixtures/libraries';
import { createHmac } from 'node:crypto';
import type * as V from '../packages/protocol/types';
import { allTitles, artwork, channels as defaultChannels, detail, extras, featuredSources, featuredTitles, guide as defaultGuide, rows, titles } from '../packages/protocol/fixtures/catalogue';
import { faults, mediaRoot, fixtureDurationSeconds, serveMedia, originalFixture, originalFixtureName, probeOriginalFixture, formatsRoot } from './media';
import { serveLive, liveFaults } from './live';
import { trickplaySheet } from './trickplay';
import { applyCommand, createSession, events, failover, observe, originalLost, publish, requestedInit, sessions, sidecarFixture, snapshot, type Session } from './sessions';
import { appearance, packAsset, serverEvents, setAppearance } from './appearance';
import { audioSourceFor, isMediaLibrary, isVideoChild, mediaArtwork, mediaChildren, mediaDetail, mediaGroups, mediaLibraries, mediaLibraryEntries, mediaLibraryPeople, mediaPerson, mediaPersonArtwork, mediaPersonTitles, mediaTitle } from '../packages/protocol/fixtures/media';
import { bookGenerator, createAudioSession, issueReadGrant, musicGenerator, readingState, readingWriteTime, serveAudioSession, serveReadTicket, setReadingState, withReading } from './media-kinds';
import { buildHistoryRecap, getPlaylistImport, isHiddenDuplicateTitle, isRecapPeriod, libraryDuplicateGroups, recordingReleasesForTitle, resolvePlaylistImportSave, setDuplicatePreference, startPlaylistImport } from './music-library';
import { renderCover } from './covers';
import { downloadSubtitle, foundSubtitleVtt, searchSubtitles, subtitleLanguages } from './subtitle-search';

import { scaleGuide } from './guide-fixture';
import { archivePlan, archiveRange, catchUpFeature, checkTimeshiftCommand, eventProgramme, flagProgramme, goLive, withArchives } from './catch-up';
import { admitTile, createGroup, endGroup, initSports, liveEventOnChannel, placeTile, capTileHeight, replanTile, setWatchProgramme, sportsAdmin, sportsEnabled, sportsLogo } from './sports';
import { screensAdmin, screensApi, screensBootstrap } from './screens';
const scaleCount = Number(process.env.VELA_MOCK_GUIDE_SCALE);
const scaleFixture = scaleCount === 1000 || scaleCount === 10000 ? scaleGuide(scaleCount) : undefined;
const channels = scaleFixture?.channels ?? defaultChannels;
withArchives(channels);
const channelById = new Map(channels.map(c => [c.id, c]));
initSports(channels);
// Guide programmes carry the catch-up flags their channel's archive implies, computed as they are read.
const fixtureEpoch = Date.now();
const archiveFixture: V.Programme[] = [
  { name: 'Archive Match', offset: -45, end: -15 },
  { name: 'Live Match', offset: -15, end: 120 },
].map(({ name, offset, end }) => {
  const start = fixtureEpoch + offset * 60_000;
  return { id: `catchup:channel-1:${start}`, channelId: 'channel-1', name, summary: '', artwork: [],
    start: new Date(start).toISOString(), end: new Date(fixtureEpoch + end * 60_000).toISOString() };
});
const fixtureGuide = (from: number, until: number, ids: string[]) => {
  let programmes = (scaleFixture?.guide ?? defaultGuide)(from, until, ids);
  if (faults.catchUpFixture) {
    programmes = programmes.filter(p => p.channelId !== 'channel-1');
    if (!ids.length || ids.includes('channel-1')) programmes.push(...archiveFixture.filter(p => Date.parse(p.start) < until && Date.parse(p.end) > from));
  }
  return programmes.map(p => flagProgramme(p, channelById.get(p.channelId)));
};
setWatchProgramme((channelId, eventStart) => eventProgramme(channelById.get(channelId), fixtureGuide(eventStart - 6 * 3600_000, eventStart + 3600_000, [channelId]), eventStart));
const mockSeasonCount = Math.max(0, Math.floor(Number(process.env.VELA_MOCK_SEASONS) || 0));
const gapChannels = new Set((process.env.VELA_MOCK_GUIDE_GAPS ?? '').split(','));
const gapHour = Math.floor(Date.now() / 3600000) * 3600000;
const guide = (from: number, until: number, ids: string[]) => fixtureGuide(from, until, ids).filter(programme =>
  !gapChannels.has(programme.channelId) || Date.parse(programme.end) <= gapHour - 3 * 3600000 || Date.parse(programme.start) >= gapHour + 5 * 3600000);

const port = Number(process.env.PORT ?? 7777), origin = process.env.DEV_ORIGIN ?? 'http://localhost:3000';
// VELA_MOCK_LONG_HEROES=1: featured titles with names long enough to take two lines in the hero.
const longHeroes = process.env.VELA_MOCK_LONG_HEROES === '1';
const bootstrapDelayMs = Math.min(120_000, Math.max(0, Number(process.env.VELA_MOCK_BOOTSTRAP_DELAY_MS) || 0));
// VELA_MOCK_COLLECTIONS_DELAY_MS=35000: every /libraries/:id/collections read answers that late (up
// to two minutes), as a production library's collections route did (26-40 s), while the rest stays fast.
const collectionsDelayMs = Math.min(120_000, Math.max(0, Number(process.env.VELA_MOCK_COLLECTIONS_DELAY_MS) || 0));
const secret = crypto.randomUUID();
// The demo viewer is Plex-linked: bootstrap carries its avatar as a session-length image address.
const viewer: V.Viewer = { id: 'viewer-demo', name: 'Demo Viewer', policyRevision: 'mock-1',
  avatar: { id: 'viewer-demo', kind: 'person', tag: '1', sizes: [{ width: 240, height: 240, url: '/vela/v0/images/plexavatar-viewer-demo' }] } };
let viewerRevision = 1;
const yes = { available: true }, no = { available: false, reason: 'Not implemented by this mock' };
const capabilities: V.ServerCapabilities = { searchLibraries: true, searchKinds: [{ id: 'movie', label: 'Movies' }, { id: 'show', label: 'Shows' }, { id: 'game', label: 'Video games' }], searchSorts: [{ id: 'relevance', directions: [] }, ...(['title', 'released'] as const).map(id => ({ id, directions: ['asc', 'desc'] as V.SearchDirection[] }))], protocolVersion: 0, compatibleClientBuilds: { minInclusive: '0.1.0', maxExclusive: '0.3.0' }, server: { id: 'ether-mock', name: 'Vela Studio', version: 'mock-v0' }, plexAccountSignIn: process.env.VELA_MOCK_NO_PLEX !== '1', plexHomeProfiles: process.env.VELA_MOCK_PLEX_HOME === '1', features: { passwordSignIn: yes, deviceGrant: yes, quickConnect: yes, descriptiveSearch: yes, ...(process.env.VELA_MOCK_UNIFIED_SEARCH === '1' ? { unifiedSearch: yes } : {}), aiSearch: no, proactiveFallback: no, liveTV: yes, ...(process.env.VELA_MOCK_OLD !== '1' ? { libraryLive: yes, removeFromContinue: yes, versions: yes, playlists: { available: true, maxEntries: 5000 } } : {}), extras: yes, trailerPreview: yes, initialTrackSelection: no, sessionTrackChanges: no, extraPlayback: yes }, skins: [{ id: 'cinematic', name: 'Cinematic' }, { id: 'editorial', name: 'Editorial' }], defaultSkinId: 'cinematic' };
// Music, books and audiobooks (docs/media-kinds.md). VELA_MOCK_OLD=1 is a server from before them,
// and the VELA_MOCK_LAB=1 preset mirrors a lab server's video-only libraries.
const mediaEnabled = process.env.VELA_MOCK_OLD !== '1' && process.env.VELA_MOCK_LAB !== '1';
// Sports: its plugin screens and surfaces (screens.ts) and multiview.
if (sportsEnabled) Object.assign(capabilities.features, { multiview: { available: true, maxTiles: 4 } });
Object.assign(capabilities.features, catchUpFeature());
if (mediaEnabled) Object.assign(capabilities.features, {
  mediaClasses: { available: true, classes: ['video', 'music', 'book', 'audiobook', 'podcast', 'photo'] },
  reading: { available: true, formats: ['epub', 'pdf', 'cbz'] },
  audioPlayback: yes,
  historyRecap: { available: true, periods: ['week', 'month', 'year', 'all'] },
  playlistImport: { available: true, links: ['deezer', 'spotify'], files: ['m3u', 'csv'], maxTracks: 500 },
  duplicates: yes,
} satisfies Partial<V.ServerCapabilities['features']>);
// Every library names how it opens (protocol README, Library experience): music, audiobooks and
// podcasts listen, books read, photos are a gallery, Live TV is live, the rest watch.
// VELA_MOCK_NO_EXPERIENCES=1 is a server without it (Vela chooses by media class).
// VELA_MOCK_LIKED=<title id>,…: titles the viewer has already liked (parity captures of Liked Songs).
for (const id of (process.env.VELA_MOCK_LIKED ?? '').split(',').filter(Boolean)) {
  const title = mediaTitle(id);
  if (title) title.watch = { ...(title.watch ?? { positionSeconds: 0, played: false, watchlisted: false }), favorite: true };
}
// VELA_MOCK_FAVORITES_LIST=1: Ether's liked lists by role (GET /favorites/titles), as Liked Songs reads them.
if (mediaEnabled && process.env.VELA_MOCK_FAVORITES_LIST === '1') capabilities.features.favoritesList = { available: true };
// VELA_MOCK_LYRICS=1: GET /titles/:id/lyrics, timed lines for the music tracks (a fictional verse
// every five seconds, so a paused position lights a known line), plain text for none, instrumental
// for the test signals.
if (mediaEnabled && process.env.VELA_MOCK_LYRICS === '1') capabilities.features.lyrics = { available: true };
const experiencesEnabled = mediaEnabled && process.env.VELA_MOCK_NO_EXPERIENCES !== '1';
// Loudness levelling and AutoMix markers on music tracks; VELA_MOCK_NO_LOUDNESS=1 is an Ether without them.
if (mediaEnabled && process.env.VELA_MOCK_NO_LOUDNESS !== '1') capabilities.features.loudness = { available: true, album: true, fades: true };
if (experiencesEnabled) capabilities.features.libraryExperiences = { available: true, experiences: ['watch', 'listen', 'read', 'gallery', 'live'] };
// Plugin levels (concerts under music artists, rows per recommended tab). VELA_MOCK_NO_LEVELS=1 is
// a server from before them: no capability, no Concerts tab, no childCounts and no video children.
const levelsEnabled = mediaEnabled && process.env.VELA_MOCK_NO_LEVELS !== '1';
if (levelsEnabled) capabilities.features.pluginLevels = { available: true, tabRows: true, childRoles: true };
// Subtitle search, as a newer Ether advertises it; VELA_MOCK_OLD or VELA_MOCK_NO_SUBTITLE_SEARCH=1 is an Ether without it.
const subtitleSearchEnabled = process.env.VELA_MOCK_OLD !== '1' && process.env.VELA_MOCK_NO_SUBTITLE_SEARCH !== '1';
if (subtitleSearchEnabled) capabilities.features.subtitleSearch = { available: true, languages: subtitleLanguages };
if (process.env.VELA_MOCK_GUIDE_WINDOW === '1') capabilities.liveGuideWindow = { maxChannels: 128, maxWindowMinutes: 180 };
const labPreset = process.env.VELA_MOCK_LAB === '1';
const videoLibraries: V.Library[] = labPreset ? [
  { ...fixtureLibraries[0]!, id: '1', browse: { ...fixtureLibraries[0]!.browse, filters: { ...fixtureLibraries[0]!.browse.filters, genres: undefined } } },
  { ...fixtureLibraries[1]!, id: '2', browse: { ...fixtureLibraries[1]!.browse, filters: { ...fixtureLibraries[1]!.browse.filters, genres: undefined } } },
  { ...fixtureLibraries[1]!, id: '4', name: 'Anime Shows', browse: { ...fixtureLibraries[1]!.browse, filters: { ...fixtureLibraries[1]!.browse.filters, genres: undefined } } },
] : fixtureLibraries;
const libraries: V.Library[] = [...videoLibraries.map(library => experiencesEnabled ? { ...library, experience: library.kind === 'live' ? 'live' : 'watch' } : library),
  ...(mediaEnabled ? mediaLibraries.map(({ experience, ...library }) => experiencesEnabled ? { ...library, experience } : library).map(library => levelsEnabled ? library
    : { ...library, tabs: library.tabs?.filter(tab => !(tab.kind === 'recommended' && tab.card)) }) : [])];
const isMedia = (libraryId: string) => mediaEnabled && isMediaLibrary(libraryId);
/** A library's entries; media libraries list the root level, or `level` when a tab names one. */
const libraryEntries = (id: string, level?: string): V.RowEntry[] => isMedia(id) ? mediaLibraryEntries(id, level) ?? []
  : fixtureLibraryEntries(labPreset ? id === '1' ? 'movies' : id === '2' || id === '4' ? 'shows' : id : id);
const findMediaTitle = (id: string) => mediaEnabled ? mediaTitle(id) : undefined;
const findTitle = (id: string): V.Title | undefined => allTitles.find(title => title.id === id) ?? findMediaTitle(id);
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
interface Grant { id: string; device: V.Device; access: string; refresh: string; expires: number; revoked: boolean; viewer: { id: string; name: string }; client?: V.ClientCapabilities }
const grants = new Map<string, Grant>(), access = new Map<string, Grant>(), refresh = new Map<string, Grant>();
function issue(device: V.Device, profile: { id: string; name: string } = { id: viewer.id, name: viewer.name }): V.Tokens {
  if (!device?.id) fail('request', 'device_required', 'A device id is required');
  const g: Grant = { id: crypto.randomUUID(), device, access: crypto.randomUUID(), refresh: crypto.randomUUID(), expires: Date.now() + 3600000, revoked: false, viewer: profile };
  grants.set(g.id, g); access.set(g.access, g); refresh.set(g.refresh, g);
  return tokens(g);
}
function tokens(g: Grant): V.Tokens { return { accessToken: g.access, refreshToken: g.refresh, expiresAt: new Date(g.expires).toISOString(), viewer: { ...g.viewer, policyRevision: viewer.policyRevision } }; }
if (process.env.VELA_MOCK_TOKEN) { const t = issue({ id: 'vela-dev', name: 'Development', platform: 'web', appVersion: '0.1' }); const g = access.get(t.accessToken)!; access.delete(g.access); g.access = process.env.VELA_MOCK_TOKEN; access.set(g.access, g); }
function authenticate(req: Request): Grant {
  const g = access.get(req.headers.get('authorization')?.replace(/^Bearer /, '') ?? '');
  if (!g || g.revoked || g.expires <= Date.now() || req.headers.get('x-vela-device-id') !== g.device.id) fail('auth', 'unauthorized', 'Valid bearer and X-Vela-Device-Id required');
  return g;
}
/** Until when session refresh fails (POST /__admin/faults refreshFailSeconds re-arms it from now). */
let refreshFailureUntil = 0;
/** A transient refresh failure as the lab gave one: 500 with no retry ("database is locked"), or 503 with Retry-After. */
function refreshFailure(): never {
  const busy = faults.refreshFailStatus === 503;
  const error: V.ProtocolError = busy
    ? { class: 'transient', code: 'unavailable', message: 'Sign-in is briefly unavailable', retry: { allowed: true, afterSeconds: 2 } }
    : { class: 'transient', code: 'internal', message: 'database is locked', retry: { allowed: false } };
  throw Response.json({ error } satisfies V.ErrorResponse, { status: busy ? 503 : 500, headers: { 'Cache-Control': 'no-store', ...(busy ? { 'Retry-After': '2' } : {}) } });
}
/**
 * Refresh keys the mock abandoned the way the lab's Ether did: the replay key was stored, the
 * rotation never committed, and the key now answers 409 mutation_outcome_unknown. Setting
 * refreshAbandonMs arms one abandonment (the next refresh key seen) and forgets earlier ones.
 */
const abandonedRefreshKeys = new Set<string>();
let refreshAbandonArmed = false;
async function abandonedRefresh(key: string): Promise<void> {
  const unknown = () => fail('conflict', 'mutation_outcome_unknown', 'The outcome of an earlier request with this idempotency key is unknown');
  if (abandonedRefreshKeys.has(key)) unknown();
  if (!refreshAbandonArmed || faults.refreshAbandonMs <= 0) return;
  refreshAbandonArmed = false;
  abandonedRefreshKeys.add(key);
  await Bun.sleep(Math.min(faults.refreshAbandonMs, 600_000));
  unknown();
}
/** Each viewer's most recently stopped session (the `startStoppedSession` fault answers a start with it). */
const lastStopped = new Map<string, string>();
/**
 * The playback start faults (Faults in media.ts), for a start that is not queued: a 503
 * `preparation_pending` while `pending` names a count left, else the viewer's last stopped session
 * shown as `ready`. Undefined when no fault applies.
 */
function startFault(g: Grant, body: V.PlaybackRequest, pending: 'audioStartPending' | 'videoStartPending'): V.PlaybackPlan | undefined {
  if (body.queued) return undefined;
  if (faults[pending] > 0) {
    faults[pending]--;
    throw Response.json({ error: { class: 'transient', code: 'preparation_pending', message: 'Playback is being prepared', retry: { allowed: true, afterSeconds: 1 } } } satisfies V.ErrorResponse,
      { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '1' } });
  }
  const stopped = sessions.get(lastStopped.get(g.id) ?? '');
  if (faults.startStoppedSession > 0 && stopped) {
    faults.startStoppedSession--;
    return { ...stopped.plan, state: 'ready' };
  }
  return undefined;
}
function fail(cls: V.ProtocolError['class'], code: string, message: string, extra: Partial<V.ProtocolError> = {}, statusOverride?: number): never {
  const status = statusOverride ?? { auth: 401, policy: 403, 'not-found': 404, source: 502, decoder: 422, playback: 422, capacity: 503, transient: 503, request: 400, conflict: 409 }[cls];
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
/** Signs a media person portrait the same way as video person artwork. */
function signedMediaPortrait(g: Grant, personId: string): V.ArtworkRef {
  const ref = mediaPersonArtwork(personId), token = `${g.id}.${mac(`${g.id}|${ref.kind}|${personId}`)}`;
  return { ...ref, sizes: ref.sizes.map(size => ({ ...size, url: `${size.url}&grant=${token}` })) };
}
/** A title as this viewer sees it (books carry the viewer's reading progress). A server without
 * plugin levels counts an artist's albums alone and sends no per-level counts. */
const present = (g: Grant, title: V.Title): V.Title => title.media ? withReading(g.viewer.id, levelsEnabled || !title.media.childCounts ? title : withoutLevels(title)) : title;
function withoutLevels(title: V.Title): V.Title {
  const { childCounts, ...media } = title.media!;
  return { ...title, media: { ...media, childCount: childCounts?.album ?? 0 } };
}
/** A title's children as this server reads them: one child level (`role`, or `level` for a level key), or all of them. */
function childrenFor(id: string, url: URL): V.Title[] {
  const role = url.searchParams.get('role') ?? url.searchParams.get('level') ?? undefined;
  if (!levelsEnabled) return mediaChildren(id).filter(child => !isVideoChild(child));
  return mediaChildren(id, role || undefined);
}
const presentEntry = (g: Grant, entry: V.RowEntry): V.RowEntry => entry.kind === 'title' && entry.title.media ? { ...entry, title: present(g, entry.title) } : entry;
/** A row's items' media role, as Ether reads it: the declared role, else the title's kind. */
const roleOf = (title: V.Title) => title.media?.role && title.media.role !== 'item' ? title.media.role : title.kind;
/** A row of titles with Ether's Recommendations presentation (card, role, and any layout, personal, library, experience). */
const titleRow = (id: string, name: string, purpose: V.Row['purpose'], card: V.RowCard, items: V.Title[], more: Pick<V.Row, 'layout' | 'personal' | 'library' | 'experience'> = {}): V.Row[] => items.length ? [{
  id, name, purpose, card, role: roleOf(items[0]!), ...more, receiptToken: '', continuation: 'exhausted', items: items.map(title => ({ id: `${id}:${title.id}`, kind: 'title', title, receiptToken: '' })) }] : [];
const recentFirst = (a: V.Title, b: V.Title) => (b.watch?.lastViewedAt ?? '').localeCompare(a.watch?.lastViewedAt ?? '');
const continueReading = (g: Grant) => mediaGroups.books.map(title => present(g, title))
  .filter(title => !!title.watch?.reading && !title.watch.played && !removedContinue.has(title.id)).sort(recentFirst);
// Audiobooks, their parts and podcast episodes resume; music never enters Continue.
const continueListening = (only?: 'audiobook' | 'podcast') => [...mediaGroups.audiobooks, ...mediaGroups.parts, ...mediaGroups.episodes]
  .filter(title => (!only || title.media?.class === only) && (title.watch?.positionSeconds ?? 0) > 0 && !title.watch?.played && !removedContinue.has(title.id)).sort(recentFirst);
/** Each show's newest episode the viewer has not heard, newest first. */
const newEpisodes = () => mediaGroups.shows.flatMap(show => mediaChildren(show.id).filter(episode => !episode.watch?.played && !(episode.watch?.positionSeconds)).slice(0, 1))
  .sort((a, b) => (b.airDate ?? '').localeCompare(a.airDate ?? ''));
const recentAlbums = () => [...mediaGroups.albums].sort((a, b) => (b.airDate ?? '').localeCompare(a.airDate ?? ''));
function mediaHomeRows(g: Grant): V.Row[] {
  if (!mediaEnabled || labPreset) return [];
  return [...titleRow('media-recent-albums', 'Recently added albums', 'recentlyAdded', 'square', recentAlbums().slice(0, 12)),
    ...titleRow('media-continue-reading', 'Continue reading', 'continue', 'poster', continueReading(g)),
    ...titleRow('media-continue-listening', 'Continue listening', 'continue', 'square', continueListening())];
}
/** A recommended tab's own shelves: Concerts, in 16:9 video cards. Row ids are stable per tab and shelf. */
function concertRows(g: Grant): V.Row[] {
  const shelf = (key: string, name: string, purpose: V.Row['purpose'], items: V.Title[]) => titleRow(`plugin:music:tab:concerts:shelf:${key}`, name, purpose, 'landscape', items.map(title => present(g, title)));
  const all = mediaGroups.concerts;
  return [
    ...shelf('continue', 'Continue watching', 'continue', all.filter(title => (title.watch?.positionSeconds ?? 0) > 0 && !title.watch?.played && !removedContinue.has(title.id)).sort(recentFirst)),
    ...shelf('recent', 'Recently filmed', 'recentlyAdded', [...all].sort((a, b) => (b.airDate ?? '').localeCompare(a.airDate ?? ''))),
    ...shelf('full-length', 'Full-length shows', 'recommendation', all.filter(title => (title.durationSeconds ?? 0) >= 90 * 60)),
    ...shelf('open-air', 'Open-air and on the street', 'collection', all.filter(title => /quay|square|streets|pier|festival/i.test(title.media?.facts?.[0]?.value ?? ''))),
    ...shelf('by-artist', 'From Harbour Brass Collective', 'recommendation', all.filter(title => title.media?.parents?.[0]?.name === 'Harbour Brass Collective')),
  ];
}
function mediaLibraryRows(g: Grant, libraryId: string, tab?: string): V.Row[] {
  if (libraryId === 'music' && tab === 'concerts') return concertRows(g);
  if (libraryId === 'music') {
    const listen = { experience: 'listen' as const };
    // A track list carries only track leaves with a duration and an album or artist parent.
    const leaf = (track: V.Title) => (track.durationSeconds ?? 0) > 0 && !!track.media?.parents?.some(parent => parent.role === 'album' || parent.role === 'artist');
    return [...titleRow('music-jump-back-in', 'Jump back in', 'recentContexts', 'square', recentAlbums().slice(0, 6), { ...listen, personal: true }),
      ...titleRow('music-recent-albums', 'Recently added albums', 'recentlyAdded', 'square', recentAlbums(), listen),
      ...titleRow('music-quick-picks', 'Quick picks', 'recommendation', 'square', mediaGroups.tracks.filter((track, index) => index % 7 === 2 && leaf(track)).slice(0, 8), { ...listen, layout: 'tracks', personal: true }),
      ...titleRow('music-liked', 'Liked albums', 'liked', 'square', recentAlbums().slice(6, 12), { ...listen, personal: true }),
      ...titleRow('music-artists', 'Artists to explore', 'recommendation', 'round', mediaGroups.artists, listen)];
  }
  if (libraryId === 'books') return [...titleRow('books-continue', 'Continue reading', 'continue', 'poster', continueReading(g)),
    ...titleRow('books-series', 'Series to start', 'recommendation', 'poster', mediaGroups.series),
    ...titleRow('books-standalone', 'Standalone reads', 'collection', 'poster', mediaGroups.books.filter(book => !book.media?.parents?.length).map(book => present(g, book)))];
  if (libraryId === 'photos') return titleRow('photos-recent', 'Recent photos', 'recentlyAdded', 'square', mediaGroups.photos);
  if (libraryId === 'podcasts') return [...titleRow('podcasts-continue', 'Continue listening', 'continue', 'square', continueListening('podcast')),
    ...titleRow('podcasts-new', 'New episodes', 'recentlyReleased', 'square', newEpisodes()),
    ...titleRow('podcasts-shows', 'Your shows', 'collection', 'square', mediaGroups.shows)];
  return [...titleRow('audiobooks-continue', 'Continue listening', 'continue', 'square', continueListening('audiobook')),
    ...titleRow('audiobooks-recent', 'Recently added', 'recentlyAdded', 'square', [...mediaGroups.audiobooks].sort((a, b) => (b.year ?? 0) - (a.year ?? 0)))];
}
/** Playlist members: playable leaves of a media container (an album's tracks, an artist's albums). */
function mediaLeaves(title: V.Title): V.Title[] {
  if (audioSourceFor(title.id)) return [title];
  // Books are read, not played: they join no playlist.
  return mediaChildren(title.id).flatMap(mediaLeaves);
}
function recordListening(session: Session, title: V.Title, ended: boolean): void {
  const position = session.plan.positionSeconds ?? 0, finished = ended || position >= (session.plan.durationSeconds ?? 0) - 1;
  const watch = title.watch ?? { positionSeconds: 0, played: false, favorite: false, watchlisted: false };
  // Tracks never store a resume point; audiobooks and parts do, as video.
  title.watch = { ...watch, positionSeconds: finished || title.media?.role === 'track' ? 0 : position,
    played: title.media?.role === 'track' ? watch.played || finished : finished, lastViewedAt: new Date().toISOString() };
  viewer.policyRevision = `mock-${++viewerRevision}`;
  feedChanged();
}
function recordPlayback(session: Session, ended: boolean): void {
  const media = session.plan.titleId ? findMediaTitle(session.plan.titleId) : undefined;
  if (media) return recordListening(session, media, ended);
  const title = allTitles.find(value => value.id === session.plan.titleId);
  if (!title) return;
  const position = session.plan.positionSeconds ?? 0;
  const finished = ended || position >= (title.durationSeconds ?? fixtureDurationSeconds) - 1;
  title.watch = { ...(title.watch ?? { favorite: false, watchlisted: false }), positionSeconds: finished ? 0 : position, played: finished };
  viewer.policyRevision = `mock-${++viewerRevision}`;
  feedChanged();
}
function homeScope(g: Grant) { return `${viewer.policyRevision}:${mac(JSON.stringify([featuredTitles.map(t => t.id), progressRows(), rows, mediaHomeRows(g)]))}`; }
function homeRow(g: Grant, row: V.Row, url: URL): V.Row {
  const source = row.purpose === 'continue' ? { ...row, items: row.items.filter(item => item.kind !== 'title' || !removedContinue.has(item.title.id)) } : row;
  const bound = boundRow(g, source);
  return { ...bound, ...page(bound.items, url, g, `home-items:${row.id}:${homeScope(g)}`, 20) };
}
/**
 * Ether re-mints a viewer's row ids when the feed recomputes (playback, a watch change): a row's
 * id carries the row-view snapshot it was read in, and its opaque `key` stays the same. An id
 * from an older snapshot answers 409 cursor_expired; an id it never minted, 404.
 */
let rowSnapshot = 1;
const feedChanged = () => { rowSnapshot++; };
const minted = (row: V.Row, key = row.id, snapshot = rowSnapshot): V.Row => ({ ...row, id: `${row.id}~${snapshot}`, key });
/** The row a wire id names, by its base id; a superseded snapshot is refused. */
function mintedRow(id: string, candidates: V.Row[]): V.Row {
  const at = id.lastIndexOf('~'), base = at < 0 ? id : id.slice(0, at), snapshot = at < 0 ? '' : id.slice(at + 1);
  const row = candidates.find(r => r.id === base);
  if (!row) fail('not-found', 'row_not_found', 'Row not found');
  if (snapshot !== String(rowSnapshot)) fail('conflict', 'cursor_expired', 'Refresh from first page');
  return row;
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
/** Home's page in order: progress rows, media rows, the catalogue's rows, and a plugin's surface
 * row where the page places it (after Top 10), as Ether lists them. */
function homeRows(g: Grant, url: URL, surfaces: V.SurfaceRow[] = [], snapshot = rowSnapshot): V.Page<V.Row | V.SurfaceRow> {
  const ordered: (V.Row | V.SurfaceRow)[] = [...progressRows(), ...mediaHomeRows(g), ...rows];
  const top = ordered.findIndex(row => row.id === 'row-top10');
  ordered.splice(top + 1, 0, ...surfaces);
  const result = page(labPreset ? labHomeRows : ordered, url, g, `home-rows:${homeScope(g)}:${surfaces.map(row => row.id).join(',')}`, labPreset ? 5 : 2);
  const firstItems = new URL(url); firstItems.search = '';
  return { ...result, items: result.items.map(row => 'kind' in row ? row : minted(homeRow(g, row, firstItems), row.id, snapshot)) };
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
const clearedVersionChoices = new Set<string>();
const preparedVersions = new Set<string>();
const versionId = (titleId: string, slot: string) => `${titleId}-0000-4000-8000-${slot.padStart(12, '0')}`;
function versionsFor(titleId: string, owner: string): V.TitleVersions {
  const title = allTitles.find(candidate => candidate.id === titleId);
  if (!title) fail('not-found', 'title_not_found', 'Title not found');
  if (!['movie', 'episode'].includes(title.kind)) fail('request', 'not_playable', 'Versions are available for movies and episodes');
  const cold = titleId === 'title-1-3';
  const remembered = !clearedVersionChoices.has(`${owner}:${titleId}`) && (titleId === 'title-1-1' || title.kind === 'episode');
  const pinned = titleId === 'title-1-2';
  const auto: V.VersionItem = { id: versionId(titleId, '0'), label: 'Auto', recommended: !remembered && !pinned, availability: 'instant' };
  const full: V.VersionItem[] = cold ? [
    auto,
    { id: versionId(titleId, '1'), label: '4K Remux', recommended: false, availability: 'instant' },
    { id: versionId(titleId, '2'), label: '1080p WEB-DL', recommended: false, availability: 'cached' },
  ] : [
    auto,
    { id: versionId(titleId, '1'), label: '4K Dolby Vision Remux · TrueHD Atmos 7.1', recommended: true, ...(remembered ? { remembered: true as const } : {}), ...(pinned ? { pinned: true as const } : {}), resolution: '4K', dynamicRange: 'dv', videoCodec: 'hevc', audio: { codec: 'truehd', channels: '7.1', atmos: true }, source: 'Remux', edition: 'Theatrical', sizeBytes: 67_800_000_000, languages: ['English'], availability: 'instant' },
    { id: versionId(titleId, '2'), label: '1080p WEB-DL · DD+ 5.1', recommended: false, resolution: '1080p', dynamicRange: 'sdr', videoCodec: 'h264', audio: { codec: 'eac3', channels: '5.1' }, source: 'WEB-DL', sizeBytes: 8_400_000_000, languages: ['English', 'French'], availability: 'cached' },
    { id: versionId(titleId, '3'), label: '4K HDR10 Blu-ray · DTS-HD MA 5.1', recommended: false, resolution: '4K', dynamicRange: 'hdr10', videoCodec: 'hevc', audio: { codec: 'dts', channels: '5.1' }, source: 'Blu-ray', sizeBytes: 43_200_000_000, availability: 'fetch', note: 'Stored in the archive' },
    { id: versionId(titleId, '4'), label: 'Director’s Cut · 1080p', recommended: false, resolution: '1080p', source: 'Local', edition: 'Director’s Cut', availability: 'unavailable', note: 'The source drive is offline' },
  ];
  const selected = remembered || pinned ? full[1]!.id : auto.id;
  return { titleId, selectedVersionId: selected, ...(remembered ? { rememberedChoice: { scope: title.kind === 'episode' ? 'show' as const : 'title' as const, active: true, label: full[1]!.label } } : {}), versions: full };
}
interface MockPlaylist { id: string; name: string; summary?: string; smart: boolean; updatedAt: string; entries: { entryId: string; titleId: string }[] }
const playlists: MockPlaylist[] = [
  { id: 'playlist-weekend', name: 'Weekend watch', smart: false, updatedAt: new Date().toISOString(), entries: [
    { entryId: 'entry-weekend-1', titleId: titles[0]!.id }, { entryId: 'entry-weekend-2', titleId: titles[1]!.id },
  ] },
  { id: 'playlist-smart', name: 'Recently added', smart: true, updatedAt: new Date().toISOString(), entries: [
    { entryId: 'entry-smart-1', titleId: titles[2]!.id },
  ] },
];
// VELA_MOCK_PLAYLIST_TRACKS=<track id>,…: a music playlist, "Evening Drive" (parity captures of a playlist page).
if (process.env.VELA_MOCK_PLAYLIST_TRACKS) playlists.push({ id: 'playlist-evening-drive', name: 'Evening Drive', summary: 'Windows down, the long way home.', smart: false,
  updatedAt: new Date(Date.parse(process.env.VELA_MOCK_NOW ?? '') || Date.now()).toISOString(),
  entries: process.env.VELA_MOCK_PLAYLIST_TRACKS.split(',').filter(Boolean).map((titleId, n) => ({ entryId: `entry-evening-drive-${n + 1}`, titleId })) });
if (process.env.VELA_MOCK_NOW) for (const value of playlists) value.updatedAt = new Date(Date.parse(process.env.VELA_MOCK_NOW) || Date.now()).toISOString();
function playlistArtwork(g: Grant, titleId: string): V.ArtworkRef {
  const media = findMediaTitle(titleId);
  if (media) return media.artwork[0] ?? mediaArtwork(media.id, 'square');
  return signedArtwork(g, titleId, 'poster');
}
const playlistCard = (g: Grant, value: MockPlaylist): V.PlaylistCard => ({ id: value.id, kind: 'playlist', name: value.name,
  ...(value.summary ? { summary: value.summary } : {}),
  artwork: value.entries[0] ? [playlistArtwork(g, value.entries[0].titleId)] : [], itemCount: value.entries.length,
  smart: value.smart, updatedAt: value.updatedAt });
function playlistTitles(ids: string[]): V.Title[] {
  const result: V.Title[] = [];
  for (const id of ids) {
    const media = findMediaTitle(id);
    if (media) { result.push(...mediaLeaves(media)); continue; }
    const title = allTitles.find(item => item.id === id);
    if (!title) fail('not-found', 'not_found', 'Title not found');
    if (title.kind === 'movie' || title.kind === 'episode') result.push(title);
    else if (title.kind === 'show') result.push(...allTitles.filter(item => item.kind === 'episode' && item.showId === title.id));
    else if (title.kind === 'season') result.push(...allTitles.filter(item => item.kind === 'episode' && item.showId === title.showId && item.seasonNumber === title.seasonNumber));
    else unprocessable('unsupported_kind', 'Unsupported playlist title kind');
  }
  return result;
}
function unprocessable(code: string, message: string): never {
  throw Response.json({ error: { class: 'request', code, message, retry: { allowed: false } } } satisfies V.ErrorResponse,
    { status: 422, headers: { 'Cache-Control': 'no-store' } });
}
function revoke(g: Grant) { g.revoked = true; for (const p of previewSessions.values()) if (p.owner === g.id) p.ended = true; for (const s of sessions.values()) if (s.owner === g.id) { for (const close of s.listeners.values()) close(); s.listeners.clear(); } }
const plexSelections = new Map<string, { expires: number; deviceId: string; old?: Grant; consumed: boolean; attempts: number }>();
const plexProfiles: V.PlexHomeProfile[] = [
  { id: 'owner', name: 'Demo Owner', protected: true, avatarUrl: '/vela/v0/images/plexavatar-owner' },
  { id: 'kids', name: 'Kids', protected: false, restricted: true, avatarUrl: '/vela/v0/images/plexavatar-kids' },
];
function plexSelection(deviceId: string, old?: Grant): V.PlexHomeSelection {
  const selectionToken = crypto.randomUUID(), expires = Date.now() + 300000;
  plexSelections.set(selectionToken, { expires, deviceId, old, consumed: false, attempts: 0 });
  return { selectionToken, expiresAt: new Date(expires).toISOString(), profiles: plexProfiles };
}
function currentSession(id: string, g: Grant): Session { const s = sessions.get(id); if (!s || s.owner !== g.id || s.expires <= Date.now()) fail('not-found', 'session_not_found', 'Session not found'); return s; }

async function api(req: Request, url: URL, body: any): Promise<Response> {
  const path = url.pathname.replace(/^\/vela\/v0/, ''), method = req.method;
  if (method === 'GET' && path === '/capabilities') return cached(req, capabilities, 'public');
  if (method === 'GET' && path === '/appearance') return cached(req, appearance(), 'public');
  if (method === 'POST' && path === '/auth/plex') {
    if (body.plexToken !== 'mock-plex-approved') return Response.json({ error: 'not_shared' }, {status: 403});
    if (capabilities.plexHomeProfiles && body.selectProfile === true) return json(plexSelection(body.device?.id));
    return json(issue(body.device));
  }
  if (method === 'POST' && path === '/auth/plex/profiles/challenge') {
    if (!capabilities.plexHomeProfiles) fail('request', 'unsupported', 'Plex Home profiles are unavailable', {}, 404);
    if (!body.device?.id) fail('request', 'device_required', 'A device id is required');
    return json(plexSelection(body.device?.id, authenticate(req)));
  }
  if (method === 'POST' && path === '/auth/plex/profile') {
    const selection = plexSelections.get(body.selectionToken);
    if (!selection || selection.expires <= Date.now()) fail('conflict', 'selection_expired', 'This profile selection expired', {}, 410);
    if (selection.consumed) fail('conflict', 'selection_consumed', 'This profile selection was already used');
    if (!body.device?.id || body.device.id !== selection.deviceId) fail('policy', 'selection_device_mismatch', 'This profile selection belongs to another device');
    const profile = plexProfiles.find(value => value.id === body.profileId);
    if (!profile) fail('policy', 'profile_ineligible', 'This profile is unavailable');
    if (profile.protected && selection.attempts >= 5) { selection.consumed = true; fail('capacity', 'rate_limited', 'Too many PIN attempts; start again', {}, 429); }
    if (profile.protected) selection.attempts++;
    if (profile.id === 'owner' && body.pin !== '1234') fail('auth', 'invalid_pin', 'Incorrect PIN');
    selection.consumed = true;
    const issued = issue(body.device, { id: profile.id, name: profile.name });
    if (selection.old) revoke(selection.old);
    return json(issued);
  }
  if (method === 'POST' && path === '/auth/sign-in') { if (body.username !== 'demo' || body.password !== 'vela') fail('auth', 'invalid_credentials', 'Invalid sign-in'); return json(issue(body.device)); }
  if (method === 'POST' && path === '/auth/refresh') {
    if (faults.refreshStallMs > 0) await Bun.sleep(Math.min(faults.refreshStallMs, 600_000));
    if (Date.now() < refreshFailureUntil) refreshFailure();
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
  if (capabilities.features.historyRecap?.available && method === 'GET' && path === '/history/recap') {
    const periodParam = url.searchParams.get('period') ?? 'month';
    if (!isRecapPeriod(periodParam)) fail('request', 'invalid_period', 'Period must be week, month, year or all');
    const result = buildHistoryRecap(periodParam, url.searchParams.get('at'), url.searchParams.get('library'), t => present(g, t));
    if (result === 'invalid_date') fail('request', 'invalid_date', 'at must be YYYY-MM-DD');
    if (result === 'invalid_library') fail('not-found', 'library_not_found', 'Library not found');
    return json(result);
  }
  if (capabilities.features.playlistImport?.available) {
    if (method === 'POST' && path === '/playlists/import') {
      if (body.library && !visibleLibraries.some(l => l.id === body.library)) fail('not-found', 'library_not_found', 'Library not found');
      const result = startPlaylistImport(body, t => present(g, t));
      if (result.status === 400) fail('request', result.code, result.message);
      return Response.json(result.job, { status: 202, headers: { 'Cache-Control': 'no-store' } });
    }
    const importMatch = /^\/playlists\/import\/([^/]+)(\/save)?$/.exec(path);
    if (importMatch) {
      const importId = decodeURIComponent(importMatch[1]!);
      if (method === 'GET' && !importMatch[2]) {
        const state = getPlaylistImport(importId, url.searchParams.get('state'));
        if (!state) fail('not-found', 'import_not_found', 'Playlist import job not found');
        return json(state);
      }
      if (method === 'POST' && importMatch[2] === '/save') {
        const resolved = resolvePlaylistImportSave(importId, body);
        if (!resolved) fail('not-found', 'import_not_found', 'Playlist import job not found');
        if (resolved === 'invalid_choice') fail('request', 'invalid_choice', 'Chosen release must belong to the ambiguous item candidates');
        const expanded = playlistTitles(resolved.titleIds);
        const value: MockPlaylist = {
          id: `playlist-${crypto.randomUUID()}`,
          name: resolved.name,
          ...(resolved.description ? { summary: resolved.description } : {}),
          smart: false,
          updatedAt: new Date().toISOString(),
          entries: expanded.map(title => ({ entryId: crypto.randomUUID(), titleId: title.id })),
        };
        playlists.push(value);
        return json(playlistCard(g, value));
      }
    }
  }
  if (capabilities.features.duplicates?.available) {
    const libDuplicatesMatch = /^\/libraries\/([^/]+)\/duplicates(?:\/([^/]+))?$/.exec(path);
    if (libDuplicatesMatch) {
      const libraryId = decodeURIComponent(libDuplicatesMatch[1]!);
      if (!visibleLibraries.some(l => l.id === libraryId)) fail('not-found', 'library_not_found', 'Library not found');
      if (method === 'GET' && !libDuplicatesMatch[2]) {
        const groups = libraryDuplicateGroups(libraryId, g.viewer.id, t => present(g, t));
        return cached(req, page(groups, url, g, `duplicates:${libraryId}:${viewer.policyRevision}:${mac(JSON.stringify(groups))}`), g.id);
      }
      if (method === 'POST' && libDuplicatesMatch[2]) {
        const recordingId = decodeURIComponent(libDuplicatesMatch[2]);
        const updated = setDuplicatePreference(libraryId, recordingId, g.viewer.id, body, t => present(g, t));
        if (updated === 'not_found') fail('not-found', 'recording_not_found', 'Duplicate recording group not found');
        if (updated === 'invalid') fail('request', 'invalid_duplicate_preference', 'preferredTitleId must belong to the recording group');
        viewer.policyRevision = `mock-${++viewerRevision}`;
        return json(updated);
      }
    }
    const recordingMatch = /^\/titles\/([^/]+)\/recording$/.exec(path);
    if (method === 'GET' && recordingMatch) {
      const title = findTitle(decodeURIComponent(recordingMatch[1]!));
      if (!title) fail('not-found', 'title_not_found', 'Title not found');
      return cached(req, recordingReleasesForTitle(title, g.viewer.id, t => present(g, t)), g.id);
    }
  }
  if (capabilities.features.playlists?.available) {
    if (method === 'GET' && path === '/playlists') return cached(req, page(playlists.map(value => playlistCard(g, value)), url, g, `playlists:${playlists.map(value => `${value.id}:${value.updatedAt}`).join('|')}`), g.id);
    if (method === 'POST' && path === '/playlists') {
      if (typeof body.name !== 'string' || !body.name.trim()) fail('request', 'invalid_request', 'Playlist name required');
      const expanded = playlistTitles(Array.isArray(body.titleIds) ? body.titleIds : []);
      if (expanded.length > 5000) unprocessable('playlist_too_large', 'Playlist is too large');
      const value: MockPlaylist = { id: `playlist-${crypto.randomUUID()}`, name: body.name.trim(), smart: false, updatedAt: new Date().toISOString(),
        entries: expanded.map(title => ({ entryId: crypto.randomUUID(), titleId: title.id })) };
      playlists.push(value); return Response.json(playlistCard(g, value), { status: 201 });
    }
    const titlePlaylists = /^\/titles\/([^/]+)\/playlists$/.exec(path);
    if (method === 'GET' && titlePlaylists) {
      const titleId = decodeURIComponent(titlePlaylists[1]!);
      const matchingTitleIds = new Set(playlistTitles([titleId]).map(title => title.id));
      return cached(req, { items: playlists.map(value => ({ id: value.id, name: value.name, smart: value.smart,
        entryIds: value.entries.filter(entry => matchingTitleIds.has(entry.titleId)).map(entry => entry.entryId) })) } satisfies V.TitlePlaylists, g.id);
    }
    const playlistMatch = /^\/playlists\/([^/]+)$/.exec(path);
    if (playlistMatch) {
      const id = decodeURIComponent(playlistMatch[1]!); const value = playlists.find(item => item.id === id);
      if (!value) fail('not-found', 'not_found', 'Playlist not found');
      if (method === 'GET') {
        const items: V.RowEntry[] = value.entries.flatMap(member => {
          const title = findTitle(member.titleId); return title ? [{ id: title.id, entryId: member.entryId, kind: 'title' as const,
            title: title.media ? present(g, title) : { ...title, artwork: title.artwork.map(ref => signedArtwork(g, title.id, ref.kind)) }, receiptToken: '' }] : [];
        });
        return cached(req, { collection: { id: value.id, kind: 'playlist', name: value.name, ...(value.summary ? { summary: value.summary } : {}), artwork: playlistCard(g, value).artwork,
          smart: value.smart, entryCount: value.entries.length, updatedAt: value.updatedAt }, ...page(items, url, g, `playlist:${id}:${value.updatedAt}`) } satisfies V.CollectionContents, g.id);
      }
      if (value.smart) fail('conflict', 'playlist_read_only', 'Smart playlists are read only');
      if (method === 'PATCH') {
        if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) fail('request', 'invalid_request', 'Playlist name required');
        if (typeof body.name === 'string') value.name = body.name.trim();
        if (typeof body.summary === 'string') value.summary = body.summary.trim() || undefined;
        value.updatedAt = new Date().toISOString();
        return json(playlistCard(g, value));
      }
      if (method === 'DELETE') { playlists.splice(playlists.indexOf(value), 1); return json({ accepted: true }); }
    }
    const entriesMatch = /^\/playlists\/([^/]+)\/entries$/.exec(path);
    if (method === 'POST' && entriesMatch) {
      const value = playlists.find(item => item.id === decodeURIComponent(entriesMatch[1]!)); if (!value) fail('not-found', 'not_found', 'Playlist not found');
      if (value.smart) fail('conflict', 'playlist_read_only', 'Smart playlists are read only');
      const expanded = playlistTitles(Array.isArray(body.titleIds) ? body.titleIds : []); if (!expanded.length) fail('request', 'invalid_request', 'Title ids required');
      if (value.entries.length + expanded.length > 5000) unprocessable('playlist_too_large', 'Playlist is too large');
      value.entries.push(...expanded.map(title => ({ entryId: crypto.randomUUID(), titleId: title.id }))); value.updatedAt = new Date().toISOString();
      return json({ entryCount: value.entries.length });
    }
    const entryMatch = /^\/playlists\/([^/]+)\/entries\/([^/]+)(\/move)?$/.exec(path);
    if (entryMatch) {
      const value = playlists.find(item => item.id === decodeURIComponent(entryMatch[1]!)); if (!value) fail('not-found', 'not_found', 'Playlist not found');
      if (value.smart) fail('conflict', 'playlist_read_only', 'Smart playlists are read only');
      const entryId = decodeURIComponent(entryMatch[2]!); const index = value.entries.findIndex(entry => entry.entryId === entryId);
      if (index < 0) fail('not-found', 'not_found', 'Playlist entry not found');
      if (method === 'DELETE' && !entryMatch[3]) { value.entries.splice(index, 1); value.updatedAt = new Date().toISOString(); return json({ accepted: true }); }
      if (method === 'POST' && entryMatch[3]) {
        if (!('afterEntryId' in body)) fail('request', 'invalid_request', 'afterEntryId is required');
        const [moving] = value.entries.splice(index, 1); const after = body.afterEntryId === null ? -1 : value.entries.findIndex(entry => entry.entryId === body.afterEntryId);
        if (!moving || body.afterEntryId !== null && after < 0) fail('request', 'invalid_request', 'Invalid playlist move');
        value.entries.splice(after + 1, 0, moving); value.updatedAt = new Date().toISOString(); return json({ accepted: true });
      }
    }
  }
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
    // ?tab= names a recommended tab (features.pluginLevels.tabRows); none, or the first, is the library's rows.
    // An unknown tab is not found, as Ether answers; a server from before plugin levels ignores the parameter.
    const tabId = levelsEnabled ? url.searchParams.get('tab') ?? '' : '';
    const recommended = (library.tabs ?? []).filter(tab => tab.kind === 'recommended');
    if (tabId && !recommended.some(tab => tab.id === tabId)) fail('not-found', 'tab_not_found', 'Unknown recommended tab');
    const rowsTab = tabId && tabId !== recommended[0]?.id ? tabId : undefined;
    if (isMedia(library.id)) { const shelves = mediaLibraryRows(g, library.id, rowsTab); return cached(req, page(shelves.map(row => boundRow(g, row)), url, g, `library-rows:${library.id}:${rowsTab ?? ''}:${mac(JSON.stringify(shelves))}`), g.id); }
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
    if (collectionsDelayMs) await Bun.sleep(collectionsDelayMs);
    const library = libraries.find(l => l.id === collectionsMatch[1]);
    if (!library) fail('not-found', 'not_found', 'Library not found');
    const tab = library.tabs?.find(tab => tab.id === url.searchParams.get('tab'));
    if (url.searchParams.has('tab') && (!tab || tab.kind !== 'collections' && tab.kind !== 'people')) fail('request', 'invalid_tab', 'Unknown collections tab');
    const query = (url.searchParams.get('query') ?? '').trim();
    if (query && tab?.search === false) fail('request', 'unsupported_library_query', 'Tab search is disabled');
    const matches = (name: string) => matchesLibrarySearch(name, query);
    if (tab?.kind === 'people' && isMedia(library.id)) {
      const entries: V.LibraryPersonEntry[] = mediaLibraryPeople(library.id, tab.facet ?? 'author').map(({ person, itemCount }) => ({
        id: `person:${person.id}`, kind: 'person', person: { id: person.id, name: person.name, photo: signedMediaPortrait(g, person.id) }, itemCount }));
      entries.sort((a, b) => tab.order === 'count' ? b.itemCount - a.itemCount || a.person.name.localeCompare(b.person.name) : a.person.name.localeCompare(b.person.name));
      return cached(req, page(entries.filter(entry => matches(entry.person.name)), url, g, `library-people:${library.id}:${tab.id}:${query}`), g.id);
    }
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
  const creditedPerson = personMatch && mediaEnabled ? mediaPerson(decodeURIComponent(personMatch[1]!)) : undefined;
  if (method === 'GET' && creditedPerson) {
    if (!personMatch![2]) return cached(req, { id: creditedPerson.id, name: creditedPerson.name, photo: signedMediaPortrait(g, creditedPerson.id), roles: creditedPerson.roles,
      knownFor: creditedPerson.knownFor, biography: creditedPerson.biography } satisfies V.PersonDetail, g.id);
    const libraryId = url.searchParams.get('libraryId');
    const library = libraryId ? libraries.find(l => l.id === libraryId) : undefined;
    if (libraryId && !library) fail('not-found', 'not_found', 'Library not found');
    const items: V.RowEntry[] = mediaPersonTitles(creditedPerson.id).filter(({ title }) => !library || library.media === title.media?.class)
      .map(({ title, role }) => ({ id: `${creditedPerson.id}:${title.id}`, kind: 'title', title: present(g, title), role, receiptToken: '' }));
    return cached(req, page(items, url, g, `person:${creditedPerson.id}:${libraryId ?? ''}`), g.id);
  }
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
    for (const key of q.keys()) if (key.startsWith('facet.') ? !options.filters.facets?.some(f => `facet.${f.id}` === key) : !['cursor','limit','tab','sort','direction','kind','genre','year','played','favorite','collectionId','query'].includes(key) || q.getAll(key).length !== 1) invalid();
    // View tabs, and library tabs that list one level (Albums, Tracks, Series) or a media library's root.
    const tab = q.get('tab') ? library.tabs?.find(candidate => candidate.id === q.get('tab') && (candidate.kind === 'view' || candidate.kind === 'library' && (candidate.level !== undefined || isMedia(library.id)))) : undefined;
    if ((q.has('tab') && !tab) || (tab?.kind === 'view' && q.has('query') && !tab.search)) invalid();
    const collectionId = q.get('collectionId');
    if (collectionId && (process.env.VELA_MOCK_OLD === '1' || !options.filters.collectionId || collectionId !== 'fixture-collection')) invalid();
    const sort = q.get('sort') ?? options.defaultSort, direction = q.get('direction') ?? options.defaultDirection;
    if (!options.sorts.some(s => s.id === sort && s.directions.includes(direction as V.SortDirection))) invalid();
    const kind = q.get('kind'), genre = q.get('genre'), year = q.get('year');
    if (kind !== null && !options.filters.kind?.includes(kind as V.TitleKind)) invalid();
    if (genre !== null && (!options.filters.genre || !genre.trim() || genre.length > 100)) invalid();
    if (year !== null && (!options.filters.year || !/^\d{1,4}$/.test(year) || Number(year) < 1)) invalid();
    for (const key of ['played','favorite'] as const) if (q.has(key) && (!options.filters[key] || !['true','false'].includes(q.get(key)!))) invalid();
    let items = libraryEntries(library.id, tab?.level).map(e => presentEntry(g, e)).filter(e => {
      if (e.kind !== 'title') return true;
      const t = e.title;
      if (isHiddenDuplicateTitle(g.viewer.id, t.id)) return false;
      if (q.get('query') && !t.name.toLowerCase().includes(q.get('query')!.toLowerCase())) return false;
      for (const facet of options.filters.facets ?? []) { const wanted = q.getAll(`facet.${facet.id}`); if (wanted.length && !facetValues(e, facet.id).some(value => wanted.includes(value))) return false; }
      return (!collectionId || t.id === titles[0]!.id) && (!kind || kind === t.kind) && (!genre || t.genres.some(g => g.toLowerCase() === genre.trim().toLowerCase()))
        && (!year || t.year === Number(year)) && (!q.has('played') || !!t.watch?.played === (q.get('played') === 'true'))
        && (!q.has('favorite') || !!t.watch?.favorite === (q.get('favorite') === 'true'));
    });
    if (sort !== 'server' && sort !== 'index') items.sort((a, b) => {
      if (a.kind !== 'title' || b.kind !== 'title') return 0;
      const cmp = sort === 'title' ? librarySortTitle(a.title.name).localeCompare(librarySortTitle(b.title.name), 'en', { numeric: true }) : sort === 'released' ? (a.title.airDate ?? '').localeCompare(b.title.airDate ?? '')
        : sort === 'lastViewed' ? (a.title.watch?.lastViewedAt ?? '').localeCompare(b.title.watch?.lastViewedAt ?? '') : (a.title.year ?? 0) - (b.title.year ?? 0);
      return (cmp || a.id.localeCompare(b.id)) * (direction === 'desc' ? -1 : 1);
    });
    const query = [tab?.id, sort, direction, kind, genre?.trim().toLowerCase(), year, q.get('played'), q.get('favorite'), q.get('query'), q.get('limit') ?? '50', collectionId];
    const scope = `library:${library.id}:${viewer.policyRevision}:${mac(JSON.stringify([query, q.getAll('query'), [...q].filter(([key]) => key.startsWith('facet.')), items]))}`;
    items = items.map(i => ({ ...i, receiptToken: receipt(g, `library:${scope}:${i.id}`) }));
    const paging = new URL(url);
    if (tab?.kind === 'view') paging.searchParams.set('limit', '6');
    return cached(req, { library, sort: sort as V.LibrarySort, direction: direction as V.SortDirection, ...page(items, paging, g, scope), total: items.length } satisfies V.LibraryContents, g.id);
  }
  if (method === 'POST' && path.endsWith('/approve')) { const p = [...(path.includes('/device/') ? devices : quick).values()].find(p => p.code === (body.userCode ?? body.code) && p.expires > Date.now()); if (!p) fail('not-found', 'grant_not_found', 'Pairing not found'); p.approved = true; return json({ accepted: true }); }
  const lyricsMatch = /^\/titles\/([^/]+)\/lyrics$/.exec(path);
  if (method === 'GET' && lyricsMatch && capabilities.features.lyrics?.available) {
    const track = mediaTitle(decodeURIComponent(lyricsMatch[1]!));
    if (!track || track.media?.role !== 'track') fail('not-found', 'lyrics_not_found', 'No lyrics for this title');
    if (track!.genres.includes('Test Signal')) return json({ lines: [], instrumental: true, source: 'Mock' } satisfies V.TitleLyrics);
    const words = ['the tide comes in', 'over the harbour wall', 'lanterns in the window', 'a kettle on the stove', 'paper boats are sailing',
      'down the long field', 'we sing it once again', 'the morning train to wells'];
    const lines = Array.from({ length: Math.ceil((track!.durationSeconds ?? 60) / 5) }, (_, n) => ({ startMs: n * 5000,
      text: `${words[(n + track!.name.length) % words.length]![0]!.toUpperCase()}${words[(n + track!.name.length) % words.length]!.slice(1)}${n % 4 === 3 ? '' : ','}` }));
    return json({ lines, instrumental: false, source: 'Mock' } satisfies V.TitleLyrics);
  }
  if (method === 'GET' && path === '/favorites/titles' && capabilities.features.favoritesList?.available) {
    const role = url.searchParams.get('role') ?? '';
    const liked = [...mediaGroups.tracks, ...mediaGroups.albums, ...mediaGroups.artists].filter(t => t.watch?.favorite && (!role || t.media?.role === role));
    const likedAt = new Date(Date.parse(process.env.VELA_MOCK_NOW ?? '') || Date.now()).toISOString();
    const items = liked.map(t => ({ id: t.id, kind: 'title' as const, title: present(g, t), likedAt, receiptToken: receipt(g, `favorites:${t.id}`) }));
    return json({ ...page(items, url, g, `favorites:${role}:${mac(JSON.stringify(liked.map(t => t.id)))}`, 100), total: items.length } satisfies V.FavoriteTitlesPage);
  }
  if (method === 'GET' && path === '/events') return serverEvents(req, () => !g.revoked && g.expires > Date.now());
  if (method === 'POST' && path === '/auth/revoke') { if (body.refreshToken !== g.refresh) fail('auth', 'invalid_refresh', 'Refresh does not belong to this grant'); revoke(g); return json({ accepted: true }); }
  if (method === 'GET' && path === '/bootstrap') {
    if (bootstrapDelayMs) await Bun.sleep(bootstrapDelayMs);
    const heroes = featuredSources.map(({ rowId, ...hero }): V.Hero => ({ ...hero, ...(longHeroes ? { title: { ...hero.title, name: `${hero.title.name}: The Long Way Round to the Edge of Everything` } } : {}), receiptToken: receipt(g, `hero:${hero.title.id}`), previewOnFocus: rows.find(row => row.id === rowId)?.previewOnFocus === true }));
    const firstPage = new URL(url); firstPage.search = '';
    // Plugin screens and surfaces, only for a client that says its renderer (screens.ts).
    const { navigation, surfaces, homeRows: surfaceRows } = screensBootstrap(req, g.viewer.id);
    const stale = faults.bootstrapStaleReads > 0 && rowSnapshot > 1;
    const snapshot = stale ? rowSnapshot - 1 : rowSnapshot;
    if (stale) faults.bootstrapStaleReads--;
    const home = homeRows(g, firstPage, surfaceRows, snapshot);
    const bootstrap = { viewer, capabilities, defaultSkinId: capabilities.defaultSkinId, heroes, rows: home.items, ...(home.nextCursor ? { nextCursor: home.nextCursor } : {}), ...(navigation ? { navigation } : {}), ...(surfaces ? { surfaces } : {}) } satisfies V.Bootstrap;
    return stale ? json(bootstrap) : cached(req, bootstrap, `${g.id}:${req.headers.get('x-vela-screen-renderer') ?? ''}:${req.headers.get('x-vela-screen-preview') ?? ''}`);
  }
  if (method === 'GET' && path === '/rows') {
    const placement = url.searchParams.get('placement') ?? 'home';
    const libraryId = url.searchParams.get('libraryId');
    if (url.searchParams.getAll('libraryId').length > 1 || libraryId && placement !== 'library') fail('request', 'invalid_request', 'Invalid library placement');
    if (libraryId && !libraries.some(l => l.id === libraryId)) fail('not-found', 'not_found', 'Library not found');
    if (libraryId && isMedia(libraryId)) { const shelves = mediaLibraryRows(g, libraryId); return cached(req, page(shelves.map(row => boundRow(g, row)), url, g, `library-rows:${libraryId}:${mac(JSON.stringify(shelves))}`), g.id); }
    if (libraryId && process.env.VELA_MOCK_OLD !== '1') {
      if (labPreset) { const first = new URL(url); first.search = ''; return cached(req, page(labRows.map(row => minted(homeRow(g, row, first), `library.${libraryId}.${row.id}`)), url, g, `library-rows:${libraryId}`), `${g.id}:${rowSnapshot}`); }
      const ids = new Set(libraryEntries(libraryId).filter(e => e.kind === 'title').map(e => e.kind === 'title' ? e.title.id : ''));
      const matches = rows.map(row => ({ ...row, items: row.items.filter(e => e.kind === 'title' && ids.has(e.title.id)) })).filter(row => row.items.length);
      const paging = new URL(url);
      if (process.env.VELA_MOCK_LIBRARY_ROW_PAGE) paging.searchParams.set('limit', process.env.VELA_MOCK_LIBRARY_ROW_PAGE);
      return cached(req, page(matches.map(row => minted(boundRow(g, row), `library.${libraryId}.${row.id}`)), paging, g, `library-rows:${libraryId}`), `${g.id}:${rowSnapshot}`);
    }
    if (!['home','detail','library'].includes(placement)) fail('request', 'invalid_placement', 'Unknown row placement');
    if (placement === 'detail') {
      const media = findMediaTitle(url.searchParams.get('titleId') ?? '');
      if (media) {
        // An artist page's top tracks: purpose 'recommendation', id suffix ':top'.
        const top = media.media?.role === 'artist' ? titleRow(`${media.id}:top`, 'Top tracks', 'recommendation', 'square',
          mediaGroups.tracks.filter(track => track.showId === media.id && (track.media?.index ?? 0) % 3 === 1).slice(0, 5)) : [];
        return cached(req, { items: top.map(row => boundRow(g, row)), continuation: 'exhausted' } satisfies V.Page<V.Row>, g.id);
      }
      if (!detail(url.searchParams.get('titleId') ?? '')) fail('not-found', 'title_not_found', 'Detail title not found');
      return cached(req, { items: [], continuation: 'exhausted' }, g.id);
    }
    return cached(req, placement === 'home' ? homeRows(g, url, screensBootstrap(req, g.viewer.id).homeRows) : page([], url, g, `rows:${placement}`), `${g.id}:${req.headers.get('x-vela-screen-renderer') ?? ''}`);
  }
  const collectionMatch = /^\/collections\/([^/]+)$/.exec(path);
  if (method === 'GET' && collectionMatch) {
    const row = rows.find(r => r.id === collectionMatch[1]);
    if (!row) fail('not-found', 'collection_not_found', 'Collection not found');
    return cached(req, { collection: { id: row.id, kind: 'collection', name: row.name, artwork: [] }, ...page(boundRow(g, row).items, url, g, `collection:${row.id}`) } satisfies V.CollectionContents, g.id);
  }
  const rowMatch = /^\/rows\/([^/]+)$/.exec(path);
  if (method === 'GET' && rowMatch) {
    const r = mintedRow(decodeURIComponent(rowMatch[1]!), [...progressRows(), ...rows, ...mediaHomeRows(g), ...(labPreset ? [...labRows, ...labHomeRows] : [])]);
    return cached(req, minted(homeRow(g, r, url)), `${g.id}:${rowSnapshot}`);
  }
  const versionsMatch = /^\/titles\/([^/]+)\/versions(?:\/(choice))?$/.exec(path);
  if (versionsMatch) {
    if (capabilities.features.versions?.available !== true) fail('policy', 'feature_unavailable', 'Versions are unavailable');
    const result = versionsFor(versionsMatch[1], g.id);
    if (method === 'GET' && !versionsMatch[2]) return json(result);
    if (method === 'DELETE' && versionsMatch[2] === 'choice') {
      clearedVersionChoices.add(`${g.id}:${versionsMatch[1]}`);
      const next = versionsFor(versionsMatch[1], g.id);
      return json({ ...next, cleared: true });
    }
  }
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
  const mediaMatch = /^\/titles\/([^/]+)(?:\/(children|extras|watch|read|reading-progress))?$/.exec(path);
  const mediaItem = mediaMatch ? findMediaTitle(decodeURIComponent(mediaMatch[1]!)) : undefined;
  if (mediaMatch && mediaItem) {
    const action = mediaMatch[2], viewerId = g.viewer.id;
    if (method === 'GET' && !action) {
      const d = mediaDetail(mediaItem.id)!;
      return cached(req, { ...d, title: present(g, d.title), ...(d.seasons ? { seasons: d.seasons.map(t => present(g, t)) } : {}), ...(d.episodes ? { episodes: d.episodes.map(t => present(g, t)) } : {}) } satisfies V.TitleDetail, g.id);
    }
    // Ordered children: an artist's albums, an album's tracks by disc then index, a series' books, an audiobook's parts.
    // ?role= (or ?level=) pages within one child level: an artist's albums apart from its concerts.
    if (method === 'GET' && action === 'children') return cached(req, page(childrenFor(mediaItem.id, url).map(t => present(g, t)), url, g, `children:${mediaItem.id}:${url.searchParams.get('role') ?? url.searchParams.get('level') ?? ''}`), g.id);
    if (method === 'GET' && action === 'extras') return cached(req, { items: [] } satisfies V.ExtrasResponse, g.id);
    if (method === 'POST' && action === 'watch') {
      mediaItem.watch ??= { positionSeconds: 0, played: false, favorite: false, watchlisted: false };
      for (const key of ['played', 'favorite', 'watchlisted'] as const) if (typeof body[key] === 'boolean') mediaItem.watch[key] = body[key];
      // Played/unplayed on a book is the viewer's own reading state; unplayed clears the progress.
      if (mediaItem.media?.reading && typeof body.played === 'boolean') setReadingState(viewerId, mediaItem.id, body.played ? { ...readingState(viewerId, mediaItem), played: true } : { played: false });
      if (body.continueWatching === false) removedContinue.add(mediaItem.id);
      if (typeof body.played === 'boolean' || body.continueWatching === false) feedChanged();
      viewer.policyRevision = `mock-${++viewerRevision}`;
      return json({ accepted: true } satisfies V.Ack);
    }
    if (method === 'POST' && (action === 'read' || action === 'reading-progress') && !mediaItem.media?.reading) fail('request', 'not_readable', 'Only books open in the reader');
    if (method === 'POST' && action === 'read') {
      const grant = await issueReadGrant(g.id, mediaItem, readingState(viewerId, mediaItem).reading);
      if (!grant) fail('source', 'media_not_generated', `Run bun ${bookGenerator} first`);
      return json(grant);
    }
    if (method === 'POST' && action === 'reading-progress') {
      const { locator, fraction, label, observedAt } = body as Partial<V.ReadingProgressRequest>;
      if (typeof locator !== 'string' || !locator || locator.length > 4096 || typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction < 0 || fraction > 1
        || (label !== undefined && (typeof label !== 'string' || label.length > 200))
        || (observedAt !== undefined && (typeof observedAt !== 'string' || !Number.isFinite(Date.parse(observedAt))))) fail('request', 'invalid_reading_progress', 'locator (1–4096 chars), fraction 0–1, an optional label up to 200 chars and an optional RFC3339 observedAt are required');
      const previous = readingState(viewerId, mediaItem);
      const updatedAt = readingWriteTime(previous.reading?.updatedAt, observedAt, Date.now());
      // An older observed write (a device syncing late) is acknowledged and dropped.
      if (updatedAt) setReadingState(viewerId, mediaItem.id, { reading: { locator, fraction, ...(label ? { label } : {}), updatedAt }, played: previous.played || fraction >= 0.98 });
      viewer.policyRevision = `mock-${++viewerRevision}`;
      return json({ accepted: true } satisfies V.Ack);
    }
  }
  if (titleMatch) {
    const requestedSeason = /^season-meridian-(\d+)$/.exec(titleMatch[1]);
    const requestedSeasonNumber = Number(requestedSeason?.[1]);
    const fixtureSeason = requestedSeasonNumber > 0 && requestedSeasonNumber <= mockSeasonCount
      ? detail('season-meridian-1')
      : undefined;
    const raw = detail(titleMatch[1]) ?? (fixtureSeason ? {
      ...fixtureSeason,
      title: {
        ...fixtureSeason.title,
        id: titleMatch[1],
        name: ['Borneo', 'The Australian Outback', 'Africa'][requestedSeasonNumber - 1] ?? `Season ${requestedSeasonNumber}`,
        seasonNumber: requestedSeasonNumber,
      },
      episodes: fixtureSeason.episodes?.map(episode => ({
        ...episode,
        id: `episode-${requestedSeasonNumber}-${episode.episodeNumber}`,
        seasonNumber: requestedSeasonNumber,
      })),
    } : undefined);
    if (!raw) fail('not-found', 'title_not_found', 'Title not found');
    const scaledSeasons = raw.title.kind === 'show' && mockSeasonCount > 0
      ? Array.from({ length: mockSeasonCount }, (_, index) => ({
          ...raw.title,
          id: `season-meridian-${index + 1}`,
          kind: 'season' as const,
          name: ['Borneo', 'The Australian Outback', 'Africa'][index] ?? `Season ${index + 1}`,
          showId: raw.title.id,
          showName: raw.title.name,
          seasonNumber: index + 1,
        }))
      : raw.seasons;
    const mockTitle = process.env.VELA_MOCK_RAW_RATING === '1' && raw.title.id === 'title-1-1'
      ? { ...raw.title, rating: 'gb/U' }
      : raw.title;
    const d = { ...raw, title: mockTitle, seasons: scaledSeasons, cast: raw.cast.map(person => person.artwork ? { ...person, artwork: personArtwork(g) } : person) };
    if (method === 'POST' && titleMatch[2] === 'watch') {
      const t = allTitles.find(t => t.id === titleMatch[1])!;
      t.watch ??= { positionSeconds: 0, played: false, favorite: false, watchlisted: false };
      for (const key of ['played','favorite','watchlisted'] as const) if (typeof body[key] === 'boolean') t.watch[key] = body[key];
      if (body.continueWatching === false) removedContinue.add(t.id);
      if (typeof body.played === 'boolean' || body.continueWatching === false) feedChanged();
      viewer.policyRevision = `mock-${++viewerRevision}`;
      return json({ accepted: true });
    }
    if (method === 'GET' && !titleMatch[2] && coldTitle(d.title.id)) return partial({ ...d, extras: [], pending: ['extras'], refreshAfterMs: 2000 });
    if (method === 'GET') return cached(req, titleMatch[2] === 'children' ? page(d.seasons ?? d.episodes ?? [], url, g, d.title.id) : titleMatch[2] === 'extras' ? { items: d.extras } : d, g.id);
  }
  if (method === 'POST' && path === '/search') {
    if (typeof body.query !== 'string' || !Number.isInteger(body.generation) || !['fast', 'descriptive', ...(capabilities.features.unifiedSearch ? ['auto'] : [])].includes(body.mode)) fail('request', 'invalid_search', 'Query, generation and mode required');
    if (body.sort && !capabilities.searchSorts!.some(s => s.id === body.sort)) fail('request', 'invalid_sort', 'Invalid sort');
    if (body.direction !== undefined && !['asc', 'desc'].includes(body.direction)) fail('request', 'invalid_direction', 'Invalid direction');
    if (body.kind !== undefined && !capabilities.searchKinds!.some(k => (typeof k === 'string' ? k : k.id) === body.kind)) fail('request', 'invalid_kind', 'Invalid kind');
    if (body.library !== undefined && !visibleLibraries.some(l => l.id === body.library)) fail('request', 'invalid_library', 'Invalid library');
    // A media library's search reaches every level in it (an artist's albums and their tracks), as
    // Ether's does; leaves (tracks, parts, episodes) are searched only within a library.
    const mediaScope = !!body.library && isMedia(body.library);
    const libraryIds = body.library ? new Set<string>() : undefined;
    const within = (id: string): void => { if (!libraryIds || libraryIds.has(id)) return; libraryIds.add(id); if (mediaScope) for (const child of mediaChildren(id)) within(child.id); };
    if (body.library) for (const entry of libraryEntries(body.library)) if (entry.kind === 'title') within(entry.title.id);
    const terms = body.query.toLowerCase().split(/\s+/).filter(Boolean);
    const searchable = [...titles, ...(mediaEnabled ? [...mediaGroups.artists, ...mediaGroups.albums, ...(levelsEnabled ? mediaGroups.concerts : []), ...mediaGroups.series, ...mediaGroups.books, ...mediaGroups.audiobooks, ...mediaGroups.shows, ...(mediaScope ? [...mediaGroups.tracks, ...mediaGroups.parts, ...mediaGroups.episodes] : [])].filter(t => !isHiddenDuplicateTitle(g.viewer.id, t.id)).map(t => present(g, t)) : [])];
    // Within a media library a title is found by the people it credits too (an artist's songs, an author's books).
    const named = (t: V.Title) => mediaScope ? `${t.name} ${(t.media?.credits ?? []).map(credit => credit.name).join(' ')} ${(t.media?.parents ?? []).filter(parent => parent.role === 'artist').map(parent => parent.name).join(' ')}` : t.name;
    const found = (byName: boolean) => searchable.filter(t => (!libraryIds || libraryIds.has(t.id)) && (!body.kind || t.kind === body.kind) && terms.every((term: string) => (byName ? named(t) : `${t.name} ${t.summary} ${t.genres.join(' ')}`).toLowerCase().includes(term)));
    // Auto (unified search): titles by name; description matches only when no name matches.
    const byName = body.mode === 'descriptive' ? [] : found(true);
    const items = body.mode === 'fast' || byName.length ? byName : found(false);
    const match = body.mode !== 'auto' ? undefined : byName.length ? 'title' : items.length ? 'description' : 'none';
    if (body.sort && body.sort !== 'relevance') items.sort((a, b) => (body.direction === 'desc' ? -1 : 1) * (body.sort === 'title' ? a.name.localeCompare(b.name) : (a.year ?? 0) - (b.year ?? 0)));
    const paging = new URL(url); if (body.cursor) paging.searchParams.set('cursor', body.cursor); if (body.limit) paging.searchParams.set('limit', String(body.limit));
    const titlePage = page(items, paging, g, `search:${body.mode}:${body.query}:${body.sort ?? ""}:${body.direction ?? ""}:${body.kind ?? ""}:${body.library ?? ""}`);
    const limit = Number(paging.searchParams.get('limit') ?? 50);
    const matches = (text: string) => terms.length > 0 && terms.every((term: string) => text.toLowerCase().includes(term));
    const now = Date.now();
    const programmes = body.mode !== 'descriptive' && !body.library ? guide(now, now + 86400000, []).filter(p => matches(`${p.name} ${p.episodeTitle ?? ''} ${p.summary ?? ''} ${(p.genres ?? []).join(' ')}`)).slice(0, limit) : [];
    const parentIds = new Set(programmes.map(p => p.channelId));
    const live = body.mode !== 'descriptive' && !body.library ? {
      channels: channels.filter(c => matches(`${c.number} ${c.name} ${c.group ?? ''} ${(c.guides ?? []).map(g => g.name).join(' ')}`)).slice(0, limit),
      programmes,
      programmeChannels: channels.filter(c => parentIds.has(c.id)),
    } : undefined;
    return json({ ...titlePage, query: body.query, generation: body.generation, ...(live ? { live } : {}), ...(match ? { match, state: 'complete' as const } : {}) } satisfies V.SearchResponse);
  }
  if (path.startsWith('/search/ai')) fail('policy', 'feature_unavailable', 'AI search unavailable');
  if (method === 'POST' && path === '/interactions') {
    if (!Array.isArray(body.interactions) || body.interactions.length > 100 || body.interactions.some((i: V.Interaction) => !validReceipt(g, i.receiptToken) || !['visible', 'selected', 'played'].includes(i.kind))) fail('request', 'invalid_receipt', 'Invalid interaction receipt');
    return json({ accepted: true });
  }
  const screens = await screensApi(req, url, method, path, g.viewer.id, () => !g.revoked && g.expires > Date.now(), fail, body);
  if (screens) return screens;
  if (sportsEnabled && method === 'POST' && path === '/multiview') {
    if (!body.device?.id) fail('request', 'device_required', 'Device required');
    return json(createGroup(g.id));
  }
  const multiviewMatch = /^\/multiview\/([^/]+)$/.exec(path);
  if (sportsEnabled && method === 'DELETE' && multiviewMatch) {
    endGroup(g.id, decodeURIComponent(multiviewMatch[1]!), fail, id => { const s = sessions.get(id); if (s && s.plan.state !== 'ended') applyCommand(s, { kind: 'stop', idempotencyKey: 'multiview-end', sourceGeneration: s.plan.sourceGeneration, seekGeneration: s.plan.seekGeneration }); });
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
      channels: ids.map(channelId => ({ channelId, state: unavailable.has(channelId) ? 'unavailable' : 'ready', programmes: unavailable.has(channelId) ? [] : programmes.filter(p => p.channelId === channelId),
        ...(channelById.get(channelId)?.archiveDays ? { archiveDays: channelById.get(channelId)!.archiveDays } : {}) })),
    };
    return cached(req, answer, g.id);
  }
  if (method === 'POST' && path === '/playback') {
    if (body.audioTrackId !== undefined || body.subtitleTrackId != null) fail('policy', 'feature_unavailable', 'Initial track selection is unavailable; use native HLS audio and sidecar subtitles');
    if (!body.client || [body.titleId, body.channelId, body.extraId].filter(Boolean).length !== 1) fail('request', 'invalid_target', 'Exactly one playback target required');
    const mediaTarget = body.titleId ? findMediaTitle(body.titleId) : undefined;
    // A video child (a concert) plays through the ordinary video path, whatever its library holds.
    const videoChild = mediaTarget && levelsEnabled && isVideoChild(mediaTarget) ? mediaTarget : undefined;
    const listening = videoChild ? undefined : mediaTarget;
    if (listening) {
      const source = audioSourceFor(listening.id);
      if (!source) fail('request', 'not_playable', listening.media?.reading ? 'Books open with POST /titles/:id/read' : 'Select a track, audiobook or part to play');
      if (faults.capacityExhausted) fail('capacity', 'capacity_exhausted', 'Mock capacity exhausted');
      if (body.positionSeconds !== undefined && (!Number.isFinite(body.positionSeconds) || body.positionSeconds < 0 || body.positionSeconds > source.durationSeconds)) fail('request', 'invalid_position', `Position must be 0–${source.durationSeconds}`);
      const faulted = startFault(g, body, 'audioStartPending');
      if (faulted) return json(faulted);
      const s = await createAudioSession(g.id, body, listening);
      if (!s) fail('source', 'media_not_generated', `Run bun ${musicGenerator} first`);
      return json(s.plan);
    }
    const channel = channels.find(c => c.id === body.channelId);
    const title = videoChild ?? allTitles.find(t => t.id === body.titleId), extra = extras.find(e => e.id === body.extraId);
    if (!title && !extra && !channel) fail('not-found', 'title_not_found', 'Playback target not found');
    // VELA_MOCK_DOWN_CHANNELS (ids or numbers): channels whose provider is down, refused as final the way a lab's broken tuner is.
    if (channel && (process.env.VELA_MOCK_DOWN_CHANNELS ?? '').split(',').some(down => down && (down === channel.id || down === String(channel.number)))) fail('source', 'network', 'The connection to the Live TV provider failed.', {}, 503);
    if (title && !['movie', 'episode'].includes(title.kind)) fail('request', 'not_playable', 'Select an episode to play');
    if (title && !channel && !extra) { const faulted = startFault(g, body, 'videoStartPending'); if (faulted) return json(faulted); }
    // A programme from the channel's archive (spec C3): an ended one, or the one on air from its start.
    const archive = channel && (body.programmeId || body.startAt) ? archiveRange(body, channel, id => {
      const start = Number(id.slice(id.lastIndexOf(':') + 1));
      return Number.isFinite(start) ? guide(start - 1, start + 1, [channel.id]).find(p => p.id === id) : undefined;
    }, fail) : undefined;
    const versionData = title && !videoChild ? versionsFor(title.id, g.id) : undefined;
    const requestedVersion = body.versionId ? versionData?.versions.find(version => version.id === body.versionId) : undefined;
    if (body.versionId && !requestedVersion) fail('request', 'invalid_version', 'Unknown version');
    if (requestedVersion?.availability === 'unavailable') fail('source', 'version_unavailable', requestedVersion.note || 'Version unavailable', {}, 409);
    if (body.multiview !== undefined) admitTile(g.id, body.multiview, channel?.id, id => { const s = sessions.get(id); return !!s && s.plan.state !== 'ended'; }, fail);
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
    const selectedVersionId = body.versionId ?? versionData?.selectedVersionId;
    const s = await createSession(g.id, body, pending, versionData ? { ...versionData, selectedVersionId } : undefined);
    if (pending && !s.plan.paths.some(p => p.id === pending.pathId)) { sessions.delete(s.plan.sessionId); fail('source', 'media_not_generated', 'Requested MSE fixture is unavailable'); }
    if (body.multiview && channel) { placeTile(body.multiview, channel.id, s.plan.sessionId); capTileHeight(s.plan, body.multiview); }
    if (channel) s.liveEvent = liveEventOnChannel(channel.id);
    if (channel && archive) {
      archivePlan(s.plan, (s.plan.paths[0]?.url ?? '').replace(/\/live\/master\.m3u8$/, ''), channel, archive);
      // Only the programme on air is the game on air.
      if (!archive.airing) s.liveEvent = null;
    }
    return json(s.plan);
  }
  const sheet = /^\/sessions\/([^/]+)\/trickplay\/([^/]+)\/([^/]+)\.jpg$/.exec(path);
  if (sheet && method === 'GET') return trickplaySheet(currentSession(sheet[1]!, g).plan, sheet[2]!, sheet[3]!, req);
  const subtitles = /^\/sessions\/([^/]+)\/subtitles\/([^/]+)$/.exec(path);
  if (subtitles) {
    if (!subtitleSearchEnabled) fail('policy', 'feature_unavailable', 'Subtitle search is unavailable');
    const s = currentSession(subtitles[1]!, g);
    if (s.plan.state === 'ended') fail('conflict', 'session_ended', 'Session ended');
    if (method === 'GET' && subtitles[2] === 'search') {
      const language = url.searchParams.get('language');
      if (language !== null && !subtitleLanguages.includes(language)) fail('request', 'invalid_language', 'Not a searchable subtitle language');
      return json(searchSubtitles(s.plan, language));
    }
    if (method === 'POST') {
      const offerId = decodeURIComponent(subtitles[2]!);
      const before = JSON.stringify([s.plan.subtitleTracks.length, s.plan.selectedSubtitleTrackId]);
      const reply = downloadSubtitle(s.plan, `/sessions/media/${s.plan.sessionId}/${s.mediaToken}`, offerId);
      if (!reply) fail('not-found', 'offer_not_found', 'Search again: that subtitle is no longer offered');
      if (!('sessionId' in reply)) return Response.json(reply, { status: 202, headers: { 'Cache-Control': 'no-store' } });
      if (JSON.stringify([s.plan.subtitleTracks.length, s.plan.selectedSubtitleTrackId]) !== before) publish(s);
      return json(s.plan);
    }
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
      if (body.kind === 'version') {
        if (!s.plan.titleId || !s.plan.versions) fail('policy', 'feature_unavailable', 'Versions are unavailable for this session');
        const version = s.plan.versions.find(version => version.id === body.versionId);
        if (!version) fail('request', 'invalid_version', 'Unknown version');
        if (version.availability === 'unavailable') fail('source', 'version_unavailable', version.note || 'Version unavailable', {}, 409);
        const prepareKey = `${s.plan.sessionId}:${version.id}`;
        if (version.availability === 'fetch' && !preparedVersions.has(prepareKey)) {
          preparedVersions.add(prepareKey);
          fail('source', 'version_preparing', 'Version is preparing', { retry: { allowed: true, afterSeconds: 1, maxAttempts: 3 } }, 503);
        }
      }
      if (body.kind === 'replan') {
        if (!Number.isFinite(body.maxHeight) || body.maxHeight <= 0) fail('request', 'invalid_command', 'maxHeight must be a positive number');
        return json(replanTile(s.plan, body.maxHeight));
      }
      if (!['seek', 'pause', 'resume', 'stop', 'tracks', 'switch', 'version', 'goLive'].includes(body.kind)) fail('request', 'invalid_command', 'Unknown command');
      checkTimeshiftCommand(s.plan, body, fail);
      if (body.kind === 'goLive') { goLive(s.plan, (s.plan.paths[0]?.url ?? '').replace(/\/live\/(archive\/[^/]+\/[^/]+\/)?master\.m3u8$/, '')); publish(s); return json(s.plan); }
      const duration = s.plan.durationSeconds ?? fixtureDurationSeconds;
      if (body.kind === 'seek' && !s.plan.live && (!Number.isFinite(body.positionSeconds) || body.positionSeconds < 0 || body.positionSeconds > duration)) fail('request', 'invalid_position', `Position must be 0–${duration}`);
      if (body.kind === 'tracks' && !sidecarFixture.enabled) fail('policy', 'feature_unavailable', 'Changing active tracks needs a new source');
      if (body.kind === 'switch') { const p = s.plan.paths.find(p => p.id === body.pathId); if (!p) fail('not-found', 'path_not_found', 'Unknown path'); if (p.kind === 'transcode' && faults.capacityExhausted) fail('capacity', 'capacity_exhausted', 'Mock capacity exhausted'); if (p.kind === 'transcode' && faults.fallbackUnavailable) fail('source', 'fallback_unavailable', 'Fallback unavailable'); if (!sidecarFixture.enabled && !p.boundaries.some(b => b.atSeconds === body.atSeconds && (!s.plan.selectedAudioTrackId || b.audioTrackIds.includes(s.plan.selectedAudioTrackId)) && (!s.plan.selectedSubtitleTrackId || b.subtitleTrackIds.includes(s.plan.selectedSubtitleTrackId)))) fail('conflict', 'unsafe_boundary', 'No proven switch boundary'); }
      if (body.kind === 'stop') { recordPlayback(s, false); lastStopped.set(s.owner, s.plan.sessionId); }
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
    if (url.pathname === '/__admin/original') {
      // Format-matrix qualification: {"name":"hevc-hdr10-eac3-5.1.mkv"} or {"name":null}; the file is probed as Ether would,
      // and an optional "video" object overrides the probe's originalVideo facts.
      if (req.method === 'POST') { const data = await req.json(); if (data.name !== null && (typeof data.name !== 'string' || !originalFixtureName.test(data.name))) return Response.json({ error: 'invalid_name' }, { status: 400 });
        if (data.name !== null && !await Bun.file(`${formatsRoot}/${data.name}`).exists()) return Response.json({ error: 'not_found' }, { status: 404 });
        Object.assign(originalFixture, { name: data.name, video: undefined, audio: undefined }, data.name === null ? {} : await probeOriginalFixture(data.name));
        // Facts ffprobe cannot see in a raw-muxed fixture, such as a profile 7 Dolby Vision record.
        if (originalFixture.video && data.video && typeof data.video === 'object') Object.assign(originalFixture.video, data.video);
        originalFixture.selectSubtitle = data.selectSubtitle === true; }
      return json(originalFixture);
    }
    if (url.pathname === '/__admin/sidecar') {
      if (req.method === 'POST') { const data = await req.json(); if (typeof data.enabled === 'boolean') sidecarFixture.enabled = data.enabled;
        if (typeof data.selected === 'boolean') sidecarFixture.selected = data.selected; if (typeof data.pathId === 'string') sidecarFixture.pathId = data.pathId; }
      return json(sidecarFixture);
    }
    // A mid-stream failover (Ether W380): each open session with versions moves to its next playable
    // release and publishes a plan of a higher revision naming it (playingVersionId, playingLabel).
    if (req.method === 'POST' && url.pathname === '/__admin/failover') {
      const moved = [...sessions.values()].filter(s => s.plan.state !== 'ended' && s.plan.versions?.length && failover(s));
      return json(moved.map(s => ({ sessionId: s.plan.sessionId, revision: s.plan.revision, playingVersionId: s.plan.playingVersionId, playingLabel: s.plan.playingLabel })));
    }
    // A new revision of every open session's plan for the same source, as a server sends for any update; with
    // {"selectedSubtitleTrackId": id|null}, one in which the server changed the selected subtitle itself.
    if (req.method === 'POST' && url.pathname === '/__admin/revise') {
      const data = await req.json().catch(() => ({}));
      const revised = [...sessions.values()].filter(s => s.plan.state !== 'ended');
      for (const s of revised) {
        if (data.selectedSubtitleTrackId === null || s.plan.subtitleTracks.some(t => t.id === data.selectedSubtitleTrackId)) s.plan.selectedSubtitleTrackId = data.selectedSubtitleTrackId;
        publish(s);
      }
      return json(revised.map(s => ({ sessionId: s.plan.sessionId, revision: s.plan.revision, sourceGeneration: s.plan.sourceGeneration })));
    }
    if (req.method === 'GET' && url.pathname === '/__admin/catch-up-fixture') return json(archiveFixture);
    if (req.method === 'GET' && url.pathname === '/__admin/faults') return json(faults);
    if (req.method === 'POST' && url.pathname === '/__admin/faults') { const data = await req.json(); for (const key of Object.keys(faults) as (keyof typeof faults)[]) if (key in data) { if (typeof faults[key] === 'boolean') (faults as any)[key] = data[key] === true; else if (Number.isFinite(data[key]) && data[key] >= 0) (faults as any)[key] = Math.min(data[key], 60_000_000); } if ('refreshFailSeconds' in data) refreshFailureUntil = Date.now() + faults.refreshFailSeconds * 1000; if ('refreshAbandonMs' in data) { abandonedRefreshKeys.clear(); refreshAbandonArmed = faults.refreshAbandonMs > 0; } return json(faults); }
    if (req.method === 'POST' && url.pathname === '/__admin/sports') return json(sportsAdmin(await req.json()));
    if (req.method === 'POST' && url.pathname === '/__admin/screens') return json(screensAdmin(await req.json()));
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
    if (s.plan.media === 'audio') return serveAudioSession(req, s, media[3]);
    const found = /^found-subtitles\/([^/]+)\.vtt$/.exec(media[3]);
    if (found) {
      const vtt = foundSubtitleVtt(s.plan.sessionId, decodeURIComponent(found[1]!));
      return vtt ? new Response(vtt, { headers: { 'Content-Type': 'text/vtt; charset=utf-8', 'Cache-Control': 'private, no-store' } }) : new Response('Not found', { status: 404 });
    }
    const selected = s.plan.paths.find(path => path.id === s.plan.selectedPathId);
    const originalRead = req.method === 'GET' && selected?.original === true && selected.url?.endsWith(`/${media[3]}`);
    if (originalRead && (s.plan.sourceFailure === 'version_unavailable' || faults.originalLost409 > 0)) {
      // Some native browser media loaders reopen an original with a full GET.
      // A follow-up range probe must still see the pinned original as unavailable.
      if (s.plan.sourceFailure !== 'version_unavailable') {
        faults.originalLost409--;
        originalLost(s, faults.originalLostVersionUnavailable);
      }
      return new Response('Original file is gone', { status: 409, headers: { 'X-Ether-Playback-Error': 'original_lost', 'Cache-Control': 'no-store' } });
    }
    const truncateOriginal = originalRead && req.headers.has('range') && faults.originalLostTruncate > 0;
    if (truncateOriginal) {
      faults.originalLostTruncate--;
      originalLost(s, faults.originalLostVersionUnavailable);
    }
    const response = await (media[3].startsWith('live/') ? serveLive(req, media[3].slice(5)) : serveMedia(req, media[3], truncateOriginal));
    if (req.method === 'GET' && response.status === 200 && media[3].endsWith('/init.mp4')) requestedInit(s, media[3], () => !g.revoked && g.expires > Date.now());
    return response;
  }
  // Reading grants: opaque short-lived document URLs, fetched without the bearer.
  const reading = /^\/reading\/media\/([a-f0-9]+)\/([^/]+)$/.exec(url.pathname);
  if (reading) return serveReadTicket(req, reading[1]!, reading[2]!, owner => { const g = grants.get(owner); return !!g && !g.revoked && g.expires > Date.now(); });
  // Plex Home avatars, as Ether serves them: a sealed same-server path, plain GET, no headers.
  const avatar = /^\/vela\/v0\/images\/plexavatar-([a-z0-9-]+)$/.exec(url.pathname);
  if (avatar && req.method === 'GET') return new Response(renderArtwork(`profile-${avatar[1]}`, 'avatar', 240), { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'private, no-store' } });
  const art = /^\/vela\/v0\/artwork\/([a-z0-9-]+)$/.exec(url.pathname);
  if (art && req.method === 'GET') {
    if (url.searchParams.get('kind') === 'person' || url.searchParams.has('grant')) {
      const [id, signature] = (url.searchParams.get('grant') ?? '').split('.');
      const g = grants.get(id ?? '');
      if (!g || g.revoked || g.expires <= Date.now() || signature !== mac(`${g.id}|${url.searchParams.get('kind')}|${art[1]}`)) fail('auth', 'invalid_image_grant', 'Invalid image grant');
    }
    // Only synthetic assets: no private or remotely fetched imagery.
    const width = Math.max(120, Math.min(1920, Number(url.searchParams.get('width')) || 480));
    const kind = url.searchParams.get('kind') ?? 'poster';
    return new Response((mediaEnabled ? renderCover(art[1]!, kind, width) : undefined) ?? renderArtwork(art[1]!, kind, width), { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': url.searchParams.has('grant') ? 'private, no-store' : 'public, max-age=86400' } });
  }
  const logo = req.method === 'GET' ? sportsLogo(url.pathname) : undefined;
  if (logo) return logo;
  const packFile = req.method === 'GET' ? await packAsset(url.pathname) : undefined;
  if (packFile) return packFile;
  if (!url.pathname.startsWith('/vela/v0/')) fail('not-found', 'endpoint_not_found', 'Endpoint not found');
  if (req.method !== 'POST' && req.method !== 'DELETE' && req.method !== 'PATCH' && req.method !== 'PUT') return api(req, url, undefined);
  let raw: string, body: any; try { raw = await req.text(); if (raw.length > 262144) fail('request', 'body_too_large', 'Body exceeds 256KiB'); body = JSON.parse(raw); } catch (e) { if (e instanceof Response) throw e; fail('request', 'invalid_json', 'JSON object required'); }
  if (url.pathname === '/vela/v0/live/guide/window') {
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail('request', 'invalid_json', 'JSON object required');
    return api(req, url, body);
  }
  // Plugin-screen mutations may carry the key as Ether's Idempotency-Key header (the header wins).
  const headerKey = req.headers.get('idempotency-key');
  if (headerKey && body && typeof body === 'object' && /^\/vela\/v0\/(screens|surfaces)\//.test(url.pathname)) body.idempotencyKey = headerKey;
  if (!body || typeof body.idempotencyKey !== 'string' || !body.idempotencyKey || body.idempotencyKey.length > 200) fail('request', 'idempotency_required', 'Nonempty idempotencyKey required');
  if (url.pathname !== '/vela/v0/negotiate' && !/^\/vela\/v0\/auth\/(plex(?:\/profile)?|sign-in|refresh|device(?:\/poll)?|quick-connect(?:\/poll)?|web-code\/redeem)$/.test(url.pathname)) authenticate(req);
  const identity = access.get(req.headers.get('authorization')?.replace(/^Bearer /, '') ?? '')?.id ?? body.device?.id ?? body.client?.device?.id ?? 'anonymous';
  const key = `${identity}:${url.pathname}:${body.idempotencyKey}`, old = idempotency.get(key);
  if (url.pathname === '/vela/v0/auth/refresh') await abandonedRefresh(key);
  if (old && old.expires > Date.now()) { if (old.body !== raw) fail('conflict', 'idempotency_conflict', 'Key reused with different body'); return (await old.response).clone(); }
  const response = api(req, url, body).catch(e => { if (e instanceof Response) return e; throw e; });
  const entry = { body: raw, response, expires: Date.now() + 86400000 };
  idempotency.set(key, entry);
  // Like Ether, a server-side failure (5xx) is not kept: the same key asks again once the server recovers.
  const answer = await response.catch(e => { if (idempotency.get(key) === entry) idempotency.delete(key); throw e; });
  if (answer.status >= 500 && idempotency.get(key) === entry) idempotency.delete(key);
  return answer.clone();
}
const server = Bun.serve({ hostname: process.env.VELA_MOCK_HOST ?? '127.0.0.1', port, idleTimeout: 0, async fetch(req) {
  // Delay API answers without delaying preflight or artwork.
  const delay = Number(process.env.VELA_MOCK_DELAY_MS ?? 0);
  if (req.method !== 'OPTIONS' && new URL(req.url).pathname.startsWith('/vela/v0/') && !new URL(req.url).pathname.includes('/artwork/') && Number.isFinite(delay) && delay > 0) await Bun.sleep(Math.min(delay, 30000));
  let response: Response;
  try { response = await dispatch(req); } catch (e) { if (e instanceof Response) response = e; else { console.error(e); response = Response.json({ error: { class: 'transient', code: 'internal', message: 'Internal mock error', retry: { allowed: false } } }, { status: 500 }); } }
  response.headers.set('Access-Control-Allow-Origin', origin); response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Vela-Device-Id, X-Vela-Screen-Renderer, X-Vela-Language, X-Vela-Screen-Preview, Idempotency-Key, If-None-Match, Last-Event-ID, Range, Cache-Control, Pragma'); response.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS'); response.headers.set('Access-Control-Expose-Headers', 'ETag, Retry-After, Content-Range, Content-Length, X-Ether-Live-Media-Sequence, X-Ether-Live-Window-Start'); return response;
} });
console.log(`Vela mock: ${server.url} — demo / vela`);

function facetValues(entry: V.RowEntry, field: string): string[] {
  if (entry.kind !== 'title') return [];
  if (field === 'studios') return [['Studio North', 'Pixel Workshop', 'Moonlight Pictures', 'Observatory Films'][(entry.title.year ?? 0) % 4]!];
  if (field === 'topic') return entry.title.genres;
  if (field === 'creator') return [(entry.title.year ?? 0) % 2 ? 'Studio North' : 'Pixel Workshop'];
  if ((field === 'author' || field === 'narrator') && entry.title.media) return (entry.title.media.credits ?? []).filter(credit => credit.role === field).map(credit => credit.name);
  if (field === 'length') return [(entry.title.durationSeconds ?? 0) < 6000 ? 'Under 100 min' : '100 min or longer'];
  return [];
}
