import { describe, expect, test } from 'bun:test';
import { ServerCredentials, ServerRegistry, serverAddress } from '../src/session/servers';
import { MemoryStore, device, tokens } from './helpers';

const ETHER = 'https://ether.example';

describe('serverAddress', () => {
  test('keeps the origin and a base path without trailing slashes', () => {
    expect(serverAddress('https://media.example:8920/jellyfin///', 'jellyfin')).toEqual({ origin: 'https://media.example:8920', basePath: '/jellyfin' });
    expect(serverAddress('http://10.0.0.2:8096', 'emby')).toEqual({ origin: 'http://10.0.0.2:8096', basePath: '/' });
  });

  test.each([
    ['ftp://media.example', 'not http(s)'],
    ['https://user:secret@media.example', 'user-info'],
    ['https://media.example/?api_key=1', 'a query'],
    ['https://media.example/#top', 'a fragment'],
    ['https://media.example/a%2e%2e/b', 'an encoded dot'],
    ['https://media.example/a%2Fb', 'an encoded slash'],
    ['https://media.example/a%5cb', 'an encoded backslash'],
    ['https://media.example/a%25', 'an encoded percent'],
  ])('refuses %s (%s)', value => {
    expect(() => serverAddress(value, 'jellyfin')).toThrow('Invalid server address');
  });

  test('refuses text that is not a URL', () => {
    expect(() => serverAddress('media.example', 'jellyfin')).toThrow();
  });

  test('Plex takes an origin only', () => {
    expect(serverAddress('https://plex.example:32400/', 'plex')).toEqual({ origin: 'https://plex.example:32400', basePath: '/' });
    expect(() => serverAddress('https://plex.example:32400/web', 'plex')).toThrow('Plex requires a server origin');
  });
});

