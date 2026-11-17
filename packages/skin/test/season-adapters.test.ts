import { afterEach, expect, test } from 'bun:test';
import { EtherAdapter } from '../../core/src/adapter/ether';
import { PlexAdapter } from '../../core/src/adapter/plex';
import { JellyfinAdapter } from '../../core/src/adapter/jellyfin';
import { nativeConnection } from '../../core/src/adapter/connection';
import { detailModel } from '../../core/src/discovery/models';
import { FakeCredentials, restoreFetch, routeFetch } from '../../core/test/helpers';
import { detailSeason } from '../../../apps/vela/src/detail-season';
import { accessor, collection, type Env } from '../src/vocabulary';

afterEach(restoreFetch);
const base = { name: 'MobLand', summary: '', genres: [], artwork: [] };
const show = '000000000000000100071afd4990c7a6';
const s1 = '0000000000000001000aa87c81fa4461', s2 = '0000000000000001000aa87c81fa4462';
const e1 = '0000000000000001000e383b56893e11', e2 = 'season-two-episode';

for (const kind of ['ether', 'plex', 'jellyfin', 'emby'] as const) test(`${kind} adapter → display → environment → binding: default, picked and linked seasons`, async () => {
  const credentials = new FakeCredentials();
  const season = (id: string, seasonNumber: number) => ({ ...base, id, kind: 'season', seasonNumber, episodeNumber: 0, showId: show });
  const episode = (id: string, seasonNumber: number) => ({ ...base, id, kind: 'episode', name: seasonNumber === 1 ? 'Stick or Twist' : 'Season two episode', seasonNumber, episodeNumber: 1, showId: show });
  const seasons = [season(s1, 1), season(s2, 2)];
  const detail = (title: object, extra: object = {}) => ({ title, extras: [], chapters: [], cast: [], ...extra });
  const origin = 'https://media.example';
  let adapter;
  if (kind === 'ether') {
    // Exact lab shape: opaque season ids, episode seasonNumber, no episode seasonId;
    // the show answer includes only season 1, and a season answer has no seasons array.
    routeFetch({
      [`GET /vela/v0/titles/${show}`]: detail({ ...base, id: show, kind: 'show' }, { seasons, episodes: [episode(e1, 1)] }),
      [`GET /vela/v0/titles/${s1}`]: detail(season(s1, 1), { episodes: [episode(e1, 1)] }),
      [`GET /vela/v0/titles/${s2}`]: detail(season(s2, 2), { episodes: [episode(e2, 2)] }),
    });
    adapter = new EtherAdapter(origin, credentials, 'test');
  } else if (kind === 'plex') {
    const ep = (id: string, number: number) => ({ ratingKey: id, type: 'episode', title: id, parentRatingKey: number === 1 ? s1 : s2, parentIndex: number, index: 1 });
    routeFetch({
      [`GET /library/metadata/${show}`]: { MediaContainer: { Metadata: [{ ratingKey: show, type: 'show', title: 'MobLand' }] } },
      [`GET /library/metadata/${show}/children`]: { MediaContainer: { Metadata: [{ ratingKey: s1, type: 'season', index: 1 }, { ratingKey: s2, type: 'season', index: 2 }] } },
      [`GET /library/metadata/${show}/allLeaves`]: { MediaContainer: { Metadata: [ep(e1, 1), ep(e2, 2)] } },
      [`GET /library/metadata/${s1}`]: { MediaContainer: { Metadata: [{ ratingKey: s1, type: 'season', index: 1 }] } },
      [`GET /library/metadata/${s1}/children`]: { MediaContainer: { Metadata: [ep(e1, 1)] } },
      [`GET /library/metadata/${s2}`]: { MediaContainer: { Metadata: [{ ratingKey: s2, type: 'season', index: 2 }] } },
      [`GET /library/metadata/${s2}/children`]: { MediaContainer: { Metadata: [ep(e2, 2)] } },
    });
    adapter = new PlexAdapter({ origin, credentials, clientIdentifier: 'test' });
  } else {
    const ep = (id: string, n: number) => ({ Id: id, Type: 'Episode', Name: id, SeriesId: show, SeasonId: n === 1 ? s1 : s2, ParentIndexNumber: n, IndexNumber: 1 });
    routeFetch({
      [`GET /Users/viewer-1/Items/${show}`]: { Id: show, Type: 'Series', Name: 'MobLand' },
      [`GET /Shows/${show}/Seasons`]: { Items: [{ Id: s1, Type: 'Season', IndexNumber: 1 }, { Id: s2, Type: 'Season', IndexNumber: 2 }] },
      [`GET /Shows/${show}/Episodes`]: (r: import('../../core/test/helpers').Seen) => ({ Items: r.url.searchParams.get('SeasonId') === s1 ? [ep(e1, 1)] : r.url.searchParams.get('SeasonId') === s2 ? [ep(e2, 2)] : [ep(e1, 1), ep(e2, 2)] }),
      [`GET /Users/viewer-1/Items/${s1}`]: { Id: s1, Type: 'Season', Name: 'Season 1', SeriesId: show, IndexNumber: 1 },
      [`GET /Users/viewer-1/Items/${s2}`]: { Id: s2, Type: 'Season', Name: 'Season 2', SeriesId: show, IndexNumber: 2 },
      'GET /Shows/NextUp': { Items: [] },
    });
    adapter = kind === 'jellyfin' ? new JellyfinAdapter(origin, credentials) : nativeConnection({ id: 'emby', kind: 'emby', name: 'Emby', origin, basePath: '/' }, credentials, () => {}).adapter;
  }
  const model = detailModel(await adapter.detail(show));
  const initial = detailModel(await adapter.detail(s1));
  const picked = detailModel(await adapter.detail(s2));
  for (const loaded of [false, true]) for (const selection of ['', s1, s2, '@number:2', 'stale-other-show']) {
    const result = detailSeason(model, selection, id => loaded ? id === s2 ? picked : initial : undefined);
    const env = { detail: result.detail, season: result.season } as Env;
    const two = selection === s2 || selection === '@number:2';
    // Ether has no second-season episodes until the scoped request resolves.
    if (!loaded && two && kind === 'ether') {
      expect(collection('detail.episodes', { index: 0 }, env, 100)).toEqual([]);
      continue;
    }
    expect(result.season).toBe(two ? s2 : s1);
    expect(collection('detail.episodes', { index: 0 }, env, 100).map(ctx => ctx.card!.id)).toEqual([two ? e2 : e1]);
    expect(accessor('detail.seasonPending')!({ index: 0 }, env)).toBe('false');
  }
});
