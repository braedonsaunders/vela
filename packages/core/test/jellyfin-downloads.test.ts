import { afterEach, expect, test } from 'bun:test';
import { hasMediaDownloads, hasOfflineProgress, type OfflineProgressEntry } from '../src/adapter/capabilities';
import { VelaError } from '../src/adapter/errors';
import { JellyfinAdapter } from '../src/adapter/jellyfin';
import type { Item } from '../src/adapter/jellyfin/types';
import { FakeCredentials, restoreFetch, routeFetch, tokens, type Seen } from './helpers';

afterEach(restoreFetch);

const base = 'https://media.example/server';
const userRoute = 'GET /server/Users/viewer-1';
const itemRoute = `${userRoute}/Items/title`;
const infoRoute = 'GET /server/System/Info/Public';
const user = { Id: 'viewer-1', Name: 'Viewer' };
const jellyfin = { Id: 'srv', ServerName: 'Home', Version: '10.9.11', ProductName: 'Jellyfin Server' };
const emby = { Id: 'srv', ServerName: 'Home', Version: '4.8.11.0' };
const movie: Item = {
  Id: 'title', Name: 'The Glass Orchard', Type: 'Movie', ImageTags: { Primary: 'cover' },
  Chapters: [{ Name: 'Opening', StartPositionTicks: 0 }, { Name: 'Nightfall', StartPositionTicks: 145_000_000 }],
  MediaSources: [
    { Id: 'title', Container: 'mkv', Size: 7000, Name: 'Original' },
    {
      Id: 'alternate', Container: 'MP4', Size: 3500, RunTimeTicks: 300_000_000, Name: 'Alternate',
      DefaultAudioStreamIndex: 2, DefaultSubtitleStreamIndex: 4,
      MediaStreams: [
        { Index: 0, Type: 'Video', Codec: 'h264', Width: 1920, Height: 1080 },
        { Index: 1, Type: 'Audio', Codec: 'aac', Language: 'eng', Channels: 2 },
        { Index: 2, Type: 'Audio', Codec: 'ac3', Language: 'fra', Channels: 6 },
        { Index: 3, Type: 'Subtitle', Codec: 'srt', IsExternal: false, DeliveryUrl: '?api_key=embedded' },
        { Index: 4, Type: 'Subtitle', Codec: 'ass', IsExternal: true, IsForced: true, DeliveryUrl: '?api_key=external' },
        { Index: 5, Type: 'Subtitle', Codec: 'pgssub', IsExternal: true, IsTextSubtitleStream: false },
        { Index: 6, Type: 'Subtitle', Codec: 'srt', IsExternal: true, IsHearingImpaired: true },
      ],
    },
  ],
};

test.each([true, false, undefined])('download policy %s is read once per session', async permission => {
  const seen = routeFetch({ [userRoute]: { ...user, Policy: { EnableContentDownloading: permission } } });
  const adapter = new JellyfinAdapter(base, new FakeCredentials());
  expect(await Promise.all([adapter.downloadsAvailable(), adapter.downloadsAvailable()]))
    .toEqual([permission !== false, permission !== false]);
  expect(seen).toHaveLength(1);
  expect(seen[0]!.headers.get('X-Emby-Token')).toBe('token-1');
});

test('download policy is refreshed for a new token or viewer and discarded on sign-out', async () => {
  const seen = routeFetch({
    [userRoute]: ({ headers }: Seen) => ({ ...user, Policy: { EnableContentDownloading: headers.get('X-Emby-Token') === 'token-2' } }),
    'GET /server/Users/viewer-2': { Id: 'viewer-2', Name: 'Viewer 2', Policy: { EnableContentDownloading: false } },
  });
  const credentials = new FakeCredentials();
  const adapter = new JellyfinAdapter(base, credentials);
  expect(await adapter.downloadsAvailable()).toBe(false);
  await credentials.set(tokens('token-2'));
  expect(await adapter.downloadsAvailable()).toBe(true);
  await credentials.set(null);
  expect(await adapter.downloadsAvailable()).toBe(false);
  await credentials.set(tokens('token-2'));
  expect(await adapter.downloadsAvailable()).toBe(true);
  await credentials.set(tokens('token-2', 'viewer-2'));
  expect(await adapter.downloadsAvailable()).toBe(false);
  expect(seen.map(r => r.url.pathname)).toEqual([
    '/server/Users/viewer-1', '/server/Users/viewer-1', '/server/Users/viewer-1', '/server/Users/viewer-2',
  ]);
});

