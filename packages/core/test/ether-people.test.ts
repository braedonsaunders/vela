import { expect, test } from 'bun:test';
import { EtherAdapter } from '../src/adapter/ether';
import { hasLibraryRecommendations, hasPersonFilmography } from '../src/adapter/capabilities';
import { FakeCredentials } from './helpers';
import { launchMock } from '../../../mock-server/test/launch';

async function connect(old = false) {
  const mock = await launchMock(old ? { VELA_MOCK_OLD: '1' } : {});
  const credentials = new FakeCredentials(null);
  const adapter = new EtherAdapter(mock.url, credentials, 'test');
  credentials.current = await adapter.signInWithPassword({ username: 'demo', password: 'vela', device: credentials.device, idempotencyKey: 'sign-in' });
  return { mock, adapter, credentials };
}

test('Ether person and library capabilities use the scoped endpoints', async () => {
  const { mock, adapter, credentials } = await connect();
  try {
    expect(hasPersonFilmography(adapter)).toBe(false);
    await adapter.probeLibraryViews('movies');
    expect(hasLibraryRecommendations(adapter)).toBe(true);
    const detail = await adapter.detail('title-1-1');
    expect(detail.cast[0]?.id).toBe('person-mara-vale');
    expect(hasPersonFilmography(adapter)).toBe(true);
    const person = await adapter.personDetails('person-mara-vale');
    expect(person).toMatchObject({ name: 'Mara Vale', knownFor: 'Acting', birthday: '1985-04-12' });
    const image = new URL(person.photo!.sizes[0]!.url, mock.url);
    expect((await fetch(image)).status).toBe(200);
    image.searchParams.set('grant', 'invalid');
    expect((await fetch(image)).status).toBe(401);
    expect((await adapter.personTitles('person-mara-vale', 'movies')).items[0]).toMatchObject({ kind: 'title', role: 'Commander' });
    expect((await adapter.libraryRows('movies', 'movies')).length).toBeGreaterThan(0);
    const collections = await adapter.libraryCollections('movies');
    expect(collections.items[0]).toMatchObject({ kind: 'collection', targetId: 'fixture-collection' });
    expect((await adapter.library('movies', { collectionId: 'fixture-collection' })).items).toHaveLength(1);
    await expect(adapter.personDetails('unknown')).rejects.toMatchObject({ status: 404 });
    expect(hasPersonFilmography(adapter)).toBe(true);
    await expect(adapter.rows({ placement: 'home', libraryId: 'movies' })).rejects.toMatchObject({ status: 400 });
    await expect(adapter.rows({ placement: 'library', libraryId: 'hidden' })).rejects.toMatchObject({ status: 404 });
    await expect(adapter.libraryCollections('hidden')).rejects.toMatchObject({ status: 404 });
    await expect(adapter.personTitles('person-mara-vale', 'hidden')).rejects.toMatchObject({ status: 404 });
    const duplicate = await fetch(`${mock.url}/vela/v0/rows?placement=library&libraryId=movies&libraryId=shows`, { headers: { Authorization: `Bearer ${credentials.current!.accessToken}`, 'X-Vela-Device-Id': credentials.device.id } });
    expect(duplicate.status).toBe(400);
  } finally { await mock.stop(); }
});

test('older Ether remembers unavailable capabilities', async () => {
  const { mock, adapter } = await connect(true);
  try {
    await adapter.probeLibraryViews('movies');
    await adapter.detail('title-1-1');
    expect(hasLibraryRecommendations(adapter)).toBe(false);
    expect(hasPersonFilmography(adapter)).toBe(false);
    await adapter.probeLibraryViews('movies');
  } finally { await mock.stop(); }
});
