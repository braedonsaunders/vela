// Vela's own sources and actions, answered on the device (docs/experiences.md: "Sources for Vela's
// own pages"). A page document's `vela.*` source is read here, through the stores that already
// read the active server (catalogue, media, music, playlists, home, audio), never forked: each
// answer asks the store, waits for its loadable, and turns the model into `{$record}` values and
// the records they reference. What the active server cannot answer reads `unsupported`. Live
// sources (the queue, Now Playing, the import, the visualizer setting) are records core keeps
// current while some page reads them. Actions answer as plugin actions do (ScreenActionAnswer).
import type * as V from '../wire';
import type { SourceSpec } from '../../../protocol/screen';
import { isVelaAction, isVelaSource, VELA_ACTIONS, VELA_LOCAL_RECORDS, VELA_SOURCES, type ImportRecord, type LibraryInfoValue, type ListValue, type PlaylistValue, type TitleValue, type VelaActionName, type VelaSourceName } from '../../../protocol/vela-sources';
import { hasHistoryRecap, hasLibraryDuplicates, hasLibraryRecommendations, hasLiveTv, hasMusicLibrary, hasTitleChildren } from '../adapter/capabilities';
import { VelaError } from '../adapter/errors';
import { audioCardsOf, playStart, resumePoint } from '../audio/cards';
import { msg } from '../i18n';
import type { Card, PlaylistModel, Row } from '../models';
import { libraryHomeTab } from '../library-presentation';
import { childrenKey } from '../plugin-levels';
import { sameJSON, type RecordStore } from './records';
import { boolArg, cardList, lyricsLine, musicHomeValue, cardOf, cardValue, intArg, intsArg, itemId, itemKey, missingArgs, nowPlayingRecord, pairsArg, queueRecord, ref, rowsValue, sourceArgs, textArg, type LocalAnswer, type LocalRecords, type LocalScope } from './local-records';
import type { Vela } from '../store';
import { normalizeQuery, searchList } from '../store/search-list';
import type { RecordRef } from '../../../protocol/screen';
import type { Loadable } from '../store/state';
import { MAX_CHILDREN } from '../store/media';
import { libraryKey, type LibraryQuery } from '../store/catalogue';
import { recapKey, type PlaylistImportModel } from '../store/music';

/** The stores local answers wrap (the Vela store; a subset so tests can stand in). */
export type LocalStores = Pick<Vela, 'getState' | 'subscribe' | 'catalogue' | 'media' | 'music' | 'playlists' | 'home' | 'audio' | 'musicSearch' | 'live'>;

/** What the server says it offers, read after the session is ready. */
export interface LocalServer {
  ready(): Promise<{ adapter: object }>;
  features(): V.ServerCapabilities['features'] | undefined;
}

/** The viewer's visualizer choice on this device (the app's own setting, per profile). */
export interface VisualizerSettings {
  get(): { scene: string; enabled: boolean };
  /** A scene id, or "off". */
  set(id: string): void;
  subscribe(listener: () => void): () => void;
}

/** The page an action is pressed on: its sources (specs and values) and holes' scope. */
export interface LocalActionPage {
  specs: Record<string, SourceSpec>;
  values: Record<string, unknown>;
  scope: LocalScope;
}

/** A local action's answer, and the records it brings (written by the caller with the answer). */
export interface LocalActionResult { answer: V.ScreenActionAnswer; records?: LocalRecords }

/** Children read per page of `vela.children`, and how many more `vela.more` asks for. */
const LIST_PAGE = 100;
/** Import progress is read this often until it is done or failed. */
const IMPORT_POLL_MS = 1000;

const unsupported = (): LocalAnswer => ({ error: 'unsupported' });

/** A source error code from a store's failed loadable. */
function loadableError(loadable: Loadable<unknown> | undefined): string {
  if (loadable?.failure === 'not-found') return 'not_found';
  return loadable?.code || 'unavailable';
}

/** An action refusal in the server's problem shape (Screens.action rejects with it). */
function refusal(code: string, message = code.replace(/_/g, ' ')): VelaError {
  return new VelaError({ class: 'request', code, message, retry: { allowed: false } }, 400);
}

/** Waits until `read()` is no longer loading (another caller may have started the load). */
function settled<T>(stores: LocalStores, read: () => Loadable<T> | undefined): Promise<Loadable<T> | undefined> {
  return new Promise(resolve => {
    const check = () => {
      const now = read();
      if (now && now.load === 'loading') return false;
      resolve(now);
      return true;
    };
    if (check()) return;
    const off = stores.subscribe(() => { if (check()) off(); });
  });
}

/** A playlist as an `item:` card (kind playlist). */
export function playlistCard(model: Pick<PlaylistModel, 'id' | 'name' | 'poster' | 'backdrop' | 'itemCount' | 'smart'>): Card {
  return {
    id: model.id, kind: 'playlist', name: model.name, summary: '', facts: '', yearLabel: '', durationLabel: '', progressLabel: '',
    seasonNumberLabel: '', episodeNumberLabel: '', airDate: '', year: 0, rating: '', durationSeconds: 0, progressSeconds: 0,
    played: false, showId: '', showName: '', episodeContext: '', contextParts: [], seasonId: '', seasonNumber: 0, episodeNumber: 0,
    genres: [], poster: model.poster, backdrop: model.backdrop, logo: '', accent: '', receipt: '',
  };
}

export class LocalSources {
  /** Live sources being read: how many pages read each, and how to stop following it. */
  private readonly live = new Map<string, { count: number; stop: () => void }>();
  /** Extra pages `vela.more` asked for, by source identity (`from` + args). */
  private readonly extra = new Map<string, number>();
  private visualizer: VisualizerSettings | undefined;
  private importTimer: ReturnType<typeof setTimeout> | undefined;
  private importRun = 0;

  constructor(
    private readonly stores: LocalStores,
    private readonly server: LocalServer,
    private readonly records: RecordStore,
    /** Records core wrote outside a read (a live update): pages reaching them track them again. */
    private readonly changed: (keys: string[]) => void = () => {},
  ) {}