test('Jellyfin resolves the first source and downloads an alternate by its item ID', async () => {
  routeFetch({ [infoRoute]: jellyfin, [userRoute]: user, [itemRoute]: movie });
  const adapter = new JellyfinAdapter(base, new FakeCredentials());
  expect(hasMediaDownloads(adapter)).toBe(true);
  expect(adapter.downloadCredentials).toBe('headers');
  expect(await adapter.resolveDownload('title')).toMatchObject({
    url: `${base}/Items/title/Download`, sourceId: 'title', versionId: 'title', byteLength: 7000,
    container: 'mkv', mimeType: 'video/x-matroska',
  });
  const download = await adapter.resolveDownload('title', { versionId: 'alternate', subtitleFormats: ['ass', 'webvtt'] });
  expect(download).toMatchObject({
    url: `${base}/Items/alternate/Download`, sourceId: 'alternate', versionId: 'alternate', versionLabel: 'Alternate',
    title: { id: 'title', name: 'The Glass Orchard', durationSeconds: 30 },
    posterUrl: `${base}/Items/title/Images/Primary?tag=cover`,
    byteLength: 3500, container: 'mp4', mimeType: 'video/mp4', originalVideo: { codec: 'h264', width: 1920 },
    headers: { Authorization: expect.stringContaining('Token="token-1"'), 'X-Emby-Token': 'token-1' },
    selectedAudioTrackId: '2', selectedSubtitleTrackId: '4',
  });
  expect(download.chapters.map(c => [c.name, c.startSeconds])).toEqual([['Opening', 0], ['Nightfall', 14.5]]);
  expect(download.audioTracks.map(t => [t.id, t.language, t.channels])).toEqual([['1', 'eng', 2], ['2', 'fra', 6]]);
  expect(download.subtitleTracks.map(t => [t.id, t.delivery?.kind])).toEqual([['3', 'embedded'], ['4', 'external'], ['6', 'external']]);
  expect(download.sidecars).toEqual([
    { trackId: '4', format: 'ass', url: `${base}/Videos/title/alternate/Subtitles/4/0/Stream.ass` },
    { trackId: '6', format: 'webvtt', url: `${base}/Videos/title/alternate/Subtitles/6/0/Stream.vtt` },
  ]);
  await expect(adapter.resolveDownload('title', { versionId: 'unknown' })).rejects.toThrow('Unknown media version');
});

test('Jellyfin follows the first response source even when its ID differs from the catalogue item', async () => {
  routeFetch({ [infoRoute]: jellyfin, [userRoute]: user, [itemRoute]: { ...movie, MediaSources: [...movie.MediaSources!].reverse() } });
  const adapter = new JellyfinAdapter(base, new FakeCredentials());
  expect(await adapter.resolveDownload('title')).toMatchObject({
    sourceId: 'alternate', url: `${base}/Items/alternate/Download`,
  });
});

test('Emby resolves an episode version with auth headers and WebVTT sidecars', async () => {
  routeFetch({
    [infoRoute]: emby,
    [userRoute]: user,
    [itemRoute]: { ...movie, Type: 'Episode', MediaSources: [
      movie.MediaSources![0], { ...movie.MediaSources![1], ItemId: 'emby-version', MimeType: 'video/mp4' },
    ] },
  });
  const adapter = new JellyfinAdapter(base, new FakeCredentials());
  const download = await adapter.resolveDownload('title', { versionId: 'alternate', subtitleFormats: ['webvtt'] });
  expect(download).toMatchObject({
    title: { kind: 'episode' }, sourceId: 'alternate', mimeType: 'video/mp4',
    url: `${base}/Items/emby-version/Download?mediaSourceId=alternate`,
    headers: { 'X-Emby-Token': 'token-1' },
  });
  expect(download.sidecars).toEqual([4, 6].map(index => ({
    trackId: String(index), format: 'webvtt', url: `${base}/Videos/title/alternate/Subtitles/${index}/0/Stream.vtt`,
  })));
  for (const url of [download.url, download.posterUrl!, ...download.sidecars.map(s => s.url)]) {
    expect(url).not.toContain('token-1');
    expect(new URL(url).searchParams.has('api_key')).toBe(false);
  }
  const embeddedOnly = await adapter.resolveDownload('title', { versionId: 'alternate', subtitleFormats: [] });
  expect(embeddedOnly.sidecars).toEqual([]);
  expect(embeddedOnly.subtitleTracks.map(t => t.id)).toEqual(['3']);
});

