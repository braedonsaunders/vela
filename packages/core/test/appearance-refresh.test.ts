import { expect, test } from 'bun:test';
import { appearanceModel } from '../src/appearance';
import { refreshed, refreshing, settled } from '../src/store/appearance';
import { ready } from '../src/store/state';

const model = (revision: number) => appearanceModel({ revision, defaultSkinId: 'cinematic', defaultEngineId: 'cinematic', force: false, packs: [] }, 'https://server.test');

test('refreshing an unchanged appearance keeps the current model, so the page is not re-resolved', () => {
  const current = model(3);
  expect(settled(current, model(3))).toBe(current);
});

test('an unchanged ready appearance is a state-level no-op throughout a background refresh', () => {
  const current = ready(model(3));
  expect(refreshing(current)).toBe(current);
  expect(refreshed(current, model(3))).toBe(current);
});

test('a changed or first appearance replaces the model', () => {
  const next = model(4);
  expect(settled(model(3), next)).toBe(next);
  expect(settled(undefined, next)).toBe(next);
});

test('appearance loads asked for together while the app starts share one read', async () => {
  const { Appearance } = await import('../src/store/appearance');
  const { StateBox } = await import('../src/store/state');
  let reads = 0;
  const adapter = { skinDocument: async () => ({}), appearance: async () => { reads++; return { revision: 1, defaultSkinId: 'cinematic', defaultEngineId: 'cinematic', force: false, packs: [] }; } };
  const session = { epoch: 0, onReset() {}, hasServer: () => true, selected: () => ({ adapter, record: { origin: 'https://server.test' } }) };
  const box = new StateBox({ appearance: { load: 'idle' } } as never);
  const appearance = new Appearance(box as never, session as never, 16, 'https://app.test');
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('{}', { status: 404 })) as unknown as typeof fetch;
  try {
    await Promise.all([appearance.load(), appearance.load(), appearance.load()]);
    await appearance.load();
    expect(reads).toBe(1);
    session.epoch++;
    await appearance.load();
    expect(reads).toBe(2);
  } finally { globalThis.fetch = realFetch; }
});

test('a cancelled appearance request settles quietly and can be read again', async () => {
  const { Appearance } = await import('../src/store/appearance');
  const { StateBox } = await import('../src/store/state');
  let firstSignal: AbortSignal | undefined;
  const adapter = {
    skinDocument: async () => ({}),
    appearance: (signal: AbortSignal) => {
      if (firstSignal) return Promise.resolve({ revision: 2, defaultSkinId: 'cinematic', force: false, packs: [] });
      firstSignal = signal;
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new TypeError('Load failed')), { once: true }));
    },
  };
  const session = { epoch: 0, onReset() {}, hasServer: () => true, selected: () => ({ adapter, record: { origin: 'https://server.test' } }) };
  const current = ready(model(1));
  const box = new StateBox({ appearance: current });
  const appearance = new Appearance(box as never, session as never, 16, 'https://app.test');
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('{}', { status: 404 })) as unknown as typeof fetch;

  try {
    const pending = appearance.load();
    appearance.cancelLoad();
    await pending;
    expect(firstSignal?.aborted).toBe(true);
    expect(box.get().appearance).toBe(current);
    await appearance.load();
    expect(box.get().appearance.value?.revision).toBe(2);
  } finally { globalThis.fetch = realFetch; }
});
