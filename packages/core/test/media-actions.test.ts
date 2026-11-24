import { afterEach, expect, test } from 'bun:test';
import { PlexAdapter } from '../src/adapter/plex';
import { JellyfinAdapter } from '../src/adapter/jellyfin';
import { EtherAdapter } from '../src/adapter/ether';
import { hasTitleManagement, hasSubtitleSearch } from '../src/adapter/media-actions';
import { FakeCredentials, restoreFetch, routeFetch, device } from './helpers';
afterEach(restoreFetch);
const client = { device, protocolVersions: [0], containers: ['mp4'], videoCodecs: ['h264'], audioCodecs: ['aac'], subtitleFormats: ['vtt'], hls: false, mse: false };
test('capabilities are absent rather than inferred from title kind', () => {
  expect(hasTitleManagement({} as never)).toBe(false);
  expect(hasSubtitleSearch({} as never)).toBe(false);
});
test('Plex offers watched and versions; choosing a version uses its part', async () => {
  const media = (id: string) => ({ id, videoResolution: '1080', container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', Part: [{ id, key: `/library/parts/${id}/file.mp4`, Stream: [] }] });
  const seen = routeFetch({ 'GET /library/metadata/10': { MediaContainer: { Metadata: [{ ratingKey: '10', type: 'movie', title: 'Movie', Media: [media('a'), media('b')] }] } }, 'PUT /:/scrobble': {}, 'PUT /actions/removeFromContinueWatching': {} });
  const api = new PlexAdapter({ origin: 'https://test.example', credentials: new FakeCredentials(), clientIdentifier: 'c' });
  const actions = await api.titleActions('10');
  expect(actions).toMatchObject({ favorite: false, watchlist: false }); expect(actions.versions.map(v => v.id)).toEqual(['a', 'b']);
  await api.setTitleWatch('10', { played: true, idempotencyKey: 'watched' });
  expect(seen.at(-1)?.url.searchParams.get('key')).toBe('10');
  await api.setTitleWatch('10', { continueWatching: false, idempotencyKey: 'remove' });
  expect(seen.at(-1)?.url.searchParams.get('ratingKey')).toBe('10');
  const plan = await api.startPlayback({ titleId: '10', mediaSourceId: 'b', client, idempotencyKey: 'play' });
  expect(plan.paths[0]?.url).toContain('/parts/b/');
});
test('Jellyfin mutations use viewer-scoped endpoints and subtitle results retain language', async () => {
  const seen = routeFetch({ 'POST /Users/viewer-1/PlayedItems/10': {}, 'DELETE /Users/viewer-1/FavoriteItems/10': {} });
  const api = new JellyfinAdapter('https://test.example', new FakeCredentials());
  await api.setTitleWatch('10', { played: true, favorite: false, idempotencyKey: 'watched' });
  expect(seen.map(r => `${r.method} ${r.url.pathname}`)).toEqual(['POST /Users/viewer-1/PlayedItems/10', 'DELETE /Users/viewer-1/FavoriteItems/10']);
});
test('Ether maps every supported watch field to its idempotent title mutation', async () => {
  const seen = routeFetch({ 'POST /vela/v0/titles/10/watch': { accepted: true } });
  const api = new EtherAdapter('https://test.example', new FakeCredentials(), 'test');
  await api.setTitleWatch('10', { played: true, favorite: true, watchlisted: false, idempotencyKey: 'watch-1' });
  expect(seen[0]?.body).toEqual({ played: true, favorite: true, watchlisted: false, idempotencyKey: 'watch-1' });
});
test('Plex downloads a searched subtitle into the existing plan without changing the source', async () => {
  let downloaded = false;
  const part = () => ({ id: 'part', key: '/library/parts/part/file.mp4', Stream: downloaded ? [{ id: 'sub', streamType: 3, key: '/library/streams/sub', languageCode: 'en', codec: 'srt' }] : [] });
  routeFetch({
    'GET /library/metadata/10': () => ({ MediaContainer: { Metadata: [{ ratingKey: '10', type: 'movie', title: 'Movie', Media: [{ container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', Part: [part()] }] }] } }),
    'GET /library/metadata/10/subtitles': { MediaContainer: { Stream: [{ key: 'provider-result', displayTitle: 'English SDH', languageCode: 'en' }] } },
    'PUT /library/metadata/10/subtitles': () => { downloaded = true; return {}; },
  });
  const api = new PlexAdapter({ origin: 'https://test.example', credentials: new FakeCredentials(), clientIdentifier: 'c' });
  const plan = await api.startPlayback({ titleId: '10', client, idempotencyKey: 'start' });
  expect(await api.searchSubtitles(plan.sessionId, 'en')).toEqual({ language: 'en', preferred: [], offers: [{ id: 'provider-result', name: 'English SDH', language: 'en' }] });
  const next = await api.downloadSubtitle(plan.sessionId, 'provider-result');
  expect(next.sessionId).toBe(plan.sessionId); expect(next.sourceGeneration).toBe(plan.sourceGeneration);
  expect(next.subtitleTracks[0]?.delivery?.kind).toBe('external');
});
test('Jellyfin subtitle search and download keep the running session and source', async () => {
  let downloaded = false;
  const source = () => ({ Id: 'media', SupportsDirectPlay: true, Container: 'mp4', MediaStreams: downloaded ? [{ Type: 'Subtitle', Index: 3, Language: 'eng', Codec: 'srt' }] : [] });
  const seen = routeFetch({
    'GET /Users/viewer-1/Items/10': () => ({ Id: '10', Type: 'Movie', Name: 'Movie', MediaSources: [source()] }),
    'POST /Items/10/PlaybackInfo': () => ({ PlaySessionId: 'session', MediaSources: [source()] }),
    'GET /Items/10/RemoteSearch/Subtitles/en': [{ Id: 'provider', Name: 'English', Language: 'eng' }],
    'POST /Items/10/RemoteSearch/Subtitles/provider': () => { downloaded = true; return {}; },
  });
  const api = new JellyfinAdapter('https://test.example', new FakeCredentials());
  const plan = await api.startPlayback({ titleId: '10', client, idempotencyKey: 'start' });
  expect((await api.searchSubtitles(plan.sessionId, 'en')).offers[0]?.language).toBe('eng');
  const next = await api.downloadSubtitle(plan.sessionId, 'provider');
  expect(next.sessionId).toBe(plan.sessionId); expect(next.sourceGeneration).toBe(0);
  expect(next.subtitleTracks[0]?.id).toBe('3');
  expect(seen.filter(s => s.url.pathname.endsWith('PlaybackInfo'))).toHaveLength(1);
});
