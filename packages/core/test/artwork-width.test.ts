import { expect, test } from 'bun:test';
import { artworkURL } from '../src/discovery/artwork';
import { detailModel, entry } from '../src/discovery/models';
import { createVela } from '../src/store';
import { Session } from '../src/store/session';
import type { VelaPlatform } from '../src/store/platform';
import type { ArtworkRef, Title } from '../src/wire';
import { MemoryStore, restoreFetch, routeFetch, tokens } from './helpers';

const origin = 'https://fixture.test';
const grant = '?signature=a%2fb%2B+%20&w=3840&expiry=1000';
const image: ArtworkRef = { id: 'a', kind: 'backdrop', tag: 'fixture', sizes: [{ width: 3840, height: 2160, url: '/vela/v0/images/a' + grant }] };

test('browser Ether artwork lowers only its width and covers height as well as width', () => {
  const images = { origin, fitProxyWidth: true };
  expect(artworkURL(image, 1440, 900, images)).toBe(origin + '/vela/v0/images/a' + grant.replace('3840', '1600'));
  expect(artworkURL(image, 4500, 2400, images)).toBe(origin + '/vela/v0/images/a' + grant);
});

test('the proxy width is untouched without fitProxyWidth and on foreign artwork origins', () => {
  expect(artworkURL(image, 1440, 900, { origin })).toBe(origin + '/vela/v0/images/a' + grant);
  const foreign = 'https://other.test/vela/v0/images/a' + grant;
  expect(artworkURL({ ...image, sizes: [{ ...image.sizes[0]!, url: foreign }] }, 1440, 900,
    { origin, fitProxyWidth: true })).toBe(foreign);
});

test('unmeasured proxy artwork never requests the original with w=0', () => {
  const unmeasured: ArtworkRef = { id: 'poster', kind: 'poster', tag: '', sizes: [{ width: 0, height: 0, url: '/vela/v0/images/poster?w=0&signature=x' }] };
  expect(artworkURL(unmeasured, 400, 600, { origin, fitProxyWidth: true }))
    .toBe(`${origin}/vela/v0/images/poster?w=400&signature=x`);
  expect(artworkURL({ ...unmeasured, sizes: [{ ...unmeasured.sizes[0]!, url: '/vela/v0/images/poster?signature=x' }] }, 400, 600, { origin, fitProxyWidth: true }))
    .toBe(`${origin}/vela/v0/images/poster?signature=x&w=400`);
});

test('every platform fits Ether proxy widths: TV title pages cap backdrops to artWidth and row cards to 1280', async () => {
  const still: ArtworkRef = {
    id: 'still',
    kind: 'still',
    tag: 'fixture',
    sizes: [{ width: 3840, height: 2160, url: '/vela/v0/images/still?h=2160&w=3840&sig=1' }],
  };
  const title: Title = {
    id: 'robbing',
    kind: 'movie',
    name: "I'm Robbing the House on Christmas Eve",
    summary: '',
    genres: [],
    artwork: [still],
  };
  for (const platform of ['web', 'androidtv', 'tvos', 'android', 'ios'] as const) {
    const session = new Session({
      etherOrigin: origin,
      secrets: new MemoryStore(),
      device: { name: platform, platform },
      appVersion: '0.2.54',
      media: { containers: [], videoCodecs: [], audioCodecs: [], subtitleFormats: [], hls: true, mse: false, hdr: [] },
      artWidth: 1920,
    } satisfies VelaPlatform);
    const images = await session.selected().images();
    expect(images.fitProxyWidth).toBe(true);

    const rowCard = entry({ id: 'row-1', kind: 'title', title, receiptToken: '' }, images, 1920);
    expect(rowCard.backdrop).toBe(`${origin}/vela/v0/images/still?h=2160&w=1280&sig=1`);

    const detail = detailModel(
      {
        title,
        cast: [{ id: 'p1', name: 'Lead', artwork: { id: 'p1', kind: 'poster', tag: '', sizes: [{ width: 185, height: 278, url: '/vela/v0/images/p1?h=278&w=185' }] } }],
        crew: [],
        seasons: [{ ...title, id: 's1', kind: 'season', seasonNumber: 1 }],
        episodes: [{ ...title, id: 'e1', kind: 'episode', seasonNumber: 1, episodeNumber: 1 }],
        nextUp: { ...title, id: 'e1', kind: 'episode', seasonNumber: 1, episodeNumber: 1 },
        chapters: [],
        extras: [],
      },
      images,
      1920,
    );
    expect(detail.title[0]!.backdrop).toBe(`${origin}/vela/v0/images/still?h=2160&w=1920&sig=1`);
    expect(detail.castPeople[0]!.portrait).toBe(`${origin}/vela/v0/images/p1?h=278&w=160`);
    expect(detail.seasons[0]!.backdrop).toBe(`${origin}/vela/v0/images/still?h=2160&w=1280&sig=1`);
    expect(detail.episodes[0]!.backdrop).toBe(`${origin}/vela/v0/images/still?h=2160&w=1280&sig=1`);
    expect(detail.nextUp?.[0]!.backdrop).toBe(`${origin}/vela/v0/images/still?h=2160&w=1280&sig=1`);
  }
});

test('the store caps artWidth at 3840 even when a high-DPI 4K display reports 7680', async () => {
  const unmeasured: ArtworkRef = {
    id: 'backdrop',
    kind: 'backdrop',
    tag: 'fixture',
    sizes: [{ width: 0, height: 0, url: '/vela/v0/images/backdrop?w=0&sig=1' }],
  };
  const title: Title = { id: 't1', kind: 'movie', name: '4K Title', summary: '', genres: [], artwork: [unmeasured] };
  const secrets = new MemoryStore();
  secrets.set('vela.session', JSON.stringify(tokens()));
  routeFetch({
    'GET /vela/v0/titles/t1': { title, cast: [], crew: [], chapters: [], extras: [] },
    'GET /vela/v0/capabilities': {
      protocolVersions: [0],
      serverVersion: '0.2.54',
      skins: [],
      authMethods: [],
      features: { liveTV: { available: false }, aiSearch: { available: false }, descriptiveSearch: { available: false } },
    },
  });
  try {
    const vela = createVela({
      etherOrigin: origin,
      secrets,
      device: { name: 'Android TV', platform: 'androidtv' },
      appVersion: '0.2.54',
      media: { containers: [], videoCodecs: [], audioCodecs: [], subtitleFormats: [], hls: true, mse: false, hdr: [] },
      artWidth: 7680,
      rendererVersion: 1,
    });
    await vela.catalogue.title('t1');
    expect(vela.getState().titles['t1']?.value?.title[0]?.backdrop).toBe(`${origin}/vela/v0/images/backdrop?w=3840&sig=1`);
  } finally {
    restoreFetch();
  }
});
