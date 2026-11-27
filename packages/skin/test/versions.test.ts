import { expect, test } from 'bun:test';
import type { VersionItem } from '@vela/core';
import { convertedFrom, playingElsewhere, preparingRetry, selectedVersion, versionAvailability, versionBadge, versionChips, versionMenuChips, versionMenuGroups, versionPlayArg, versionRowStatus } from '../src/widgets/versions';

const version: VersionItem = {
  id: 'v1', label: '4K Dolby Vision Remux', recommended: true, remembered: true, pinned: true,
  resolution: '4K', dynamicRange: 'dv', videoCodec: 'hevc',
  audio: { codec: 'truehd', channels: '7.1', atmos: true }, source: 'Remux', edition: 'Director’s Cut',
  languages: ['English'], sizeBytes: 67_800_000_000, availability: 'fetch',
};

test('version presentation applies badge priority and tidy, de-duplicated chips', () => {
  expect(versionBadge(version)).toBe('Your choice');
  expect(versionBadge({ ...version, remembered: undefined })).toBe('Pinned by owner');
  expect(versionBadge({ ...version, remembered: undefined, pinned: undefined })).toBe('Recommended');
  expect(versionChips(version)).toEqual(['4K', 'Dolby Vision', 'HEVC', 'Dolby Atmos', 'TrueHD', '7.1', 'Remux', 'Director’s Cut', 'English', '63.1 GB']);
  expect(versionMenuChips(version)).toEqual(['Your choice', '4K', 'Dolby Vision', 'Dolby Atmos', '63.1 GB']);
  expect(versionAvailability(version)).toBe('May take a moment to prepare');
});

test('quality menu groups originals before converted options', () => {
  const groups = versionMenuGroups([version], [{ id: '720p' }, { id: '480p' }]);
  expect(groups.versions.map(item => item.id)).toEqual(['v1']);
  expect(groups.converted.map(item => item.id)).toEqual(['720p', '480p']);
});

test('version preparation retries are bounded to three attempts and honor server delay', () => {
  expect(preparingRetry('version_preparing', { afterSeconds: 2, maxAttempts: 3 }, 1)).toBe(2);
  expect(preparingRetry('version_preparing', { afterSeconds: 2, maxAttempts: 3 }, 2)).toBe(2);
  expect(preparingRetry('version_preparing', { afterSeconds: 2, maxAttempts: 3 }, 3)).toBeNull();
  expect(preparingRetry('version_unavailable', { afterSeconds: 2 }, 1)).toBeNull();
});

const auto: VersionItem = { id: 'auto-id', label: 'Auto', recommended: true, availability: 'instant' };
const top: VersionItem = { ...version, id: 'v4k', label: '4K Dolby Vision Remux · TrueHD Atmos 7.1', availability: 'instant' };
const web: VersionItem = { id: 'v1080', label: '1080p WEB-DL · DD+ 5.1', recommended: false, availability: 'cached' };

test('every version, Auto in the first row included, plays by the id the server gave it', () => {
  expect(versionPlayArg('title-1', auto)).toBe('title-1||||auto-id');
  expect(versionPlayArg('title-1', top)).toBe('title-1||||v4k');
  expect(versionPlayArg('title-1', auto).split('|')[4]).toBe('auto-id');
});

test('a server naming Auto as playing selects the Auto row, and conversions are from the current version', () => {
  const versions = [auto, top, web];
  expect(selectedVersion(versions, 'auto-id')?.label).toBe('Auto');
  expect(convertedFrom(versions, 'auto-id')).toBe('');
  expect(convertedFrom(versions, 'v1080')).toBe('1080p WEB-DL');
  // The top release sent as its own row beside Auto stays a row of its own and can be named.
  expect(versionMenuGroups(versions, []).versions.map(item => item.id)).toEqual(['auto-id', 'v4k', 'v1080']);
  expect(convertedFrom(versions, 'v4k')).toBe('4K Dolby Vision Remux');
  expect(selectedVersion(versions, 'gone')).toBeUndefined();
  expect(convertedFrom(versions, undefined)).toBe('');
});

test('the release playing is marked on its row, also when Auto is the choice', () => {
  expect(versionRowStatus(top, 'v4k')).toBe('Playing now · Ready');
  expect(versionRowStatus(auto, 'v4k')).toBe('Ready');
  expect(versionRowStatus(web, undefined)).toBe('Ready · cached');
});

test('a playing release the menu does not list is named under the rows', () => {
  const versions = [auto, top, web];
  expect(playingElsewhere(versions, 'v4k', top.label)).toBe('');
  expect(playingElsewhere(versions, null, '720p HDTV · AAC 2.0')).toBe('Playing 720p HDTV · AAC 2.0');
  expect(playingElsewhere(versions, 'gone', '720p HDTV')).toBe('Playing 720p HDTV');
  expect(playingElsewhere(versions, undefined, '')).toBe('');
});

test('conversions are named from the release actually playing, Auto\'s pick included', () => {
  expect(convertedFrom([auto, top, web], 'auto-id', '1080p WEB-DL · DD+ 5.1 · 4.2 GB')).toBe('1080p WEB-DL');
  expect(convertedFrom([auto, top, web], 'v4k', '1080p WEB-DL · DD+ 5.1')).toBe('1080p WEB-DL');
  expect(convertedFrom([auto, top, web], 'v4k', '')).toBe('4K Dolby Vision Remux');
});

test('a version size chip counts as the server label does, so it never contradicts the title', () => {
  const base = { id: 'v', label: '', kind: 'original', resolution: '1080p', availability: 'fetch' } as unknown as Parameters<typeof versionChips>[0];
  // Ether's labels read "7.3 GB" and "11.7 GB" for these files.
  expect(versionChips({ ...base, sizeBytes: 7_838_000_000 } as never)).toContain('7.3 GB');
  expect(versionChips({ ...base, sizeBytes: 12_560_000_000 } as never)).toContain('11.7 GB');
  expect(versionChips({ ...base, sizeBytes: 150 * 1024 ** 3 } as never)).toContain('150 GB');
});