  /** The app's visualizer setting (absent: `vela.visualizer` is unsupported, the action refused). */
  setVisualizer(settings: VisualizerSettings | undefined): void {
    this.visualizer = settings;
    const bound = this.live.get('vela.visualizer');
    if (bound) { bound.stop(); this.live.set('vela.visualizer', { count: bound.count, stop: this.follow('vela.visualizer') }); }
  }

  /** Forget what the last session left: page counts, the import poll. Live bindings stay (pages re-read). */
  reset(): void {
    this.extra.clear();
    this.stopImportPoll();
  }

  static isLocal(spec: SourceSpec | undefined): boolean {
    return !!spec && typeof spec.from === 'string' && spec.from.startsWith('vela.');
  }

  static isLive(spec: SourceSpec | undefined): boolean {
    return !!spec && isVelaSource(spec.from) && (VELA_SOURCES[spec.from] as { live?: boolean }).live === true;
  }

  // Records

  /** Write records as values: unchanged ones are left alone; a key core never saw starts at rev 0,
   * a known one keeps its rev (so a newer server rev still wins). Returns the changed keys. */
  write(records: LocalRecords | undefined): string[] {
    const changed: string[] = [];
    for (const [key, value] of Object.entries(records ?? {})) {
      const known = this.records.get(key);
      if (known && sameJSON(known.value, value)) continue;
      this.records.put(key, { rev: known?.rev ?? 0, value });
      changed.push(key);
    }
    return changed;
  }

  // Live sources

