import { appearanceAsset, installedDocument, chosenSkin, packDocument } from '@vela/skin/src/installed';
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
import {
  loadFonts,
  RENDERER_VERSION,
  resolveDocument,
  type ResolvedDocument,
  type RouteName,
  type SkinHost,
  type Viewport,
} from '@vela/skin';
import { resolveUi } from '@vela/skin/src/resolve/ui';
import { ServersProvider } from '@vela/skin/src/widgets/auth';
import { LiveProvider, useLiveView } from '@vela/skin/src/widgets/guide';
import { GuideRowDrawing, GuideSurface } from '@vela/guide-native';
import { holdBack } from '@vela/skin/src/menu-key';
import { useDispatcher } from './actions';
import { config } from './data/config';
import { listenWebHandoff, platform } from './data/platform';
import { APP_FONTS, assetSource, DOCUMENTS, initialDocument } from './documents';
import { preferences } from './data/preferences';
import { AppearancePicker } from './picker';

const SKIN_PREFERENCE = 'skin';
import { authArt } from './auth-art';
import { createEnvironmentReader } from './env';
import { useLiveController } from './live';
import { LaunchGate } from './launch';
import { launchReady } from './launch-state';
import { Previews } from './previews';
import { useViewState } from './view-state';

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
  authArt: { backdrop: string; wordmark: string };
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

/** Routes a signed-out viewer may stay on. */
const SIGNED_OUT_ROUTES = ['/sign-in', '/connect'];

