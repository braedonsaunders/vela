import { expect, test } from 'bun:test';
import type { Destination } from '@vela/core';
import { screenDestinationId, screenOf, screenPath, withScreens } from '../../../apps/vela/src/plugin-screens';
import { sectionPathVisible, sectionRoute } from '../../../apps/vela/src/section-route';

const library = (id: string, kind = 'movies'): Destination => ({ id, name: id, kind, dateDisplay: 'year', backdrop: '' });

test('plugin screens join the navigation right after Live TV', () => {
  const libraries = [library('movies'), library('live', 'live'), library('music')];
  const shown = withScreens(libraries, [{ id: 'sports', title: 'Sports', icon: 'sports' }]);
  expect(shown.map(d => d.id)).toEqual(['movies', 'live', 'screen:sports', 'music']);
  expect(shown[2]).toMatchObject({ name: 'Sports', kind: 'screen' });
  expect(withScreens([library('movies')], [{ id: 'sports', title: 'Sports', icon: '' }]).map(d => d.id)).toEqual(['movies', 'screen:sports']);
  expect(withScreens(libraries, [])).toBe(libraries);
});

test('a screen destination is told from a library and routed as a section', () => {
  expect(screenOf(screenDestinationId('sports'))).toBe('sports');
  expect(screenOf('movies')).toBe('');
  expect(screenPath('sports')).toBe('/screen/sports');
  expect(sectionRoute('screen/[id]', 'sports')).toEqual({ route: 'screen', entry: 'sports' });
  expect(sectionPathVisible('/screen/sports')).toBe(true);
  expect(sectionPathVisible('/game/x')).toBe(false);
});
