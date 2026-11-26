import { afterEach, describe, expect, test } from 'bun:test';
import { PlexAdapter } from '../src/adapter/plex';
import { hasMediaDownloads } from '../src/adapter/capabilities';
import { FakeCredentials, restoreFetch, routeFetch } from './helpers';

afterEach(restoreFetch);

const ORIGIN = 'https://plex.example:32400';
const plex = (credentials = new FakeCredentials()) => new PlexAdapter({ origin: ORIGIN, credentials, clientIdentifier: 'client-1' });

const metadataWithStreams = {
  ratingKey: 101,
  type: 'movie',
  title: 'Heat',
  summary: 'LA crime.',
  year: 1995,
  duration: 6_120_000,
  viewOffset: 90_000,
  viewCount: 1,
  lastViewedAt: 1700000000,
  thumb: '/library/metadata/101/thumb/1',
  Chapter: [{ id: 1, tag: 'Intro', startTimeOffset: 0, endTimeOffset: 300_000 }],
  Marker: [{ type: 'intro', startTimeOffset: 10_000, endTimeOffset: 60_000 }],
  Media: [
    {
      id: 500,
      container: 'mkv',
      videoCodec: 'hevc',
      videoResolution: '4k',
      audioCodec: 'truehd',
      audioChannels: 8,
      width: 3840,
      height: 2160,
      duration: 6_120_000,
      Part: [
        {
          id: 900,
          key: '/library/parts/900/1700000000/file.mkv',
          container: 'mkv',
          size: 4_500_000_000,
          Stream: [
            { id: 1, index: 0, streamType: 1, codec: 'hevc', width: 3840, height: 2160, colorTrc: 'smpte2084' },
            { id: 2, index: 1, streamType: 2, codec: 'truehd', languageCode: 'eng', displayTitle: 'TrueHD 7.1', channels: 8, selected: 1 },
            { id: 3, index: 2, streamType: 3, codec: 'pgs', languageCode: 'eng', displayTitle: 'English PGS', selected: 1 },
            { id: 4, index: 3, streamType: 3, codec: 'ass', languageCode: 'jpn', displayTitle: 'Japanese ASS', key: '/library/streams/4' },
            { id: 5, index: 4, streamType: 3, codec: 'srt', languageCode: 'spa', displayTitle: 'Spanish SRT', key: '/library/streams/5' },
          ],
        },
      ],
    },
    {
      id: 501,
      container: 'mp4',
      videoCodec: 'h264',
      videoResolution: '1080',
      audioCodec: 'aac',
      audioChannels: 2,
      width: 1920,
      height: 1080,
      duration: 6_120_000,
      Part: [
        {
          id: 901,
          key: '/library/parts/901/1700000000/file.mp4',
          container: 'mp4',
          size: 1_200_000_000,
          Stream: [
            { id: 10, index: 0, streamType: 1, codec: 'h264', width: 1920, height: 1080 },
            { id: 11, index: 1, streamType: 2, codec: 'aac', languageCode: 'eng', displayTitle: 'AAC Stereo', channels: 2, selected: 1 },
          ],
        },
      ],
    },
  ],
};