  /** Keep a live source's record current until the returned function is called (counted per source). */
  bind(from: string): () => void {
    if (!isVelaSource(from) || !(VELA_SOURCES[from] as { live?: boolean }).live) return () => {};
    const known = this.live.get(from);
    if (known) known.count++;
    else this.live.set(from, { count: 1, stop: this.follow(from) });
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const entry = this.live.get(from);
      if (!entry) return;
      if (--entry.count > 0) return;
      entry.stop();
      this.live.delete(from);
    };
  }

  /**
   * Call `changed` whenever what a (not live) source reads in the stores moves and has settled: a
   * playlist's entries after a move or removal, the liked lists after a like, a title read again.
   */
  watch(spec: SourceSpec, scope: LocalScope, changed: () => void): () => void {
    if (!isVelaSource(spec.from)) return () => {};
    const select = storeSlices(spec.from, sourceArgs(spec, scope));
    if (!select) return () => {};
    let seen = select(this.stores.getState());
    return this.stores.subscribe(() => {
      const now = select(this.stores.getState());
      if (now.length === seen.length && now.every((slice, at) => slice === seen[at])) return;
      seen = now;
      // Only settled values: a read under way answers when it lands.
      if (now.some(slice => (slice as Loadable<unknown> | undefined)?.load === 'loading')) return;
      changed();
    });
  }

  /** The server's libraries, read once (a failed read is tried again). */
  private async libraries(): Promise<void> {
    const state = this.stores.getState().libraries;
    if (state.load === 'idle' || (state.load === 'failed' && !state.value)) await this.stores.home.libraries();
    await settled(this.stores, () => this.stores.getState().libraries);
  }

  /** Whether a live source is followed now (tests, diagnostics). */
  following(from: string): boolean { return this.live.has(from); }

  private follow(from: VelaSourceName): () => void {
    const push = (records: LocalRecords) => { const keys = this.write(records); if (keys.length) this.changed(keys); };
    if (from === 'vela.queue' || from === 'vela.nowPlaying') {
      let seen: unknown;
      const update = () => {
        const audio = this.stores.getState().audio;
        const basis = from === 'vela.queue' ? audio.queue : audio;
        if (basis === seen) return;
        seen = basis;
        push(this.liveRecords(from));
      };
      update();
      return this.stores.subscribe(update);
    }
    if (from === 'vela.import') {
      let seen: unknown;
      const update = () => {
        const state = this.stores.getState().music.playlistImport;
        if (state === seen) return;
        seen = state;
        push(this.liveRecords(from));
      };
      update();
      return this.stores.subscribe(update);
    }
    if (from === 'vela.visualizer' && this.visualizer) {
      const update = () => push(this.liveRecords(from));
      update();
      return this.visualizer.subscribe(update);
    }
    return () => {};
  }

  /** A live source's record(s) as they stand now. */
  private liveRecords(from: VelaSourceName): LocalRecords {
    const state = this.stores.getState();
    if (from === 'vela.queue') {
      const { value, records } = queueRecord(state.audio.queue);
      return { ...records, [VELA_LOCAL_RECORDS.queue]: value };
    }
    if (from === 'vela.nowPlaying') {
      const { value, records } = nowPlayingRecord(state.audio);
      return { ...records, [VELA_LOCAL_RECORDS.nowPlaying]: value };
    }
    if (from === 'vela.import') {
      const { value, records } = importRecord(state.music.playlistImport);
      return { ...records, [VELA_LOCAL_RECORDS.import]: value };
    }
    if (from === 'vela.visualizer' && this.visualizer) return { [VELA_LOCAL_RECORDS.visualizer]: this.visualizer.get() };
    return {};
  }

  // Reads

  /**
   * One source's answer with the records it references. The caller writes them (`write`) in the
   * same turn as it sets the value, so no release can come between. `fresh`: past the stores' session caches (a
   * page refreshing what it shows).
   */
  async read(spec: SourceSpec, scope: LocalScope, fresh = false): Promise<LocalAnswer> {
    const from = spec.from;
    if (!isVelaSource(from)) return unsupported();
    const args = sourceArgs(spec, scope);
    if (missingArgs(VELA_SOURCES[from], args).length) return { error: 'invalid_request' };
    let answer: LocalAnswer;
    try {
      answer = await this.answer(from, args, fresh, this.extra.get(sourceIdentity(from, args)) ?? 0);
    } catch (error) {
      answer = { error: error instanceof VelaError && error.detail.code ? error.detail.code : 'unavailable' };
    }
    return answer;
  }

  private async features(): Promise<{ adapter: object; features: V.ServerCapabilities['features'] | undefined }> {
    const { adapter } = await this.server.ready();
    // The server's features arrive with the bootstrap (Home's read): a page opened first waits for it.
    if (!this.server.features()) await this.stores.home.ensure().catch(() => undefined);
    return { adapter, features: this.server.features() };
  }

  private async answer(from: VelaSourceName, args: Record<string, string>, fresh: boolean, extraPages: number): Promise<LocalAnswer> {
    const { stores } = this;
    switch (from) {
      case 'vela.title': {
        const id = itemId(args.id!);
        await stores.catalogue.title(id, fresh);
        const loaded = await settled(stores, () => stores.getState().titles[id]);
        const detail = loaded?.value;
        const card = detail?.title[0];
        if (!detail || !card) return { error: loadableError(loaded) };
        const seriesId = card.media?.parents.find(parent => parent.role === 'series')?.id;
        const value: TitleValue = {
          item: ref(itemKey(card.id)),
          ...(seriesId ? { seriesId } : {}),
          canPlay: detail.canPlay,
          resumeSeconds: detail.resumeSeconds,
          mediaFacts: detail.mediaFacts,
          chapters: (detail.chapters ?? []).map(chapter => ({ id: chapter.id, name: chapter.name, startSeconds: chapter.startSeconds, ...(chapter.endSeconds !== undefined ? { endSeconds: chapter.endSeconds } : {}) })),
          childCounts: card.media?.childCounts ?? {},
        };
        return { value, records: { [itemKey(card.id)]: cardValue(card) } };
      }
      case 'vela.children': {
        const { adapter } = await this.features();
        if (!hasTitleChildren(adapter as never)) return unsupported();
        const id = itemId(args.id!);
        const role = args.role || undefined;
        const limit = Math.min(MAX_CHILDREN, Math.max(1, intArg(args.limit) ?? LIST_PAGE));
        const want = limit * (1 + extraPages);
        // A server without child levels lists every child: the role is chosen here.
        const byRole = role && stores.media.features().childRoles ? role : undefined;
        await stores.media.children(id, fresh, byRole, role && !byRole ? MAX_CHILDREN : want);
        const loaded = stores.getState().children[childrenKey(id, byRole)];
        if (!loaded?.value) return { error: loadableError(loaded) };
        const items = role && !byRole ? loaded.value.items.filter(card => card.media?.role === role) : loaded.value.items;
        const shown = items.slice(0, want);
        return cardList(shown, items.length > shown.length || loaded.value.more, loaded.value.complete ? items.length : undefined);
      }
      case 'vela.rows': {
        const placement = args.placement;
        if (placement === 'home') {
          await stores.home.ensure();
          const loaded = await settled(stores, () => stores.getState().home);
          if (!loaded?.value) return { error: loadableError(loaded) };
          return rowsValue(loaded.value.rows);
        }
        if (placement === 'title') {
          if (!args.titleId) return { error: 'invalid_request' };
          const id = itemId(args.titleId);
          await stores.catalogue.related(id);
          const loaded = await settled(stores, () => stores.getState().related[id]);
          if (!loaded?.value) return { error: loadableError(loaded) };
          return rowsValue(loaded.value);
        }
        if (placement === 'library') {
          if (!args.libraryId) return { error: 'invalid_request' };
          const { adapter } = await this.features();
          if (!hasLibraryRecommendations(adapter as never)) return unsupported();
          await this.libraries();
          const library = stores.getState().libraries.value?.find(item => item.id === args.libraryId);
          const rows = await stores.catalogue.libraryRecommendations(args.libraryId, (library?.kind ?? 'mixed') as V.Library['kind'], fresh, args.tab || libraryHomeTab(library?.tabs));
          if (!rows) return unsupported();
          return rowsValue(rows);
        }
        return { error: 'invalid_request' };
      }
      case 'vela.library': {
        let query = libraryQuery(args);
        if (args.view) {
          // A named view of the library: `albums` is its searchable album view (Search's See all).
          if (args.view !== 'albums') return { error: 'invalid_request' };
          await this.libraries();
          const tabs = stores.getState().libraries.value?.find(item => item.id === args.id)?.tabs;
          const tab = tabs?.find(item => item.kind === 'view' && item.level === 'album' && item.search === true);
          if (!tab) return unsupported();
          // As the music app: a view is searched; without a query it lists nothing.
          if (!args.q) return cardList([], false, 0);
          query = { ...query, tab: tab.id };
        }
        const pages = 1 + extraPages;
        await stores.catalogue.library(args.id!, query, pages);
        const loaded = stores.getState().library[libraryKey(args.id!, query)];
        if (!loaded?.value) return { error: loadableError(loaded) };
        return cardList(loaded.value.items, loaded.value.more);
      }
      case 'vela.favorites': {
        await this.features();
        const role = args.role!;
        const cls = args.class;
        if (!stores.music.likedAvailable) {
          // Servers before role lists: the viewer's marked Favorites playlist, by role; else (Jellyfin,
          // Plex) the library's own favourite filter, on the tab listing that role.
          if (stores.playlists.available && stores.getState().playlists.list.load !== 'ready') await stores.playlists.load();
          const favorites = stores.playlists.available ? stores.getState().playlists.list.value?.find(item => item.name === 'Favorites') : undefined;
          if (!favorites) {
            if (args.library) return this.favoritesInLibrary(args.library, role, cls, extraPages);
            return stores.playlists.available ? cardList([], false, 0) : unsupported();
          }
          await stores.playlists.open(favorites.id, false, fresh);
          const loaded = await settled(stores, () => stores.getState().collections[favorites.id]);
          if (!loaded?.value) return { error: loadableError(loaded) };
          const items = loaded.value.items.filter(card => card.media?.role === role && (!cls || card.media?.class === cls));
          return cardList(items, false, items.length);
        }
        await stores.music.liked(role, false, fresh);
        // A page asked for more than the store holds: read on.
        let loaded = await settled(stores, () => stores.getState().music.liked[role]);
        for (let pages = Math.ceil((loaded?.value?.items.length ?? 0) / 100); loaded?.value?.more && pages < 1 + extraPages; pages++) {
          await stores.music.liked(role, true);
          loaded = stores.getState().music.liked[role];
        }
        if (!loaded?.value) return { error: loadableError(loaded) };
        const items = cls ? loaded.value.items.filter(card => card.media?.class === cls) : loaded.value.items;
        return cardList(items, loaded.value.more, cls ? undefined : loaded.value.total);
      }
      case 'vela.playlists': {
        await this.features();
        if (!stores.playlists.available) return unsupported();
        if (fresh || stores.getState().playlists.list.load !== 'ready') await stores.playlists.load();
        const loaded = await settled(stores, () => stores.getState().playlists.list);
        if (!loaded?.value) return { error: loadableError(loaded) };
        return cardList(loaded.value.map(playlistCard), false, loaded.value.length);
      }
      case 'vela.playlist': {
        await this.features();
        if (!stores.playlists.available) return unsupported();
        const id = itemId(args.id!);
        await stores.playlists.open(id, false, fresh);
        let loaded = await settled(stores, () => stores.getState().collections[id]);
        for (let pages = 1; loaded?.value?.more && pages < 1 + extraPages; pages++) {
          await stores.playlists.open(id, true);
          loaded = stores.getState().collections[id];
        }
        const model = loaded?.value;
        if (!model) return { error: loadableError(loaded) };
        // `audio`: only what plays as audio (the music app lists a playlist's songs, not its videos).
        const audioOnly = boolArg(args.audio) === true;
        const entries = audioOnly ? model.items.filter(item => item.media?.audio) : model.items;
        const list = cardList(entries, model.more, audioOnly ? entries.length : model.entryCount);
        const known = stores.getState().playlists.list.value?.find(item => item.id === id);
        const playlist = playlistCard({ id, name: model.name, poster: known?.poster ?? model.items[0]?.poster ?? '', backdrop: known?.backdrop ?? '', itemCount: model.entryCount ?? model.items.length, smart: !!model.smart });
        const value: PlaylistValue = { ...list.value, playlist: ref(itemKey(id)), entryIds: entries.map(item => item.entryId ?? ''), smart: !!model.smart, summary: model.summary ?? '' };
        return { value, records: { ...list.records, [itemKey(id)]: { ...playlist, summary: model.summary ?? '' } } };
      }
      case 'vela.recent': {
        await this.features();
        if (!stores.music.recentAvailable) return unsupported();
        await stores.music.recent(fresh);
        const loaded = await settled(stores, () => stores.getState().music.recent);
        if (!loaded?.value) return { error: loadableError(loaded) };
        const records: LocalRecords = {};
        const items = loaded.value.map(context => {
          if (context.kind === 'favorites') return { kind: 'favorites' as const, role: context.role, playedAt: context.playedAt };
          records[itemKey(context.card.id)] = cardValue(context.card);
          return { kind: context.kind, item: ref(itemKey(context.card.id)), playedAt: context.playedAt };
        });
        return { value: { items }, records };
      }
      case 'vela.musicHome': {
        await this.features();
        await this.libraries();
        const library = stores.getState().libraries.value?.find(item => item.id === args.library);
        if (!library) return { error: 'not_found' };
        const [rows] = await Promise.all([
          stores.catalogue.libraryRecommendations(library.id, library.kind as V.Library['kind'], fresh, libraryHomeTab(library.tabs)).catch(() => [] as Row[]),
          stores.music.recentAvailable ? stores.music.recent(fresh) : undefined,
          stores.playlists.available && (fresh || stores.getState().playlists.list.load !== 'ready') ? stores.playlists.load() : undefined,
        ]);
        const all = stores.getState().playlists.list.value ?? [];
        const favorites = all.find(item => item.name === 'Favorites');
        let likedTotal = 0;
        if (stores.music.likedAvailable) {
          await stores.music.liked('track', false, fresh);
          likedTotal = stores.getState().music.liked.track?.value?.total ?? 0;
        } else if (favorites) {
          await stores.playlists.open(favorites.id, false, fresh);
          likedTotal = (stores.getState().collections[favorites.id]?.value?.items ?? []).filter(card => card.media?.class === 'music' && card.media?.role === 'track').length;
        }
        return musicHomeValue({
          rows: rows ?? [], recentAvailable: stores.music.recentAvailable, recent: stores.getState().music.recent.value ?? [],
          playlists: all.filter(item => item !== favorites).map(playlistCard), favoritesPlaylist: !!favorites, likedTotal,
          recapAvailable: stores.music.recapAvailable,
        });
      }
      case 'vela.libraryInfo': {
        await this.features();
        await this.libraries();
        const loaded = await settled(stores, () => stores.getState().libraries);
        const library = loaded?.value?.find(item => item.id === args.id);
        if (!library) return { error: loaded?.value ? 'not_found' : loadableError(loaded) };
        const media = library.media ?? 'video';
        const value: LibraryInfoValue = {
          id: library.id, name: library.name, kind: library.kind, media,
          experience: library.experience ?? library.declaredExperience ?? 'watch',
          listening: media === 'music' || media === 'audiobook' || media === 'podcast' ? media : 'audio',
          tabs: (library.tabs ?? []).map(tab => ({ id: tab.id, label: tab.label, kind: tab.kind, ...(tab.level ? { level: tab.level } : {}) })),
          features: {
            likedByRole: stores.music.likedAvailable, playlists: stores.playlists.available, recent: stores.music.recentAvailable,
            lyrics: stores.music.lyricsAvailable, recap: stores.music.recapAvailable, recapPeriods: stores.music.recapAvailable ? stores.music.recapPeriods : [],
            playlistImport: stores.music.playlistImportAvailable, duplicates: stores.music.duplicatesAvailable, loudness: stores.music.loudnessAvailable,
          },
        };
        return { value };
      }
      case 'vela.viewer': {
        const auth = stores.getState().auth;
        if (auth.phase !== 'signed-in') await this.features();
        const now = stores.getState();
        return { value: { id: now.auth.viewerId ?? '', name: now.auth.viewer ?? '', avatar: now.home.value?.viewerAvatar ?? '' } };
      }
      case 'vela.queue':
      case 'vela.nowPlaying':
      case 'vela.import': {
        const key = from === 'vela.queue' ? VELA_LOCAL_RECORDS.queue : from === 'vela.nowPlaying' ? VELA_LOCAL_RECORDS.nowPlaying : VELA_LOCAL_RECORDS.import;
        return { value: ref(key), records: this.liveRecords(from) };
      }
      case 'vela.visualizer':
        if (!this.visualizer) return unsupported();
        return { value: ref(VELA_LOCAL_RECORDS.visualizer), records: this.liveRecords(from) };
      case 'vela.lyrics': {
        const { adapter } = await this.features();
        if (!stores.music.lyricsAvailable || !hasMusicLibrary(adapter as never)) return unsupported();
        const id = itemId(args.id!);
        await stores.music.lyrics(id);
        const loaded = await settled(stores, () => stores.getState().music.lyrics[id]);
        if (!loaded || loaded.load === 'failed') return { error: loadableError(loaded) };
        const lyrics = loaded.value;
        if (!lyrics) return { value: { lines: [], synced: false, plain: '', instrumental: false, source: '', none: true } };
        const synced = lyrics.lines.length > 0;
        const lines = synced ? lyrics.lines.flatMap(line => lyricsLine(line) ?? []) : lyrics.plain.split('\n').map(text => ({ startMs: -1, text }));
        return { value: { lines, synced, plain: lyrics.plain, instrumental: lyrics.instrumental, source: lyrics.source, none: false } };
      }
      case 'vela.readingProgress': {
        const id = itemId(args.id!);
        await stores.catalogue.title(id, fresh);
        const loaded = await settled(stores, () => stores.getState().titles[id]);
        const media = loaded?.value?.title[0]?.media;
        if (!loaded?.value) return { error: loadableError(loaded) };
        if (!media?.readingFormat) return unsupported();
        return { value: { fraction: media.readingFraction, locator: media.readingLocator, label: media.readingLabel } };
      }
      case 'vela.recap': {
        const { adapter } = await this.features();
        if (!stores.music.recapAvailable || !hasHistoryRecap(adapter as never)) return unsupported();
        const period = args.period as V.HistoryRecapPeriod;
        await stores.music.recap(period, args.library || undefined, args.at || undefined, fresh);
        const loaded = await settled(stores, () => stores.getState().music.recaps[recapKey(period, args.library || undefined, args.at || undefined)]);
        const recap = loaded?.value;
        if (!recap) return { error: loadableError(loaded) };
        const records: LocalRecords = {};
        const entries = (list: { card: Card; plays: number; minutes: number }[]) => list.map(entry => {
          records[itemKey(entry.card.id)] = cardValue(entry.card);
          return { item: ref(itemKey(entry.card.id)), plays: entry.plays, minutes: entry.minutes };
        });
        return {
          value: {
            period: recap.period, from: recap.from, to: recap.to, minutes: recap.minutes, plays: recap.plays,
            distinctTracks: recap.distinctTracks, distinctArtists: recap.distinctArtists,
            topArtists: entries(recap.topArtists), topTracks: entries(recap.topTracks), topAlbums: entries(recap.topAlbums),
            streak: recap.streak, byDay: recap.byDay, ...(recap.firstPlayAt ? { firstPlayAt: recap.firstPlayAt } : {}), generatedAt: recap.generatedAt,
          },
          records,
        };
      }
      case 'vela.duplicates': {
        const { adapter } = await this.features();
        if (!stores.music.duplicatesAvailable || !hasLibraryDuplicates(adapter as never)) return unsupported();
        const libraryId = args.libraryId!;
        await stores.music.duplicates(libraryId, false, fresh);
        let loaded = await settled(stores, () => stores.getState().music.duplicates[libraryId]);
        for (let pages = 1; loaded?.value?.more && pages < 1 + extraPages; pages++) {
          await stores.music.duplicates(libraryId, true);
          loaded = stores.getState().music.duplicates[libraryId];
        }
        if (!loaded?.value) return { error: loadableError(loaded) };
        const records: LocalRecords = {};
        const groups = loaded.value.items.map(group => {
          const list = cardList(group.cards, false);
          Object.assign(records, list.records);
          return { recordingId: group.recordingId, count: group.count, items: list.value.items, preferred: group.preferredTitleId ? ref(itemKey(group.preferredTitleId)) : null };
        });
        return { value: { groups, more: loaded.value.more }, records };
      }
      case 'vela.recording': {
        const { adapter } = await this.features();
        if (!stores.music.duplicatesAvailable || !hasLibraryDuplicates(adapter as never)) return unsupported();
        const id = itemId(args.id!);
        await stores.music.recording(id, fresh);
        const loaded = await settled(stores, () => stores.getState().music.recordings[id]);
        if (!loaded?.value) return { error: loadableError(loaded) };
        const list = cardList(loaded.value.cards, false);
        return { value: { recordingId: loaded.value.recordingId, items: list.value.items, preferred: loaded.value.preferredTitleId ? ref(itemKey(loaded.value.preferredTitleId)) : null }, records: list.records };
      }
      case 'vela.search': {
        const q = (args.q ?? '').trim();
        if (!q) return { value: { q: '', items: [], more: false, byDescription: false, top: null, groups: {} } };
        const search = stores.musicSearch;
        search.scopeTo(args.library || undefined);
        if ((args.kind || undefined) !== stores.getState().musicSearch.kind) search.setOptions({ kind: (args.kind || undefined) as V.SearchOptions['kind'] });
        const before = stores.getState().musicSearch;
        if (before.query !== q || fresh || before.fast.status === 'failed') search.setQuery(q, true);
        let state = await this.searched(q);
        for (let pages = 1; state && searchList(state).more && pages < 1 + extraPages; pages++) {
          search.more();
          state = await this.searched(q, true);
        }
        if (!state) return { error: 'unavailable' };
        const list = searchList(state);
        if (list.state === 'failed') return { error: 'unavailable' };
        // A server that cannot keep search to a library answers its whole catalogue: keep the library's class.
        const cls = args.library && state.library !== args.library ? stores.getState().libraries.value?.find(item => item.id === args.library)?.media : undefined;
        const items = cls ? list.items.filter(card => (card.kind === 'playlist' ? cls === 'music' : card.media?.class === cls)) : list.items;
        const { value, records } = cardList(items, !!list.more);
        const groups: Record<string, RecordRef[]> = {};
        items.forEach((card, at) => { const role = card.kind === 'playlist' ? 'playlist' : card.media?.role || card.kind; (groups[role] ??= []).push(value.items[at]!); });
        const top = topMatch(items, q);
        return { value: { ...value, q, byDescription: list.byDescription, top: top ? ref(itemKey(top.id)) : null, groups }, records };
      }
      case 'vela.guide': {
        const { adapter, features } = await this.features();
        if (!hasLiveTv(adapter as never) || features?.liveTV?.available !== true) return unsupported();
        const day = Math.max(0, Math.min(6, intArg(args.day) ?? 0));
        const held = stores.getState().live.guide[day];
        if (fresh || !held?.value || held.load === 'failed') await stores.live.guide(day);
        const loaded = await settled(stores, () => stores.getState().live.guide[day]);
        const guide = loaded?.value;
        if (!guide) return { error: loadableError(loaded) };
        const records: LocalRecords = {};
        const channels = guide.channels.map(channel => { records[`channel:${channel.id}`] = channel; return ref(`channel:${channel.id}`); });
        return {
          value: { channels, day: guide.day, dayLabel: guide.dayLabel, nowMinute: guide.nowMinute, minutes: guide.minutes, days: guide.days, guides: guide.guides },
          records,
        };
      }
    }
  }

  /** A library's favourites of one role, through its favourite filter on the tab listing that role
   * (Jellyfin's Songs, Albums and Artists); unsupported where the library has no such filter. */
  private async favoritesInLibrary(libraryId: string, role: string, cls: string | undefined, extraPages: number): Promise<LocalAnswer> {
    const { stores } = this;
    await this.libraries();
    const library = stores.getState().libraries.value?.find(item => item.id === libraryId);
    if (!library) return { error: 'not_found' };
    const tab = library.tabs?.find(item => item.level === role) ?? library.tabs?.find(item => item.id === `${role}s` && item.kind === 'library');
    // The plain view says whether the library filters by favourite at all (Plex keeps none).
    const plain: LibraryQuery = tab ? { tab: tab.id } : {};
    if (!stores.getState().library[libraryKey(libraryId, plain)]?.value) await stores.catalogue.library(libraryId, plain);
    const view = stores.getState().library[libraryKey(libraryId, plain)];
    if (!view?.value) return { error: loadableError(view) };
    if (!view.value.canFavorite) return unsupported();
    const query: LibraryQuery = { ...plain, favorite: true };
    await stores.catalogue.library(libraryId, query, 1 + extraPages);
    const loaded = stores.getState().library[libraryKey(libraryId, query)];
    if (!loaded?.value) return { error: loadableError(loaded) };
    const items = loaded.value.items.filter(card => (card.media?.role ?? '') === role && (!cls || card.media?.class === cls));
    return cardList(items, loaded.value.more);
  }

  /** The audio app's search once the list for `q` has answered (or another query took over: undefined). */
  private searched(q: string, paging = false): Promise<import('../store/search').SearchState | undefined> {
    const read = () => this.stores.getState().musicSearch;
    return new Promise(resolve => {
      const check = () => {
        const state = read();
        if (state.query.trim() !== q) { resolve(undefined); return true; }
        const list = searchList(state);
        if (list.state === 'loading' || (paging && (state.fast.loadingMore || state.descriptive.loadingMore))) return false;
        resolve(state);
        return true;
      };
      if (check()) return;
      const off = this.stores.subscribe(() => { if (check()) off(); });
    });
  }

  // Actions

  /** A `vela.*` action pressed on `page`. Rejects (a VelaError) when it cannot be done. */
  async action(name: string, args: Record<string, V.ScreenActionArg>, page: LocalActionPage): Promise<LocalActionResult> {
    if (!isVelaAction(name)) throw refusal('unknown_action');
    const missing = missingArgs(VELA_ACTIONS[name], args);
    if (missing.length) throw refusal('invalid_request', `Missing ${missing.join(', ')}`);
    return this.act(name, args, page);
  }

  private async act(name: VelaActionName, args: Record<string, V.ScreenActionArg>, page: LocalActionPage): Promise<LocalActionResult> {
    const { stores } = this;
    switch (name) {
      case 'vela.play': {
        const { items, source, container } = await this.playContext(textArg(args.context), page);
        const start = textArg(args.item);
        const shuffle = boolArg(args.shuffle) === true;
        if (!items.length) {
          // No list: the item itself. A container plays its tracks, a book or show where the viewer left it.
          const card = start ? await this.card(start) : undefined;
          if (!card) throw refusal('not_found');
          const cards = await audioCardsOf(stores as Vela, card);
          if (!cards.length) throw refusal('nothing_to_play');
          const leaf = cards.length === 1 && cards[0]!.id === card.id;
          if (leaf) { stores.audio.play({ items: cards, index: 0, shuffle, positionSeconds: resumePoint(card) }); return { answer: {} }; }
          const from = playStart(card, cards);
          if (!from.items.length) throw refusal('nothing_to_play');
          stores.audio.play({ ...from, shuffle, source: { id: card.id, name: card.name, kind: card.kind === 'playlist' ? 'playlist' : 'title' } });
          return { answer: {} };
        }
        if (!start) {
          // The whole list: a book's parts or a show's episodes from where the viewer left them.
          const from = container && !shuffle ? playStart(container, items) : { items, index: 0 };
          if (!from.items.length) throw refusal('nothing_to_play');
          stores.audio.play({ ...from, shuffle, ...(source ? { source } : {}) });
          return { answer: {} };
        }
        const index = Math.max(0, items.findIndex(card => card.id === itemId(start)));
        stores.audio.play({ items, index, shuffle, positionSeconds: resumePoint(items[index]!), ...(source ? { source } : {}) });
        return { answer: {} };
      }
      case 'vela.playNext':
      case 'vela.addToQueue': {
        const card = await this.card(textArg(args.item));
        if (!card) throw refusal('not_found');
        const cards = await audioCardsOf(stores as Vela, card);
        if (!cards.length) throw refusal('nothing_to_play');
        if (!stores.getState().audio.queue) stores.audio.play({ items: cards, index: 0 });
        else if (name === 'vela.playNext') stores.audio.playNext(cards);
        else stores.audio.addToQueue(cards);
        return { answer: {} };
      }
      case 'vela.startRadio': {
        const card = await this.card(textArg(args.item));
        if (!card) throw refusal('not_found');
        const cards = await audioCardsOf(stores as Vela, card);
        const seed = cards[0];
        if (!seed) throw refusal('nothing_to_play');
        const following = await stores.music.continuation(seed.id).catch(() => [] as Card[]);
        const ids = new Set([seed.id]);
        const items = [seed, ...following.filter(item => !ids.has(item.id) && (ids.add(item.id), true))];
        stores.audio.play({ items, index: 0, source: { id: card.id, name: card.name, kind: 'title' } });
        return { answer: {} };
      }
      case 'vela.like': {
        const id = itemId(textArg(args.item));
        const on = boolArg(args.on);
        if (on === undefined) throw refusal('invalid_request', 'on must be true or false');
        await stores.catalogue.setTitleWatch(id, { favorite: on });
        const card = cardOf(this.records.get(itemKey(id))?.value);
        const role = card?.media?.role;
        if (stores.music.likedAvailable && role) void stores.music.liked(role, false, true);
        return {
          answer: { refresh: sourcesFrom(page.specs, ['vela.favorites', 'vela.playlist']) },
          ...(card ? { records: { [itemKey(id)]: { ...card, favorite: on } } } : {}),
        };
      }
      case 'vela.more': {
        const source = textArg(args.source);
        const spec = page.specs[source];
        if (!spec || !LocalSources.isLocal(spec) || !isVelaSource(spec.from)) throw refusal('invalid_request', 'Not a list on this page');
        const scope: LocalScope = { ...page.scope, sources: page.values, record: key => this.records.get(key)?.value };
        const identity = sourceIdentity(spec.from, sourceArgs(spec, scope));
        const value = page.values[source] as Partial<ListValue> | undefined;
        if (value && (value as ListValue).more === false) return { answer: {} };
        this.extra.set(identity, (this.extra.get(identity) ?? 0) + 1);
        const answer = await this.read(spec, scope);
        if ('error' in answer) throw refusal(answer.error);
        return { answer: { sources: { [source]: answer.value } }, records: answer.records };
      }
      case 'vela.playlistImport': {
        const library = textArg(args.library);
        const url = textArg(args.url);
        const format = textArg(args.format) as V.PlaylistImportFormat;
        const text = typeof args.text === 'string' ? args.text : '';
        if (!url && (!format || !text)) throw refusal('invalid_request', 'A link or a file is needed');
        const source = url ? { url } : { file: { name: textArg(args.name) || 'playlist', format, text } };
        await this.features();
        if (!stores.music.playlistImportAvailable) throw refusal('unsupported');
        const run = ++this.importRun;
        this.stopImportPoll();
        const model = await stores.music.startPlaylistImport(library, source);
        if (model && model.state !== 'done') this.pollImport(model.id, run);
        return { answer: {} };
      }
      case 'vela.playlistImportSave': {
        const current = stores.getState().music.playlistImport.value;
        if (!current || current.state !== 'done') throw refusal('import_not_ready');
        const created = await stores.music.savePlaylistImport(current.id, { name: textArg(args.name) || undefined, exclude: intsArg(args.exclude), choose: pairsArg(args.choose) });
        if (!created) throw refusal('unsupported');
        void stores.playlists.load();
        return { answer: { navigate: { action: 'navigate', args: { screen: 'vela.listen', page: 'playlist', id: created.id } } } };
      }
      case 'vela.playlistImportReset':
        this.importRun++;
        this.stopImportPoll();
        stores.music.resetPlaylistImport();
        return { answer: {} };
      case 'vela.duplicatePreference': {
        const libraryId = textArg(args.libraryId), recordingId = textArg(args.recordingId), preferred = itemId(textArg(args.preferred));
        const hide = boolArg(args.hideOthers) === true;
        const group = stores.getState().music.duplicates[libraryId]?.value?.items.find(item => item.recordingId === recordingId);
        const others = hide ? (group?.cards ?? []).map(card => card.id).filter(id => id !== preferred) : undefined;
        await this.features();
        const updated = await stores.music.setDuplicatePreference(libraryId, recordingId, preferred, others);
        if (!updated) throw refusal('unsupported');
        return { answer: { refresh: sourcesFrom(page.specs, ['vela.duplicates', 'vela.recording']) } };
      }
      case 'vela.setVisualizerScene': {
        if (!this.visualizer) throw refusal('unsupported');
        this.visualizer.set(textArg(args.id));
        const keys = this.write(this.liveRecords('vela.visualizer'));
        if (keys.length) this.changed(keys);
        return { answer: {} };
      }
    }
  }

  /** A card for an item id or key: the record pool's, else the title's detail read now. */
  private async card(value: string): Promise<Card | undefined> {
    if (!value) return undefined;
    const known = cardOf(this.records.get(itemKey(value))?.value);
    if (known) return known;
    const id = itemId(value);
    await this.stores.catalogue.title(id);
    return (await settled(this.stores, () => this.stores.getState().titles[id]))?.value?.title[0];
  }

  /** What `vela.play {context}` plays through: a list source on the page, or a container item. */
  private async playContext(context: string, page: LocalActionPage): Promise<{ items: Card[]; container?: Card; source?: { id: string; name: string; kind?: 'title' | 'playlist' | 'favorites' } }> {
    if (!context) return { items: [] };
    const spec = page.specs[context];
    const value = page.values[context] as Partial<ListValue> | undefined;
    if (spec && Array.isArray(value?.items)) {
      const items = value.items.map(item => cardOf(this.records.get(item.$record)?.value)).filter((card): card is Card => !!card && !!card.media?.audio);
      const args = LocalSources.isLocal(spec) ? sourceArgs(spec, page.scope) : {};
      const known = (id: string) => cardOf(this.records.get(itemKey(id))?.value);
      if (spec.from === 'vela.children' && args.id) {
        const container = known(args.id) ?? await this.card(args.id).catch(() => undefined);
        return { items, ...(container ? { container } : {}), source: { id: itemId(args.id), name: container?.name ?? '', kind: 'title' } };
      }
      if (spec.from === 'vela.playlist' && args.id) return { items, source: { id: itemId(args.id), name: known(args.id)?.name ?? '', kind: 'playlist' } };
      if (spec.from === 'vela.favorites' && args.role) return { items, source: { id: args.role, name: msg('music.liked'), kind: 'favorites' } };
      return { items };
    }
    const card = await this.card(context);
    if (!card) throw refusal('not_found');
    const items = await audioCardsOf(this.stores as Vela, card);
    return { items, container: card, source: { id: card.id, name: card.name, kind: card.kind === 'playlist' ? 'playlist' : 'title' } };
  }

  private pollImport(id: string, run: number): void {
    this.importTimer = setTimeout(async () => {
      this.importTimer = undefined;
      if (run !== this.importRun) return;
      const model = await this.stores.music.pollPlaylistImport(id);
      if (run !== this.importRun) return;
      if (model && model.state !== 'done') this.pollImport(id, run);
    }, IMPORT_POLL_MS);
  }

  private stopImportPoll(): void {
    if (this.importTimer) clearTimeout(this.importTimer);
    this.importTimer = undefined;
  }
}

