// The spike's app state: one server session, the home model, title details, the two built-in
// documents (the Vela base as Cinematic, and Mochi), and the view state documents read (env).
// Presses arrive here as document actions; navigation goes through expo-router.
import { router } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Action, SkinDocument } from '../../../protocol/v0/skin';
import mochi from '../../../protocol/v0/fixtures/skins/mochi/document';
import { velaBase } from '../../../client/src/skin/base';
import { detailModel, homeModel } from '../../../client/src/discovery/models';
import { artworkURL } from '../../../client/src/discovery/artwork';
import { loadFonts, page, resolveDocument, type Destination, type DetailModel, type Env, type HomeModel, type ResolvedDocument, type SkinHost, type Viewport } from '@vela/skin';
import { ASSETS } from './assets.generated';
import { EtherClient } from './ether';

const SERVER = process.env.EXPO_PUBLIC_VELA_SERVER ?? 'http://127.0.0.1:7777';
const USER = process.env.EXPO_PUBLIC_VELA_USER ?? 'demo';
const PASSWORD = process.env.EXPO_PUBLIC_VELA_PASSWORD ?? 'vela';
const DOCUMENTS: SkinDocument[] = [velaBase, mochi as SkinDocument];
/** The app's own faces, which the Vela base's display type names. */
const APP_FONTS = { instrument: { family: 'Instrument Serif', files: [
  { url: 'assets/fonts/InstrumentSerif-Regular.ttf', weight: 400, style: 'normal' as const },
  { url: 'assets/fonts/InstrumentSerif-Italic.ttf', weight: 400, style: 'italic' as const },
] } };

type Load = Env['load'];

interface Vela {
  host(route: 'home' | 'title', entry: string): SkinHost | null;
  doc: ResolvedDocument | null;
  docError: string | null;
  openTitle(id: string): void;
}

const VelaContext = createContext<Vela | null>(null);

export function useVela(): Vela {
  const vela = useContext(VelaContext);
  if (!vela) throw new Error('useVela outside <VelaProvider>');
  return vela;
}

