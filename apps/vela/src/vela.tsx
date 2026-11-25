import { appearanceAsset, installedDigest, installedDocument, chosenSkin, packDocument } from '@vela/skin/src/installed';
import type { SkinDocument } from '../../../packages/protocol/skin';
// The app's state for its routes: the core store (sessions, servers, catalogue, search, playback,
// live TV) under core's provider, the built-in skin documents, and the host each route draws
// with (the active document, the view state documents read, and what presses do). A signed-out
// server sends the viewer to /sign-in.
import { router, usePathname } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createVela, type Vela as Store, type VelaState } from '@vela/core';
import { VelaProvider as StoreProvider, useVelaState } from '@vela/core/react';
import { VelaPlayerView } from '@vela/player';
import { useFold } from '@vela/fold';
import {
  loadFonts,
  RENDERER_VERSION,
  resolveDocument,
  type ResolvedDocument,
  type RouteName,
  type SkinHost,
  type Viewport,
} from '@vela/skin';
import { HostContext } from '@vela/skin/src/host';
import { resolveUi } from '@vela/skin/src/resolve/ui';
import { PlexProfileDialog, ServersProvider } from '@vela/skin/src/widgets/auth';
import { LiveProvider, useLiveView } from '@vela/skin/src/widgets/guide';
import { GuideRowDrawing, GuideSurface } from '@vela/guide-native';
import { holdBack } from '@vela/skin/src/menu-key';
import { useDispatcher } from './actions';
import { config } from './data/config';
import { setQuietPlayback } from '@vela/skin/src/quiet-playback';
import { PreviewBadge, previewReturnPath, startPreview, usePreviewReload } from './screen-preview';

// A lab or development build (a pinned server on a device, start routes, or __DEV__) never starts
// playback with sound: it may open a channel or multiview on launch on a shared TV.
setQuietPlayback(__DEV__ || !!config.startRoutes || (Platform.OS !== 'web' && !!config.server));
import { aboutApp, listenWebHandoff, platform } from './data/platform';
import { APP_FONTS, assetSource, DOCUMENTS, initialDocument } from './documents';
import { preferences } from './data/preferences';
import { AppearancePicker } from './picker';
import { AddToPlaylist } from './playlists/add-to-playlist';
import { useLast } from '@vela/skin/src/presence';

const SKIN_PREFERENCE = 'skin';
import { authArt } from './auth-art';
import { createEnvironmentReader } from './env';
import { useMediaAccess } from './media-access';
import { useLiveController } from './live';
import { useMultiviewController } from './multiview';
import { MultiviewProvider, useMultiview } from '@vela/skin/src/widgets/multiview';
import { LaunchGate } from './launch';
import { launchReady } from './launch-state';
import { Previews } from './previews';
import { createHostStateSelector } from './host-state';
import { useViewState } from './view-state';
import { actionHref, webHref } from './action-href';
import { useSearchAddress } from './use-search-address';
import { pageTitle } from './page-title';
import { prefetchLibrary, prefetchLibrariesWhenIdle } from './browse/prefetch';
import { screenOf, screenPath } from './plugin-screens';

export interface Vela {
  /** The core store, for its actions (`vela.store.auth.signIn`, …). */
  store: Store;
  /** The host a route draws with; null until the document and its fonts are ready. */
  host(route: RouteName, entry: string, library?: string): SkinHost | null;
  doc: ResolvedDocument | null;
  docError: string | null;
  /** A title's page is on screen (a title or watch route): its details are read and kept current
   * while partial. Call the returned function when it leaves. */
  openTitle(id: string): () => void;
  /** The server pack's stage art for the signed-out page, as document image paths ('' for none). */
  authArt: { backdrop: string; wordmark: string; name?: string };
}

const VelaContext = createContext<Vela | null>(null);

export function useVela(): Vela {
  const vela = useContext(VelaContext);
  if (!vela) throw new Error('useVela outside <VelaProvider>');
  return vela;
}

