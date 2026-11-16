// The app's state for its routes: the core store (sessions, servers, catalogue, search, playback,
// live TV) under core's provider, the built-in skin documents, and the host each route draws
// with (the active document, the view state documents read, and what presses do). A signed-out
// server sends the viewer to /sign-in.
import { router, usePathname } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useWindowDimensions } from 'react-native';
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
import { ServersProvider } from '@vela/skin/src/widgets/auth';
import { LiveProvider, useLiveView } from '@vela/skin/src/widgets/guide';
import { useDispatcher } from './actions';
import { config } from './data/config';
import { platform } from './data/platform';
import { APP_FONTS, assetSource, DOCUMENTS, initialDocument } from './documents';
import { preferences } from './data/preferences';
import { AppearancePicker } from './picker';

const SKIN_PREFERENCE = 'skin';
import { authArt } from './auth-art';
import { environment } from './env';
import { useLiveController } from './live';
import { Previews } from './previews';
import { useViewState } from './view-state';

export interface Vela {
  /** The core store, for its actions (`vela.store.auth.signIn`, …). */
  store: Store;
  /** The host a route draws with; null until the document and its fonts are ready. */
  host(route: RouteName, entry: string): SkinHost | null;
  doc: ResolvedDocument | null;
  docError: string | null;
  /** Read a title's details (a title or watch route opened). */
  openTitle(id: string): void;
  /** The server pack's stage art for the signed-out page, as document image paths ('' for none). */
  authArt: { backdrop: string; wordmark: string };
}

const VelaContext = createContext<Vela | null>(null);

export function useVela(): Vela {
  const vela = useContext(VelaContext);
  if (!vela) throw new Error('useVela outside <VelaProvider>');
  return vela;
}

/** Routes a signed-out viewer may stay on. */
const SIGNED_OUT_ROUTES = ['/sign-in', '/connect'];

export function VelaProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => createVela({ ...platform(), rendererVersion: RENDERER_VERSION }));
  useEffect(() => {
    void start(store);
  }, [store]);
  return (
    <StoreProvider vela={store}>
      <AppProvider store={store}>{children}</AppProvider>
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

function AppProvider({ store, children }: { store: Store; children: ReactNode }) {
  const state = useVelaState(s => s);
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
    () => ({ servers, actions: store.servers, openConnect: () => router.push('/connect') }),
    [servers, store],
  );

  // The providers wrap the app whether or not they have a value: wrapping on sign-in would remount
  // every route under them (a watch route would start its session again).
  return (
    <LiveProvider controller={live} Player={VelaPlayerView}>
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
    if (phase === 'signed-out' && !SIGNED_OUT_ROUTES.includes(pathname)) router.replace('/sign-in');
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
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const liveView = useLiveView();
  const heroPreviewing = state.previews.heroId !== '' && state.previews.url !== '';
  const view = useViewState(state.home.value?.hero.length ?? 0, state.search.query, heroPreviewing);
  const pathname = usePathname();
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

  const raw = DOCUMENTS[docIndex % DOCUMENTS.length]!;
  const resolved = useMemo(() => {
    try {
      return { doc: resolveDocument(raw, width), error: null };
    } catch (error) {
      return { doc: null, error: String(error) };
    }
  }, [raw, width]);

  useEffect(() => {
    setFontsReady(false);
    const source = (path: string) => assetSource(path, origin);
    void Promise.all([loadFonts(APP_FONTS, source), loadFonts(raw.fonts, source)]).finally(() => setFontsReady(true));
  }, [raw, origin]);

  // The appearance picker: the viewer's choice applies at once and is remembered on this device.
  const [pickerOpen, setPickerOpen] = useState(false);
  const openPicker = useCallback(() => setPickerOpen(true), []);
  const closePicker = useCallback(() => setPickerOpen(false), []);
  const pickDocument = useCallback((index: number) => {
    setDocIndex(index);
    setPicked(true);
    setPickerOpen(false);
    void preferences.set(SKIN_PREFERENCE, DOCUMENTS[index]!.id);
  }, []);
  useEffect(() => {
    if (picked) return;
    const index = DOCUMENTS.findIndex(doc => doc.id === preferences.get(SKIN_PREFERENCE));
    if (index >= 0) { setDocIndex(index); setPicked(true); }
  // Only at start: a stored choice never overrides one made in this session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { dispatch, loadMore } = useDispatcher({ store, view, live, openPicker });
  const viewport: Viewport = useMemo(() => ({ width, height, insets }), [width, height, insets]);
  const image = useCallback<SkinHost['image']>(path => {
    const source = assetSource(path, origin);
    if (source === undefined) return undefined;
    // A URL; or a bundled asset, which is a module id natively and an asset object on the web.
    return typeof source === 'string' ? { uri: source } : source;
  }, [origin]);
  const setQuery = useCallback((query: string) => store.search.setQuery(query), [store]);

  const host = useCallback((route: RouteName, entry: string): SkinHost | null => {
    if (!resolved.doc || !fontsReady) return null;
    const env = environment({
      state,
      view,
      live: live ? liveView : undefined,
      route,
      entry,
      width,
      skinCount: DOCUMENTS.length,
      skinName: resolved.doc.name,
    });
    return {
      doc: resolved.doc,
      env,
      viewport,
      dispatch: (action, arg) => dispatch({ route, entry }, action, arg),
      image,
      setQuery,
      setFlag: view.setFlag,
      setPager: view.setPager,
      loadMore,
    };
  }, [resolved.doc, fontsReady, state, view, live, liveView, width, viewport, dispatch, image, setQuery, loadMore]);

  const openTitle = useCallback((id: string) => void store.catalogue.title(id), [store]);
  const art = useMemo(
    () => authArt(state.appearance.value, state.home.value?.defaultSkinId ?? '', picked ? raw.id : ''),
    [state.appearance.value, state.home.value?.defaultSkinId, picked, raw.id],
  );
  const value = useMemo<Vela>(
    () => ({ store, host, doc: resolved.doc, docError: resolved.error, openTitle, authArt: art }),
    [store, host, resolved, openTitle, art],
  );
  return (
    <VelaContext.Provider value={value}>
      <Previews store={store} state={state} onHome={pathname === '/'} heroIndex={view.heroIndex} still={view.still}>
        {children}
      </Previews>
      {pickerOpen ? <AppearancePicker documents={DOCUMENTS} current={docIndex % DOCUMENTS.length} image={image} onPick={pickDocument} onClose={closePicker} /> : null}
    </VelaContext.Provider>
  );
}