test('only movies and episodes are downloadable', async () => {
  routeFetch({ [userRoute]: user, [itemRoute]: { ...movie, Type: 'Series' } });
  const adapter = new JellyfinAdapter(base, new FakeCredentials());
  await expect(adapter.resolveDownload('title')).rejects.toThrow('Only movies and episodes');
});

test.each(['account policy', 'item policy', 'server response'])('%s refusal surfaces as a VelaError with status 403', async scenario => {
  const seen = routeFetch({
    [userRoute]: { ...user, Policy: { EnableContentDownloading: scenario !== 'account policy' } },
    [itemRoute]: scenario === 'item policy' ? { ...movie, CanDownload: false } : new Response(null, { status: 403 }),
  });
  const adapter = new JellyfinAdapter(base, new FakeCredentials());
  const solution = adapter.resolveDownload('title');
  await expect(solution).rejects.toBeInstanceOf(VelaError);
  await expect(solution).rejects.toMatchObject({
    status: 403, detail: { class: 'policy', code: 'download_not_allowed' },
    message: 'Downloads are not allowed for this title or account',
  });
  expect(seen).toHaveLength(scenario === 'account policy' ? 1 : 2);
});

const entry: OfflineProgressEntry = {
  serverId: 'srv', viewerId: 'viewer-1', titleId: 'title', positionSeconds: 12.25, durationSeconds: 30,
  completed: false, observedAt: '2026-11-26T08:00:00Z', idempotencyKey: 'progress',
};
const modern = 'POST /server/UserItems/title/UserData';
const legacy = 'POST /server/Users/viewer-1/Items/title/UserData';
const userData = { PlaybackPositionTicks: 122_500_000, LastPlayedDate: entry.observedAt };

test('Jellyfin replays partial progress without changing Played', async () => {
  const seen = routeFetch({ [infoRoute]: jellyfin, [modern]: {} });
  const adapter = new JellyfinAdapter(base, new FakeCredentials());
  expect(hasOfflineProgress(adapter)).toBe(true);
  expect(await adapter.replayWatchProgress('title', entry)).toEqual({ accepted: true });
  expect(seen[1]!.body).toEqual(userData);
  expect(seen[1]!.url.searchParams.get('userId')).toBe('viewer-1');
});

test('Jellyfin retries the legacy user data route if the modern route is absent', async () => {
  const seen = routeFetch({ [infoRoute]: jellyfin, [legacy]: {} });
  const adapter = new JellyfinAdapter(base, new FakeCredentials());
  expect(await adapter.replayWatchProgress('title', entry)).toEqual({ accepted: true });
  expect(seen.filter(r => r.method === 'POST').map(r => r.url.pathname)).toEqual([modern.slice(5), legacy.slice(5)]);
  expect(seen.at(-1)!.body).toEqual(userData);
});

test('Emby replays completed progress through the per-user route', async () => {
  const seen = routeFetch({ [infoRoute]: emby, [legacy]: {} });
  const adapter = new JellyfinAdapter(base, new FakeCredentials());
  expect(await adapter.replayWatchProgress('title', { ...entry, completed: true })).toEqual({ accepted: true });
  expect(seen.filter(r => r.method === 'POST').map(r => r.url.pathname)).toEqual([legacy.slice(5)]);
  expect(seen[1]!.body).toEqual({ ...userData, Played: true });
});
