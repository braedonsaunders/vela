// Playlist import follows what the server advertises: its link sources and file formats, a link
// that cannot come from one refused before sending, and every refusal of a link (at once with 400,
// or as a job that failed while reading) reaching the store the same way.
import { describe, expect, test } from 'bun:test';
import { importLinkFromSources, playlistImportSources } from '../src/adapter/capabilities';
import { VelaError } from '../src/adapter/errors';
import { initialMusic, Music } from '../src/store/music';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type * as V from '../src/wire';

const deezerOnly = { available: true, links: ['deezer'], files: ['m3u', 'csv'], maxTracks: 500 } as const;

describe('playlistImportSources', () => {
  test('reads the advertised links, formats and track limit', () => {
    expect(playlistImportSources({ ...deezerOnly, links: [...deezerOnly.links], files: [...deezerOnly.files] })).toEqual({ links: ['deezer'], files: ['m3u', 'csv'], maxTracks: 500 });
  });

  test('offers nothing the server does not list', () => {
    expect(playlistImportSources(undefined)).toBeNull();
    expect(playlistImportSources({ available: false, links: ['deezer'], files: ['m3u'], maxTracks: 500 })).toBeNull();
    const bare = playlistImportSources({ available: true } as V.ServerCapabilities['features']['playlistImport']);
    expect(bare).toEqual({ links: [], files: [], maxTracks: 0 });
    const odd = playlistImportSources({ available: true, links: [' Deezer ', 'deezer', ''], files: ['xspf', 'csv'] as V.PlaylistImportFormat[], maxTracks: -1 });
    expect(odd).toEqual({ links: ['deezer'], files: ['csv'], maxTracks: 0 });
  });
});

describe('importLinkFromSources', () => {
  test('accepts http(s) links whose host names an advertised source', () => {
    expect(importLinkFromSources('https://www.deezer.com/en/album/302127', ['deezer'])).toBe(true);
    expect(importLinkFromSources('  https://link.deezer.com/s/abc  ', ['deezer'])).toBe(true);
    expect(importLinkFromSources('https://open.spotify.com/playlist/37i9dQZF1DX4JAvHpjipBk', ['deezer', 'spotify'])).toBe(true);
  });

  test('rejects links from other hosts, other schemes, and text that is not a link', () => {
    expect(importLinkFromSources('https://open.spotify.com/playlist/37i9dQZF1DX4JAvHpjipBk', ['deezer'])).toBe(false);
    expect(importLinkFromSources('spotify:playlist:37i9dQZF1DX4JAvHpjipBk', ['spotify'])).toBe(false);
    expect(importLinkFromSources('ftp://deezer.com/playlist/1', ['deezer'])).toBe(false);
    expect(importLinkFromSources('my favourite playlist', ['deezer'])).toBe(false);
    expect(importLinkFromSources('https://www.deezer.com/album/1', [])).toBe(false);
  });
});

/** A music store over a server advertising `feature`, whose adapter answers starts with `start`. */
function harness(feature: V.ServerCapabilities['features']['playlistImport'], start: (request: V.PlaylistImportRequest) => Promise<V.PlaylistImportJobRef>, poll?: (id: string) => Promise<V.PlaylistImport>) {
  const calls: string[] = [];
  const adapter = {
    startPlaylistImport: async (request: V.PlaylistImportRequest) => {
      calls.push(`start:${request.url ?? request.file?.format}`);
      return start(request);
    },
    playlistImport: async (id: string) => {
      calls.push(`poll:${id}`);
      if (!poll) throw new Error('no poll');
      return poll(id);
    },
    savePlaylistImport: async () => { throw new Error('unused'); },
  };
  const box = new StateBox({ music: initialMusic } as unknown as VelaState);
  let keys = 0;
  const session = {
    features: { playlistImport: feature },
    onReset() {},
    key: () => `key-${++keys}`,
    ready: async () => ({ adapter, images: async () => undefined }),
  } as unknown as Session;
  return { music: new Music(box, session, () => 640), box, calls };
}

const refused = (code: string) => new VelaError({ class: 'request', code, message: code.replace(/_/g, ' '), retry: { allowed: false } }, 400);
const failedJob = (id: string, error: string): V.PlaylistImport => ({ id, state: 'failed', name: '', total: 0, done: 0, matched: [], unmatched: [], error });
const lab = { available: true, links: ['deezer'], files: ['m3u', 'csv'] as V.PlaylistImportFormat[], maxTracks: 500 };

describe('startPlaylistImport refusals', () => {
  test('a link no advertised source can serve is refused without a server round trip', async () => {
    const { music, box, calls } = harness(lab, async () => ({ id: 'never' }));
    expect(await music.startPlaylistImport('10', { url: 'https://open.spotify.com/playlist/37i9dQZF1DX4JAvHpjipBk' })).toBeNull();
    expect(calls).toEqual([]);
    const state = box.get().music.playlistImport;
    expect(state).toMatchObject({ load: 'failed', code: 'unsupported_link', value: null });
  });

  test('a format the server does not list is refused without a round trip', async () => {
    const { music, box, calls } = harness({ ...lab, files: ['csv'] }, async () => ({ id: 'never' }));
    await music.startPlaylistImport('10', { file: { name: 'mix.m3u', format: 'm3u', text: '#EXTM3U' } });
    expect(calls).toEqual([]);
    expect(box.get().music.playlistImport).toMatchObject({ load: 'failed', code: 'unsupported_file' });
  });

  test('a 400 unsupported_link and a job that fails with unsupported_link leave the same state', async () => {
    const link = 'https://www.deezer.com/en/artist/27';
    const immediate = harness(lab, async () => { throw refused('unsupported_link'); });
    await immediate.music.startPlaylistImport('10', { url: link });
    const later = harness(lab, async () => ({ id: 'job-1' }), async id => failedJob(id, 'unsupported_link'));
    await later.music.startPlaylistImport('10', { url: link });

    expect(immediate.calls).toEqual([`start:${link}`]);
    expect(later.calls).toEqual([`start:${link}`, 'poll:job-1']);
    const a = immediate.box.get().music.playlistImport;
    const b = later.box.get().music.playlistImport;
    expect(a).toMatchObject({ load: 'failed', code: 'unsupported_link' });
    expect(b).toEqual(a);
    // The failed job does not stand in for results: the form comes back to try another link.
    expect(b.value).toBeFalsy();
  });

  test('a 400 unsupported_file keeps its code', async () => {
    const { music, box } = harness(lab, async () => { throw refused('unsupported_file'); });
    await music.startPlaylistImport('10', { file: { name: 'x.m3u', format: 'm3u', text: 'not a playlist' } });
    expect(box.get().music.playlistImport).toMatchObject({ load: 'failed', code: 'unsupported_file' });
  });

  test('a job that fails for another reason carries that reason, not a link refusal', async () => {
    const { music, box } = harness(lab, async () => ({ id: 'job-2' }), async id => failedJob(id, 'unavailable'));
    await music.startPlaylistImport('10', { url: 'https://www.deezer.com/playlist/908622995' });
    expect(box.get().music.playlistImport).toMatchObject({ load: 'failed', code: 'unavailable' });
  });
});
