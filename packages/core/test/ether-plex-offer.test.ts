import { expect, test } from 'bun:test';
import { Servers, initialServers } from '../src/store/servers';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type { VelaPlatform } from '../src/store/platform';
import { MemoryStore, tokens } from './helpers';
import { ServerRegistry } from '../src/session/servers';

test('a linked Ether choice saves Vela tokens before selecting its native protocol', async () => {
  const record = { id: 'ether-id', kind: 'ether', name: 'Ether', origin: 'https://example.test', basePath: '/' } as const;
  const calls: string[] = [];
  const conn = { record, credentials: { set: async (value: unknown) => { expect(value).toEqual(tokens('vela-session')); calls.push('tokens'); } } };
  const registry = { read: () => ({ servers: [] }), add: (kind: string) => { expect(kind).toBe('ether'); return record; } };
  const session = { servers: registry, device: { id: 'device' }, key: () => 'key', onReset() {}, selected: () => ({}), connection: () => conn, select: (id: string) => { expect(id).toBe(record.id); calls.push('select'); } };
  const box = new StateBox({ servers: { ...initialServers, plex: { code: '123', state: 'linked', choices: [], linkUrl: '' } } } as unknown as VelaState);
  const servers = new Servers(box, session as unknown as Session, {} as VelaPlatform);
  (servers as unknown as { plexLink: unknown }).plexLink = { choose: async () => ({ ...record, origins: [record.origin], tokens: tokens('vela-session') }), cancel() {} };
  expect(await servers.plexChoose('chosen')).toEqual({ id: record.id, error: '' });
  expect(calls).toEqual(['tokens', 'select']);
  expect(box.get().servers.plex).toBeNull();
});

test('a newly linked empty resource list retries at 3s and 10s without another PIN', async () => {
  const box = new StateBox({ servers: initialServers } as unknown as VelaState);
  const session = { onReset() {} };
  const servers = new Servers(box, session as unknown as Session, {} as VelaPlatform);
  let refreshes = 0;
  const link = { poll: async () => 'linked', servers: () => [], hasEtherServer: async () => false, refreshServers: async () => { refreshes++; } };
  const internal = servers as unknown as { plexLink: unknown; schedulePlexPoll: (link: unknown, code: string, delay: number) => void; plexPoll: (link: unknown, code: string) => Promise<void> };
  internal.plexLink = link;
  const delays: number[] = [];
  internal.schedulePlexPoll = (_, __, delay) => { delays.push(delay); };
  await internal.plexPoll(link, 'pin');
  expect(box.get().servers.plex?.state).toBe('waiting');
  await internal.plexPoll(link, 'pin');
  await internal.plexPoll(link, 'pin');
  expect(delays).toEqual([3000, 10000]);
  expect(refreshes).toBe(2);
  expect(box.get().servers.plex?.state).toBe('linked');
});


test('older Ether discovered through Plex stays saved and selected for password/code sign-in', async () => {
  const registry = new ServerRegistry(new MemoryStore());
  const calls: string[] = [];
  const session = { servers: registry, device: { id: 'device' }, key: () => 'key', onReset() {},
    select: (id: string) => { registry.select(id); calls.push('select'); },
    connection: () => { throw new Error('No credentials may be saved for an unsupported exchange'); } };
  const box = new StateBox({ servers: { ...initialServers, plex: { code: '123', state: 'linked', choices: [], linkUrl: '' } } } as unknown as VelaState);
  const servers = new Servers(box, session as unknown as Session, {} as VelaPlatform);
  servers.refresh = async () => { calls.push('refresh'); };
  (servers as unknown as { plexLink: unknown }).plexLink = { choose: async () => ({
    kind: 'ether', name: 'Production Ether', origin: 'https://older.example', origins: ['https://older.example'],
    tokens: null, note: 'Plex sign-in needs Ether 0.3.16 or later',
  }), cancel() {} };
  const result = await servers.plexChoose('chosen');
  expect(result.error).toBe('');
  expect(result.note).toBe('Plex sign-in needs Ether 0.3.16 or later');
  expect(registry.read()).toEqual({ selectedId: result.id, servers: [{ id: result.id, kind: 'ether', name: 'Production Ether', origin: 'https://older.example', basePath: '/' }] });
  expect(calls).toEqual(['select', 'refresh']);
  expect(box.get().servers.plex).toBeNull();
});