/** Containers before leaves when two share the query's name exactly (the album over the song). */
const TOP_ORDER = ['artist', 'album', 'playlist', 'audiobook', 'book', 'series', 'show', 'track', 'part', 'episode'];

/** The best match: a title named exactly what was typed (containers first), else the server's first. */
export function topMatch(items: readonly Card[], query: string): Card | undefined {
  const q = normalizeQuery(query);
  const rank = (card: Card) => { const at = TOP_ORDER.indexOf(card.kind === 'playlist' ? 'playlist' : card.media?.role ?? ''); return at < 0 ? TOP_ORDER.length : at; };
  const exact = items.filter(card => q && normalizeQuery(card.name) === q).sort((a, b) => rank(a) - rank(b));
  return exact[0] ?? items[0];
}

type StoreState = ReturnType<LocalStores['getState']>;

/** The store slices a source's answer is made from (compared by identity), or undefined when it
 * follows none (live sources follow on their own; search and guide are read on demand). */
function storeSlices(from: VelaSourceName, args: Record<string, string>): ((state: StoreState) => unknown[]) | undefined {
  const id = args.id ? itemId(args.id) : '';
  switch (from) {
    case 'vela.title': case 'vela.readingProgress': return state => [state.titles[id]];
    case 'vela.children': return state => [state.children[childrenKey(id, args.role || undefined)], state.children[childrenKey(id)]];
    case 'vela.playlist': return state => [state.collections[id]];
    case 'vela.playlists': return state => [state.playlists.list];
    case 'vela.favorites': return state => [state.music.liked[args.role ?? ''], state.playlists.list, state.collections];
    case 'vela.recent': return state => [state.music.recent];
    case 'vela.duplicates': return state => [state.music.duplicates[args.libraryId ?? '']];
    case 'vela.recording': return state => [state.music.recordings[id]];
    case 'vela.rows': return args.placement === 'home' ? state => [state.home.value] : args.placement === 'title' ? state => [state.related[itemId(args.titleId ?? '')]] : undefined;
    case 'vela.musicHome': return state => [state.music.recent, state.playlists.list, state.music.liked.track];
    case 'vela.libraryInfo': return state => [state.libraries];
    default: return undefined;
  }
}