describe('PlexAdapter MediaDownloads', () => {
  test('advertises MediaDownloads capability and maps lastViewedAt on title watch state', async () => {
    const adapter = plex();
    expect(hasMediaDownloads(adapter)).toBe(true);
    routeFetch({
      'GET /library/metadata/101': { MediaContainer: { Metadata: [metadataWithStreams] } },
      'GET /library/sections': { MediaContainer: { Directory: [] } },
    });
    const resolved = await adapter.resolveDownload('101', { subtitleFormats: ['ass', 'webvtt'] });
    expect(resolved.title.watch?.lastViewedAt).toBe(new Date(1700000000 * 1000).toISOString());
    expect(resolved.url).toBe(`${ORIGIN}/library/parts/900/1700000000/file.mkv?download=1`);
    expect(resolved.headers['X-Plex-Token']).toBe('token-1');
    expect(resolved.headers['X-Plex-Client-Identifier']).toBe('client-1');
    expect(resolved.mimeType).toBe('video/x-matroska');
    expect(resolved.container).toBe('mkv');
    expect(resolved.byteLength).toBe(4_500_000_000);
    expect(resolved.sourceId).toBe('900');
    expect(resolved.versionId).toBe('500');
    expect(resolved.originalVideo).toEqual({ codec: 'hevc', width: 3840, height: 2160 });
    expect(resolved.audioTracks).toEqual([
      expect.objectContaining({ id: '2', streamIndex: 1, codec: 'truehd', channels: 8, default: true }),
    ]);
    // Embedded PGS stays embedded; external ASS stays .ass; external SRT converts to format=vtt:
    expect(resolved.subtitleTracks).toEqual([
      expect.objectContaining({ id: '3', streamIndex: 2, codec: 'pgs', delivery: { kind: 'embedded' } }),
      expect.objectContaining({
        id: '4',
        streamIndex: 3,
        codec: 'ass',
        delivery: { kind: 'external', format: 'ass', url: `${ORIGIN}/library/streams/4.ass?encoding=utf-8` },
      }),
      expect.objectContaining({
        id: '5',
        streamIndex: 4,
        codec: 'srt',
        delivery: { kind: 'external', format: 'webvtt', url: `${ORIGIN}/library/streams/5?format=vtt` },
      }),
    ]);
    expect(resolved.sidecars).toEqual([
      { trackId: '4', format: 'ass', url: `${ORIGIN}/library/streams/4.ass?encoding=utf-8` },
      { trackId: '5', format: 'webvtt', url: `${ORIGIN}/library/streams/5?format=vtt` },
    ]);
    expect(resolved.chapters).toEqual([{ id: '1', name: 'Intro', startSeconds: 0, endSeconds: 300 }]);
    expect(resolved.markers).toEqual([{ kind: 'intro', startSeconds: 10, endSeconds: 60 }]);
    expect(resolved.posterUrl).toBe(`${ORIGIN}/library/metadata/101/thumb/1`);
  });

  test('selects a requested versionId when resolving a multi-version Plex title', async () => {
    routeFetch({
      'GET /library/metadata/101': { MediaContainer: { Metadata: [metadataWithStreams] } },
    });
    const resolved = await plex().resolveDownload('101', { versionId: '501' });
    expect(resolved.versionId).toBe('501');
    expect(resolved.url).toBe(`${ORIGIN}/library/parts/901/1700000000/file.mp4?download=1`);
    expect(resolved.container).toBe('mp4');
    expect(resolved.mimeType).toBe('video/mp4');
    expect(resolved.byteLength).toBe(1_200_000_000);
  });

  test('refuses multi-part stacked Plex titles and accounts with allowSync disabled', async () => {
    const stacked = {
      ...metadataWithStreams,
      Media: [{
        ...metadataWithStreams.Media[0],
        Part: [
          { id: 900, key: '/library/parts/900/file-pt1.mkv', size: 2_000_000_000 },
          { id: 901, key: '/library/parts/901/file-pt2.mkv', size: 2_000_000_000 },
        ],
      }],
    };
    routeFetch({
      'GET /': { MediaContainer: { friendlyName: 'Home Plex', allowSync: 0 } },
      'GET /library/metadata/101': { MediaContainer: { Metadata: [stacked] } },
    });
    const adapter = plex();
    expect(await adapter.downloadsAvailable()).toBe(false);
    await expect(adapter.resolveDownload('101')).rejects.toThrow('Downloads are not allowed');

    routeFetch({
      'GET /': { MediaContainer: { friendlyName: 'Home Plex', allowSync: 1 } },
      'GET /library/metadata/101': { MediaContainer: { Metadata: [stacked] } },
    });
    const allowedAdapter = plex();
    expect(await allowedAdapter.downloadsAvailable()).toBe(true);
    await expect(allowedAdapter.resolveDownload('101')).rejects.toThrow('several parts');
  });
});
