import { afterEach, expect, test } from 'bun:test';
import { featuredFixture } from './home-hero-fixtures';
import { FakeCredentials, restoreFetch, routeFetch } from './helpers';
import { homeHeroes } from '../src/adapter/home-heroes';
import { nativeConnection } from '../src/adapter/connection';
afterEach(restoreFetch);
for (const provider of ['plex','jellyfin'] as const) test(`${provider} features real resume, next-up and recent titles with series art and a six-title cap`, async () => {
  const { home, ids } = await featuredFixture(provider);
  const heroes = home.heroes!;
  expect(heroes.map(h => h.title.id)).toEqual(ids);
  expect(heroes.map(h => h.reason)).toEqual(['resume','nextEpisode','newRelease','newRelease','newRelease','newRelease']);
  expect(heroes[0]!.action).toEqual({ kind: 'resume', titleId: 'resume', positionSeconds: 80 });
  expect(heroes[1]!.action.kind).toBe('play');
  expect(heroes[3]!.action.kind).toBe('details');
  expect(heroes.every(h => !!h.receiptToken)).toBe(true);
  expect(heroes.every(h => h.title.artwork.find(a => a.kind === 'backdrop')?.sizes[0]?.width === 1920)).toBe(true);
  const episode = heroes[1]!.title;
  const backdrop = episode.artwork.find(a => a.kind === 'backdrop')!;
  const logo = episode.artwork.find(a => a.kind === 'logo')!;
  expect(decodeURIComponent(backdrop.sizes[0]!.url)).toContain(provider === 'plex' ? '/series/art' : '/series/Images/Backdrop');
  expect(decodeURIComponent(logo.sizes[0]!.url)).toContain(provider === 'plex' ? '/series/logo' : '/series/Images/Logo');
  expect(episode.artwork.find(a => a.kind === 'poster')?.sizes[0]?.width).toBe(600);
  expect(home.rows[0]!.items.map(i => i.id)).toEqual(['no-backdrop']);
  expect(home.rows[1]!.items.map(i => i.id)).toEqual(['next']); // Never empty a shelf.
  expect(home.rows[2]!.items.some(i => i.id === 'recent')).toBe(false);
});
test('promoted items fill the remaining hero slots without mutating server rows', async () => {
  const { home } = await featuredFixture('plex');
  const row = { ...home.rows[1]!, purpose: 'recommendation' as const };
  const result = homeHeroes([row], 'plex', url => url);
  expect(result.heroes.map(h => h.reason)).toEqual(['featured']);
  expect(row.items.length).toBe(1);
  expect(result.rows[0]!.items.length).toBe(1);
});
test('Plex hero art reaches the image service as the server\'s own artwork, which it sizes', async () => {
  const { home } = await featuredFixture('plex');
  routeFetch({ 'GET /security/token': { token: 'transient-art' } });
  const connection = nativeConnection({ id: 'p', kind: 'plex', name: 'Plex', origin: 'https://media.example', basePath: '/' }, new FakeCredentials(), () => {});
  const images = await connection.images();
  for (const kind of ['backdrop', 'logo', 'poster'] as const) {
    const url = home.heroes![1]!.title.artwork.find(a => a.kind === kind)!.sizes[0]!.url;
    const sized = images.sized?.(new URL(url), 1920, 1080);
    expect(sized).toBeDefined();
    expect(new URL(sized!).searchParams.get('url')).toStartWith('/library/metadata/series/');
  }
});
