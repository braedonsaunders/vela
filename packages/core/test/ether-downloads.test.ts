import { afterEach, expect, test } from 'bun:test';
import { EtherAdapter } from '../src/adapter/ether';
import { FakeCredentials, restoreFetch, routeFetch } from './helpers';
import type * as V from '../src/wire';

afterEach(restoreFetch);

const origin = 'https://ether.example';
const adapter = () => new EtherAdapter(origin, new FakeCredentials(), 'downloads-test');
const title = { id: 'movie', kind: 'movie', name: 'Original', artwork: [] };
const grant = {
  url: '/vela/v0/download/ticket',
  etag: '"file-1"',
  expiresAt: '2030-01-01T03:00:00Z',
  container: 'mkv',
  mimeType: 'video/x-matroska',
  sourceId: 'original',
  byteLength: 64,
  audioTracks: [],
  subtitleTracks: [],
  chapters: [],
} satisfies V.DownloadGrant;

test('Ether uses a viewer-scoped grant and writes timestamped offline progress', async () => {
  const requests = routeFetch({
    'GET /vela/v0/capabilities': { features: { downloads: { enabled: true, maxPerDay: 3, remainingToday: 0 } } },
    'GET /vela/v0/titles/movie': { title, cast: [], crew: [], extras: [] },
    'POST /vela/v0/titles/movie/download': grant,
    'POST /vela/v0/titles/movie/watch': { accepted: true },
  });
  const ether = adapter();
  expect(await ether.downloadsAvailable()).toBe(true);
  const resolution = await ether.resolveDownload('movie', { versionId: 'release', idempotencyKey: 'grant-1' });
  expect(resolution.url).toBe(origin + grant.url);
  expect(resolution.etag).toBe(grant.etag);
  expect(resolution.headers).toEqual({});
  expect(requests.find(request => request.method === 'POST')?.body).toEqual({ versionId: 'release', idempotencyKey: 'grant-1' });
  expect(requests[0]?.headers.get('Authorization')).toBe('Bearer token-1');
  await ether.replayWatchProgress('movie', {
    titleId: 'movie', serverId: 'ether', viewerId: 'viewer', positionSeconds: 52,
    durationSeconds: 120, observedAt: '2026-11-25T00:00:00Z', completed: false, idempotencyKey: 'watch-1',
  });
  expect(requests.at(-1)?.body).toEqual({ positionSeconds: 52, observedAt: '2026-11-25T00:00:00Z', offline: true, idempotencyKey: 'watch-1' });
});

test('Ether rejects a grant with a missing file identity or a foreign ticket URL', async () => {
  for (const bad of [{ ...grant, etag: undefined }, { ...grant, url: 'https://elsewhere.example' + grant.url }]) {
    routeFetch({
      'GET /vela/v0/titles/movie': { title, cast: [], crew: [], extras: [] },
      'POST /vela/v0/titles/movie/download': bad,
    });
    await expect(adapter().resolveDownload('movie')).rejects.toThrow();
  }
});

test('Ether download refusals read as sentences, and an incomplete grant fails clearly', async () => {
  const refuse = (code: string, message = code, status = 409) => new Response(JSON.stringify({
    error: { class: 'source', code, message, retry: { allowed: false } },
  }), { status, headers: { 'Content-Type': 'application/json' } });
  for (const [answer, words] of [
    [refuse('version_unavailable'), 'This version can\'t be downloaded from the server right now.'],
    [refuse('download_limit', 'download_limit', 429), 'You\'ve reached today\'s download limit on this server.'],
    [refuse('download_limit', 'Daily download limit reached', 429), 'Daily download limit reached'],
  ] as const) {
    routeFetch({ 'GET /vela/v0/titles/movie': { title, cast: [], crew: [], extras: [] }, 'POST /vela/v0/titles/movie/download': answer });
    await expect(adapter().resolveDownload('movie')).rejects.toThrow(words);
  }
  routeFetch({ 'GET /vela/v0/titles/movie': { title, cast: [], crew: [], extras: [] }, 'POST /vela/v0/titles/movie/download': { ...grant, url: undefined } });
  await expect(adapter().resolveDownload('movie')).rejects.toThrow('incomplete grant');
});

test('a minimal Ether grant (no track lists or container) still resolves from its file name', async () => {
  const { audioTracks: _a, subtitleTracks: _s, chapters: _c, container: _k, ...minimal } = grant;
  routeFetch({
    'GET /vela/v0/titles/movie': { title, cast: [], crew: [], extras: [] },
    'POST /vela/v0/titles/movie/download': { ...minimal, mimeType: 'video/mp4', filename: 'Andre and Wally B.MP4' },
  });
  const resolution = await adapter().resolveDownload('movie');
  expect(resolution).toMatchObject({ container: 'mp4', audioTracks: [], subtitleTracks: [], chapters: [], sidecars: [] });
  expect(resolution).not.toHaveProperty('filename');
});
