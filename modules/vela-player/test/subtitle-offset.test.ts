import { expect, test } from 'bun:test';
import { updateSubtitlePreference, validateSubtitlePreferences } from '../web/engine/universal/subtitles/preferences';
import { defaultSubtitlePreferences } from '../web/engine/universal/subtitles/types';

test('the CC menu sets a subtitle delay in seconds, bounded to ten minutes', () => {
  const later = updateSubtitlePreference(defaultSubtitlePreferences, 'subtitleOffset=1.5');
  expect(later.offsetSeconds).toBe(1.5);
  expect(updateSubtitlePreference(later, 'subtitleOffset=-0.25').offsetSeconds).toBe(-0.25);
  expect(updateSubtitlePreference(later, 'subtitleOffset=-0').offsetSeconds).toBe(0);
  expect(validateSubtitlePreferences(later)).toEqual(later);
  expect(() => updateSubtitlePreference(later, 'subtitleOffset=601')).toThrow();
  expect(() => updateSubtitlePreference(later, 'subtitleOffset=1e3')).toThrow();
  expect(() => updateSubtitlePreference(later, 'subtitleOffset=')).toThrow();
  // Appearance choices keep the offset.
  expect(updateSubtitlePreference(later, 'subtitleSize=large')).toMatchObject({ subtitleSize: 'large', offsetSeconds: 1.5 });
});
