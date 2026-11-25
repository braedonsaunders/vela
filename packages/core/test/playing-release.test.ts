import { expect, test } from 'bun:test';
import type { PlaybackPlan } from '../src/wire';
import { playingRelease, withPlaying } from '../src/store/playing-release';

const plan = (extra: Partial<PlaybackPlan> = {}) => ({ sessionId: 's', revision: 1, sourceGeneration: 1, seekGeneration: 1, selectedVersionId: 'auto', ...extra }) as PlaybackPlan;

test('the plan\'s own playing release is kept; a snapshot or event fills in only what it lacks', () => {
  const own = plan({ playingVersionId: 'v4k', playingLabel: '4K Remux · TrueHD 7.1' });
  expect(withPlaying(own, { playingVersionId: 'v1080', playingLabel: '1080p WEB-DL' })).toBe(own);
  const filled = withPlaying(plan(), { playingVersionId: 'v1080', playingLabel: '1080p WEB-DL · DD+ 5.1 · 4.2 GB' });
  expect(filled).toMatchObject({ selectedVersionId: 'auto', playingVersionId: 'v1080', playingLabel: '1080p WEB-DL · DD+ 5.1 · 4.2 GB' });
  expect(withPlaying(plan(), undefined)).toEqual(plan());
});

test('a release with no row is null, not absent; malformed values are dropped', () => {
  expect(withPlaying(plan(), { playingVersionId: null, playingLabel: 'Auto · now 720p HDTV' }).playingVersionId).toBeNull();
  const bad = withPlaying(plan(), { playingVersionId: '' as never, playingLabel: '  ' });
  expect('playingVersionId' in bad || 'playingLabel' in bad).toBe(false);
  expect(withPlaying(plan({ playingVersionId: 7 as never }), { playingVersionId: 'v1' }).playingVersionId).toBe('v1');
});

test('the playing release as the chrome reads it', () => {
  expect(playingRelease(plan())).toBeNull();
  expect(playingRelease(null)).toBeNull();
  expect(playingRelease(plan({ playingVersionId: 'v1', playingLabel: ' 1080p WEB-DL ' }))).toEqual({ versionId: 'v1', label: '1080p WEB-DL' });
  expect(playingRelease(plan({ playingVersionId: null, playingLabel: '720p HDTV' }))).toEqual({ versionId: null, label: '720p HDTV' });
  expect(playingRelease(plan({ playingLabel: '720p HDTV' }))).toEqual({ versionId: null, label: '720p HDTV' });
});
