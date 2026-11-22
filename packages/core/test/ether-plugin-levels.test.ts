// The Ether adapter against the mock's plugin levels: a recommended tab's own shelves (?tab=),
// an artist's children one level at a time (?role=), and a server from before them.
import { expect, test } from 'bun:test';
import { EtherAdapter } from '../src/adapter/ether';
import { FakeCredentials } from './helpers';
import { launchMock } from '../../../mock-server/test/launch';

async function connect(env: Record<string, string> = {}) {
  const mock = await launchMock(env);
  const credentials = new FakeCredentials(null);
  const adapter = new EtherAdapter(mock.url, credentials, 'test');
  credentials.current = await adapter.signInWithPassword({ username: 'demo', password: 'vela', device: credentials.device, idempotencyKey: 'sign-in' });
  await adapter.libraries({ limit: 100 });
  return { mock, adapter };
}

test('a recommended tab reads its own shelves; an artist reads albums and concerts apart', async () => {
  const { mock, adapter } = await connect();
  try {
    expect((await adapter.describe()).features.pluginLevels).toEqual({ available: true, tabRows: true, childRoles: true });
    const concerts = await adapter.libraryRows('music', 'shows', false, 'concerts');
    expect(concerts.length).toBeGreaterThan(2);
    expect(concerts.every(row => row.id.startsWith('plugin:music:tab:concerts:shelf:'))).toBe(true);
    const titles = concerts.flatMap(row => row.items.flatMap(item => item.kind === 'title' ? [item.title] : []));
    expect(titles.every(title => title.kind === 'movie' && title.media?.class === 'video' && title.media.role === 'concert' && title.media.parents?.[0]?.role === 'artist')).toBe(true);
    // No tab, or the first recommended tab, is the library's rows as before.
    const library = await adapter.libraryRows('music', 'shows');
    expect(library.map(row => row.id)).toEqual((await adapter.libraryRows('music', 'shows', false, 'recommended')).map(row => row.id));
    expect(library.some(row => row.id.includes(':tab:'))).toBe(false);

    const artist = (await adapter.detail('artist-hollow-lanterns')).title;
    expect(artist.media?.childCounts).toEqual({ album: 3, concert: 2 });
    expect((await adapter.children('artist-hollow-lanterns', undefined, 100, 'album')).items.map(title => title.media?.role)).toEqual(['album', 'album', 'album']);
    expect((await adapter.children('artist-hollow-lanterns', undefined, 100, 'concert')).items.map(title => title.kind)).toEqual(['movie', 'movie']);
    expect((await adapter.detail('artist-harbour-brass-collective')).title.media?.childCounts).toEqual({ concert: 3 });
    expect((await adapter.detail('artist-mira-solenne')).title.media?.childCounts).toEqual({ album: 2 });
    // A concert's own page plays as video and names its artist.
    const concert = await adapter.detail('concert-lanterns-live-at-the-boathouse');
    expect(concert.canPlay).toBe(true);
    expect(concert.title.media?.parents).toEqual([{ id: 'artist-hollow-lanterns', name: 'The Hollow Lanterns', role: 'artist' }]);
  } finally { await mock.stop(); }
});

test('a server without plugin levels has no tab rows, no counts and no video children', async () => {
  const { mock, adapter } = await connect({ VELA_MOCK_NO_LEVELS: '1' });
  try {
    expect((await adapter.describe()).features.pluginLevels).toBeUndefined();
    const music = (await adapter.libraries({ limit: 100 })).items.find(library => library.id === 'music')!;
    expect(music.tabs?.some(tab => tab.id === 'concerts')).toBe(false);
    // An older server ignores ?tab=: the library's own rows (Vela never sends it one).
    expect((await adapter.libraryRows('music', 'shows', false, 'concerts')).map(row => row.id)).toEqual((await adapter.libraryRows('music', 'shows')).map(row => row.id));
    const artist = (await adapter.detail('artist-hollow-lanterns')).title;
    expect(artist.media?.childCounts).toBeUndefined();
    expect(artist.media?.childCount).toBe(3);
    expect((await adapter.children('artist-hollow-lanterns')).items.map(title => title.media?.role)).toEqual(['album', 'album', 'album']);
  } finally { await mock.stop(); }
});
