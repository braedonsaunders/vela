import { describe, expect, test } from 'bun:test';
import { clearTitleNavigation, isTitleNavigation, noteTitleNavigation } from '../../../apps/vela/src/title-origin';

describe('title navigation origin', () => {
  test('only the matching in-app title has the marker', () => {
    noteTitleNavigation('movie-1');
    expect(isTitleNavigation('movie-2')).toBe(false);
    expect(isTitleNavigation('movie-1')).toBe(true);
    clearTitleNavigation('movie-1');
    expect(isTitleNavigation('movie-1')).toBe(false);
  });

  test('a newer navigation replaces a stale marker', () => {
    noteTitleNavigation('movie-1');
    noteTitleNavigation('movie-2');
    expect(isTitleNavigation('movie-1')).toBe(false);
    expect(isTitleNavigation('movie-2')).toBe(true);
    clearTitleNavigation('movie-2');
  });
});