/** The safe area a screen keeps clear of. A TV's (tvOS reports its overscan margins) is no hardware
 * in the way: there, as on every other TV, pictures run to the edges, the header stands at the top
 * and documents keep their own TV gutters, so it is zero. */
const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };
function useScreenInsets(): { top: number; right: number; bottom: number; left: number } {
  const safeArea = useSafeAreaInsets();
  return Platform.isTV ? NO_INSETS : safeArea;
}

/** A screen's padding for the safe area at its sides, filled with the active document's page.
 * Documents lay out between the side insets (AppHost gives them that width), so the padding is
 * applied once, by every screen, rather than by each document's gutters. */
export function useSideInsets(): { paddingLeft: number; paddingRight: number; backgroundColor: string } {
  const { left, right } = useScreenInsets();
  const doc = useContext(VelaContext)?.doc;
  const page = useMemo(() => resolveUi(doc?.document.ui).page, [doc]);
  return useMemo(() => ({ paddingLeft: left, paddingRight: right, backgroundColor: page }), [left, right, page]);
}

/** The About line's app facts: fixed for the life of the bundle. */
const ABOUT_APP = aboutApp();

/** Routes a signed-out viewer may stay on. */
const SIGNED_OUT_ROUTES = ['/sign-in', '/connect'];

/**
 * The core store belongs to the JavaScript runtime, not to a mount of the app's tree. On Android,
 * Back out of the app destroys its Activity but keeps the process and the runtime, and opening it
 * again mounts the tree anew: it finds the same store (the session, the sign-in, the queue that is
 * still playing) rather than starting a second one beside the first, which nothing would stop.
 */
let runtime: { boot: ReturnType<typeof platform>; store: Store } | undefined;
/** Stores whose session has been settled (`start`): once each, however often the tree mounts. */
const started = new WeakSet<Store>();

function runtimeStore(): NonNullable<typeof runtime> {
  if (!runtime) {
    const boot = platform();
    runtime = { boot, store: createVela({ ...boot, rendererVersion: RENDERER_VERSION }) };
  }
  return runtime;
}

export function VelaProvider({ children }: { children: ReactNode }) {
  const [{ boot, store }] = useState(runtimeStore);
  // Development: probes (tools/perf/screen-record-push.ts) push records through the real store.
  if (__DEV__ && typeof globalThis !== 'undefined') (globalThis as { __velaStore?: unknown }).__velaStore = store;
  const [consoleUrl, setConsoleUrl] = useState(boot.page?.consoleUrl);
  useEffect(() => {
    if (!started.has(store)) {
      started.add(store);
      // A Studio preview (screen-preview.tsx) enters preview mode before bootstrap is read.
      startPreview(store);
      void start(store);
    }
    return listenWebHandoff(link => {
      setConsoleUrl(link.consoleUrl);
      if (link.code !== undefined) void store.auth.signInWithWebCode(link.code).then(signedIn => {
        if (signedIn) router.replace((previewReturnPath() ?? '/') as never);
      });
    });
  }, [store]);
  usePreviewReload(store);
  return (
    <StoreProvider vela={store}>
      <AppProvider store={store} consoleUrl={consoleUrl}>{children}</AppProvider>
      <PreviewBadge />
    </StoreProvider>
  );
}

/** Settle the session; a development or lab build may then sign in from its configuration. */
async function start(store: Store): Promise<void> {
  await store.start();
  const auth = store.getState().auth;
  if (config.user && config.password && auth.phase === 'signed-out' && auth.serverKind === 'ether') {
    await store.auth.signIn(config.user, config.password);
  }
}

