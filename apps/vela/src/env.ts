// The view state a document reads (env) for one route, from the store's state and the app's own
// view state. A value the store has not read yet is honest about it: loading, or absent.
import { Platform } from 'react-native';
import { detailDateDisplay, type VelaState } from '@vela/core';
import { searchView, type Env, type RouteName } from '@vela/skin';
import type { LiveView } from '@vela/skin/src/widgets/guide';
import { waitForResumeSeason, detailSeason, selectedDetailSeason } from './detail-season';
import type { ViewState } from './view-state';

export interface EnvInput {
  state: VelaState;
  view: ViewState;
  live: LiveView | undefined;
  route: RouteName;
  entry: string;
  library?: string;
  width: number;
  skinCount: number;
  skinName: string;
}

function load(value: { load: string; value?: unknown } | undefined): Env['load'] {
  if (value?.value !== undefined || value?.load === 'ready') return 'ready';
  if (value?.load === 'failed') return 'failed';
  return 'loading';
}

export function environment({ state, view, live, route, entry, library, width, skinCount, skinName }: EnvInput): Env {
  const home = state.home;
  const title = route === 'title' || route === 'watch' ? state.titles[entry] : undefined;
  const source = title?.value;
  const waitingForResume = waitForResumeSeason(source, view.season, !home.value && home.load !== 'failed');
  const detail = source && waitingForResume ? { ...source, pending: [...new Set([...source.pending, 'episodes' as const])] } : source;
  const { season, detail: selectedDetailRaw } = detailSeason(detail, view.season, id => state.titles[id]?.value);
  const dateDisplay = state.libraries.value?.find(item => item.id === library)?.dateDisplay;
  const selectedDetail = selectedDetailRaw ? detailDateDisplay(selectedDetailRaw, dateDisplay) : undefined;
  return {
    viewer: state.auth.viewer,
    section: route === 'library' ? entry : route === 'live' ? 'live' : 'home',
    query: state.search.query,
    small: width < 640,
    tv: width >= 1600 || Platform.isTV,
    still: view.still,
    canLive: home.value?.liveAvailable ?? false,
    canPlaylists: home.value?.playlistsAvailable ?? false,
    width,
    home: home.value,
    heroIndex: home.value ? view.heroIndex % Math.max(1, home.value.hero.length) : 0,
    libraries: state.libraries.value ?? [],
    skinCount,
    skinName,
    homeLoading: !home.value && home.load === 'loading',
    homeSlow: home.slow,
    detail: selectedDetail,
    season,
    route,
    load: route === 'title' || route === 'watch' ? load(title) : load(home),
    entry,
    flags: view.flags,
    rowLoading: home.rowsLoading,
    pagers: view.pagers,
    search: route === 'home' ? searchView(state.search) : undefined,
    live,
    preview: { cardId: state.previews.cardId, heroId: state.previews.heroId },
  };
}

/** Keep a route's environment stable while unrelated store slices change. */
export function createEnvironmentReader() {
  const defaults = new Map<string, string>();
  const routes = new Map<string, { inputs: unknown[]; env: Env; title: unknown; seasonTitle: unknown; search: unknown }>();
  return (input: EnvInput): Env => {
    const { state, view, route, entry, library } = input;
    const title = route === 'title' || route === 'watch' ? state.titles[entry] : undefined;
    const explicit = title?.value?.seasons.some(s => s.id === view.season || `@number:${s.seasonNumber}` === view.season);
    const selection = explicit ? view.season : defaults.get(entry) ?? '';
    const home = state.home.value;
    const resume = !selection && title?.value ? [...(home?.hero ?? []), ...(home?.rows.flatMap(row => row.items) ?? [])].find(card => card.showId === entry && card.progressSeconds > 0 && !card.played) : undefined;
    const waitingForResume = !selection && !home && state.home.load !== 'failed' && !title?.value?.nextUp?.length;
    const season = waitingForResume ? '' : selectedDetailSeason(title?.value, selection, resume);
    if (season && !defaults.has(entry)) defaults.set(entry, season);
    const inputs = [state.auth.viewer, state.home, state.libraries.value, state.search.query,
      route === 'home' ? state.search : undefined, title, state.titles[season],
      view.season, view.flags, view.pagers, view.heroIndex, view.still,
      input.live, input.width, input.skinCount, input.skinName, library, state.previews.cardId, state.previews.heroId];
    const key = `${route}:${entry}:${library ?? ''}`, previous = routes.get(key);
    if (previous && inputs.every((v, i) => v === previous.inputs[i])) return previous.env;
    const env = environment({ ...input, view: { ...view, season: selection || season } });
    // Season scoping need not replace the detail model for menu/pager changes.
    if (previous && title?.value && previous.title === title && previous.seasonTitle === state.titles[season]
      && previous.env.season === env.season) env.detail = previous.env.detail;
    if (previous?.search === state.search) env.search = previous.env.search;
    if (previous && previous.env.preview?.cardId === env.preview?.cardId && previous.env.preview?.heroId === env.preview?.heroId) env.preview = previous.env.preview;
    routes.set(key, { inputs, env, title, seasonTitle: state.titles[season], search: state.search });
    return env;
  };
}
