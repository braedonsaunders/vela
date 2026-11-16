import type { Answer, Sources } from '../app.contract.d.ts';
import type { AISearchJob, ClientCapabilities, Device, ServerCapabilities, Tokens, Bootstrap, LibraryBrowseQuery, LibrarySort, SortDirection, TitleKind, RowEntry } from '../wire/v0/types';
import type { ServerAdapter } from './adapter';
import { EtherAdapter, VelaError } from './adapter/ether';
import { etherConnection, nativeConnection, type Connection } from './adapter/connection';
import { probeServer } from './adapter/probe';
import { PlexLink } from './adapter/plex/link';
import { SessionCredentials } from './session';
import { ServerCredentials, ServerRegistry, type ServerKind, type ServerRecord } from './session/servers';
import { card, entry, feedRow, homeModel, detailModel } from './discovery/models';
import { guideFocus, loadGuide, liveIdentity } from './live/guide';
import { liveSearch } from './live/search';
import { artworkURL } from './discovery/artwork';
import { liveStatus, stopPlan } from './live/player';
import { InteractionQueue } from './telemetry';
import { PreviewCoordinator } from './discovery/preview';
import { sessionEvents } from './protocol/events';
import { appearanceModel, appearanceStream, builtInDocuments } from './appearance';
import { skinDoc } from './skin';
import { randomId } from './protocol/id';
import { playerPresentation } from '../player/presentation';
import { msg, setLocale, time, withLocale } from '../foundation/i18n';

