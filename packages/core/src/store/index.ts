// The Vela store: the app's data state and the actions that change it, framework-free. It
// replaces the Exact answer dispatcher (client/src/sources.ts): what each source did now lives in
// a slice (auth, servers, home, catalogue, search, playback, live, appearance, receipts,
// previews), and React reads the state through `@vela/core/react`.
import type { AppearanceModel } from '../appearance';
import type { GuideModel } from '../live/guide';
import type { CollectionModel, Destination, DetailModel, LibraryModel, Row } from '../models';
import { setLocale, type LocaleContext } from '../i18n';
import type { ClientCapabilities } from '../wire';
import { Appearance } from './appearance';
import { Auth, initialAuth, type AuthState } from './auth';
import { Catalogue } from './catalogue';
import { Home, initialHome, type HomeState } from './home';
import { initialLive, Live, type LiveState } from './live';
import { initialPlayback, Playback, type PlaybackState } from './playback';
import type { MediaCapabilities, VelaPlatform } from './platform';
import { Previews } from './previews';
import { Receipts } from './receipts';
import { initialSearch, Search, type SearchState } from './search';
import { initialServers, Servers, type ServersState } from './servers';
import { Session } from './session';
import { idle, StateBox, type Loadable } from './state';

export interface VelaState {
  auth: AuthState;
  servers: ServersState;
  home: HomeState;
  libraries: Loadable<Destination[]>;
  /** Title details by title ID. */
  titles: Record<string, Loadable<DetailModel>>;
  /** Related rows by title ID. */
  related: Record<string, Loadable<Row[]>>;
  /** Library views by `libraryKey(id, query)`. */
  library: Record<string, Loadable<LibraryModel>>;
  /** Collections by collection ID. */
  collections: Record<string, Loadable<CollectionModel>>;
  search: SearchState;
  playback: PlaybackState;
  live: LiveState;
  appearance: Loadable<AppearanceModel>;
}

export interface VelaOptions extends VelaPlatform {
  /** The skin renderer version this app draws; built-in documents needing a newer one are not offered. */
  rendererVersion: number;
}

export interface Vela {
  getState(): VelaState;
  subscribe(listener: () => void): () => void;
  /** Settle the session (redeem a sign-in link, validate what is stored) and read the server list. */
  start(): Promise<void>;
  /** The display's locale, time zone and offset; labels read afterwards use it. */
  setLocale(context: LocaleContext): void;
  /** The player's capabilities changed (a new engine, an output change): servers are told again. */
  setMedia(media: MediaCapabilities): void;
  /** What this client declares it can play (as negotiated with servers), once the player has said. */
  client(): Promise<ClientCapabilities>;
  /** The width artwork is sized for; reads after this use it. */
  setArtWidth(width: number): void;
  auth: Auth;
  servers: Servers;
  home: Home;
  catalogue: Catalogue;
  search: Search;
  playback: Playback;
  live: Live;
  appearance: Appearance;
  receipts: Receipts;
  previews: Previews;
}

const initialState: VelaState = {
  auth: initialAuth,
  servers: initialServers,
  home: initialHome,
  libraries: idle(),
  titles: {},
  related: {},
  library: {},
  collections: {},
  search: initialSearch,
  playback: initialPlayback,
  live: initialLive,
  appearance: idle(),
};

/** Art widths come in steps, so a window resized by a few pixels reads the same images. */
const ART_STEP = 320;
const bucket = (width: number) => Math.max(ART_STEP, Math.ceil(width / ART_STEP) * ART_STEP);

export function createVela(options: VelaOptions): Vela {
  const box = new StateBox<VelaState>(initialState);
  const session = new Session(options);
  let artWidth = bucket(options.artWidth);
  const width = () => artWidth;
  const auth = new Auth(box, session, options);
  const servers = new Servers(box, session, options);
  const previews = new Previews(session);
  return {
    getState: box.get,
    subscribe: box.subscribe,
    async start() {
      await auth.start();
      await servers.refresh().catch(() => {});
    },
    setLocale(context) {
      setLocale(JSON.stringify(context));
    },
    setMedia(media) {
      session.setMedia(media);
      previews.setClient(session.client);
    },
    client: () => session.declared(),
    setArtWidth(next) {
      artWidth = bucket(next);
    },
    auth,
    servers,
    home: new Home(box, session, width),
    catalogue: new Catalogue(box, session, width),
    search: new Search(box, session, width),
    playback: new Playback(box, session),
    live: new Live(box, session),
    appearance: new Appearance(box, session, options.rendererVersion),
    receipts: new Receipts(session),
    previews,
  };
}

export type { AppearanceModel, GuideModel };