function source(path: string): string | number | undefined {
  if (!path) return undefined;
  if (ASSETS[path] !== undefined) return ASSETS[path];
  if (/^https?:\/\//.test(path)) return path;
  if (path.startsWith('/')) return `${SERVER}${path}`;
  return undefined;
}

export function VelaProvider({ children }: { children: ReactNode }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const client = useRef(new EtherClient(SERVER)).current;
  const [load, setLoad] = useState<Load>('loading');
  const [home, setHome] = useState<HomeModel>();
  const [viewer, setViewer] = useState('');
  const [libraries, setLibraries] = useState<Destination[]>([]);
  const [details, setDetails] = useState<Record<string, { load: Load; model?: DetailModel }>>({});
  const [docIndex, setDocIndex] = useState(0);
  const [query, setQuery] = useState('');
  const [flags, setFlags] = useState<string[]>([]);
  const [heroIndex, setHeroIndex] = useState(0);
  const [season, setSeason] = useState('');
  const [pagers, setPagers] = useState<Env['pagers']>({});
  const [still, setStill] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);
  const images = useMemo(() => ({ origin: SERVER }), []);
  const artWidth = Math.ceil(Math.max(width, 960) * 2);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setStill);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setStill);
    return () => sub.remove();
  }, []);

  const start = useCallback(async () => {
    setLoad('loading');
    try {
      if (!client.signedIn) setViewer((await client.signIn(USER, PASSWORD)).viewer.name);
      await client.negotiate();
      const [bootstrap, libraryPage] = await Promise.all([client.bootstrap(), client.libraries()]);
      setHome(homeModel(bootstrap, images, Date.now(), artWidth));
      setLibraries(libraryPage.items.map(({ id, name, kind, artwork }) => {
        const backdrop = artwork.find(a => a.kind === 'backdrop');
        return { id, name, kind, backdrop: backdrop ? artworkURL(backdrop, 960, 540, images) ?? '' : '' };
      }));
      setLoad('ready');
    } catch (error) {
      console.warn('Vela could not reach its server', error);
      setLoad('failed');
    }
  }, [client, images, artWidth]);

  useEffect(() => { start(); }, [start]);

  const openTitle = useCallback((id: string) => {
    if (details[id]?.load === 'ready') return;
    setDetails(d => ({ ...d, [id]: { load: 'loading' } }));
    client.detail(id).then(
      data => setDetails(d => ({ ...d, [id]: { load: 'ready', model: detailModel(data, images, artWidth) } })),
      () => setDetails(d => ({ ...d, [id]: { load: 'failed' } })),
    );
  }, [client, details, images, artWidth]);

  const raw = DOCUMENTS[docIndex % DOCUMENTS.length];
  const resolved = useMemo(() => {
    try { return { doc: resolveDocument(raw, width), error: null }; } catch (error) { return { doc: null, error: String(error) }; }
  }, [raw, width]);

  useEffect(() => {
    setFontsReady(false);
    Promise.all([loadFonts(APP_FONTS, source), loadFonts(raw.fonts, source)]).finally(() => setFontsReady(true));
  }, [raw]);

  const rotating = !!home && home.hero.length > 1 && !still && query === '';
  useEffect(() => {
    if (!rotating || !home) return;
    const timer = setInterval(() => setHeroIndex(i => (i + 1) % home.hero.length), 9000);
    return () => clearInterval(timer);
  }, [rotating, home, heroIndex]);

  const setFlag = useCallback((flag: string, on: boolean) => {
    setFlags(list => (on ? (list.includes(flag) ? list : [...list, flag]) : list.filter(f => f !== flag)));
  }, []);

  const dispatch = useCallback((action: Action, arg: string) => {
    switch (action) {
      case 'select': {
        const [id, kind] = arg.split('|');
        if (kind === 'season') { setSeason(id); return; }
        if (id) router.push({ pathname: '/title/[id]', params: { id } });
        return;
      }
      case 'pickHero': setHeroIndex(Number(arg) || 0); return;
      case 'home': setQuery(''); router.dismissTo('/'); return;
      case 'back': case 'close':
        if (action === 'close' && arg) { setFlag(arg, false); return; }
        if (router.canGoBack()) router.back();
        return;
      case 'toggle': setFlags(list => (list.includes(arg) ? list.filter(f => f !== arg) : [...list, arg])); return;
      case 'open': setFlag(arg, true); return;
      case 'only': setFlags(list => (list.includes(arg) ? list.filter(f => f !== arg) : [...list.filter(f => f.startsWith('keep-')), arg])); return;
      case 'reset': setFlags(list => list.filter(f => f.startsWith('keep-'))); return;
      case 'clearSearch': setQuery(''); return;
      case 'search': case 'focusSearch': setFlag('search-focused', true); return;
      case 'pageNext': page(arg, 1); return;
      case 'pagePrev': page(arg, -1); return;
      case 'openPicker': setDocIndex(i => i + 1); return;
      case 'retry': start(); return;
      default:
        // Playback is spike (b); libraries, live TV, auth and collections follow at conversion.
        console.info(`Vela spike: ${action} ${arg} is not part of spike (a)`);
    }
  }, [setFlag, start]);

  const viewport: Viewport = useMemo(() => ({ width, height, insets }), [width, height, insets]);

  const host = useCallback((route: 'home' | 'title', entry: string): SkinHost | null => {
    if (!resolved.doc || !fontsReady) return null;
    const detail = route === 'title' ? details[entry] : undefined;
    const env: Env = {
      viewer, section: 'home', query, small: width < 640, tv: width >= 1600 || Platform.isTV, still, canLive: home?.liveAvailable ?? false,
      width, home, heroIndex: home ? heroIndex % Math.max(1, home.hero.length) : 0, libraries, skinCount: DOCUMENTS.length, skinName: resolved.doc.name,
      homeLoading: false, detail: detail?.model, season, route, load: route === 'title' ? detail?.load ?? 'loading' : load, entry, flags, rowLoading: [], pagers,
    };
    return {
      doc: resolved.doc, env, viewport, dispatch, image: path => { const s = source(path); return s === undefined ? undefined : typeof s === 'number' ? s : { uri: s }; },
      setQuery, setFlag, setPager: (rowId, state) => setPagers(p => (p[rowId]?.atStart === state.atStart && p[rowId]?.atEnd === state.atEnd ? p : { ...p, [rowId]: state })),
    };
  }, [resolved.doc, fontsReady, details, viewer, query, width, still, home, heroIndex, libraries, season, load, flags, pagers, viewport, dispatch, setFlag]);

  const value = useMemo<Vela>(() => ({ host, doc: resolved.doc, docError: resolved.error, openTitle }), [host, resolved, openTitle]);
  return <VelaContext.Provider value={value}>{children}</VelaContext.Provider>;
}
