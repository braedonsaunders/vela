import { expect, test } from 'bun:test';
const { attachNativePlayer } = require('../native-player.js');

function fixture(create?: Function) {
  const events: unknown[] = [];
  const calls: unknown[] = [];
  const window = { isDestroyed: () => false, setBackgroundColor: (color: string) => calls.push(color), webContents: { send: (...args: unknown[]) => events.push(args) } };
  const host = { setAccess: async (value: unknown) => { calls.push(value); }, update: async (value: unknown) => { calls.push(value); }, setBounds: async () => {}, destroy: async () => { calls.push('destroy'); } };
  let emit: Function = () => {};
  const bridge = attachNativePlayer(window, { create: async (args: any) => { emit = args.emit; return create ? create(host) : host; } });
  return { bridge, calls, events, captureEmit: () => emit, emit: (...args: unknown[]) => emit(...args) };
}

test('grant precedes props, stale mounts cannot update or emit after dispose', async () => {
  const f = fixture();
  const grant = { origin: 'https://media.invalid', pathPrefix: '/media/', headers: { Authorization: 'fixture' } };
  await f.bridge.receive({ kind: 'media-access', ...grant });
  await f.bridge.receive({ kind: 'mount', id: 'a', props: { active: true } });
  expect(f.calls.slice(1, 4)).toEqual([grant, '#00000000', { active: true }]);
  await f.bridge.receive({ kind: 'update', id: 'stale', props: { active: false } });
  expect(f.calls).not.toContainEqual({ active: false });
  await f.bridge.receive({ kind: 'dispose', id: 'a' });
  f.emit('snapshot', {});
  expect(f.events).toEqual([]);
  expect(f.calls).toContain('destroy');
});

test('close during asynchronous creation destroys the eventual host', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = fixture(async (host: unknown) => { await gate; return host; });
  const mounting = f.bridge.receive({ kind: 'mount', id: 'a', props: {} });
  await Promise.resolve();
  const closing = f.bridge.dispose();
  release(); await mounting; await closing;
  expect(f.calls.filter(value => value === 'destroy')).toHaveLength(1);
  expect(f.calls).not.toContain('#00000000');
});

test('host failure releases native surface and requests browser fallback', async () => {
  const f = fixture(host => ({ ...host, update: async () => { throw Error('private address'); } }));
  await f.bridge.receive({ kind: 'mount', id: 'a', props: {} });
  expect(JSON.stringify(f.events)).not.toContain('private address');
  expect(f.events).toContainEqual(['vela:native-event', { kind: 'event', id: 'a', event: 'fallback', value: null }]);
  expect(f.calls).toContain('destroy');
});

test('replacing a mounted player retires its event callbacks', async () => {
  const f = fixture();
  await f.bridge.receive({ kind: 'mount', id: 'a', props: {} });
  const oldEmit = f.captureEmit();
  await f.bridge.receive({ kind: 'dispose', id: 'a' });
  oldEmit('observation', { sessionId: 'a' });
  expect(f.events).toEqual([]);
  await f.bridge.receive({ kind: 'media-access', origin: null });
  await f.bridge.receive({ kind: 'mount', id: 'b', props: { active: true } });
  oldEmit('observation', { sessionId: 'a' });
  f.emit('snapshot', { state: 'playing' });
  expect(f.events).toEqual([['vela:native-event', { kind: 'event', id: 'b', event: 'snapshot', value: { state: 'playing' } }]]);
});
