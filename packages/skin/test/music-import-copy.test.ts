// The import form names, suggests and offers only what the server's import reads.
import { describe, expect, test } from 'bun:test';
import type { PlaylistImportSources } from '@vela/core';
import { importFileModeLabel, importFileTextLabel, importRefusalMessage, importSampleLinks, importSubtitle, importUrlPlaceholder } from '../src/blocks/import-copy';

const deezer: PlaylistImportSources = { links: ['deezer'], files: ['m3u', 'csv'], maxTracks: 500 };
const both: PlaylistImportSources = { links: ['deezer', 'spotify'], files: ['m3u', 'csv'], maxTracks: 0 };

describe('source-driven copy', () => {
  test('a Deezer-only server never mentions Spotify', () => {
    const copy = [importSubtitle(deezer), importUrlPlaceholder(deezer), importRefusalMessage('unsupported_link', deezer), ...importSampleLinks(deezer).map(s => `${s.label} ${s.url}`)].join('\n');
    expect(copy).not.toMatch(/spotify/i);
    expect(importSubtitle(deezer)).toBe('Paste a playlist or album link from Deezer, or bring a tracklist file (M3U or CSV), to match it against your library. Up to 500 tracks are read from each playlist.');
    expect(importUrlPlaceholder(deezer)).toBe('https://www.deezer.com/playlist/…');
    expect(importSampleLinks(deezer).map(s => s.label)).toEqual(['Try a sample Deezer link']);
  });

  test('every listed source is named, offered and suggested', () => {
    expect(importSubtitle(both)).toBe('Paste a playlist or album link from Deezer or Spotify, or bring a tracklist file (M3U or CSV), to match it against your library.');
    expect(importUrlPlaceholder(both)).toBe('https://www.deezer.com/playlist/… or https://open.spotify.com/playlist/…');
    expect(importSampleLinks(both).map(s => s.source)).toEqual(['deezer', 'spotify']);
  });

  test('a source Vela has no example for is named by its id', () => {
    const tidal: PlaylistImportSources = { links: ['deezer', 'qobuz'], files: [], maxTracks: 0 };
    expect(importUrlPlaceholder(tidal)).toBe('A playlist or album link from Deezer or Qobuz');
    expect(importSampleLinks(tidal).map(s => s.source)).toEqual(['deezer']);
    expect(importSubtitle(tidal)).toBe('Paste a playlist or album link from Deezer or Qobuz to match it against your library.');
  });

  test('files only, and the listed formats only', () => {
    const csv: PlaylistImportSources = { links: [], files: ['csv'], maxTracks: 200 };
    expect(importSubtitle(csv)).toBe('Bring a tracklist file (CSV) to match it against your library. Up to 200 tracks are read from each playlist.');
    expect(importFileModeLabel(csv)).toBe('CSV file');
    expect(importFileTextLabel(csv)).toBe('Tracklist contents (CSV)');
    expect(importSampleLinks(csv)).toEqual([]);
  });

  test('nothing to import', () => {
    expect(importSubtitle(null)).toBe('This server doesn’t offer anything to import playlists from yet.');
    expect(importSubtitle({ links: [], files: [], maxTracks: 500 })).toBe('This server doesn’t offer anything to import playlists from yet.');
  });
});

describe('refusals', () => {
  test('an unsupported link names the sources the server reads', () => {
    expect(importRefusalMessage('unsupported_link', deezer)).toBe('That link isn’t a playlist or album from Deezer that this server can read.');
    expect(importRefusalMessage('unsupported_link', both)).toBe('That link isn’t a playlist or album from Deezer or Spotify that this server can read.');
  });

  test('an unsupported file names the formats the server reads', () => {
    expect(importRefusalMessage('unsupported_file', { links: [], files: ['csv'], maxTracks: 0 })).toBe('That file isn’t a tracklist this server can read. Use CSV.');
  });

  test('invalid choices and oversized files have their own wording; other codes have none', () => {
    expect(importRefusalMessage('invalid_choice', deezer)).toContain('chosen releases');
    expect(importRefusalMessage('file_too_large', deezer)).toContain('too large');
    expect(importRefusalMessage('unavailable', deezer)).toBe('');
    expect(importRefusalMessage(undefined, deezer)).toBe('');
  });
});