/** The names of the page's sources reading any of `froms`. */
function sourcesFrom(specs: Record<string, SourceSpec>, froms: string[]): string[] {
  return Object.entries(specs).filter(([, spec]) => froms.includes(spec.from)).map(([name]) => name).sort();
}

/** One source read's identity: `from` and its filled arguments. */
function sourceIdentity(from: string, args: Record<string, string>): string {
  return JSON.stringify([from, Object.keys(args).sort().map(name => [name, args[name]])]);
}

/** `vela.library` arguments as a catalogue query (absent or empty ones are the server's defaults). */
export function libraryQuery(args: Record<string, string>): LibraryQuery {
  const played = boolArg(args.played);
  const favorite = boolArg(args.favorite);
  const year = intArg(args.year);
  return {
    ...(args.sort ? { sort: args.sort as V.LibrarySort } : {}),
    ...(args.direction === 'asc' || args.direction === 'desc' ? { direction: args.direction } : {}),
    ...(args.kind ? { kind: args.kind as V.TitleKind } : {}),
    ...(args.genre ? { genre: args.genre } : {}),
    ...(played !== undefined ? { played } : {}),
    ...(favorite === true ? { favorite } : {}),
    ...(year ? { year } : {}),
    ...(args.q ? { query: args.q } : {}),
    ...(args.tab ? { tab: args.tab } : {}),
    ...(intArg(args.limit) ? { limit: Math.min(100, Math.max(1, intArg(args.limit)!)) } : {}),
  };
}