function AppProvider({ store, children, consoleUrl }: { store: Store; children: ReactNode; consoleUrl?: string }) {
  // Pages and the player subscribe to their own values; player ticks must not
  // redraw the shell and every retained catalogue section behind the video.
  const selectHostState = useMemo(createHostStateSelector, []);
  const state = useVelaState(selectHostState);
  const { auth, servers } = state;
  const signedIn = auth.phase === 'signed-in';
  useMediaAccess(store, signedIn ? auth.revision : null);
  const live = useLiveController(store, signedIn ? auth.revision : null);
  const multiview = useMultiviewController(store, signedIn ? auth.revision : null, live);
  useSignedOutGate(auth.phase);

  useEffect(() => {
    if (!signedIn) return;
    void store.home.ensure();
    store.home.ensureLibraries();
  }, [store, signedIn, state.home.load, state.libraries.load]);
  // Once home has drawn, read the first libraries' first pages while the app is idle, so their
  // first visit draws at once.
  const homeReady = signedIn && state.home.load === 'ready';
  useStartRoutes(homeReady);
  const libraryIds = (state.libraries.value ?? []).filter(library => library.kind !== 'live').map(library => library.id).join(',');
  useEffect(() => {
    if (!homeReady || !libraryIds) return;
    return prefetchLibrariesWhenIdle(store, libraryIds.split(','));
  }, [store, homeReady, libraryIds, auth.revision]);

  const serverSwitch = useMemo(
    () => ({ servers, actions: store.servers, brandingName: state.appearance.value?.branding?.name, consoleUrl, openConnect: () => router.push('/connect') }),
    [servers, store, state.appearance.value?.branding?.name, consoleUrl],
  );

  // The providers wrap the app whether or not they have a value: wrapping on sign-in would remount
  // every route under them (a watch route would start its session again).
  return (
    <LiveProvider controller={live} Player={VelaPlayerView} GuideRow={GuideRowDrawing} GuideSurface={GuideSurface}>
      <MultiviewProvider value={multiview}>
        <ServersProvider value={signedIn ? serverSwitch : null}>
          <AppHost store={store} state={state} live={live}>
            {children}
          </AppHost>
        </ServersProvider>
      </MultiviewProvider>
    </LiveProvider>
  );
}

/** A lab build's configured routes, opened once home is ready (config.startRoutes). */
let startRoutesOpened = false;
function useStartRoutes(homeReady: boolean): void {
  useEffect(() => {
    if (!homeReady || !config.startRoutes || startRoutesOpened) return;
    startRoutesOpened = true;
    String(config.startRoutes).split("|").filter(Boolean).forEach((route: string, n: number) => {
      setTimeout(() => router.push(route as never), 1500 + n * 7000);
    });
  }, [homeReady]);
}

/** A signed-out server's viewer goes to its sign-in page; nothing else draws for them. */
function useSignedOutGate(phase: VelaState['auth']['phase']): void {
  const pathname = usePathname();
  useEffect(() => {
    if ((phase === 'signed-out' || phase === 'offline') && !SIGNED_OUT_ROUTES.includes(pathname)) {
      const search = Platform.OS === 'web' ? window.location.search : '';
      router.replace({ pathname: '/sign-in', params: { returnTo: `${pathname}${search}` } });
    }
  }, [phase, pathname]);
}

interface AppHostProps {
  store: Store;
  state: VelaState;
  live: ReturnType<typeof useLiveController>;
  children: ReactNode;
}

