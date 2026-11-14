import type { Answer, Sources } from '../app.contract.d.ts';
import type { AISearchJob, ClientCapabilities, Device, ServerCapabilities, Tokens, LibraryBrowseQuery, LibrarySort, SortDirection, TitleKind } from '../wire/v0/types';
import { EtherAdapter, VelaError } from './adapter/ether';
import { SessionCredentials } from './session';
import { card, entry, feedRow, homeModel, detailModel } from './discovery/models';
import { loadGuide, liveIdentity } from './live/guide';
import { artworkURL } from './discovery/artwork';
import { liveStatus, stopPlan } from './live/player';
import { InteractionQueue } from './telemetry';
import { sessionEvents } from './protocol/events';
import { mediaPlan } from './protocol/media';
import { randomId } from './protocol/id';
import { playerPresentation } from '../player/presentation';
import { msg, setLocale, time, withLocale } from '../foundation/i18n';

export function createAnswer(devOrigin: string, MOCK: boolean, version: string): Answer {
let API = '';
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
type MediaCapabilities = Pick<ClientCapabilities, 'containers' | 'videoCodecs' | 'audioCodecs' | 'subtitleFormats' | 'hls' | 'mse'>;
function parseMediaCapabilities(json: string): MediaCapabilities {
  const value = JSON.parse(json) as Record<string, unknown>;
  const list = (name: string): string[] => {
    const items = value?.[name];
    if (!Array.isArray(items) || items.length > 32 || items.some(item => typeof item !== 'string' || item.length > 80)) throw new Error('Invalid media capabilities');
    return items;
  };
  if (typeof value?.hls !== 'boolean' || typeof value?.mse !== 'boolean') throw new Error('Invalid media capabilities');
  return { containers: list('containers'), videoCodecs: list('videoCodecs'), audioCodecs: list('audioCodecs'), subtitleFormats: list('subtitleFormats'), hls: value.hls, mse: value.mse };
}
function key(store: Parameters<Sources['uiBootstrap']>[1]): string {
  const n = Number(store.get('vela.counter') || '0') + 1;
  store.set('vela.counter', String(n));
  return `${device.id}-${n}`;
}
let adapter: EtherAdapter | undefined;
let interactions: InteractionQueue | undefined;
let ready: Promise<void> | undefined;
let activeQuick = "";
let authVersion = 0;
// Successful panel answers are kept only for this authentication session and display context.
const librarySnapshots = new Map<string, { version: number; locale: string; width: number; value: Awaited<ReturnType<Sources['uiLibrary']>> }>();
const libraryRequests = new Map<string, number>();
function resetSessionSnapshots(): void {
  authVersion++;
  librarySnapshots.clear();
  libraryRequests.clear();
}
let validation: { token: string; pending: Promise<Tokens | null> } | undefined;
let redemption: { code: string; idempotencyKey: string; pending?: Promise<Tokens>; consumed: boolean } | undefined;
let negotiation: { version: number; pending: Promise<void> } | undefined;
let features: ServerCapabilities['features'] | undefined;
let ai: { epoch: number; generation: number; query: string; job?: AISearchJob; starting?: Promise<AISearchJob> } | undefined;
const lane = (query: string, generation: number) => ({ query, generation, items: [] as ReturnType<typeof card>[], descriptive: [] as ReturnType<typeof card>[], ai: [] as ReturnType<typeof card>[], aiStatus: 'unavailable' });
function server(store: Parameters<Sources['uiBootstrap']>[1], media?: MediaCapabilities): EtherAdapter {
  if (!API) throw new Error('Server origin is unavailable');
  if (!adapter) {
    if (!media) throw new Error('Media capabilities are unavailable');
    let id = store.get('vela.device');
    if (!id) { id = randomId(); store.set('vela.device', id); }
    device = { id, name: 'Vela browser', platform: 'web', appVersion: version };
    client = { device, protocolVersions: [0], ...media };
    const credentials = new SessionCredentials(store, device, () => key(store));
    adapter = new EtherAdapter(API, credentials, JSON.stringify(client), () => {
      resetSessionSnapshots(); ready = undefined; validation = undefined; negotiation = undefined; features = undefined; interactions = undefined; ai = undefined;
    });
  }
  return adapter;
}
async function session(store: Parameters<Sources['uiBootstrap']>[1]): Promise<EtherAdapter> {
  const api = server(store);
  if (!ready) ready = (async () => {
    if (store.get('vela.session')) return;
    if (!MOCK || store.get('vela.session') === '') throw new Error('Sign in to your Vela server');
    const tokens = await api.signIn({ idempotencyKey: key(store), username: 'demo', password: 'vela', device });
    store.set('vela.session', JSON.stringify(tokens));
  })().catch(e => { ready = undefined; throw e; });
  await ready;
  // Auth can be revalidating or rotating the stored credentials while resources
  // become active. All authenticated reads must use the settled session.
  if (validation) await validation.pending;
  if (!store.get('vela.session')) throw new Error('Sign in to your Vela server');
  return api;
}
let authOptions = { passwordAvailable: false, quickAvailable: false };
let authCapabilities: Promise<ServerCapabilities> | undefined;
const authModel = async (store: Parameters<Sources['uiBootstrap']>[1], error = '') => {
  if (!authCapabilities) authCapabilities = server(store).capabilities().finally(() => { authCapabilities = undefined; });
  const capabilities = await authCapabilities;
  authOptions = { passwordAvailable: capabilities.features.passwordSignIn.available, quickAvailable: capabilities.features.quickConnect.available };
  return { authenticated: !!store.get('vela.session'), ...authOptions, error };
};
let lastLive = { sessionId: '', reconnecting: false, delivery: 'unknown', drift: -1, driftLabel: '', canCatchUp: false };
const sources: Sources = {
  uiLiveIdentity: async ([channelId, epoch, localeJSON], store) => liveIdentity(await session(store), channelId, epoch, localeJSON),
  uiGuide: async ([epoch, day, localeJSON], store) => loadGuide(await session(store), day, epoch, store.get('vela.session') ?? '', API, localeJSON),
  liveEvent: async ([json, localeJSON]) => {
    const event = JSON.parse(json);
    const next = withLocale(localeJSON, () => liveStatus(event));
    if (next) lastLive = next;
    return lastLive;
  },
  uiAuth: async ([code, _epoch, isFragment, pageOrigin, mediaJSON, localeJSON], store) => {
    setLocale(localeJSON);
    bindOrigin(pageOrigin);
    const api = server(store, parseMediaCapabilities(mediaJSON));
    if (code && !store.get('vela.session')) {
      let decoded = code;
      try { if (isFragment) decoded = decodeURIComponent(code); } catch { /* Preserve malformed input for the server to reject. */ }
      if (!redemption || redemption.code !== decoded) redemption = { code: decoded, idempotencyKey: key(store), consumed: false };
      const current = redemption;
      if (current.consumed) throw new Error('The sign-in link has already been used');
      const version = authVersion;
      if (!current.pending) {
        current.pending = api.redeemWebCode({ code: decoded, device, idempotencyKey: current.idempotencyKey })
          .catch(error => { current.pending = undefined; throw error; });
      }
      const tokens = await current.pending;
      if (redemption === current && version === authVersion && !store.get('vela.session')) {
        store.set('vela.session', JSON.stringify(tokens));
        current.consumed = true;
        resetSessionSnapshots(); ready = undefined;
      }
    } else if (MOCK && store.get('vela.session') === null) await session(store);
    const stored = store.get('vela.session');
    if (stored) {
      const token = (JSON.parse(stored) as Tokens).refreshToken;
      if (!validation || validation.token !== token) {
        const current = { token, pending: api.validateSession() };
        validation = current;
        current.pending = current.pending.then(result => {
          if (validation === current && result) current.token = result.refreshToken;
          return result;
        });
      }
      try { await validation.pending; }
      catch (error) {
        if (store.get('vela.session')) throw error;
        // The adapter already cleared only the rejected session and invalidated its state.
      }
    }
    return authModel(store);
  },
  signIn: async ([username, password], store) => {
    const api = server(store);
    try {
      const tokens = await api.signIn({ username, password, device, idempotencyKey: key(store) });
      store.set('vela.session', JSON.stringify(tokens)); resetSessionSnapshots(); ready = undefined;
      return authModel(store);
    } catch (error) { return authModel(store, error instanceof Error ? error.message : 'Sign in failed'); }
  },
  startQuick: async ([_epoch, localeJSON], store) => {
    const api = server(store);
    const grant = await api.quickConnect({ device, idempotencyKey: key(store) });
    activeQuick = grant.secret;
    return withLocale(localeJSON, () => ({ ...grant, expiresLabel: time(Date.parse(grant.expiresAt)), status: 'pending' }));
  },
  pollQuick: async ([secret], store) => {
    const api = server(store);
    if (!secret || activeQuick !== secret) return authModel(store, 'Connection cancelled');
    const result = await api.pollQuickConnect({ secret, device, idempotencyKey: key(store) });
    if (activeQuick !== secret) return authModel(store, 'Connection cancelled');
    if (result.status === 'approved') { store.set('vela.session', JSON.stringify(result.tokens)); activeQuick = ''; resetSessionSnapshots(); ready = undefined; }
    return authModel(store, result.status === 'expired' ? 'Code expired' : result.status === 'denied' ? 'Connection denied' : '');
  },
  signOut: async (_args, store) => {
    const api = server(store);
    const value = store.get('vela.session');
    const version = authVersion;
    if (value) {
      const tokens = JSON.parse(value) as { refreshToken: string };
      await api.revoke({ refreshToken: tokens.refreshToken, idempotencyKey: key(store) });
      if (version === authVersion) { store.set('vela.session', ''); resetSessionSnapshots(); ready = undefined; activeQuick = ''; ai = undefined; features = undefined; interactions = undefined; }
    }
    return { authenticated: !!store.get('vela.session'), ...authOptions, error: '' };
  },
  cancelQuick: async ([secret], store) => {
    if (activeQuick === secret) activeQuick = '';
    return { accepted: true };
  },
  uiBootstrap: async ([at, localeJSON, artWidth], store) => {
    const api = await session(store);
    const version = authVersion;
    if (!negotiation || negotiation.version !== version) {
      const current = { version, pending: Promise.resolve() };
      current.pending = api.negotiate({ client, idempotencyKey: key(store) }).then(() => {
        if (authVersion !== version) throw new Error('Session changed during negotiation');
      }).catch(error => { if (negotiation === current) negotiation = undefined; throw error; });
      negotiation = current;
    }
    await negotiation.pending;
    const bootstrap = await api.bootstrap();
    if (authVersion !== version) throw new Error('Session changed during bootstrap');
    features = bootstrap.capabilities.features;
    return withLocale(localeJSON, () => homeModel(bootstrap, API, at, artWidth));
  },
  uiHomeRows: async ([cursor, heroIds, homeAt, localeJSON, artWidth], store) => {
    if (!cursor) throw new Error('Home row cursor is missing');
    const data = await (await session(store)).rows({ cursor, placement: 'home' });
    if (data.continuation === 'more' && (!data.nextCursor || data.nextCursor === cursor)) throw new Error('Invalid home row continuation');
    const featured = new Set(heroIds), seen = new Set<string>();
    return withLocale(localeJSON, () => ({ rows: data.items.filter(row => { if (seen.has(row.id)) return false; seen.add(row.id); return true; }).map(row => feedRow({ ...row, items: row.items.filter(item => item.kind !== 'title' || !featured.has(item.title.id)) }, API, artWidth)), nextCursor: data.nextCursor ?? '', continuation: data.continuation, requestCursor: cursor, homeAt }));
  },
  uiHomeRow: async ([rowId, cursor, heroIds, homeAt, localeJSON, artWidth], store) => {
    if (!rowId || !cursor) throw new Error('Home item cursor is missing');
    const data = await (await session(store)).row(rowId, cursor);
    if (data.id !== rowId) throw new Error('Wrong row returned');
    if (data.continuation === 'more' && (!data.nextCursor || data.nextCursor === cursor)) throw new Error('Invalid home item continuation');
    const featured = new Set(heroIds), seen = new Set<string>();
    return withLocale(localeJSON, () => ({ rowId, items: data.items.filter(item => item.kind !== 'title' || !featured.has(item.title.id)).map(item => entry(item, API, artWidth)).filter(item => { if (seen.has(item.id)) return false; seen.add(item.id); return true; }), nextCursor: data.nextCursor ?? '', continuation: data.continuation, requestCursor: cursor, homeAt }));
  },
  uiLibraries: async (_args, store) => {
    const api = await session(store);
    const items: { id: string; name: string; kind: string; backdrop: string }[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let n = 0; n < 100; n++) {
      const page = await api.libraries({ cursor, limit: 100 });
      items.push(...page.items.map(({ id, name, kind, artwork }) => {
        const image = artwork.find(a => a.kind === 'backdrop');
        return { id, name, kind, backdrop: image ? artworkURL(image, 960, 540, API) ?? '' : '' };
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
    const api = await session(store);
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
    const model = withLocale(localeJSON, () => {
      const library = result.library, filters = library.browse.filters;
      const image = library.artwork.find(a => a.kind === 'backdrop');
      return { id: library.id, name: library.name, kind: library.kind,
        backdrop: image ? artworkURL(image, artWidth, Math.ceil(artWidth * 9 / 16), API) ?? '' : '',
        sorts: library.browse.sorts.map(s => ({ id: s.id, label: msg(`library.sort.${s.id}`), directions: s.directions })),
        sort: result.sort, direction: result.direction,
        kinds: (filters.kind ?? []).map(k => ({ id: k, label: msg(`library.kind.${k}`) })),
        genres: (filters.genre ? filters.genres ?? [] : []).map(g => ({ id: g, label: g })),
        kindFilter: query.kind ?? '', genreFilter: query.genre ?? '', playedFilter: query.played === undefined ? '' : String(query.played), favoriteFilter: query.favorite === true, yearFilter: query.year ?? 0,
        canYear: !!filters.year, canPlayed: !!filters.played, canFavorite: !!filters.favorite,
        items: items.map(item => entry(item, API, artWidth)), more: result.continuation === 'more' };
    });
    if (version !== authVersion) throw new Error('Session changed during library read');
    if (libraryRequests.get(snapshotKey) === request) {
      librarySnapshots.delete(snapshotKey);
      librarySnapshots.set(snapshotKey, { version, locale: localeJSON, width: artWidth, value: model });
      if (librarySnapshots.size > 60) librarySnapshots.delete(librarySnapshots.keys().next().value!);
    }
    return model;
  },
  uiCollection: async ([id, localeJSON, artWidth], store) => {
    const data = await (await session(store)).collection(id);
    return withLocale(localeJSON, () => ({ name: data.collection.name, items: data.items.map(item => entry(item, API, artWidth)) }));
  },
  cancelAISearch: async (_args, store) => {
    const previous = ai;
    ai = undefined;
    if (previous?.job && (previous.job.status === 'queued' || previous.job.status === 'running'))
      await (await session(store)).cancelAI(previous.job.id, { generation: previous.generation, idempotencyKey: `cancel-${previous.epoch}-${previous.generation}` });
    // A start still in flight detects that it was superseded and cancels itself.
    return { accepted: true };
  },
  uiRelated: async ([id, localeJSON, artWidth], store) => {
    const data = await (await session(store)).rows({ placement: 'detail', titleId: id });
    return withLocale(localeJSON, () => data.items.map(row => feedRow(row, API, artWidth)));
  },
  uiDetail: async ([id, localeJSON, artWidth], store) => { const detail = await (await session(store)).detail(id); return withLocale(localeJSON, () => detailModel(detail, API, artWidth)); },
  uiSearch: async ([query, generation, epoch, localeJSON, artWidth], store) => {
    const api = await session(store);
    const result = await api.search({ query, generation, mode: 'fast', idempotencyKey: `search-${epoch}-${generation}` });
    return withLocale(localeJSON, () => ({ query: result.query, generation: result.generation, items: result.items.map(t => card(t, '', API, artWidth)), descriptive: [], ai: [], aiStatus: 'unavailable' }));
  },
  uiDescriptive: async ([query, generation, epoch, localeJSON, artWidth], store) => {
    const api = await session(store);
    if (!features?.descriptiveSearch.available) return lane(query, generation);
    const result = await api.search({ query, generation, mode: 'descriptive', idempotencyKey: `descriptive-${epoch}-${generation}` });
    return withLocale(localeJSON, () => ({ ...lane(result.query, result.generation), items: result.items.map(t => card(t, '', API, artWidth)) }));
  },
  uiAI: async ([query, generation, epoch, localeJSON, artWidth], store) => {
    const api = await session(store);
    if (!features?.aiSearch.available) return lane(query, generation);
    if (!ai || ai.epoch !== epoch || ai.generation !== generation || ai.query !== query) {
      const previous = ai;
      const current = { epoch, generation, query } as NonNullable<typeof ai>;
      ai = current;
      current.starting = (async () => {
        if (previous?.job && (previous.job.status === 'running' || previous.job.status === 'queued'))
          await api.cancelAI(previous.job.id, { generation: previous.generation, idempotencyKey: `cancel-${previous.epoch}-${previous.generation}` });
        return api.startAI({ query, generation, idempotencyKey: `ai-${epoch}-${generation}` });
      })();
      current.job = await current.starting;
      current.starting = undefined;
      if (ai !== current) {
        await api.cancelAI(current.job.id, { generation, idempotencyKey: `cancel-${epoch}-${generation}` });
        return lane(query, generation);
      }
    } else if (ai.starting) {
      await ai.starting;
    } else if (ai.job && (ai.job.status === 'queued' || ai.job.status === 'running')) {
      const current = ai;
      const job = await api.aiJob(ai.job.id);
      if (ai === current) current.job = job;
    }
    if (!ai || ai.epoch !== epoch || ai.generation !== generation || !ai.job || ai.job.generation !== generation) return lane(query, generation);
    const job = ai.job;
    return withLocale(localeJSON, () => ({ ...lane(query, generation), items: (job.results?.items ?? []).map(t => card(t, '', API, artWidth)), aiStatus: job.status }));
  },
  interaction: async ([receipt, kind, at], store) => {
    if (kind !== 'visible' && kind !== 'selected' && kind !== 'played') throw new Error('Invalid interaction');
    const api = await session(store);
    interactions ??= new InteractionQueue(api);
    if (!interactions.add({ receiptToken: receipt, kind, occurredAt: new Date(at).toISOString() })) return { accepted: false };
    if (kind !== 'visible' || interactions.size >= 16) await interactions.flush(key(store), at);
    return { accepted: !interactions.disabled };
  },
  uiPlayback: async ([id, kind, epoch, entryId], store) => {
    const api = await session(store);
    if (kind !== 'title' && kind !== 'extra' && kind !== 'channel') throw new Error('Unsupported playback target');
    const plan = await api.playback({ ...(kind === 'extra' ? { extraId: id } : kind === 'channel' ? { channelId: id, liveMode: 'adaptive' as const } : { titleId: id }), client, idempotencyKey: `play-${epoch}-${entryId}-${kind}-${id}` });
    return { planJson: JSON.stringify(mediaPlan(plan, API)), sessionId: plan.sessionId };
  },
  sessionEvents: async ([id], store) => {
    const api = await session(store);
    return sessionEvents(api, API, id);
  },
  flushInteractions: async ([at], store) => {
    while (interactions?.size) if (!await interactions.flush(key(store), at)) return { accepted: false };
    return { accepted: true };
  },
  uiPlayer: ([planJson, eventJson, replyJson, localeJSON]) => withLocale(localeJSON, () => playerPresentation(planJson, eventJson, replyJson, localeJSON)),
  liveStop: async ([planJson], store) => stopPlan(await session(store), planJson),
  uiPlayerCommand: async ([json], store) => {
    let sessionId = '';
    try {
      const event = JSON.parse(json);
      if (event.type !== 'session-command' || typeof event.sessionId !== 'string' || !event.command) throw new Error('Invalid player command');
      sessionId = event.sessionId;
      const api = await session(store);
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
      return { planJson: JSON.stringify(mediaPlan(plan, API)), sessionId, error: '' };
    } catch (error) {
      return { planJson: '', sessionId, error: error instanceof Error ? error.message : 'Playback command failed' };
    }
  },
  playerEvent: async ([json], store) => {
    const event = JSON.parse(json);
    if (event.type !== 'observation') return { accepted: true };
    if (typeof event.sessionId !== 'string' || !event.observation) throw new Error('Invalid player observation');
    await (await session(store)).observe(event.sessionId, event.observation);
    return { accepted: true };
  },
};
return (name, args, store, storage, native) => sources[name](args, store, storage, native);
}
