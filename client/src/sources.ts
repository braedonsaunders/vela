import type { Answer, Sources } from '../app.contract.d.ts';
import type { AISearchJob, ClientCapabilities, Device } from '../wire/v0/types';
import { EtherAdapter } from './adapter/ether';
import { SessionCredentials } from './session';
import { card, entry, homeModel, detailModel } from './discovery/models';
import { InteractionQueue } from './telemetry';
import { sessionEvents } from './protocol/events';
import { mediaPlan } from './protocol/media';
import { playerPresentation } from '../player/presentation';

export function createAnswer(API: string, MOCK: boolean, version: string): Answer {
let device: Device;
let client: ClientCapabilities;
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
let ai: { epoch: number; generation: number; query: string; job?: AISearchJob; starting?: Promise<AISearchJob> } | undefined;
const lane = (query: string, generation: number) => ({ query, generation, items: [] as ReturnType<typeof card>[], descriptive: [] as ReturnType<typeof card>[], ai: [] as ReturnType<typeof card>[], aiStatus: 'unavailable' });
function server(store: Parameters<Sources['uiBootstrap']>[1]): EtherAdapter {
  if (!adapter) {
    let id = store.get('vela.device');
    if (!id) { id = crypto.randomUUID(); store.set('vela.device', id); }
    device = { id, name: 'Vela browser', platform: 'web', appVersion: version };
    client = { device, protocolVersions: [0], containers: ['mp4'], videoCodecs: ['h264'], audioCodecs: ['aac'], subtitleFormats: [], hls: true, mse: true };
    const credentials = new SessionCredentials(store, device, () => key(store));
    adapter = new EtherAdapter(API, credentials, JSON.stringify(client));
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
  return api;
}
const authModel = async (store: Parameters<Sources['uiBootstrap']>[1], error = '') => {
  const capabilities = await server(store).capabilities();
  return { authenticated: !!store.get('vela.session'), passwordAvailable: capabilities.features.passwordSignIn.available,
    quickAvailable: capabilities.features.quickConnect.available, error };
};
const sources: Sources = {
  uiAuth: async ([code, _epoch, isFragment], store) => {
    const api = server(store);
    if (code && !store.get('vela.session')) {
      let decoded = code;
      try { if (isFragment) decoded = decodeURIComponent(code); } catch { /* Preserve malformed input for the server to reject. */ }
      const tokens = await api.redeemWebCode({ code: decoded, device, idempotencyKey: key(store) });
      store.set('vela.session', JSON.stringify(tokens));
    } else if (MOCK && store.get('vela.session') === null) await session(store);
    return authModel(store);
  },
  signIn: async ([username, password], store) => {
    const api = server(store);
    try {
      const tokens = await api.signIn({ username, password, device, idempotencyKey: key(store) });
      store.set('vela.session', JSON.stringify(tokens)); authVersion++; ready = undefined;
      return authModel(store);
    } catch (error) { return authModel(store, error instanceof Error ? error.message : 'Sign in failed'); }
  },
  startQuick: async (_args, store) => {
    const api = server(store);
    const grant = await api.quickConnect({ device, idempotencyKey: key(store) });
    activeQuick = grant.secret;
    return { ...grant, status: 'pending' };
  },
  pollQuick: async ([secret], store) => {
    const api = server(store);
    if (!secret || activeQuick !== secret) return authModel(store, 'Connection cancelled');
    const result = await api.pollQuickConnect({ secret, device, idempotencyKey: key(store) });
    if (activeQuick !== secret) return authModel(store, 'Connection cancelled');
    if (result.status === 'approved') { store.set('vela.session', JSON.stringify(result.tokens)); activeQuick = ''; authVersion++; ready = undefined; }
    return authModel(store, result.status === 'expired' ? 'Code expired' : result.status === 'denied' ? 'Connection denied' : '');
  },
  signOut: async (_args, store) => {
    const api = server(store);
    const value = store.get('vela.session');
    const version = authVersion;
    if (value) {
      while (interactions?.size) await interactions.flush(key(store));
      const tokens = JSON.parse(value) as { refreshToken: string };
      await api.revoke({ refreshToken: tokens.refreshToken, idempotencyKey: key(store) });
      if (version === authVersion) { store.set('vela.session', ''); authVersion++; ready = undefined; activeQuick = ''; ai = undefined; interactions = undefined; }
    }
    return authModel(store);
  },
  cancelQuick: async ([secret], store) => {
    if (activeQuick === secret) activeQuick = '';
    return { accepted: true };
  },
  uiBootstrap: async (_args, store) => homeModel(await (await session(store)).bootstrap(), API),
  uiCollection: async ([id], store) => {
    const data = await (await session(store)).collection(id);
    return { name: data.collection.name, items: data.items.map(item => entry(item, API)) };
  },
  cancelAISearch: async (_args, store) => {
    const previous = ai;
    ai = undefined;
    if (previous?.job && (previous.job.status === 'queued' || previous.job.status === 'running'))
      await (await session(store)).cancelAI(previous.job.id, { generation: previous.generation, idempotencyKey: `cancel-${previous.epoch}-${previous.generation}` });
    // A start still in flight detects that it was superseded and cancels itself.
    return { accepted: true };
  },
  uiDetail: async ([id], store) => detailModel(await (await session(store)).detail(id), API),
  uiSearch: async ([query, generation, epoch], store) => {
    const api = await session(store);
    const result = await api.search({ query, generation, mode: 'fast', idempotencyKey: `search-${epoch}-${generation}` });
    return { query: result.query, generation: result.generation, items: result.items.map(t => card(t, '', API)), descriptive: [], ai: [], aiStatus: 'unavailable' };
  },
  uiDescriptive: async ([query, generation, epoch], store) => {
    const api = await session(store);
    if (!(await api.capabilities()).features.descriptiveSearch.available) return lane(query, generation);
    const result = await api.search({ query, generation, mode: 'descriptive', idempotencyKey: `descriptive-${epoch}-${generation}` });
    return { ...lane(result.query, result.generation), items: result.items.map(t => card(t, '', API)) };
  },
  uiAI: async ([query, generation, epoch], store) => {
    const api = await session(store);
    if (!(await api.capabilities()).features.aiSearch.available) return lane(query, generation);
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
    return { ...lane(query, generation), items: (ai.job.results?.items ?? []).map(t => card(t, '', API)), aiStatus: ai.job.status };
  },
  interaction: async ([receipt, kind, at], store) => {
    if (kind !== 'visible' && kind !== 'selected' && kind !== 'played') throw new Error('Invalid interaction');
    const api = await session(store);
    interactions ??= new InteractionQueue(api);
    if (!interactions.add({ receiptToken: receipt, kind, occurredAt: new Date(at).toISOString() })) return { accepted: false };
    if (kind !== 'visible' || interactions.size >= 16) await interactions.flush(key(store));
    return { accepted: true };
  },
  uiPlayback: async ([id, kind, epoch], store) => {
    const api = await session(store);
    if (kind !== 'title' && kind !== 'extra') throw new Error('Unsupported playback target');
    const plan = await api.playback({ ...(kind === 'extra' ? { extraId: id } : { titleId: id }), client, idempotencyKey: `play-${epoch}-${kind}-${id}` });
    return { planJson: JSON.stringify(mediaPlan(plan, API)), sessionId: plan.sessionId };
  },
  sessionEvents: async ([id], store) => {
    const api = await session(store);
    return sessionEvents(api, API, () => {
      const value = store.get('vela.session');
      return value ? JSON.parse(value) : null;
    }, device.id, id);
  },
  flushInteractions: async (_args, store) => {
    while (interactions?.size) await interactions.flush(key(store));
    return { accepted: true };
  },
  uiPlayer: ([planJson, eventJson, replyJson]) => playerPresentation(planJson, eventJson, replyJson),
  uiPlayerCommand: async ([json], store) => {
    let sessionId = '';
    try {
      const event = JSON.parse(json);
      if (event.type !== 'session-command' || typeof event.sessionId !== 'string' || !event.command) throw new Error('Invalid player command');
      sessionId = event.sessionId;
      const plan = await (await session(store)).command(sessionId, event.command);
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