/** The active document and the hosts routes draw with. Inside LiveProvider, so env.live reads it. */
function AppHost({ store, state, live, children }: AppHostProps) {
  const windowSize = useWindowDimensions();
  const safeArea = useScreenInsets();
  // Screens are padded by the side insets (useSideInsets): a document lays out in the width between
  // them, and its env(safe-area-inset-left/right) is then zero. A phone's notch in landscape, or the
  // Dynamic Island on the right edge of an unfolded iPhone, never covers a control.
  const width = windowSize.width - safeArea.left - safeArea.right;
  const height = windowSize.height;
  const insets = useMemo(() => ({ top: safeArea.top, right: 0, bottom: safeArea.bottom, left: 0 }), [safeArea.top, safeArea.bottom]);
  const liveView = useLiveView();
  const heroPreviewing = state.previews.heroId !== '' && state.previews.url !== '';
  const pathname = usePathname();
  const view = useViewState(state.home.value?.hero.length ?? 0, state.search.query, heroPreviewing, pathname === '/');
  const [docIndex, setDocIndex] = useState(initialDocument);
  /** Whether the viewer chose the document (`?skin=`, the picker); else the server's default applies. */
  const [picked, setPicked] = useState(() => DOCUMENTS[initialDocument()]?.id !== DOCUMENTS[0]?.id);
  const [fontsReady, setFontsReady] = useState(false);
  const origin = state.servers.list.find(s => s.selected)?.origin ?? '';
  // Open menus and panels belong to the session they were opened in: signing out or in, or
  // switching server, closes them (a menu left open on sign-out would greet the next sign-in).
  const { resetFlags } = view;
  const session = `${state.auth.phase === 'signed-in'}|${origin}`;
  useEffect(() => resetFlags(), [session, resetFlags]);

  const appearance = state.appearance.value;
  const [assetData, setAssetData] = useState<Record<string, string>>({});
  const [installed, setInstalled] = useState<SkinDocument[]>([]);
  const preferenceKey = `${SKIN_PREFERENCE}.${origin}.${state.auth.viewerId || state.auth.viewer}`;
  const [choice, setChoice] = useState(() => preferences.get(preferenceKey) || preferences.get(SKIN_PREFERENCE) || (picked ? DOCUMENTS[docIndex]!.id : ''));
  useEffect(() => { setChoice(preferences.get(preferenceKey) || preferences.get(SKIN_PREFERENCE) || ''); }, [preferenceKey]);
  useEffect(() => {
    void store.appearance.load();
    const active = () => {
      void store.appearance.load();
      if (store.getState().auth.phase === 'offline') void store.auth.retry();
    };
    const subscription = AppState.addEventListener('change', next => { if (next === 'active') active(); });
    const visible = () => { if (document.visibilityState === 'visible') active(); };
    if (Platform.OS === 'web') {
      window.addEventListener('online', active);
      document.addEventListener('visibilitychange', visible);
    }
    return () => {
      subscription.remove();
      if (Platform.OS === 'web') {
        window.removeEventListener('online', active);
        document.removeEventListener('visibilitychange', visible);
      }
    };
  }, [store, session]);
  useEffect(() => {
    let cancelled = false;
    setInstalled([]);
    void Promise.all((appearance?.docs ?? []).filter(ref => !DOCUMENTS.some(d => d.id === ref.id)).map(async ref => {
      try {
        const value = await store.appearance.document(ref.url);
        // A document resolved on this device before is not resolved at every width again.
        const known = `skin-resolved.${ref.id}`;
        const digest = installedDigest(JSON.stringify(value) ?? '', RENDERER_VERSION);
        const resolved = preferences.get(known) === digest;
        const doc = installedDocument(value, origin, resolved);
        if (doc.id !== ref.id) throw new Error('Skin id mismatch');
        if (!resolved) void preferences.set(known, digest);
        return doc;
      } catch { console.info('Ignored invalid installed skin', ref.id); return null; }
    })).then(docs => { if (!cancelled) setInstalled(docs.filter((d): d is SkinDocument => d !== null)); });
    return () => { cancelled = true; };
  }, [appearance, origin, store]);
  const documents = useMemo(() => [...DOCUMENTS, ...installed, ...(appearance?.packs ?? []).flatMap(pack => {
    const base = DOCUMENTS.find(d => d.id === pack.engine || (pack.engine === 'cinematic' && d === DOCUMENTS[0]));
    return base && !DOCUMENTS.some(d => d.id === pack.id) ? [packDocument(base, pack)] : [];
  })], [installed, appearance]);
  useEffect(() => {
    let cancelled = false;
    setAssetData({});
    const urls = new Set<string>();
    const visit = (value: unknown) => {
      if (typeof value === 'string') { try { urls.add(appearanceAsset(value, origin)); } catch {} }
      else if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') Object.values(value).forEach(visit);
    };
    visit(installed); visit(appearance?.packs);
    void Promise.all([...urls].map(async url => {
      try {
        const headers = await store.appearance.assetHeaders(url);
        const response = await fetch(url, { headers, redirect: 'error' });
        if (!response.ok) return;
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > 8 * 1024 * 1024) return;
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        const type = response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream';
        if (!cancelled) setAssetData(data => ({ ...data, [url]: `data:${type};base64,${btoa(binary)}` }));
      } catch { /* Unavailable artwork does not prevent the skin from drawing. */ }
    }));
    return () => { cancelled = true; };
  }, [installed, appearance, origin, store]);
  const selectedId = chosenSkin(documents.map(d => d.id), choice, appearance);
  const selectedIndex = documents.findIndex(d => d.id === selectedId);
  const raw = documents[selectedIndex]!;
  const packMark = appearance?.packs.find(pack => pack.id === raw.id)?.wordmark;
  const branding = useMemo(() => packMark ? { ...appearance?.branding, wordmark: { url: packMark, width: 240, height: 60 } } : appearance?.branding, [packMark, appearance?.branding]);
  const resolved = useMemo(() => {
    try {
      return { doc: resolveDocument(raw, width, 'en', branding), error: null };
    } catch (error) {
      return { doc: null, error: String(error) };
    }
  }, [raw, width, branding]);

  useEffect(() => {
    setFontsReady(false);
    const source = (path: string) => assetData[path] ?? assetSource(path, origin);
    void Promise.all([loadFonts(APP_FONTS, source), loadFonts(raw.fonts, source)]).finally(() => setFontsReady(true));
  }, [raw, origin, assetData]);

  // The appearance picker: the viewer's choice applies at once and is remembered on this device.
  const [pickerOpen, setPickerOpen] = useState(false);
  const openPicker = useCallback(() => setPickerOpen(true), []);
  const closePicker = useCallback(() => setPickerOpen(false), []);
  const [playlistTarget, setPlaylistTarget] = useState<{ titleId: string; titleKind?: string } | null>(null);
  const openAddToPlaylist = useCallback((titleId: string, titleKind?: string) => setPlaylistTarget({ titleId, titleKind }), []);
  const closeAddToPlaylist = useCallback(() => setPlaylistTarget(null), []);
  // The sheet stays drawn while it leaves (presence.tsx).
  const shownPlaylistTarget = useLast(playlistTarget);
  const pickDocument = useCallback((index: number) => {
    if (appearance?.force) return;
    setChoice(documents[index]!.id);
    setDocIndex(index);
    setPicked(true);
    setPickerOpen(false);
    resetFlags();
    void preferences.set(preferenceKey, documents[index]!.id);
  }, [resetFlags, documents, appearance?.force, preferenceKey]);
  useEffect(() => {
    if (picked) return;
    const index = DOCUMENTS.findIndex(doc => doc.id === preferences.get(SKIN_PREFERENCE));
    if (index >= 0) { setDocIndex(index); setPicked(true); }
  // Only at start: a stored choice never overrides one made in this session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Typing stays on the screen it began on: the address follows the query in place (#21), as a
  // route change per keystroke remounted home and dropped the field's focus.
  const setQuery = useCallback((query: string) => store.search.setQuery(query), [store]);
  useSearchAddress(store, state.search.query, pathname, state.auth.phase === 'signed-in');
  const multiviewContext = useMultiview();
  const { dispatch, loadMore } = useDispatcher({ store, view, live, openPicker, openAddToPlaylist, setQuery, multiview: multiviewContext?.open ?? null });
  useEffect(() => {
    if (Platform.OS !== 'web' || state.auth.phase !== 'signed-in') return;
    const find = () => {
      dispatch({ route: pathname === '/' ? 'home' : 'other', entry: '' }, 'search', '');
    };
    window.addEventListener('vela:find', find);
    return () => window.removeEventListener('vela:find', find);
  }, [dispatch, pathname, state.auth.phase]);
  // A foldable partly open (an iPhone Duo held like a book or stood on a table): where the window
  // divides. Flat, the viewport is as on any phone or tablet.
  const fold = useFold();
  const viewport: Viewport = useMemo(
    () => ({ width, height, insets, sides: { left: safeArea.left, right: safeArea.right }, ...(fold.posture === 'flat' ? {} : { fold }) }),
    [width, height, insets, safeArea.left, safeArea.right, fold],
  );
  // Android's content navigator already consumes the system bars. Only watch is
  // full-display; passing the bars to other documents reserves that space twice.
  const contentViewport: Viewport = useMemo(() => Platform.OS === 'android' && !Platform.isTV
    ? { ...viewport, height: height - insets.top - insets.bottom, insets: NO_INSETS }
    : viewport, [viewport, height, insets]);
  const image = useCallback<SkinHost['image']>(path => {
    const source = assetData[path] ?? assetSource(path, origin);
    if (source === undefined) return undefined;
    // A URL; or a bundled asset, which is a module id natively and an asset object on the web.
    return typeof source === 'string' ? { uri: source } : source;
  }, [origin, assetData]);
  // On TV, Back (Menu) with a search open clears the search, as it closes a menu, rather than
  // leaving the app. Only while home (where the results are) is the screen showing: held over a
  // title page or the player, it kept Menu from closing them (the player blocked its own removal
  // while tvOS hid it, and Play then went nowhere).
  const searching = state.search.query !== '' && pathname === '/';
  useEffect(() => {
    if (!Platform.isTV || !searching) return;
    return holdBack(() => {
      store.search.setQuery('');
      return true;
    });
  }, [searching, store]);

  const readEnvironment = useMemo(createEnvironmentReader, [state.auth.revision]);
  // A pointer over (or focus on) a section's destination reads its first page ahead.
  const prefetch = useCallback<NonNullable<SkinHost['prefetch']>>((action, arg) => {
    if (action === 'library' && arg && !screenOf(arg)) void prefetchLibrary(store, arg).catch(() => {});
  }, [store]);
  const hosts = useRef(new Map<string, { inputs: unknown[]; host: SkinHost; libraries: unknown }>());
  const host = useCallback((route: RouteName, entry: string, library?: string): SkinHost | null => {
    if (!resolved.doc || !fontsReady) return null;
    const env = readEnvironment({
      state,
      view,
      live: live ? liveView : undefined,
      route,
      entry,
      library,
      width,
      skinCount: documents.length,
      skinName: resolved.doc.name,
      app: ABOUT_APP,
    });
    const key = `${route}:${entry}:${library ?? ''}`;
    const routeViewport = route === 'watch' ? viewport : contentViewport;
    const inputs = [resolved.doc, env, routeViewport, dispatch, image, setQuery, view.setFlag, loadMore];
    const previous = hosts.current.get(key);
    if (previous && inputs.every((v, i) => v === previous.inputs[i])) return previous.host;
    const result: SkinHost = {
      doc: resolved.doc,
      env,
      viewport: routeViewport,
      dispatch: previous && inputs.slice(3).every((v, i) => v === previous.inputs[i + 3])
        ? previous.host.dispatch : (action, arg) => dispatch({ route, entry, library }, action, arg),
      // A route's tree redraws whole when its host's functions change; keep them while what they read is the same.
      href: previous && previous.libraries === state.libraries.value ? previous.host.href : Platform.OS === 'web' ? (action, arg) => {
        const liveLibrary = action === 'library' && state.libraries.value?.find(item => item.id === arg)?.kind === 'live';
        const screen = action === 'library' ? screenOf(arg) : '';
        const href = liveLibrary ? '/live' : screen ? screenPath(screen) : actionHref({ route, entry, library }, action, arg);
        return href && webHref(href);
      } : undefined,
      image,
      openRow: previous?.host.openRow ?? (row => {
        if (row.items.some(item => item.kind === 'channel')) { router.push('/live'); return; }
        store.rows.seed(row);
        router.push({ pathname: '/row/[id]', params: { id: row.id } });
      }),
      rowHref: previous ? previous.host.rowHref : Platform.OS === 'web' ? row => webHref(row.items.some(item => item.kind === 'channel') ? '/live' : `/row/${encodeURIComponent(row.id)}`) : undefined,
      refreshHeroArtwork: previous?.host.refreshHeroArtwork ?? (id => store.home.refreshArtwork(id)),
      setQuery,
      setFlag: view.setFlag,
      loadMore,
      prefetch,
    };
    hosts.current.set(key, { inputs, host: result, libraries: state.libraries.value });
    return result;
  }, [readEnvironment, resolved.doc, fontsReady, state, view, live, liveView, width, viewport, contentViewport, dispatch, image, setQuery, loadMore, prefetch]);

  const openTitle = useCallback((id: string) => store.catalogue.view(id), [store]);
  const art = useMemo(
    () => authArt(state.appearance.value, state.home.value?.defaultSkinId ?? '', choice ? raw.id : '', resolveUi(raw.ui).page),
    [state.appearance.value, state.home.value?.defaultSkinId, choice, raw.id],
  );
  const value = useMemo<Vela>(
    () => ({ store, host, doc: resolved.doc, docError: resolved.error, openTitle, authArt: art }),
    [store, host, resolved, openTitle, art],
  );
  const overlayHost = state.auth.plexSwitching ? host('home', '') : null;
  return (
    <VelaContext.Provider value={value}>
      {Platform.OS === 'web' && <DocumentTitle pathname={pathname} />}
      <LaunchGate ready={launchReady(state.auth.phase, state.home.load, fontsReady, SIGNED_OUT_ROUTES.includes(pathname), !!resolved.error, state.home.slow)}
        brandingReady={state.appearance.load === 'ready' || state.appearance.load === 'failed'} branding={appearance?.branding}>
        <Previews store={store} state={state} onHome={pathname === '/' && !pickerOpen} heroIndex={view.heroIndex} still={view.still} searchFocused={view.flags.includes('search-focused')}>
          {children}
        </Previews>
        {pickerOpen ? <AppearancePicker documents={documents} current={selectedIndex} locked={appearance?.force} image={image} branding={appearance?.branding} onPick={pickDocument} onClose={closePicker} /> : null}
        {shownPlaylistTarget ? <AddToPlaylist key={shownPlaylistTarget.titleId} {...shownPlaylistTarget} open={!!playlistTarget} close={closeAddToPlaylist} /> : null}
        {state.auth.plexSwitching && overlayHost ? <HostContext.Provider value={overlayHost}>
          <PlexProfileDialog profiles={state.auth.plex?.profiles ?? []} currentProfileId={state.auth.viewerId} error={state.auth.error}
            onChoose={(id, pin) => store.auth.choosePlexProfile(id, pin)} onRestart={() => store.auth.startPlexProfileSwitch()} onClose={() => store.auth.cancelPlex()}
            onRelink={state.auth.plexRelink ? () => { store.auth.cancelPlex(); router.push({ pathname: '/connect', params: { plex: '1' } }); } : undefined} />
        </HostContext.Provider> : null}
      </LaunchGate>
    </VelaContext.Provider>
  );
}

/** Names the web page after what is on show and the server, route by route. */
function DocumentTitle({ pathname }: { pathname: string }) {
  const title = useVelaState(state => pageTitle(pathname, typeof location === 'undefined' ? '' : location.search, state,
    state.appearance.value?.branding?.name || state.servers.list.find(server => server.selected)?.name || 'Vela'));
  useEffect(() => { document.title = title; }, [title]);
  return null;
}
