import { afterEach, expect, test } from 'bun:test';
import { EtherAdapter } from '../../core/src/adapter/ether';
import { PlexAdapter } from '../../core/src/adapter/plex';
import { JellyfinAdapter } from '../../core/src/adapter/jellyfin';
import { nativeConnection } from '../../core/src/adapter/connection';
import { detailModel } from '../../core/src/discovery/models';
import { FakeCredentials, restoreFetch, routeFetch } from '../../core/test/helpers';
import { waitForResumeSeason, detailSeason, selectedDetailSeason } from '../../../apps/vela/src/detail-season';
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

test('the first list uses next-up season before lazy episode data, never the show response\'s first season', () => {
  const model = detailModel({ title: { ...base, id: show, kind: 'show' }, seasons: [1,4].map(n => ({ ...base, id: `season-${n}`, kind: 'season', seasonNumber: n })),
    episodes: [{ ...base, id: e1, kind: 'episode', seasonNumber: 1, episodeNumber: 1 }],
    nextUp: { ...base, id: 's4e2', kind: 'episode', seasonNumber: 4, episodeNumber: 2, watch: { positionSeconds: 80, played: false, favorite: false, watchlisted: false } }, extras: [], cast: [], chapters: [] });
  const first = detailSeason(model, '', () => undefined);
  expect(first.season).toBe('season-4');
  expect(first.detail!.episodes).toEqual([]);
  expect(first.detail!.pending).toContain('episodes');
  expect(accessor('detail.hasEpisodes')!({ index: 0 }, { detail: first.detail, season: first.season } as Env)).toBe('true');
  expect(accessor('detail.episodesPending')!({ index: 0 }, { detail: first.detail, season: first.season } as Env)).toBe('true');
  const scoped = detailModel({ title: { ...base, id: 'season-4', kind: 'season', seasonNumber: 4 }, episodes: [{ ...base, id: 's4e2', kind: 'episode', seasonNumber: 4, episodeNumber: 2 }], extras: [], cast: [], chapters: [] });
  const loaded = detailSeason(model, first.season, () => scoped);
  expect(loaded.season).toBe(first.season);
  expect(loaded.detail!.episodes.map(e => e.id)).toEqual(['s4e2']);
  expect(loaded.detail!.pending).not.toContain('episodes');
});

test('a series primary action plays or resumes the next episode', () => {
  const model = detailModel({ title: { ...base, id: show, kind: 'show' },
    episodes: [{ ...base, id: e1, kind: 'episode', seasonNumber: 1, episodeNumber: 1, durationSeconds: 1800 }],
    nextUp: { ...base, id: 's2e4', kind: 'episode', seasonNumber: 2, episodeNumber: 4, durationSeconds: 1800,
      watch: { positionSeconds: 300, played: false, favorite: false, watchlisted: false } },
    extras: [], cast: [], chapters: [] });
  const env = { detail: model, season: '' } as Env;
  expect(accessor('detail.canPlay')!({ index: 0 }, env)).toBe('true');
  expect(accessor('detail.id')!({ index: 0 }, env)).toBe('s2e4');
  expect(accessor('detail.playLabel')!({ index: 0 }, env)).toBe('Resume S2 · E4');
  expect(accessor('detail.hasResume')!({ index: 0 }, env)).toBe('true');

  const unstarted = { ...model, nextUp: [] };
  const fresh = { detail: unstarted, season: '' } as Env;
  expect(accessor('detail.id')!({ index: 0 }, fresh)).toBe(e1);
  expect(accessor('detail.playLabel')!({ index: 0 }, fresh)).toBe('Play S1 · E1');
});

test('partial metadata does not expose season one while the progress season is undecided', () => {
  const model = detailModel({ title: { ...base, id: show, kind: 'show' }, seasons: [1,4].map(n => ({ ...base, id: `season-${n}`, kind: 'season', seasonNumber: n })),
    episodes: [{ ...base, id: e1, kind: 'episode', seasonNumber: 1, episodeNumber: 1 }], pending: ['episodes'], extras: [], cast: [], chapters: [] });
  const partial = detailSeason(model, '', () => undefined);
  expect(partial.season).toBe('');
  expect(partial.detail!.episodes).toEqual([]);
  const ready = { ...model, pending: [], episodes: [{ ...model.episodes[0]!, id: 's4e2', seasonId: 'season-4', seasonNumber: 4, progressSeconds: 100, played: false }] };
  expect(detailSeason(ready, '', () => undefined).season).toBe('season-4');
});

test('episode identity survives reordering and differs across seasons at the same position', async () => {
  const { itemKey } = await import('../src/vocabulary');
  const card = detailModel({ title: { ...base, id: show, kind: 'show' }, episodes: [{ ...base, id: e1, kind: 'episode' }], extras: [], cast: [], chapters: [] }).episodes[0]!;
  expect(itemKey({ index: 0, card }, 'detail.episodes')).toBe(itemKey({ index: 20, card }, 'detail.episodes'));
  expect(itemKey({ index: 0, card }, 'detail.episodes')).not.toBe(itemKey({ index: 0, card: { ...card, id: e2 } }, 'detail.episodes'));
});

test('an already available Continue Watching cue chooses the progress season on older servers', () => {
  const model = detailModel({ title: { ...base, id: show, kind: 'show' }, seasons: [1,4].map(n => ({ ...base, id: `season-${n}`, kind: 'season', seasonNumber: n })), episodes: [{ ...base, id: e1, kind: 'episode', seasonNumber: 1, episodeNumber: 1 }], extras: [], cast: [], chapters: [] });
  const resume = { ...model.episodes[0]!, id: 's4e2', seasonId: '', seasonNumber: 4, progressSeconds: 80 };
  expect(selectedDetailSeason(model, '', resume)).toBe('season-4');
  expect(selectedDetailSeason(model, 'season-1', resume)).toBe('season-1');
});


test('film pages never wait for a resume season while Home is still loading', () => {
  const film = detailModel({ title: { ...base, id: 'film', kind: 'movie' }, extras: [], chapters: [], cast: [] });
  expect(waitForResumeSeason(film, '', true)).toBe(false);
  expect(detailSeason(film, '', () => undefined).detail?.pending).toEqual([]);
  const series = detailModel({ title: { ...base, id: 'show', kind: 'show' }, extras: [], chapters: [], cast: [] });
  expect(waitForResumeSeason(series, '', true)).toBe(true);
  expect(waitForResumeSeason(series, '', false)).toBe(false);
});
