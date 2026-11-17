import { expect, test } from 'bun:test';
import { Servers, initialServers } from '../src/store/servers';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type { VelaPlatform } from '../src/store/platform';
import { routeFetch, restoreFetch, tokens } from './helpers';

test('a linked Plex server exposes an Ether offer once per session', async () => {
  const seen = routeFetch({ 'GET /vela/v0/capabilities': { protocolVersion: 0, server: { id: 'server', name: 'Ether' }, features: {} } });
  const record = { id: 'plex-id', kind: 'plex', name: 'Plex', origin: 'https://example.test', basePath: '/' } as const;
  const registry = { standalone: true, read: () => ({ selectedId: record.id, servers: [record] }), add: () => record };
  const conn = { record, credentials: { set: async () => {} } };
  const session = { servers: registry, device: { id: 'device' }, names: new Map(), epoch: 0, onReset() {}, hasServer: () => true, selected: () => conn, connection: () => conn, tokens: async () => tokens(), select: () => conn };
  const box = new StateBox({ servers: { ...initialServers, plex: { code: '123', state: 'linked', choices: [], linkUrl: '' } }, auth: { phase: 'signed-in' } } as unknown as VelaState);
  const servers = new Servers(box, session as unknown as Session, {} as VelaPlatform);
  (servers as unknown as { plexLink: unknown }).plexLink = { choose: async () => ({ origin: record.origin, origins: [record.origin], name: 'Plex', tokens: tokens() }), cancel() {} };
  try {
    expect((await servers.plexChoose('chosen')).error).toBe('');
    expect(box.get().servers.list[0]?.etherOrigin).toBe(record.origin);
    await servers.refresh();
    expect(seen.filter(r => r.url.pathname === '/vela/v0/capabilities')).toHaveLength(1);
  } finally { restoreFetch(); }
});
