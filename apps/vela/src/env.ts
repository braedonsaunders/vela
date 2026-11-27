import { searchServers } from '@vela/core';
// The view state a document reads (env) for one route, from the store's state and the app's own
// view state. A value the store has not read yet is honest about it: loading, or absent.
import { Platform } from 'react-native';
import { detailDateDisplay, viewerLibraryOrder, type VelaState } from '@vela/core';
import { aboutOf, searchView, type About, type Env, type RouteName } from '@vela/skin';
import type { LiveView } from '@vela/skin/src/widgets/guide';
import { waitForResumeSeason, detailSeason, selectedDetailSeason } from './detail-season';
import { screenDestinationId, withScreens } from './plugin-screens';
import { canManageLibraries, navigationOf } from './navigation';
import type { ViewState } from './view-state';
import { sameDestinations, sameFields } from './env-identity';

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
  /** This build and where it runs (aboutApp); the server's facts come from the state. */
  app: Pick<About, 'version' | 'build' | 'platform'>;
  /** This device can run the music visualizer now (apps/vela/src/visualizer/availability). */
  canVisualize?: boolean;
}

function load(value: { load: string; value?: unknown } | undefined): Env['load'] {
  if (value?.value !== undefined || value?.load === 'ready') return 'ready';
  if (value?.load === 'failed') return 'failed';
  return 'loading';
}

export function environment({ state, view, live, route, entry, library, width, skinCount, skinName, app, canVisualize }: EnvInput): Env {
  const home = state.home;
  const title = route === 'title' || route === 'watch' ? state.titles[entry] : undefined;
  const source = title?.value;
  const waitingForResume = waitForResumeSeason(source, view.season, !home.value && home.load !== 'failed');
  const detail = source && waitingForResume ? { ...source, pending: [...new Set([...source.pending, 'episodes' as const])] } : source;
  const { season, detail: selectedDetailRaw } = detailSeason(detail, view.season, id => state.titles[id]?.value);
  const dateDisplay = state.libraries.value?.find(item => item.id === library)?.dateDisplay;
  const selectedDetail = selectedDetailRaw ? detailDateDisplay(selectedDetailRaw, dateDisplay) : undefined;
  return {
    canVisualize: canVisualize === true,
    viewer: state.auth.viewer,
    viewerAvatar: home.value?.viewerAvatar ?? '',
    section: route === 'library' ? entry : route === 'live' ? 'live' : route === 'screen' ? screenDestinationId(entry) : 'home',
    query: state.search.query,
    small: width < 640,
    tv: width >= 1600 || Platform.isTV,
    still: view.still,
    canLive: home.value?.liveAvailable ?? false,
    canPlaylists: home.value?.playlistsAvailable ?? false,
    canSwitchProfile: state.auth.phase === 'signed-in' && state.auth.plexHomeAvailable,
    canManageLibraries: canManageLibraries(state.auth),
    width,
    home: home.value,
    heroIndex: home.value ? view.heroIndex % Math.max(1, home.value.hero.length) : 0,
    libraries: withScreens(state.libraries.value ?? [], home.value?.screens),
    navigation: navigationOf(state),
    skinCount,
    skinName,
    about: aboutOf(state, app),
    homeLoading: !home.value && home.load === 'loading',
    homeSlow: home.slow,
    detail: selectedDetail,
    season,
    route,
    load: route === 'title' || route === 'watch' ? load(title) : load(home),
    loadFailure: route === 'title' || route === 'watch' ? title?.failure : home.failure,
    entry,
    flags: view.flags,
    rowLoading: home.rowsLoading,
    // Search draws in home's view, and on Apple TV's own search route.
    search: route === 'home' || route === 'search' ? searchView(state.search, searchServers(state).length >= 2 && !state.search.library) : undefined,
    live,
    // Only home draws heroes: its hero preview starting or stopping need not redraw other routes.
    preview: { cardId: state.previews.cardId, heroId: route === 'home' ? state.previews.heroId : '' },
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
    const inputs = [state.auth.viewer, state.auth.plexHomeAvailable, state.home, state.libraries.value, state.search.query,
      state.auth.crossServerSearch, state.auth.phase, state.servers,
      route === 'home' || route === 'search' ? state.search : undefined, title, state.titles[season],
      view.season, view.flags, view.heroIndex, view.still,
      input.live, input.width, input.skinCount, input.skinName, input.app, state.auth.serverName, state.auth.serverVersion, state.servers.list.find(item => item.selected)?.kindLabel, library, state.previews.cardId, route === 'home' ? state.previews.heroId : '', input.canVisualize,
      state.auth.serverId, state.auth.viewerId, viewerLibraryOrder(state)];
    const key = `${route}:${entry}:${library ?? ''}`, previous = routes.get(key);
    if (previous && inputs.every((v, i) => v === previous.inputs[i])) return previous.env;
    const env = environment({ ...input, view: { ...view, season: selection || season } });
    // Season scoping need not replace the detail model for menu/pager changes.
    if (previous && title?.value && previous.title === title && previous.seasonTitle === state.titles[season]
      && previous.env.season === env.season) env.detail = previous.env.detail;
    if (previous?.search === state.search && previous.env.search?.canSearchAll === env.search?.canSearchAll) env.search = previous.env.search;
    if (previous && previous.env.preview?.cardId === env.preview?.cardId && previous.env.preview?.heroId === env.preview?.heroId) env.preview = previous.env.preview;
    // Values rebuilt on every read keep their identity while they say the same: nodes redraw when
    // what they read changes (TrackedHost), and the shell's navigation reads the libraries.
    if (previous && sameDestinations(previous.env.libraries, env.libraries)) env.libraries = previous.env.libraries;
    if (previous && sameDestinations(previous.env.navigation, env.navigation)) env.navigation = previous.env.navigation;
    if (previous && sameFields(previous.env.about, env.about)) env.about = previous.env.about;
    routes.set(key, { inputs, env, title, seasonTitle: state.titles[season], search: state.search });
    return env;
  };
}
