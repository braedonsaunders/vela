// The view state a document reads (env) for one route, from the store's state and the app's own
// view state. A value the store has not read yet is honest about it: loading, or absent.
import { Platform } from 'react-native';
import type { VelaState } from '@vela/core';
import { searchView, type Env, type RouteName } from '@vela/skin';
import type { LiveView } from '@vela/skin/src/widgets/guide';
import type { ViewState } from './view-state';

export interface EnvInput {
  state: VelaState;
  view: ViewState;
  live: LiveView | undefined;
  route: RouteName;
  entry: string;
  width: number;
  skinCount: number;
  skinName: string;
}

function load(value: { load: string } | undefined): Env['load'] {
  if (value?.load === 'ready') return 'ready';
  if (value?.load === 'failed') return 'failed';
  return 'loading';
}

export function environment({ state, view, live, route, entry, width, skinCount, skinName }: EnvInput): Env {
  const home = state.home;
  const title = route === 'title' || route === 'watch' ? state.titles[entry] : undefined;
  return {
    viewer: state.auth.viewer,
    section: route === 'live' ? 'live' : 'home',
    query: state.search.query,
    small: width < 640,
    tv: width >= 1600 || Platform.isTV,
    still: view.still,
    canLive: home.value?.liveAvailable ?? false,
    width,
    home: home.value,
    heroIndex: home.value ? view.heroIndex % Math.max(1, home.value.hero.length) : 0,
    libraries: state.libraries.value ?? [],
    skinCount,
    skinName,
    homeLoading: home.load === 'loading',
    detail: title?.value,
    season: view.season,
    route,
    load: route === 'title' || route === 'watch' ? load(title) : load(home),
    entry,
    flags: view.flags,
    rowLoading: home.rowsLoading,
    pagers: view.pagers,
    search: route === 'home' ? searchView(state.search) : undefined,
    live,
  };
}
