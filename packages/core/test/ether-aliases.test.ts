import { afterEach, expect, test } from 'bun:test';
import { ServerCredentials, ServerRegistry } from '../src/session/servers';
import { createVela } from '../src/store';
import { etherAliasMerges } from '../src/store/ether-aliases';
import { device, MemoryStore, restoreFetch, routeFetch, tokens, type Seen } from './helpers';

afterEach(restoreFetch);

function storeFor(secrets: MemoryStore) {
  return createVela({ secrets, device, appVersion: '0.2.78', rendererVersion: 1, artWidth: 390, media: {
    containers: [], videoCodecs: [], audioCodecs: [], subtitleFormats: [], hdr: [],
    maxWidth: 1920, maxHeight: 1080, hls: false, mse: false,
  } });
}

function fixture() {
  const secrets = new MemoryStore();
  const registry = new ServerRegistry(secrets);
  const old = registry.add('ether', 'Same name', 'https://old.example');
  const recent = registry.add('ether', 'Same name', 'https://recent.example');
  const other = registry.add('ether', 'Same name', 'https://other.example');
  const credentials = (id: string) => new ServerCredentials(secrets, device, () => 'key', id);
  return { secrets, registry, old, recent, other, credentials };
}

test('only matching Ether identities merge and the newest working address wins by default', () => {
  const { old, recent, other } = fixture();
  const entries = [
    { record: old, serverId: 'ether-one', signedIn: true, working: true },
    { record: other, serverId: 'ether-two', signedIn: true, working: true },
    { record: recent, serverId: 'ether-one', signedIn: false, working: true },
  ];
  expect(etherAliasMerges(entries, other.id)).toEqual([{ address: recent, keep: old, aliases: [recent] }]);
  expect(etherAliasMerges(entries, other.id, old.id)).toEqual([{ address: old, keep: old, aliases: [recent] }]);
  expect(etherAliasMerges(entries.map(entry => ({ ...entry, serverId: '' })), old.id)).toEqual([]);
});

test('adding a working alias keeps the selected sign-in and returns the surviving record', async () => {
  const { secrets, registry, old, recent, other, credentials } = fixture();
  registry.select(old.id);
  const original = tokens();
  await credentials(old.id).set(original);
  const seen = routeFetch({
    'GET /vela/v0/capabilities': ({ url }: Seen) => ({
      protocolVersion: 0,
      server: { id: url.host === 'other.example' ? 'unrelated' : 'shared', name: 'Same name' },
      features: {},
    }),
  });
  const vela = storeFor(secrets);
  expect(await vela.servers.add('ether', recent.name, recent.origin)).toEqual({ id: old.id, error: '' });
  expect(registry.read()).toMatchObject({
    selectedId: old.id,
    servers: [{ ...old, origin: recent.origin }, other],
  });
  expect(await credentials(old.id).get()).toEqual(original);
  expect(await credentials(recent.id).get()).toBeNull();
  expect(seen.filter(call => call.url.pathname === '/vela/v0/capabilities').every(call => !call.headers.has('Authorization'))).toBe(true);
});

test('legacy duplicates move selection to the signed-in record and leave unproved addresses alone', async () => {
  const { secrets, registry, old, recent, other, credentials } = fixture();
  registry.select(recent.id);
  await credentials(old.id).set(tokens());
  routeFetch({
    'GET /vela/v0/capabilities': ({ url }: Seen) => url.host === 'other.example' ? new Response('', { status: 503 }) : ({
      protocolVersion: 0, server: { id: 'shared', name: 'Same name' }, features: {},
    }),
  });
  const vela = storeFor(secrets);
  await vela.servers.refresh();
  expect(registry.read()).toMatchObject({
    selectedId: old.id,
    servers: [{ ...old, origin: recent.origin }, other],
  });
  expect(await credentials(old.id).get()).toEqual(tokens());
});

test('a new working address keeps the sign-in of a previously identified offline address', async () => {
  const secrets = new MemoryStore();
  const registry = new ServerRegistry(secrets);
  const old = registry.add('ether', 'Ether', 'https://offline.example');
  registry.select(old.id);
  const credential = new ServerCredentials(secrets, device, () => 'key', old.id);
  await credential.set(tokens());
  let offline = false;
  routeFetch({
    'GET /vela/v0/capabilities': ({ url }: Seen) => offline && url.origin === old.origin ? new Response('', { status: 503 }) : ({
      protocolVersion: 0, server: { id: 'ether-identity', name: 'Ether' }, features: {},
    }),
  });
  const vela = storeFor(secrets);
  await vela.servers.refresh();
  expect(registry.read().etherIds).toEqual({ [old.id]: 'ether-identity' });
  offline = true;
  expect(await vela.servers.add('ether', 'Ether', 'https://working.example')).toEqual({ id: old.id, error: '' });
  expect(registry.read()).toMatchObject({
    selectedId: old.id,
    servers: [{ ...old, origin: 'https://working.example' }],
    etherIds: { [old.id]: 'ether-identity' },
  });
  expect(await credential.get()).toEqual(tokens());
});
