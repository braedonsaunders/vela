import { expect, test } from 'bun:test';
import { Servers, initialServers } from '../src/store/servers';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type { VelaPlatform } from '../src/store/platform';
import { tokens } from './helpers';

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
