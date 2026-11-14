import type { Answer, Sources } from '../app.contract.d.ts';
import type { AISearchJob, ClientCapabilities, Device } from '../wire/v0/types';
import { EtherAdapter } from './adapter/ether';
import { SessionCredentials } from './session';
import { card, homeModel, detailModel } from './discovery/models';

export function createAnswer(API: string, MOCK: boolean): Answer {
const device: Device = { id: 'vela-dev', name: 'Vela browser', platform: 'web', appVersion: '0.1' };
const client: ClientCapabilities = { device, protocolVersions: [0], containers: ['mp4'], videoCodecs: ['h264'], audioCodecs: ['aac'], subtitleFormats: [], hls: true, mse: true };
let adapter: EtherAdapter | undefined;
let ready: Promise<void> | undefined;
let ai: { epoch: number; generation: number; query: string; job?: AISearchJob; starting?: Promise<AISearchJob> } | undefined;
const lane = (query: string, generation: number) => ({ query, generation, items: [] as ReturnType<typeof card>[], descriptive: [] as ReturnType<typeof card>[], ai: [] as ReturnType<typeof card>[], aiStatus: 'unavailable' });
function server(store: Parameters<Sources['uiBootstrap']>[1]): EtherAdapter {
  if (!adapter) {
    const credentials = new SessionCredentials(store, device, () => {
      const n = Number(store.get('vela.counter') || '0') + 1;
      store.set('vela.counter', String(n));
      return `refresh-${n}`;
    });
    adapter = new EtherAdapter(API, credentials, JSON.stringify(client));
  }
  return adapter;
}
async function session(store: Parameters<Sources['uiBootstrap']>[1]): Promise<EtherAdapter> {
  const api = server(store);
  if (!ready) ready = (async () => {
    if (store.get('vela.session')) return;
    if (!MOCK) throw new Error('Sign in to your Vela server');
    const tokens = await api.signIn({ idempotencyKey: 'vela-dev-sign-in', username: 'demo', password: 'vela', device });
    store.set('vela.session', JSON.stringify(tokens));
  })().catch(e => { ready = undefined; throw e; });
  await ready;
  return api;
}
const sources: Sources = {
  uiBootstrap: async (_args, store) => homeModel(await (await session(store)).bootstrap()),
  uiDetail: async ([id], store) => detailModel(await (await session(store)).detail(id)),
  uiSearch: async ([query, generation, epoch], store) => {
    const api = await session(store);
    const result = await api.search({ query, generation, mode: 'fast', idempotencyKey: `search-${epoch}-${generation}` });
    return { query: result.query, generation: result.generation, items: result.items.map(t => card(t)), descriptive: [], ai: [], aiStatus: 'unavailable' };
  },
  uiDescriptive: async ([query, generation, epoch], store) => {
    const api = await session(store);
    if (!(await api.capabilities()).features.descriptiveSearch.available) return lane(query, generation);
    const result = await api.search({ query, generation, mode: 'descriptive', idempotencyKey: `descriptive-${epoch}-${generation}` });
    return { ...lane(result.query, result.generation), items: result.items.map(t => card(t)) };
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
    return { ...lane(query, generation), items: (ai.job.results?.items ?? []).map(t => card(t)), aiStatus: ai.job.status };
  },
  interaction: async ([receipt, kind, at], store) => {
    if (kind !== 'visible' && kind !== 'selected' && kind !== 'played') throw new Error('Invalid interaction');
    await (await session(store)).interactions({ idempotencyKey: `interaction-${kind}-${receipt}-${at}`, interactions: [{ receiptToken: receipt, kind, occurredAt: new Date(at).toISOString() }] });
    return { accepted: true };
  },
  uiPlayback: async ([id, kind, epoch], store) => {
    const api = await session(store);
    if (kind !== 'title' && kind !== 'extra') throw new Error('Unsupported playback target');
    const plan = await api.playback({ ...(kind === 'extra' ? { extraId: id } : { titleId: id }), client, idempotencyKey: `play-${epoch}-${kind}-${id}` });
    return { planJson: JSON.stringify(plan) };
  },
  playerEvent: async ([json], store) => {
    const event = JSON.parse(json);
    if (event.type !== 'observation' || typeof event.sessionId !== 'string' || !event.observation) throw new Error('Unsupported player event');
    await (await session(store)).observe(event.sessionId, event.observation);
    return { accepted: true };
  },
};
return (name, args, store, storage, native) => sources[name](args, store, storage, native);
}