describe('ServerRegistry', () => {
  const registry = (store = new MemoryStore()) => ({ store, servers: new ServerRegistry(store, ETHER) });

  test('an empty store holds only the implicit Ether server, selected', () => {
    const { servers, store } = registry();
    expect(servers.read()).toEqual({ selectedId: 'ether', servers: [{ id: 'ether', name: 'Vela', kind: 'ether', origin: ETHER, basePath: '/' }] });
    expect(store.writes).toBe(0);
  });

  test('add stores a trimmed record with a v4 id and normalised address', () => {
    const { servers } = registry();
    const record = servers.add('jellyfin', '  Living room  ', 'https://media.example/jf/');
    expect(record.id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(record).toMatchObject({ name: 'Living room', kind: 'jellyfin', origin: 'https://media.example', basePath: '/jf' });
    expect(servers.read().servers.map(s => s.id)).toEqual(['ether', record.id]);
    expect(servers.get(record.id)).toEqual(record);
    // Adding does not select.
    expect(servers.read().selectedId).toBe('ether');
  });

  test('adding the same server again returns the first record', () => {
    const { servers, store } = registry();
    const first = servers.add('emby', 'Emby', 'https://media.example/emby');
    const writes = store.writes;
    expect(servers.add('emby', 'Another name', 'https://media.example/emby/')).toEqual(first);
    expect(store.writes).toBe(writes);
    // The same address under another kind is a different server.
    expect(servers.add('jellyfin', 'Jellyfin', 'https://media.example/emby').id).not.toBe(first.id);
  });

  test('add refuses blank or overlong names and the Ether kind', () => {
    const { servers } = registry();
    expect(() => servers.add('jellyfin', '   ', 'https://media.example')).toThrow('Invalid server');
    expect(() => servers.add('jellyfin', 'x'.repeat(101), 'https://media.example')).toThrow('Invalid server');
    expect(() => servers.add('ether' as 'jellyfin', 'Ether', 'https://media.example')).toThrow('Invalid server');
  });

  test('select persists, and refuses unknown ids', () => {
    const { servers, store } = registry();
    const record = servers.add('plex', 'Plex', 'https://plex.example:32400');
    servers.select(record.id);
    expect(new ServerRegistry(store, ETHER).read().selectedId).toBe(record.id);
    expect(() => servers.select('00000000-0000-4000-8000-000000000000')).toThrow('Server not found');
    expect(() => servers.get('missing')).toThrow('Server not found');
  });

  test('relocate keeps the id and replaces name and address', () => {
    const { servers } = registry();
    const record = servers.add('jellyfin', 'Old', 'http://192.168.1.4:8096');
    const moved = servers.relocate(record.id, ' New ', 'https://media.example/jf');
    expect(moved).toEqual({ ...record, name: 'New', origin: 'https://media.example', basePath: '/jf' });
    expect(servers.get(record.id)).toEqual(moved);
  });

  test('relocate refuses the Ether server and an address another record holds', () => {
    const { servers } = registry();
    const a = servers.add('jellyfin', 'A', 'https://a.example');
    servers.add('jellyfin', 'B', 'https://b.example');
    expect(() => servers.relocate(a.id, 'A', 'https://b.example')).toThrow('Server already added');
    expect(() => servers.relocate('ether', 'Vela', 'https://c.example')).toThrow('Server not found');
    expect(() => servers.relocate(a.id, '', 'https://c.example')).toThrow('Server not found');
  });

  test('removing the selected server selects Ether; Ether cannot be removed', () => {
    const { servers } = registry();
    const keep = servers.add('jellyfin', 'Keep', 'https://keep.example');
    const drop = servers.add('emby', 'Drop', 'https://drop.example');
    servers.select(drop.id);
    servers.remove(drop.id);
    expect(servers.read()).toMatchObject({ selectedId: 'ether' });
    expect(servers.read().servers.map(s => s.id)).toEqual(['ether', keep.id]);
    expect(() => servers.remove('ether')).toThrow('Cannot remove the default server');
    expect(() => servers.remove(drop.id)).toThrow('Server not found');
  });

  test('a stored selection that no longer exists falls back to Ether', () => {
    const store = new MemoryStore();
    store.set('vela.servers', JSON.stringify({ selectedId: 'gone', servers: [] }));
    expect(new ServerRegistry(store, ETHER).read().selectedId).toBe('ether');
  });

  test('a stored Ether record is ignored in favour of the configured origin', () => {
    const store = new MemoryStore();
    store.set('vela.servers', JSON.stringify({ selectedId: 'ether', servers: [{ id: 'ether', name: 'Old', kind: 'ether', origin: 'https://old.example', basePath: '/' }] }));
    expect(new ServerRegistry(store, ETHER).read().servers).toEqual([{ id: 'ether', name: 'Vela', kind: 'ether', origin: ETHER, basePath: '/' }]);
  });

  const valid = { id: '0b8f5a52-3c1e-4d6a-9f00-1234567890ab', name: 'Media', kind: 'jellyfin', origin: 'https://media.example', basePath: '/jf' };
  test.each([
    ['a malformed registry', { servers: 'nope' }],
    ['a malformed id', { selectedId: 'ether', servers: [{ ...valid, id: 'short' }] }],
    ['an unknown kind', { selectedId: 'ether', servers: [{ ...valid, kind: 'kodi' }] }],
    ['a blank name', { selectedId: 'ether', servers: [{ ...valid, name: ' ' }] }],
    ['a non-canonical base path', { selectedId: 'ether', servers: [{ ...valid, basePath: '/jf/' }] }],
    ['an origin with a path', { selectedId: 'ether', servers: [{ ...valid, origin: 'https://media.example/x', basePath: '/' }] }],
    ['a duplicate id', { selectedId: 'ether', servers: [valid, valid] }],
  ])('refuses a stored registry with %s', (_label, stored) => {
    const store = new MemoryStore();
    store.set('vela.servers', JSON.stringify(stored));
    expect(() => new ServerRegistry(store, ETHER).read()).toThrow();
  });
});

describe('ServerCredentials', () => {
  test('each server keeps its own session in one shared secret', async () => {
    const store = new MemoryStore();
    const a = new ServerCredentials(store, device, () => 'key', 'server-a');
    const b = new ServerCredentials(store, device, () => 'key', 'server-b');
    expect(await a.get()).toBeNull();
    await a.set(tokens('a-token'));
    await b.set(tokens('b-token'));
    expect((await a.get())?.accessToken).toBe('a-token');
    expect((await b.get())?.accessToken).toBe('b-token');
    expect(Object.keys(JSON.parse(store.get('vela.server-sessions')!))).toEqual(['server-a', 'server-b']);
    await a.set(null);
    expect(await a.get()).toBeNull();
    expect((await b.get())?.accessToken).toBe('b-token');
  });

  test('an unchanged session is not rewritten', async () => {
    const store = new MemoryStore();
    const credentials = new ServerCredentials(store, device, () => 'key', 'server-a');
    await credentials.set(tokens('same'));
    const writes = store.writes;
    await credentials.set(tokens('same'));
    await new ServerCredentials(store, device, () => 'key', 'other').set(null);
    expect(store.writes).toBe(writes);
  });

  test('a corrupt sessions secret is refused', async () => {
    const store = new MemoryStore();
    store.set('vela.server-sessions', '[]');
    await expect(new ServerCredentials(store, device, () => 'key', 'a').get()).rejects.toThrow('Invalid server sessions');
  });
});
