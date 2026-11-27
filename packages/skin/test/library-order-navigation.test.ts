// The shell's navigation follows the viewer's library order and leaves out the libraries they
// hid (apps/vela/src/navigation.ts), while everything else reads every library.
import { describe, expect, test } from 'bun:test';
import { ready } from '../../core/src/store/state';
import { libraryOrderKey, type LibraryOrder } from '../../core/src/library-order';
import type { Destination, ScreenNav, VelaState } from '@vela/core';
import { navigationOf } from '../../../apps/vela/src/navigation';
import { withScreens } from '../../../apps/vela/src/plugin-screens';
import { accessor, collection, type Ctx, type Env } from '../src/vocabulary';

const library = (id: string, kind = 'movies'): Destination => ({ id, name: id, kind, dateDisplay: 'year', backdrop: '' });
const server = [library('movies'), library('shows', 'shows'), library('live', 'live'), library('music', 'music')];
const sports = [{ id: 'sports', title: 'Sports' }] as ScreenNav[];
const state = (preference?: LibraryOrder, screens?: ScreenNav[]) => ({
  auth: { serverId: 'srv-1', viewerId: 'viewer-a' },
  libraries: ready(server),
  home: { value: screens ? { screens } : undefined },
  libraryOrders: preference ? { [libraryOrderKey('srv-1', 'viewer-a')]: preference } : {},
}) as unknown as VelaState;
// The environment as env.ts builds it: every library, and the navigation beside it.
const env = (preference?: LibraryOrder, screens?: ScreenNav[], extra: Partial<Env> = {}) => ({
  section: 'home', flags: [], canLive: true,
  libraries: withScreens(server, screens), navigation: navigationOf(state(preference, screens)), ...extra,
}) as unknown as Env;
const destinations = (e: Env) => collection('nav.destinations', { index: 0 }, e, 100).map(c => c.dest!.id);
const read = (key: string, e: Env, dest?: Ctx['dest']) => accessor(key)!({ index: 0, dest }, e);

describe('navigation in the viewer order', () => {
  test('without a preference the navigation is exactly what it was', () => {
    expect(navigationOf(state())).toBe(server);
    expect(navigationOf(state({ order: [], hidden: [] }))).toBe(server);
    expect(navigationOf(state(undefined, sports))).toEqual(withScreens(server, sports));
    expect(destinations(env(undefined, sports))).toEqual(['movies', 'shows', 'live', 'screen:sports', 'music']);
  });

  test('the menu lists the libraries in the viewer order, without the hidden ones', () => {
    const e = env({ order: ['music', 'movies', 'live', 'shows'], hidden: ['shows'] });
    expect(destinations(e)).toEqual(['music', 'movies', 'live']);
    expect(read('env.libraryCount', e)).toBe('3');
    // Search, Live TV and the guide still read every library.
    expect(e.libraries.map(item => item.id)).toEqual(['movies', 'shows', 'live', 'music']);
  });

  test('the wide row sends the same order to More', () => {
    const e = env({ order: ['music', 'shows', 'movies', 'live'], hidden: [] }, undefined, { navOut: ['live', 'shows', 'movies'] });
    const more = collection('nav.destinations', { index: 0 }, e, 100).filter(c => read('dest.more', e, c.dest) === 'true').map(c => c.dest!.id);
    expect(more).toEqual(['shows', 'movies', 'live']);
  });

  test('hiding a Live TV library does not bring back the separate Live TV entry', () => {
    const e = env({ order: [], hidden: ['live'] });
    expect(destinations(e)).toEqual(['movies', 'shows', 'music']);
    expect(read('env.hasLiveLibrary', e)).toBe('true');
  });

  test('plugin screens stay in the navigation when Live TV is moved or hidden', () => {
    expect(destinations(env({ order: ['live', 'movies'], hidden: [] }, sports))).toEqual(['live', 'screen:sports', 'movies', 'shows', 'music']);
    expect(destinations(env({ order: [], hidden: ['live'] }, sports))).toEqual(['movies', 'shows', 'music', 'screen:sports']);
    expect(destinations(env({ order: [], hidden: ['movies', 'shows', 'live', 'music'] }, sports))).toEqual(['screen:sports']);
  });

  test('the phone menu button still names a hidden library while it is on screen', () => {
    const e = env({ order: [], hidden: ['shows'] }, undefined, { section: 'shows' });
    expect(destinations(e)).not.toContain('shows');
    expect(read('nav.sectionName', e)).toBe('shows');
  });

  test('another viewer on the same server keeps the server order', () => {
    const other = { ...state({ order: ['music'], hidden: ['movies'] }), auth: { serverId: 'srv-1', viewerId: 'viewer-b' } } as unknown as VelaState;
    expect(navigationOf(other)).toBe(server);
  });
});

describe('Live TV in the navigation (nav.showLive)', () => {
  test('a visible Live TV library keeps Live TV in the navigation', () => {
    expect(read('nav.showLive', env())).toBe('true');
    expect(read('nav.showLive', env({ order: ['live'], hidden: ['shows'] }))).toBe('true');
  });

  test('a hidden Live TV library takes Live TV out of the navigation, and env.canLive stays', () => {
    const e = env({ order: [], hidden: ['live'] });
    expect(read('nav.showLive', e)).toBe('false');
    expect(read('env.canLive', e)).toBe('true');
  });

  test('a server with live TV but no Live TV library keeps its own entry', () => {
    const libraries = server.filter(item => item.kind !== 'live');
    const e = { section: 'home', flags: [], canLive: true, libraries, navigation: libraries } as unknown as Env;
    expect(read('nav.showLive', e)).toBe('true');
    expect(read('nav.showLive', { ...e, canLive: false })).toBe('false');
    // An environment built without the lists reads them as empty.
    expect(read('nav.showLive', { section: 'home', flags: [], canLive: true } as unknown as Env)).toBe('true');
  });

  test('Sports stays in the navigation while Live TV is hidden', () => {
    const e = env({ order: [], hidden: ['movies', 'shows', 'live', 'music'] }, sports);
    expect(destinations(e)).toEqual(['screen:sports']);
    expect(read('nav.showLive', e)).toBe('false');
  });
});