export function createAnswer(devOrigin: string, MOCK: boolean, version: string): Answer {
let API = '';
let pageOriginBound = '';
function bindOrigin(pageOrigin: string): void {
  const candidate = MOCK ? devOrigin : pageOrigin;
  let parsed: URL;
  try { parsed = new URL(candidate); } catch { throw new Error('Server origin is unavailable'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('Invalid server origin');
  if (API && API !== parsed.origin) throw new Error('Server origin changed during session');
  API = parsed.origin;
}
let device: Device;
let client: ClientCapabilities;
type MediaCapabilities = Pick<ClientCapabilities, 'containers' | 'videoCodecs' | 'audioCodecs' | 'subtitleFormats' | 'hls' | 'mse' | 'originalPlayback'>;
function parseMediaCapabilities(json: string): MediaCapabilities {
  const value = JSON.parse(json) as Record<string, unknown>;
  const list = (name: string): string[] => {
    const items = value?.[name];
    if (!Array.isArray(items) || items.length > 32 || items.some(item => typeof item !== 'string' || item.length > 80)) throw new Error('Invalid media capabilities');
    return items;
  };
  if (typeof value?.hls !== 'boolean' || typeof value?.mse !== 'boolean') throw new Error('Invalid media capabilities');
  let originalPlayback: ClientCapabilities['originalPlayback'];
  if (value.originalPlayback !== undefined) {
    const original = value.originalPlayback;
    if (!original || typeof original !== 'object' || Array.isArray(original)) throw new Error('Invalid original playback capabilities');
    const candidate = original as Record<string, unknown>;
    const names = (key: string): string[] => {
      const items = candidate[key];
      if (!Array.isArray(items) || items.length > 32 || items.some(item => typeof item !== 'string' || !item || item.length > 80)) throw new Error('Invalid original playback capabilities');
      return items;
    };
    // webgpu is the web core's presenter; a native engine (tvOS) declares false and presents natively.
    if (candidate.version !== 1 || candidate.range !== true || typeof candidate.webgpu !== 'boolean') throw new Error('Invalid original playback capabilities');
    originalPlayback = { version: 1, range: true, webgpu: candidate.webgpu, demuxContainers: names('demuxContainers'), videoDecoders: names('videoDecoders'), audioDecoders: names('audioDecoders') };
  }
  // A native host names itself (tvOS: "Apple TV"); a browser leaves the web default.
  const host = value.device as Record<string, unknown> | undefined;
  if (host && typeof host === 'object' && typeof host.name === 'string' && typeof host.platform === 'string' && /^[a-z]{2,16}$/.test(host.platform) && host.name.length <= 80) hostDevice = { name: host.name, platform: host.platform };
  return { containers: list('containers'), videoCodecs: list('videoCodecs'), audioCodecs: list('audioCodecs'), subtitleFormats: list('subtitleFormats'), hls: value.hls, mse: value.mse, ...(originalPlayback ? { originalPlayback } : {}) };
}
// Idempotency keys are unique per operation without mutating the shared store,
// which would invalidate resources that read session credentials.
function key(_store: Parameters<Sources['uiBootstrap']>[1]): string { return randomId(); }
let interactions: InteractionQueue | undefined;
let ready: Promise<void> | undefined;
// A quick-connect secret stays here; the model carries an opaque handle for it.
let activeQuick: { handle: string; secret: string; serverId: string } | undefined;
let authVersion = 0;
const homeReads = new Map<string, Promise<Bootstrap>>();
const homeFailures = new Map<string, { at: number; attempt: number; allowed: boolean; delaySeconds: number; retryLimit: number }>();
const detailReads = new Map<string, Promise<[Awaited<ReturnType<ServerAdapter['detail']>>, Awaited<ReturnType<ServerAdapter['capabilities']>>]>>();
const playbackDeclarations = new Map<string, ClientCapabilities>();
const playbackReads = new Map<string, Promise<{ planJson: string; sessionId: string; preparing: boolean; errorCode: string; errorMessage: string; retryAllowed: boolean; retryAfterSeconds: number; retryLimit: number }>>();
let previewEpoch = 0;
let previews: PreviewCoordinator | undefined;
// Successful panel answers are kept only for this authentication session and display context.
const librarySnapshots = new Map<string, { version: number; locale: string; width: number; value: Awaited<ReturnType<Sources['uiLibrary']>> }>();
const libraryRequests = new Map<string, number>();
// Collection pages read so far, continued from the server's own cursor.
const collectionReads = new Map<string, Promise<{ data: Awaited<ReturnType<ServerAdapter['collection']>>; items: RowEntry[] }>>();
function resetSessionSnapshots(): void {
  authVersion++;
  homeReads.clear();
  homeFailures.clear();
  detailReads.clear();
  playbackReads.clear();
  playbackDeclarations.clear();
  previewEpoch++;
  if (previews) void previews.cancel(previewEpoch).catch(() => {});
  previews = undefined;
  previewEpoch = 0;
  librarySnapshots.clear();
  libraryRequests.clear();
  collectionReads.clear();
}
let validation: { token: string; pending: Promise<Tokens | null> } | undefined;
let redemption: { code: string; idempotencyKey: string; pending?: Promise<Tokens>; consumed: boolean } | undefined;
let negotiation: { version: number; context: string; pending: Promise<void> } | undefined;
let features: ServerCapabilities['features'] | undefined;
let appearanceAvailable = true;
let lastAppearance: Awaited<ReturnType<Sources['uiAppearance']>> | undefined;
const localAppearance = { revision: 0, defaultSkinId: 'cinematic', defaultEngineId: 'cinematic', force: false, packs: [], documents: [] };
function missingAppearance(error: unknown): boolean {
  return error instanceof VelaError && (error.status === 404 || error.detail.code === 'feature_unavailable' || error.detail.code === 'unsupported');
}
let ai: { epoch: number; generation: number; query: string; job?: AISearchJob; starting?: Promise<AISearchJob> } | undefined;
const lane = (query: string, generation: number) => ({ query, generation, items: [] as ReturnType<typeof card>[], descriptive: [] as ReturnType<typeof card>[], ai: [] as ReturnType<typeof card>[], aiStatus: 'unavailable', descriptiveStatus: 'ready', descriptiveRetryAllowed: false, descriptiveRetryAfter: 0, liveChannels: [], liveProgrammes: [] });
type Store = Parameters<Sources['uiBootstrap']>[1];

// Servers. Ether at the bound origin is the implicit default; each record has its own
// adapter, session and secrets. Every state above belongs to the selected server alone.
let registry: ServerRegistry | undefined;
const connections = new Map<string, Connection>();
let activeId = '';
// The selected server's last validation outcome, for its entry in the server list.
let health: { id: string; reachable: boolean } | undefined;
const serverNames = new Map<string, string>();
let media: { identity: string; handle: string } | undefined;
function resetServerState(): void {
  resetSessionSnapshots();
  ready = undefined; validation = undefined; negotiation = undefined; features = undefined; interactions = undefined; ai = undefined;
  activeQuick = undefined; authCapabilities = undefined; health = undefined; media = undefined;
  appearanceAvailable = true; lastAppearance = undefined;
}
let hostDevice = { name: 'Vela browser', platform: 'web' };
function deviceFor(store: Store): Device {
  if (!device) {
    let id = store.get('vela.device');
    if (!id) { id = randomId(); store.set('vela.device', id); }
    device = { id, name: hostDevice.name, platform: hostDevice.platform, appVersion: version };
  }
  return device;
}
function servers(store: Store): ServerRegistry {
  if (!API) throw new Error('Server origin is unavailable');
  return registry ??= new ServerRegistry(store, API);
}
function connection(store: Store, id: string): Connection {
  const record = servers(store).get(id);
  const known = connections.get(id);
  if (known && JSON.stringify(known.record) === JSON.stringify(record)) return known;
  if (!client) throw new Error('Media capabilities are unavailable');
  const rejected = () => { if (activeId === id) resetServerState(); };
  const made = record.kind === 'ether'
    ? (() => { const credentials = new SessionCredentials(store, deviceFor(store), () => key(store)); return etherConnection(record, new EtherAdapter(API, credentials, JSON.stringify(client), rejected), credentials); })()
    : nativeConnection(record, new ServerCredentials(store, deviceFor(store), () => key(store), id), rejected);
  connections.set(id, made);
  return made;
}
/** The selected server. A selection changed elsewhere (another tab) resets this server's state too. */
function server(store: Store, capabilities?: MediaCapabilities): Connection {
  if (!API) throw new Error('Server origin is unavailable');
  if (!client) {
    if (!capabilities) throw new Error('Media capabilities are unavailable');
    client = { device: deviceFor(store), protocolVersions: [0], ...capabilities };
  } else if (capabilities) {
    const updated = { device: deviceFor(store), protocolVersions: [0], ...capabilities };
    const context = JSON.stringify(updated);
    if (context !== JSON.stringify(client)) {
      client = updated;
      for (const known of connections.values()) known.setCapabilityContext(context);
      previews?.setClient(client);
    }
  }
  const selected = servers(store).read().selectedId;
  if (selected !== activeId) { if (activeId) resetServerState(); activeId = selected; }
  return connection(store, selected);
}
async function signedIn(conn: Connection): Promise<Tokens | null> { return conn.credentials.get(); }
function signInMessage(conn: Connection): string {
  return conn.record.kind === 'ether' ? 'Sign in to your Vela server' : msg('server.signIn', { name: serverNames.get(conn.record.id) ?? conn.record.name });
}
async function session(store: Store): Promise<Connection> {
  const conn = server(store);
  if (!ready) ready = (async () => {
    if (await signedIn(conn)) return;
    if (conn.record.kind !== 'ether' || !MOCK || store.get('vela.session') === '') throw new Error(signInMessage(conn));
    const tokens = await conn.adapter.signIn({ idempotencyKey: key(store), username: 'demo', password: 'vela', device });
    store.set('vela.session', JSON.stringify(tokens));
  })().catch(e => { ready = undefined; throw e; });
  await ready;
  // Auth can be revalidating or rotating the stored credentials while resources
  // become active. All authenticated reads must use the settled session.
  if (validation) await validation.pending;
  if (!await signedIn(conn)) throw new Error(signInMessage(conn));
  if (server(store) !== conn) throw new Error('Server changed');
  return conn;
}
async function ensureNegotiated(api: ServerAdapter, store: Store): Promise<void> {
  for (;;) {
    const version = authVersion, context = JSON.stringify(client);
    if (negotiation && (negotiation.version !== version || negotiation.context !== context)) {
      const previous = negotiation;
      try { await previous.pending; } catch { /* A newer declaration still needs its own negotiation. */ }
      if (negotiation === previous) negotiation = undefined;
      if (version !== authVersion) throw new Error('Session changed during negotiation');
      continue;
    }
    if (!negotiation) {
      const declared = client;
      const current = { version, context, pending: Promise.resolve() };
      current.pending = api.negotiate({ client: declared, idempotencyKey: key(store) }).then(() => {
        if (authVersion !== version) throw new Error('Session changed during negotiation');
      }).catch(error => { if (negotiation === current) negotiation = undefined; throw error; });
      negotiation = current;
    }
    await negotiation.pending;
    if (version !== authVersion) throw new Error('Session changed during negotiation');
    if (context === JSON.stringify(client)) return;
  }
}
let authOptions = { passwordAvailable: false, quickAvailable: false, secureOrigin: '' };
function advertisedSecureOrigin(origins: string[] | undefined, requested?: string): string {
  let page: URL;
  try { page = new URL(pageOriginBound); } catch { return ''; }
  if (page.protocol !== 'http:') return '';
  for (const origin of origins ?? []) {
    try {
      const url = new URL(origin);
      if (url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash && origin === url.origin && (!requested || requested === origin)) return origin;
    } catch { /* Ignore malformed publisher values. */ }
  }
  return '';
}
let authCapabilities: Promise<ServerCapabilities> | undefined;
/** Native servers publish no session events; the foundation polls their snapshot this often (its timer is the literal 5000 ms). */
const SNAPSHOT_POLL_SECONDS = 5;
const authReply = (conn: Connection, authenticated: boolean, error: string) => ({ authenticated, ...authOptions, error,
  serverId: conn.record.id, serverKind: conn.record.kind, revision: authVersion, pollSeconds: conn.ether ? 0 : SNAPSHOT_POLL_SECONDS });
const authModel = async (store: Store, error = '') => {
  const conn = server(store);
  if (!authCapabilities) authCapabilities = conn.adapter.capabilities().finally(() => { authCapabilities = undefined; });
  const capabilities = await authCapabilities;
  if (capabilities.server.name) serverNames.set(conn.record.id, capabilities.server.name);
  // Plex links through plex.tv in the connect flow, not the generic code screen.
  authOptions = { passwordAvailable: capabilities.features.passwordSignIn.available, quickAvailable: capabilities.features.quickConnect.available && conn.record.kind !== 'plex',
    secureOrigin: conn.ether ? advertisedSecureOrigin(capabilities.secureOrigins) : '' };
  return authReply(conn, !!await signedIn(conn), error);
};
/** Revoke a server's session, then forget it locally; a token the server already rejected needs no revocation. */
async function endSession(conn: Connection, store: Store): Promise<void> {
  const tokens = await signedIn(conn);
  if (!tokens) return;
  try { await conn.adapter.revoke({ refreshToken: tokens.refreshToken, idempotencyKey: key(store) }); }
  catch (error) { if (!(error instanceof VelaError) || error.status !== 401) throw error; }
  const latest = await signedIn(conn);
  if (latest?.accessToken === tokens.accessToken) await conn.credentials.set(null);
}
const kindLabel = (kind: ServerKind | '') => kind === 'ether' ? 'Vela' : kind === 'jellyfin' ? 'Jellyfin' : kind === 'emby' ? 'Emby' : kind === 'plex' ? 'Plex' : '';
const failure = (error: unknown, fallback: string) => error instanceof VelaError && (error.status === 401 || error.detail.class === 'auth') ? msg('server.rejected') : error instanceof Error && error.message ? error.message : fallback;
/** Race a server check against a bounded wait, so one dead server never holds the list. */
function bounded<T>(work: Promise<T>, ms = 6000): Promise<T> {
  return Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Server did not answer')), ms))]);
}
const checks = new Map<string, Promise<{ reachable: boolean; tokens: Tokens | null }>>();
function selectServer(store: Store, id: string): void {
  servers(store).select(id);
  server(store);
}
let plexLink: PlexLink | undefined;
let plexCode = '';
let jellyQuick: { handle: string; serverId: string; secret: string; expiresAt: number } | undefined;
let lastLive = { sessionId: '', reconnecting: false, delivery: 'unknown', drift: -1, driftLabel: '', canCatchUp: false };
/** The last applied skin document (raw, by path): one entry, at most a document's own limit. */
const SKIN_DOC_KEY = 'vela.skin-doc';
const SKIN_DOC_MAX = 600 * 1024;
async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
function keptSkinDoc(store: { get(key: string): string | null }, path: string): unknown {
  try {
    const kept = JSON.parse(store.get(SKIN_DOC_KEY) || 'null') as { path?: string; doc?: unknown } | null;
    return kept?.path === path ? kept.doc : undefined;
  } catch { return undefined; }
}

const sources: Sources = {
  uiGuideFocus: async ([at, epoch, localeJSON]) => guideFocus(at, epoch, localeJSON),
  uiLiveIdentity: async ([channelId, epoch, localeJSON], store) => liveIdentity((await session(store)).adapter, channelId, epoch, localeJSON),
  uiGuide: async ([epoch, day, localeJSON], store) => {
    const conn = await session(store);
    return loadGuide(conn.adapter, day, epoch, `${conn.record.id}|${JSON.stringify(await signedIn(conn))}`, await conn.images(), localeJSON);
  },
  liveEvent: async ([json, localeJSON]) => {
    const event = JSON.parse(json);
    const next = withLocale(localeJSON, () => liveStatus(event));
    if (next) lastLive = next;
    return lastLive;
  },
  uiAuth: async ([code, _epoch, isFragment, pageOrigin, mediaJSON, localeJSON], store) => {
    setLocale(localeJSON);
    bindOrigin(pageOrigin);
    pageOriginBound = pageOrigin;
    const conn = server(store, parseMediaCapabilities(mediaJSON));
    // A web-code handoff always signs in to the Ether server this page came from.
    if (code && !store.get('vela.session')) {
      const ether = connection(store, 'ether');
      let decoded = code;
      try { if (isFragment) decoded = decodeURIComponent(code); } catch { /* Preserve malformed input for the server to reject. */ }
      if (!redemption || redemption.code !== decoded) redemption = { code: decoded, idempotencyKey: key(store), consumed: false };
      const current = redemption;
      if (current.consumed) throw new Error('The sign-in link has already been used');
      const version = authVersion;
      if (!current.pending) {
        current.pending = ether.adapter.redeemWebCode({ code: decoded, device, idempotencyKey: current.idempotencyKey })
          .catch(error => { current.pending = undefined; throw error; });
      }
      const tokens = await current.pending;
      if (redemption === current && version === authVersion && !store.get('vela.session')) {
        store.set('vela.session', JSON.stringify(tokens));
        current.consumed = true;
        if (conn === ether) { resetSessionSnapshots(); ready = undefined; }
      }
    } else if (MOCK && conn.ether && store.get('vela.session') === null) await session(store);
    const stored = await signedIn(conn);
    if (stored) {
      const token = `${conn.record.id}:${stored.refreshToken || stored.accessToken}`;
      if (!validation || validation.token !== token) {
        const current = { token, pending: conn.adapter.validateSession() };
        validation = current;
        current.pending = current.pending.then(result => {
          if (validation === current && result) current.token = `${conn.record.id}:${result.refreshToken || result.accessToken}`;
          return result;
        });
      }
      try { await validation.pending; health = { id: conn.record.id, reachable: true }; }
      catch (error) {
        health = { id: conn.record.id, reachable: false };
        if (await signedIn(conn)) throw error;
        // The adapter already cleared only the rejected session and invalidated its state.
      }
    }
    return authModel(store);
  },
  signIn: async ([username, password], store) => {
    const conn = server(store);
    try {
      const tokens = await conn.adapter.signIn({ username, password, device, idempotencyKey: key(store) });
      await conn.credentials.set(tokens); resetSessionSnapshots(); ready = undefined;
      return authModel(store);
    } catch (error) { return authModel(store, conn.ether ? (error instanceof Error ? error.message : 'Sign in failed') : failure(error, 'Sign in failed')); }
  },
  startQuick: async ([_epoch, localeJSON], store) => {
    const conn = server(store);
    const grant = await conn.adapter.quickConnect({ device, idempotencyKey: key(store) });
    activeQuick = { handle: randomId(), secret: grant.secret, serverId: conn.record.id };
    return withLocale(localeJSON, () => ({ ...grant, secret: activeQuick!.handle, expiresLabel: time(Date.parse(grant.expiresAt)), status: 'pending' }));
  },
  pollQuick: async ([handle], store) => {
    const conn = server(store);
    const current = activeQuick;
    if (!handle || current?.handle !== handle || current.serverId !== conn.record.id) return authModel(store, 'Connection cancelled');
    const result = await conn.adapter.pollQuickConnect({ secret: current.secret, device, idempotencyKey: key(store) });
    if (activeQuick !== current) return authModel(store, 'Connection cancelled');
    if (result.status === 'approved') { await conn.credentials.set(result.tokens); activeQuick = undefined; resetSessionSnapshots(); ready = undefined; }
    return authModel(store, result.status === 'expired' ? 'Code expired' : result.status === 'denied' ? 'Connection denied' : '');
  },
  signOut: async (_args, store) => {
    const conn = server(store);
    const version = authVersion;
    if (await signedIn(conn)) {
      await endSession(conn, store);
      if (version === authVersion) { resetSessionSnapshots(); ready = undefined; activeQuick = undefined; ai = undefined; features = undefined; interactions = undefined; media = undefined; }
    }
    return authReply(conn, !!await signedIn(conn), '');
  },
  cancelQuick: async ([handle]) => {
    if (activeQuick?.handle === handle) activeQuick = undefined;
    return { accepted: true };
  },
  issueSecureSwitch: async ([targetOrigin, at], store) => {
    try {
      const conn = await session(store);
      if (!conn.ether) throw new Error('Secure connection unavailable');
      const api = conn.ether;
      const version = authVersion;
      const capabilities = await api.capabilities();
      const origin = advertisedSecureOrigin(capabilities.secureOrigins, targetOrigin);
      if (!origin) throw new Error('Secure connection is no longer available');
      const issued = await api.issueWebCode({ targetOrigin: origin, device, idempotencyKey: key(store) });
      if (version !== authVersion || issued.targetOrigin !== origin || !issued.code || !Number.isFinite(Date.parse(issued.expiresAt)) || Date.parse(issued.expiresAt) <= at) throw new Error('Invalid secure connection handoff');
      return { url: `${origin}/vela/#code=${encodeURIComponent(issued.code)}`, error: '' };
    } catch (error) {
      return { url: '', error: error instanceof Error ? error.message : 'Secure connection unavailable' };
    }
  },
  uiBootstrap: async ([at, attempt, localeJSON, artWidth], store) => {
    const conn = await session(store), api = conn.adapter;
    const version = authVersion;
    await ensureNegotiated(api, store);
    const failureKey = JSON.stringify([version, at, attempt]);
    const readKey = JSON.stringify([version, at, attempt, client]);
    let read = homeReads.get(readKey);
    if (!read) {
      read = (async () => {
        try {
          try { return await api.bootstrap(); }
          catch (error) {
            if (!(error instanceof VelaError) || error.status !== 409 || error.detail.code !== 'cursor_expired') throw error;
            return await api.bootstrapFresh();
          }
        } catch (error) {
          const retry = error instanceof VelaError ? error.detail.retry : undefined;
          const rawHeader = error instanceof VelaError ? Number(error.retryAfter) : 0;
          const hint = Number.isFinite(retry?.afterSeconds) ? Math.max(0, retry!.afterSeconds!) : 0;
          const delaySeconds = Math.max(1, 2 ** Math.min(attempt, 5), hint, Number.isFinite(rawHeader) ? rawHeader : 0);
          const retryLimit = Math.max(0, Math.min(2, (Number.isFinite(retry?.maxAttempts) ? Math.floor(retry!.maxAttempts!) : 3) - 1));
          homeFailures.set(failureKey, { at, attempt, allowed: retry?.allowed === true && delaySeconds <= 60, delaySeconds, retryLimit });
          throw error;
        }
      })();
      homeReads.set(readKey, read);
      if (homeReads.size > 16) homeReads.delete(homeReads.keys().next().value!);
      if (homeFailures.size > 16) homeFailures.delete(homeFailures.keys().next().value!);
    }
    const bootstrap = await read;
    if (authVersion !== version) throw new Error('Session changed during bootstrap');
    features = bootstrap.capabilities.features;
    const images = await conn.images();
    return withLocale(localeJSON, () => homeModel(bootstrap, images, at, artWidth));
  },
  uiHomeRetryPolicy: ([at, attempt]) => homeFailures.get(JSON.stringify([authVersion, at, attempt])) ?? { at, attempt, allowed: false, delaySeconds: 0, retryLimit: 0 },
  uiPreviewCancel: async ([generation]) => {
    previewEpoch = Math.max(previewEpoch, generation);
    if (previews) await previews.cancel(generation);
    return { accepted: true };
  },
  uiPreviewRequest: async ([id, generation, at], store) => {
    previewEpoch = Math.max(previewEpoch, generation);
    const version = authVersion;
    const conn = await session(store);
    // Previews are Ether broker grants; a native server advertises none.
    if (version !== authVersion || generation !== previewEpoch || !conn.ether || !features?.trailerPreview?.available)
      return { cardId: '', url: '', expiresAt: 0, retryAfterSeconds: 0, generation };
    if (!previews) previews = new PreviewCoordinator(conn.adapter, conn.record.origin, client, () => key(store));
    return previews.request(id, generation, at);
  },
  uiHomeRows: async ([cursor, heroIds, homeAt, localeJSON, artWidth], store) => {
    if (!cursor) throw new Error('Home row cursor is missing');
    const conn = await session(store);
    const data = await conn.adapter.rows({ cursor, placement: 'home' });
    const images = await conn.images();
    if (data.continuation === 'more' && (!data.nextCursor || data.nextCursor === cursor)) throw new Error('Invalid home row continuation');
    const featured = new Set(heroIds), seen = new Set<string>();
    return withLocale(localeJSON, () => ({ rows: data.items.filter(row => { if (seen.has(row.id)) return false; seen.add(row.id); return true; }).map(row => feedRow({ ...row, items: row.items.filter(item => item.kind !== 'title' || !featured.has(item.title.id)) }, images, artWidth)), nextCursor: data.nextCursor ?? '', continuation: data.continuation, requestCursor: cursor, homeAt }));
  },
  uiHomeRow: async ([rowId, cursor, heroIds, homeAt, localeJSON, artWidth], store) => {
    if (!rowId || !cursor) throw new Error('Home item cursor is missing');
    const conn = await session(store);
    const data = await conn.adapter.row(rowId, cursor, 20);
    const images = await conn.images();
    if (data.id !== rowId) throw new Error('Wrong row returned');
    if (data.continuation === 'more' && (!data.nextCursor || data.nextCursor === cursor)) throw new Error('Invalid home item continuation');
    const featured = new Set(heroIds), seen = new Set<string>();
    return withLocale(localeJSON, () => ({ rowId, items: data.items.filter(item => item.kind !== 'title' || !featured.has(item.title.id)).map(item => entry(item, images, artWidth)).filter(item => { if (seen.has(item.id)) return false; seen.add(item.id); return true; }), nextCursor: data.nextCursor ?? '', continuation: data.continuation, requestCursor: cursor, homeAt }));
  },
  uiLibraries: async (_args, store) => {
    const conn = await session(store), api = conn.adapter;
    const images = await conn.images();
    const items: { id: string; name: string; kind: string; backdrop: string }[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let n = 0; n < 100; n++) {
      const page = await api.libraries({ cursor, limit: 100 });
      items.push(...page.items.map(({ id, name, kind, artwork }) => {
        const image = artwork.find(a => a.kind === 'backdrop');
        return { id, name, kind, backdrop: image ? artworkURL(image, 960, 540, images) ?? '' : '' };
      }));
      if (page.continuation === 'exhausted') return items;
      if (page.continuation !== 'more' || !page.nextCursor || seen.has(page.nextCursor)) throw new Error('Library list is incomplete');
      cursor = page.nextCursor; seen.add(cursor);
    }
    throw new Error('Library list exceeds page limit');
  },
  uiLibrarySnapshots: ([_version, localeJSON, artWidth]) =>
    [...librarySnapshots.values()].filter(s => s.version === authVersion && s.locale === localeJSON && s.width === artWidth).map(s => s.value),
  uiLibrary: async ([id, sort, direction, kind, genre, year, played, favorite, pages, localeJSON, artWidth], store) => {
    const conn = await session(store), api = conn.adapter;
    const version = authVersion;
    const snapshotKey = JSON.stringify([id, localeJSON, artWidth]);
    const request = (libraryRequests.get(snapshotKey) ?? 0) + 1;
    libraryRequests.set(snapshotKey, request);
    const query: LibraryBrowseQuery = {
      ...(sort && sort !== 'any' ? { sort: sort as LibrarySort } : {}), ...(direction && direction !== 'any' ? { direction: direction as SortDirection } : {}),
      ...(kind && kind !== 'any' ? { kind: kind as TitleKind } : {}), ...(genre && genre !== 'any' ? { genre } : {}), ...(year > 0 && Number.isInteger(year) ? { year } : {}),
      ...(played === 'true' || played === 'false' ? { played: played === 'true' } : {}),
      ...(favorite === 'true' || favorite === 'false' ? { favorite: favorite === 'true' } : {}), limit: 100,
    };
    let result = await api.library(id, query);
    const items = [...result.items], seen = new Set<string>();
    const pageCount = Math.max(1, Math.floor(pages));
    for (let n = 1; n < pageCount && result.continuation === 'more'; n++) {
      const cursor = result.nextCursor;
      if (!cursor || seen.has(cursor)) throw new Error('Invalid library continuation');
      seen.add(cursor); result = await api.library(id, { ...query, cursor }); items.push(...result.items);
    }
    if (result.continuation === 'more' && !result.nextCursor) throw new Error('Invalid library continuation');
    const images = await conn.images();
    const model = withLocale(localeJSON, () => {
      const library = result.library, filters = library.browse.filters;
      const image = library.artwork.find(a => a.kind === 'backdrop');
      return { id: library.id, name: library.name, kind: library.kind,
        backdrop: image ? artworkURL(image, artWidth, Math.ceil(artWidth * 9 / 16), images) ?? '' : '',
        sorts: library.browse.sorts.map(s => ({ id: s.id, label: msg(`library.sort.${s.id}`), directions: s.directions })),
        sort: result.sort, direction: result.direction,
        kinds: (filters.kind ?? []).map(k => ({ id: k, label: msg(`library.kind.${k}`) })),
        genres: (filters.genre ? filters.genres ?? [] : []).map(g => ({ id: g, label: g })),
        kindFilter: query.kind ?? '', genreFilter: query.genre ?? '', playedFilter: query.played === undefined ? '' : String(query.played), favoriteFilter: query.favorite === true, yearFilter: query.year ?? 0,
        canYear: !!filters.year, canPlayed: !!filters.played, canFavorite: !!filters.favorite,
        items: items.map(item => entry(item, images, artWidth)), more: result.continuation === 'more' };
    });
    if (version !== authVersion) throw new Error('Session changed during library read');
    if (libraryRequests.get(snapshotKey) === request) {
      librarySnapshots.delete(snapshotKey);
      librarySnapshots.set(snapshotKey, { version, locale: localeJSON, width: artWidth, value: model });
      if (librarySnapshots.size > 60) librarySnapshots.delete(librarySnapshots.keys().next().value!);
    }
    return model;
  },
  uiCollection: async ([id, pages, localeJSON, artWidth], store) => {
    const conn = await session(store);
    const version = authVersion, wanted = Math.max(1, Math.min(50, Math.floor(pages)));
    // Each further page continues from the server's cursor; a page already read is not asked again.
    let read: Promise<{ data: Awaited<ReturnType<ServerAdapter['collection']>>; items: RowEntry[] }> | undefined;
    for (let page = 1; page <= wanted; page++) {
      const cacheKey = JSON.stringify([version, conn.record.id, id, page]);
      const known = collectionReads.get(cacheKey);
      if (known) { read = known; continue; }
      const previous = read;
      read = (async () => {
        const before = previous ? await previous : undefined;
        if (before && before.data.continuation !== 'more') return before;
        const cursor = before?.data.nextCursor;
        if (before && !cursor) throw new Error('Invalid collection continuation');
        const data = await conn.adapter.collection(id, cursor, 100);
        if (data.continuation === 'more' && (!data.nextCursor || data.nextCursor === cursor)) throw new Error('Invalid collection continuation');
        return { data, items: [...(before?.items ?? []), ...data.items] };
      })();
      const current = read;
      collectionReads.set(cacheKey, current);
      current.catch(() => { if (collectionReads.get(cacheKey) === current) collectionReads.delete(cacheKey); });
      if (collectionReads.size > 64) collectionReads.delete(collectionReads.keys().next().value!);
    }
    const { data, items } = await read!;
    if (version !== authVersion) throw new Error('Session changed during collection read');
    const images = await conn.images();
    const seen = new Set<string>();
    // Only an exhausted collection is complete; an unknown end is never presented as the whole.
    return withLocale(localeJSON, () => ({ name: data.collection.name, items: items.filter(item => !seen.has(item.id) && !!seen.add(item.id)).map(item => entry(item, images, artWidth)),
      more: data.continuation === 'more', complete: data.continuation === 'exhausted' }));
  },
  cancelAISearch: async (_args, store) => {
    const previous = ai;
    ai = undefined;
    if (previous?.job && (previous.job.status === 'queued' || previous.job.status === 'running' || previous.job.status === 'partial'))
      await (await session(store)).adapter.cancelAI(previous.job.id, { generation: previous.generation, idempotencyKey: `cancel-${previous.epoch}-${previous.generation}` });
    // A start still in flight detects that it was superseded and cancels itself.
    return { accepted: true };
  },
  uiRelated: async ([id, localeJSON, artWidth], store) => {
    const conn = await session(store);
    const data = await conn.adapter.rows({ placement: 'detail', titleId: id });
    const images = await conn.images();
    return withLocale(localeJSON, () => data.items.map(row => feedRow(row, images, artWidth)));
  },
  uiDetail: async ([id, entryId, localeJSON, artWidth], store) => {
    const conn = await session(store), api = conn.adapter;
    const version = authVersion;
    const tokens = await signedIn(conn);
    const cacheKey = JSON.stringify([version, conn.record.id, tokens?.viewer.id, tokens?.viewer.policyRevision, id, entryId]);
    let read = detailReads.get(cacheKey);
    if (!read) {
      read = Promise.all([api.detail(id), api.capabilities()]);
      detailReads.set(cacheKey, read);
      if (detailReads.size > 64) detailReads.delete(detailReads.keys().next().value!);
    }
    const [detail, capabilities] = await read;
    if (version !== authVersion) throw new Error('Session changed during detail read');
    const images = await conn.images();
    return withLocale(localeJSON, () => detailModel(detail, images, artWidth, capabilities.features.extraPlayback?.available === true, capabilities.features.themeMusic?.available === true));
  },
  uiSearch: async ([query, generation, epoch, at, localeJSON, artWidth], store) => {
    const conn = await session(store);
    const result = await conn.adapter.search({ query, generation, mode: 'fast', idempotencyKey: `search-${epoch}-${generation}` });
    const images = await conn.images();
    return withLocale(localeJSON, () => ({ query: result.query, generation: result.generation, items: result.items.map(t => card(t, '', images, artWidth)), descriptive: [], ai: [], aiStatus: 'unavailable', descriptiveStatus: 'ready', descriptiveRetryAllowed: false, descriptiveRetryAfter: 0, ...liveSearch(result.live, images, at) }));
  },
  uiDescriptive: async ([query, generation, epoch, localeJSON, artWidth], store) => {
    const conn = await session(store), api = conn.adapter;
    if (!features?.descriptiveSearch.available) return lane(query, generation);
    const result = await api.search({ query, generation, mode: 'descriptive', idempotencyKey: key(store) });
    const status = result.descriptive?.state ?? 'ready';
    const retry = result.descriptive?.retry;
    const images = await conn.images();
    return withLocale(localeJSON, () => ({ ...lane(result.query, result.generation), items: result.items.map(t => card(t, '', images, artWidth)), descriptiveStatus: status, descriptiveRetryAllowed: retry?.allowed === true, descriptiveRetryAfter: Number.isFinite(retry?.afterSeconds) ? Math.max(1, Math.ceil(retry!.afterSeconds!)) : 1 }));
  },
  uiAI: async ([query, generation, epoch, localeJSON, artWidth], store) => {
    const conn = await session(store), api = conn.adapter;
    if (!features?.aiSearch.available) return lane(query, generation);
    if (!ai || ai.epoch !== epoch || ai.generation !== generation || ai.query !== query) {
      const previous = ai;
      const current = { epoch, generation, query } as NonNullable<typeof ai>;
      ai = current;
      const previousJobId = previous?.job && (previous.job.status === 'running' || previous.job.status === 'queued' || previous.job.status === 'partial') ? previous.job.id : undefined;
      current.starting = api.startAI({ query, generation, ...(previousJobId ? { previousJobId } : {}), idempotencyKey: `ai-${epoch}-${generation}` });
      current.job = await current.starting;
      current.starting = undefined;
      if (ai !== current) {
        await api.cancelAI(current.job.id, { generation, idempotencyKey: `cancel-${epoch}-${generation}` });
        return lane(query, generation);
      }
    } else if (ai.starting) {
      await ai.starting;
    } else if (ai.job && (ai.job.status === 'queued' || ai.job.status === 'running' || ai.job.status === 'partial')) {
      const current = ai;
      const job = await api.aiJob(ai.job.id);
      if (ai === current) current.job = job;
    }
    if (!ai || ai.epoch !== epoch || ai.generation !== generation || !ai.job || ai.job.generation !== generation) return lane(query, generation);
    const job = ai.job;
    if (job.results && (job.results.query !== query || job.results.generation !== generation)) return lane(query, generation);
    const images = await conn.images();
    return withLocale(localeJSON, () => ({ ...lane(query, generation), items: (job.results?.items ?? []).map(t => card(t, '', images, artWidth)), aiStatus: job.status }));
  },
  interaction: async ([receipt, kind, at], store) => {
    if (kind !== 'visible' && kind !== 'selected' && kind !== 'played') throw new Error('Invalid interaction');
    const api = (await session(store)).adapter;
    interactions ??= new InteractionQueue(api);
    if (!interactions.add({ receiptToken: receipt, kind, occurredAt: new Date(at).toISOString() })) return { accepted: false };
    if (kind !== 'visible' || interactions.size >= 16) await interactions.flush(key(store), at);
    return { accepted: !interactions.disabled };
  },
  uiPlayback: async ([id, kind, epoch, entryId, positionText, manual, attempt, preparationAttempt], store) => {
    const conn = await session(store), api = conn.adapter;
    await ensureNegotiated(api, store);
    if (kind !== 'title' && kind !== 'extra' && kind !== 'channel') throw new Error('Unsupported playback target');
    const position = positionText === '' ? undefined : Number(positionText);
    if (position !== undefined && (!Number.isFinite(position) || position < 0)) throw new Error('Invalid playback position');
    const version = authVersion;
    const declarationKey = JSON.stringify([version, entryId, kind, id, manual]);
    let declared = playbackDeclarations.get(declarationKey);
    if (!declared) {
      declared = client;
      playbackDeclarations.set(declarationKey, declared);
      if (playbackDeclarations.size > 64) playbackDeclarations.delete(playbackDeclarations.keys().next().value!);
    }
    const cacheKey = JSON.stringify([version, conn.record.id, entryId, kind, id, positionText, manual, attempt, preparationAttempt]);
    let read = playbackReads.get(cacheKey);
    if (!read) {
      read = (async () => {
        try {
          const plan = await api.playback({ ...(kind === 'title' && position !== undefined ? { positionSeconds: position } : {}), ...(kind === 'extra' ? { extraId: id } : kind === 'channel' ? { channelId: id } : { titleId: id }), client: declared!, idempotencyKey: `play-${epoch}-${entryId}-${kind}-${id}-${manual}` });
          if (version !== authVersion) throw new Error('Session changed during playback');
          if (plan.state === 'preparing') {
            if (kind !== 'extra' || !Number.isFinite(plan.retryAfterSeconds) || plan.retryAfterSeconds < 1) throw new Error('Invalid playback preparation response');
            return { planJson: '', sessionId: '', preparing: true, errorCode: '', errorMessage: '', retryAllowed: false, retryAfterSeconds: Math.ceil(plan.retryAfterSeconds), retryLimit: 0 };
          }
          detailReads.clear();
          return { planJson: JSON.stringify(conn.plan(plan)), sessionId: plan.sessionId, preparing: false, errorCode: '', errorMessage: '', retryAllowed: false, retryAfterSeconds: 0, retryLimit: 0 };
        } catch (error) {
          if (!(error instanceof VelaError)) throw error;
          const retry = error.detail.retry;
          const header = Number(error.retryAfter);
          const hint = Number.isFinite(retry.afterSeconds) ? Math.max(0, retry.afterSeconds!) : 0;
          const seconds = Math.max(2 ** Math.min(attempt, 5), hint, Number.isFinite(header) ? header : 0, 1);
          const limit = Math.max(0, Math.min(2, (Number.isFinite(retry.maxAttempts) ? Math.floor(retry.maxAttempts!) : 3) - 1));
          return { planJson: '', sessionId: '', preparing: false, errorCode: error.detail.code, errorMessage: error.message, retryAllowed: retry.allowed === true && seconds <= 60, retryAfterSeconds: seconds, retryLimit: limit };
        }
      })();
      playbackReads.set(cacheKey, read);
      if (playbackReads.size > 64) playbackReads.delete(playbackReads.keys().next().value!);
    }
    return read;
  },
  uiSkinDoc: async ([url, width, cold, localeJSON], store) => {
    const path = new URL(url).pathname;
    const locale = String(JSON.parse(localeJSON).locale ?? 'en');
    const resolve = (doc: unknown) => skinDoc(doc as Parameters<typeof skinDoc>[0], width, API, locale) as unknown as Awaited<ReturnType<Sources['uiSkinDoc']>>;
    // The last applied document, kept so a cold start draws it before the server answers.
    // Once the server has answered the document is read fresh (an edit under the same version
    // reaches the client) and the kept copy follows it.
    const kept = cold ? keptSkinDoc(store, path) : undefined;
    if (kept !== undefined) {
      try { return resolve(kept); } catch { store.set(SKIN_DOC_KEY, ''); }
    }
    let raw: unknown;
    // A built-in document is a static file of this release; a server document lives in the appearance tree.
    if (path.startsWith('/vela/skins/') && path.endsWith('/document.json')) {
      const response = await fetch(`${API}${path}`);
      if (!response.ok) throw new Error(`Built-in skin document ${path}: ${response.status}`);
      raw = await response.json();
    } else {
      if (!path.startsWith('/vela/v0/appearance/skins/')) throw new Error('Skin document outside the appearance tree');
      const ether = server(store).ether;
      if (!ether) throw new Error('This server publishes no skin documents');
      raw = await ether.skinDocument(path.slice('/vela/v0'.length));
    }
    // The model is built from the same tables tools/renderer.ts generates its shapes from.
    const model = resolve(raw);
    const text = JSON.stringify({ path, sha256: await sha256(JSON.stringify(raw)), doc: raw });
    if (text.length <= SKIN_DOC_MAX) store.set(SKIN_DOC_KEY, text);
    return model;
  },
  uiAppearance: async (_args, store) => {
    // Appearance is an Ether feature; any other server uses the local built-in appearance.
    const ether = server(store).ether;
    let appearance;
    try {
      if (!ether) throw new VelaError({ class: 'request', code: 'unsupported', message: 'No server appearance', retry: { allowed: false } }, 404);
      appearance = await ether.appearance(); appearanceAvailable = true;
    } catch (error) {
      if (!missingAppearance(error)) throw error;
      appearanceAvailable = false;
      appearance = localAppearance;
    }
    return lastAppearance = appearanceModel(appearance, API, await builtInDocuments(API));
  },
  appearanceEvents: async ([_attempt, floor], store) => {
    if (!appearanceAvailable) return lastAppearance ?? appearanceModel(localAppearance, API, await builtInDocuments(API));
    const api = (await session(store)).ether;
    try {
      if (!api) throw new VelaError({ class: 'request', code: 'unsupported', message: 'No server appearance', retry: { allowed: false } }, 404);
      return await appearanceStream(API, mapper => api.streamEvents(mapper), floor);
    } catch (error) {
      if (!missingAppearance(error)) throw error;
      appearanceAvailable = false;
      return lastAppearance ?? appearanceModel(localAppearance, API, await builtInDocuments(API));
    }
  },
  sessionEvents: async ([id], store) => {
    const conn = await session(store);
    if (conn.ether) return sessionEvents(conn.ether, conn.record.origin, id);
    // No event stream: one authoritative snapshot per ask; the foundation polls at auth.pollSeconds.
    const snapshot = await conn.adapter.snapshot(id);
    if (snapshot.plan.sessionId !== id) throw new Error('Invalid session snapshot');
    return { planJson: JSON.stringify(conn.plan(snapshot.plan)), sessionId: id, preparing: false, errorCode: '', errorMessage: '', retryAllowed: false, retryAfterSeconds: 0, retryLimit: 0 };
  },
  flushInteractions: async ([at], store) => {
    while (interactions?.size) if (!await interactions.flush(key(store), at)) return { accepted: false };
    return { accepted: true };
  },
  uiPlayer: ([planJson, eventJson, replyJson, localeJSON]) => withLocale(localeJSON, () => playerPresentation(planJson, eventJson, replyJson, localeJSON)),
  liveStop: async ([planJson], store) => stopPlan((await session(store)).adapter, planJson),
  uiPlayerCommand: async ([json], store) => {
    let sessionId = '';
    try {
      const event = JSON.parse(json);
      if (event.type !== 'session-command' || typeof event.sessionId !== 'string' || !event.command) throw new Error('Invalid player command');
      sessionId = event.sessionId;
      const conn = await session(store), api = conn.adapter;
      let plan;
      try { plan = await api.command(sessionId, event.command); }
      catch (error) {
        // A stop can race an authorized seek or switch. Retry once only when
        // the server supplies authoritative generations, with a new key because
        // the rejected precondition is itself idempotently recorded.
        const generations = error instanceof VelaError && error.detail.code === 'stale_generation' ? error.detail.currentGenerations : undefined;
        if (event.command.kind !== 'stop' || !generations) throw error;
        plan = await api.command(sessionId, { kind: 'stop', ...generations, idempotencyKey: key(store) });
      }
      return { planJson: JSON.stringify(conn.plan(plan)), sessionId, error: '' };
    } catch (error) {
      return { planJson: '', sessionId, error: error instanceof Error ? error.message : 'Playback command failed' };
    }
  },
  playerEvent: async ([json], store) => {
    const event = JSON.parse(json);
    if (event.type !== 'observation') return { accepted: true };
    if (typeof event.sessionId !== 'string' || !event.observation) throw new Error('Invalid player observation');
    await (await session(store)).adapter.observe(event.sessionId, event.observation);
    return { accepted: true };
  },

  // Native media authorization: foundation passes this JSON straight to vela-player and
  // vela-preview as a private prop. It is never part of a plan, model, log or observation.
  uiMediaAuth: async ([serverId], store) => {
    const conn = await session(store);
    const tokens = await signedIn(conn);
    if (!conn.media || !tokens || conn.record.id !== serverId) return { json: '' };
    // The opaque handle rotates with the server, principal and credential, retiring old readers.
    const identity = JSON.stringify([conn.record.id, tokens.viewer.id, tokens.accessToken]);
    if (media?.identity !== identity) media = { identity, handle: randomId() };
    const handle = media.handle, headers = await conn.media.headers();
    if (media?.handle !== handle || server(store) !== conn) return { json: '' };
    return { json: JSON.stringify({ handle, origin: conn.media.origin, pathPrefix: conn.media.pathPrefix, headers }) };
  },
  /** A native element's URL, minted for one pending host request; any mismatch fails closed. */
  uiNativeMedia: async ([json, at], store) => {
    let request: { type?: unknown; requestId?: unknown; handle?: unknown; url?: unknown };
    try { request = JSON.parse(json); } catch { return { json: '' }; }
    if (request.type !== 'native-media-request' || typeof request.requestId !== 'number' || typeof request.handle !== 'string' || typeof request.url !== 'string') return { json: '' };
    const refuse = { json: JSON.stringify({ requestId: request.requestId, handle: request.handle, url: '', expiresAt: 0 }) };
    try {
      const conn = await session(store);
      if (!conn.media || !media || media.handle !== request.handle) return refuse;
      const url = await conn.media.nativeURL(request.url);
      if (media?.handle !== request.handle) return refuse;
      // An attachment deadline for the host, not a claim about the credential's lifetime.
      return { json: JSON.stringify({ requestId: request.requestId, handle: request.handle, url, expiresAt: at + 30000 }) };
    } catch { return refuse; }
  },

  // Servers. Presentation records only: no credential reaches these answers.
  uiServers: async ([_revision, _authRevision, _authenticated, localeJSON], store) => {
    const selected = server(store);
    const list = servers(store).read();
    const rows = await Promise.all(list.servers.map(async record => {
      const conn = connection(store, record.id);
      const stored = await signedIn(conn);
      let reachable = true, tokens = stored;
      if (stored && conn !== selected) {
        const checkKey = JSON.stringify([record.id, stored.accessToken, _revision]);
        let check = checks.get(checkKey);
        if (!check) {
          check = bounded(conn.adapter.validateSession()).then(tokens => ({ reachable: true, tokens }), async () => ({ reachable: false, tokens: await signedIn(conn) }));
          checks.set(checkKey, check);
          if (checks.size > 32) checks.delete(checks.keys().next().value!);
        }
        ({ reachable, tokens } = await check);
      } else if (stored) reachable = health?.id === record.id ? health.reachable : true;
      const status = !tokens ? 'signed-out' : reachable ? 'ready' : 'unreachable';
      return withLocale(localeJSON, () => ({ id: record.id, name: serverNames.get(record.id) ?? record.name, kind: record.kind, kindLabel: kindLabel(record.kind),
        origin: record.origin, basePath: record.basePath, selected: record.id === list.selectedId, status, viewer: tokens?.viewer.name ?? '',
        message: status === 'unreachable' ? msg('server.unreachable') : status === 'signed-out' ? msg('server.signedOut') : '' }));
    }));
    return { servers: rows, selectedId: list.selectedId };
  },
  detectServer: async ([url, generation, localeJSON], store) => {
    const probe = await probeServer(url, deviceFor(store).id, pageOriginBound.startsWith('https:'));
    return withLocale(localeJSON, () => ({ url, generation, state: probe.state, kind: probe.kind, kindLabel: kindLabel(probe.kind), name: probe.name, version: probe.version, normalizedUrl: probe.url,
      message: probe.state === 'found' ? '' : probe.kind === 'ether' ? msg('server.probe.vela') : probe.state === 'insecure' ? msg('server.probe.insecure', { url: probe.url }) : msg(`server.probe.${probe.state}`) }));
  },
  setSelectedServer: async ([id], store) => {
    try { selectServer(store, id); return { id, error: '' }; }
    catch (error) { return { id: '', error: error instanceof Error ? error.message : 'Server not found' }; }
  },
  addServerRecord: async ([kind, name, url], store) => {
    try {
      if (kind !== 'jellyfin' && kind !== 'emby' && kind !== 'plex') throw new Error(msg('server.probe.unsupported'));
      if (pageOriginBound.startsWith('https:') && /^http:/i.test(url.trim())) throw new Error(msg('server.probe.insecure', { url: url.trim() }));
      return { id: servers(store).add(kind, name.trim() || kindLabel(kind), url).id, error: '' };
    } catch (error) { return { id: '', error: error instanceof Error ? error.message : 'Server could not be added' }; }
  },
  removeServerRecord: async ([id], store) => {
    try {
      if (id === 'ether') throw new Error('Cannot remove the default server');
      const conn = connection(store, id);
      // Removing forgets the session either way; revocation is attempted while the server answers.
      try { await bounded(endSession(conn, store)); } catch { /* Unreachable: the local session is still forgotten. */ }
      await conn.credentials.set(null);
      servers(store).remove(id);
      connections.delete(id);
      server(store);
      return { id, error: '' };
    } catch (error) { return { id: '', error: error instanceof Error ? error.message : 'Server could not be removed' }; }
  },
  signOutServerRecord: async ([id], store) => {
    try {
      const conn = connection(store, id);
      const version = authVersion;
      await endSession(conn, store);
      if (conn === server(store) && version === authVersion) { resetSessionSnapshots(); ready = undefined; activeQuick = undefined; ai = undefined; features = undefined; interactions = undefined; media = undefined; }
      return { id, error: '' };
    } catch (error) { return { id: '', error: failure(error, 'Sign out failed') }; }
  },
  beginPlexLink: async ([_at], store) => {
    plexLink ??= new PlexLink(deviceFor(store).id);
    try {
      const pin = await plexLink.start();
      plexCode = pin.code;
      return { code: pin.code, linkUrl: 'https://plex.tv/link', state: 'waiting', expiresAt: pin.expiresAt };
    } catch { plexCode = ''; return { code: '', linkUrl: 'https://plex.tv/link', state: 'failed', expiresAt: '' }; }
  },
  pollPlexLink: async ([code, at]) => {
    let state: Awaited<ReturnType<PlexLink['poll']>> = 'failed';
    if (plexLink && code && code === plexCode) { try { state = await plexLink.poll(code, at); } catch { state = 'failed'; } }
    return { code, linkUrl: 'https://plex.tv/link', state, expiresAt: '' };
  },
  stopPlexLink: async () => {
    plexLink?.cancel(); plexCode = '';
    return { accepted: true };
  },
  uiPlexServers: async ([code, localeJSON]) => {
    const choices = plexLink?.servers(code, pageOriginBound.startsWith('https:')) ?? [];
    return withLocale(localeJSON, () => choices.map(c => ({ id: c.id, name: c.name, owned: c.owned, connectionLabel: msg(`server.plex.${c.connection}`), recommended: c.recommended })));
  },
  selectPlexServer: async ([id], store) => {
    try {
      if (!plexLink || !plexCode) throw new Error(msg('server.plex.again'));
      const chosen = await plexLink.choose(plexCode, id, pageOriginBound.startsWith('https:'));
      plexCode = '';
      // A Plex record added by a typed address (often the LAN one) becomes this server at its proven address.
      const list = servers(store).read().servers;
      const proven = list.find(s => s.kind === 'plex' && s.origin === chosen.origin);
      let typed: ServerRecord | undefined;
      for (const s of list) if (!proven && !typed && s.kind === 'plex' && chosen.origins.includes(s.origin) && !await signedIn(connection(store, s.id))) typed = s;
      const record = proven ?? (typed ? servers(store).relocate(typed.id, chosen.name, chosen.origin) : servers(store).add('plex', chosen.name, chosen.origin));
      await connection(store, record.id).credentials.set(chosen.tokens);
      selectServer(store, record.id);
      return { id: record.id, error: '' };
    } catch (error) { return { id: '', error: failure(error, msg('server.plex.again')) }; }
  },
  connectJellyfin: async ([id, username, password], store) => {
    try {
      const conn = connection(store, id);
      if (conn.record.kind !== 'jellyfin' && conn.record.kind !== 'emby') throw new Error('Not a Jellyfin or Emby server');
      const tokens = await conn.adapter.signIn({ username, password, device: deviceFor(store), idempotencyKey: key(store) });
      await conn.credentials.set(tokens);
      selectServer(store, id);
      return { id, error: '' };
    } catch (error) { return { id: '', error: failure(error, 'Sign in failed') }; }
  },
  beginJellyfinQuick: async ([id, _at, localeJSON], store) => {
    const conn = connection(store, id);
    if (conn.record.kind !== 'jellyfin' && conn.record.kind !== 'emby') throw new Error('Not a Jellyfin or Emby server');
    const grant = await conn.adapter.quickConnect({ device: deviceFor(store), idempotencyKey: key(store) });
    jellyQuick = { handle: randomId(), serverId: id, secret: grant.secret, expiresAt: Date.parse(grant.expiresAt) };
    return withLocale(localeJSON, () => ({ secret: jellyQuick!.handle, code: grant.code, expiresAt: grant.expiresAt, expiresLabel: time(Date.parse(grant.expiresAt)), status: 'pending', pollIntervalSeconds: grant.pollIntervalSeconds }));
  },
  pollJellyfinQuick: async ([handle, at], store) => {
    const current = jellyQuick;
    if (!current || current.handle !== handle) return { id: '', error: 'Connection cancelled' };
    if (Number.isFinite(current.expiresAt) && at >= current.expiresAt) { jellyQuick = undefined; return { id: '', error: msg('server.codeExpired') }; }
    try {
      const conn = connection(store, current.serverId);
      const result = await conn.adapter.pollQuickConnect({ secret: current.secret, device: deviceFor(store), idempotencyKey: key(store) });
      if (jellyQuick !== current) return { id: '', error: 'Connection cancelled' };
      if (result.status === 'pending') return { id: '', error: '' };
      jellyQuick = undefined;
      if (result.status !== 'approved') return { id: '', error: result.status === 'expired' ? msg('server.codeExpired') : 'Connection denied' };
      await conn.credentials.set(result.tokens);
      selectServer(store, current.serverId);
      return { id: current.serverId, error: '' };
    } catch (error) { jellyQuick = undefined; return { id: '', error: failure(error, 'Quick Connect failed') }; }
  },
  stopJellyfinQuick: async () => {
    jellyQuick = undefined;
    return { accepted: true };
  },
};
return (name, args, store, storage, native) => sources[name](args, store, storage, native);
}