/** The `import:current` record from the music store's import. */
export function importRecord(state: Loadable<PlaylistImportModel | null>): { value: ImportRecord; records: LocalRecords } {
  const records: LocalRecords = {};
  const keep = (card: Card) => { records[itemKey(card.id)] = cardValue(card); return ref(itemKey(card.id)); };
  const model = state.value;
  const source = (value: V.ImportSource) => ({ title: value.title, artist: value.artist, ...(value.album ? { album: value.album } : {}) });
  if (!model) {
    const failedNow = state.load === 'failed';
    return {
      value: { state: state.load === 'loading' ? 'starting' : failedNow ? 'failed' : 'idle', id: '', name: '', description: '', poster: '', total: 0, done: 0, progress: 0, matched: [], unmatched: [], error: failedNow ? state.code || state.error : '', truncated: false },
      records,
    };
  }
  return {
    value: {
      state: state.load === 'failed' ? 'failed' : model.state, id: model.id, name: model.name, description: model.description, poster: model.poster,
      total: model.total, done: model.done, progress: model.total > 0 ? Math.min(1, model.done / model.total) : 0,
      matched: model.matched.map(match => ({ index: match.index, item: keep(match.card), by: match.by, source: source(match.source) })),
      unmatched: model.unmatched.map(miss => ({ index: miss.index, reason: miss.reason, source: source(miss.source), candidates: miss.candidates.map(keep) })),
      error: state.load === 'failed' ? state.code || state.error : model.error ?? '',
      truncated: !!model.truncated,
      ...(model.sourceTotal !== undefined ? { sourceTotal: model.sourceTotal } : {}),
    },
    records,
  };
}
