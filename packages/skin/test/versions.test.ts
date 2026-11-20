import { expect, test } from 'bun:test';
import type { VersionItem } from '@vela/core';
import { preparingRetry, versionAvailability, versionBadge, versionChips, versionMenuGroups } from '../src/widgets/versions';

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
  expect(versionChips(version)).toEqual(['4K', 'Dolby Vision', 'HEVC', 'Dolby Atmos', 'TrueHD', '7.1', 'Remux', 'Director’s Cut', 'English', '68 GB']);
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