export function VelaProvider({ children }: { children: ReactNode }) {
  const [boot] = useState(platform);
  const [store] = useState(() => createVela({ ...boot, rendererVersion: RENDERER_VERSION }));
  const [consoleUrl, setConsoleUrl] = useState(boot.page?.consoleUrl);
  useEffect(() => {
    void start(store);
    return listenWebHandoff(link => {
      setConsoleUrl(link.consoleUrl);
      if (link.code !== undefined) void store.auth.signInWithWebCode(link.code).then(signedIn => {
        if (signedIn) router.replace('/');
      });
    });
  }, [store]);
  return (
    <StoreProvider vela={store}>
      <AppProvider store={store} consoleUrl={consoleUrl}>{children}</AppProvider>
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
  // Library/collection pages subscribe to their own keyed values. Their loading and
  // paging must not invalidate every host, the shell and all retained sections.
  const selectHostState = useMemo(() => {
    let previous: VelaState | undefined;
    return (next: VelaState): VelaState => {
      if (previous && (Object.keys(next) as (keyof VelaState)[]).every(key =>
        key === 'library' || key === 'collections' || next[key] === previous![key])) return previous;
      return previous = next;
    };
  }, []);
  const state = useVelaState(selectHostState);
  const { auth, servers } = state;
  const signedIn = auth.phase === 'signed-in';
  const live = useLiveController(store, signedIn ? auth.revision : null);
  useSignedOutGate(auth.phase);

  useEffect(() => {
    if (!signedIn) return;
    void store.home.ensure();
    store.home.ensureLibraries();
  }, [store, signedIn, state.home.load, state.libraries.load]);

  const serverSwitch = useMemo(
    () => ({ servers, actions: store.servers, consoleUrl, openConnect: () => router.push('/connect') }),
    [servers, store, consoleUrl],
  );

  // The providers wrap the app whether or not they have a value: wrapping on sign-in would remount
  // every route under them (a watch route would start its session again).
  return (
    <LiveProvider controller={live} Player={VelaPlayerView} GuideRow={GuideRowDrawing} GuideSurface={GuideSurface}>
      <ServersProvider value={signedIn ? serverSwitch : null}>
        <AppHost store={store} state={state} live={live}>
          {children}
        </AppHost>
      </ServersProvider>
    </LiveProvider>
  );
}

/** A signed-out server's viewer goes to its sign-in page; nothing else draws for them. */
function useSignedOutGate(phase: VelaState['auth']['phase']): void {
  const pathname = usePathname();
  useEffect(() => {
    if ((phase === 'signed-out' || phase === 'offline') && !SIGNED_OUT_ROUTES.includes(pathname)) router.replace('/sign-in');
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

  useEffect(() => {
    if (Platform.OS === 'web') document.title = state.appearance.value?.branding?.name || 'Vela';
  }, [state.appearance.value?.branding?.name]);
  const appearance = state.appearance.value;
  const [assetData, setAssetData] = useState<Record<string, string>>({});
  const [installed, setInstalled] = useState<SkinDocument[]>([]);
  const preferenceKey = `${SKIN_PREFERENCE}.${origin}.${state.auth.viewer}`;
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
        const doc = installedDocument(await store.appearance.document(ref.url), origin);
        if (doc.id !== ref.id) throw new Error('Skin id mismatch');
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
  const { dispatch, loadMore } = useDispatcher({ store, view, live, openPicker });
  useEffect(() => {
    if (Platform.OS !== 'web' || state.auth.phase !== 'signed-in') return;
    const find = () => {
      dispatch({ route: pathname === '/' ? 'home' : 'other', entry: '' }, 'search', '');
    };
    window.addEventListener('vela:find', find);
    return () => window.removeEventListener('vela:find', find);
  }, [dispatch, pathname, state.auth.phase]);
  const viewport: Viewport = useMemo(
    () => ({ width, height, insets, sides: { left: safeArea.left, right: safeArea.right } }),
    [width, height, insets, safeArea.left, safeArea.right],
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
  const setQuery = useCallback((query: string) => store.search.setQuery(query), [store]);
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
  const hosts = useRef(new Map<string, { inputs: unknown[]; host: SkinHost }>());
  const host = useCallback((route: RouteName, entry: string, library?: string): SkinHost | null => {
    if (!resolved.doc || !fontsReady) return null;
    const env = readEnvironment({
      state,
      view,
      live: live ? liveView : undefined,
      route,
      entry,
      width,
      skinCount: documents.length,
      skinName: resolved.doc.name,
    });
    const key = `${route}:${entry}:${library ?? ''}`;
    const routeViewport = route === 'watch' ? viewport : contentViewport;
    const inputs = [resolved.doc, env, routeViewport, dispatch, image, setQuery, view.setFlag, view.setPager, loadMore];
    const previous = hosts.current.get(key);
    if (previous && inputs.every((v, i) => v === previous.inputs[i])) return previous.host;
    const result: SkinHost = {
      doc: resolved.doc,
      env,
      viewport: routeViewport,
      dispatch: (action, arg) => dispatch({ route, entry, library }, action, arg),
      image,
      openRow: row => {
        if (row.items.some(item => item.kind === 'channel')) { router.push('/live'); return; }
        store.rows.seed(row);
        router.push({ pathname: '/row/[id]', params: { id: row.id } });
      },
      refreshHeroArtwork: id => store.home.refreshArtwork(id),
      setQuery,
      setFlag: view.setFlag,
      setPager: view.setPager,
      loadMore,
    };
    hosts.current.set(key, { inputs, host: result });
    return result;
  }, [readEnvironment, resolved.doc, fontsReady, state, view, live, liveView, width, viewport, contentViewport, dispatch, image, setQuery, loadMore]);

  const openTitle = useCallback((id: string) => store.catalogue.view(id), [store]);
  const art = useMemo(
    () => authArt(state.appearance.value, state.home.value?.defaultSkinId ?? '', choice ? raw.id : '', resolveUi(raw.ui).page),
    [state.appearance.value, state.home.value?.defaultSkinId, choice, raw.id],
  );
  const value = useMemo<Vela>(
    () => ({ store, host, doc: resolved.doc, docError: resolved.error, openTitle, authArt: art }),
    [store, host, resolved, openTitle, art],
  );
  return (
    <VelaContext.Provider value={value}>
      <LaunchGate ready={launchReady(state.auth.phase, state.home.load, fontsReady, SIGNED_OUT_ROUTES.includes(pathname), !!resolved.error)}>
        <Previews store={store} state={state} onHome={pathname === '/'} heroIndex={view.heroIndex} still={view.still}>
          {children}
        </Previews>
        {pickerOpen ? <AppearancePicker documents={documents} current={selectedIndex} locked={appearance?.force} image={image} onPick={pickDocument} onClose={closePicker} /> : null}
      </LaunchGate>
    </VelaContext.Provider>
  );
}
