// The music app's server reads (docs/media-kinds.md): a viewer's likes of one role, a page at a
// time (Liked Songs, saved albums, followed artists), a title's lyrics, listening recaps ("Rewind"),
// playlist imports (links and M3U/CSV files), and duplicate recording review. Each exists only where
// the server advertises it (features.favoritesList, features.lyrics, features.historyRecap,
// features.playlistImport, features.duplicates).
import type * as V from '../wire';
import { hasHistoryRecap, hasLibraryDuplicates, hasMusicLibrary, hasPlaylistImports } from '../adapter/capabilities';
import { card, entry } from '../discovery/models';
import { durationLabel } from '../media';
import { localeContext, msg, number, plural } from '../i18n';
import type { Card } from '../models';
import type { Session } from './session';
import { failed, idle, loading, ready, type Loadable, type StateBox } from './state';
import type { VelaState } from './index';

export interface LikedList { items: (Card & { likedAt: string })[]; total: number; cursor: string; more: boolean }
export interface Lyrics { lines: { startMs: number; text: string }[]; plain: string; instrumental: boolean; source: string }

/** One thing the viewer played from: a title (album, artist), a playlist, or a liked list. */
export type RecentContext = { kind: 'title'; card: Card; playedAt: string } | { kind: 'playlist'; card: Card; playedAt: string } | { kind: 'favorites'; role: string; playedAt: string };

export interface RecapEntryModel { card: Card; plays: number; minutes: number }
export interface HistoryRecapModel {
  period: V.HistoryRecapPeriod;
  from: string;
  to: string;
  minutes: number;
  plays: number;
  distinctTracks: number;
  distinctArtists: number;
  topArtists: RecapEntryModel[];
  topTracks: RecapEntryModel[];
  topAlbums: RecapEntryModel[];
  streak: { current: number; longest: number };
  byDay: { date: string; minutes: number }[];
  firstPlayAt?: string;
  generatedAt: string;
}

export interface RecapLabels {
  distinctTracks: string;
  distinctArtists: string;
  topArtists: string;
  topTracks: string;
  topAlbums: string;
}

export interface RecapChartBucket {
  label: string;
  minutes: number;
  dateRange: string;
  totalMinutes: number;
  dayCount: number;
  tooltip: string;
}

/** Presentation-aware labels for a listening recap across music, audiobooks and podcasts. */
export function recapLabels(kind: 'music' | 'audiobook' | 'podcast' = 'music'): RecapLabels {
  if (kind === 'audiobook') {
    return {
      distinctTracks: msg('music.rewind.distinctTracks.audiobook'),
      distinctArtists: msg('music.rewind.distinctArtists.audiobook'),
      topArtists: msg('music.rewind.topArtists.audiobook'),
      topTracks: msg('music.rewind.topTracks.audiobook'),
      topAlbums: msg('music.rewind.topAlbums.audiobook'),
    };
  }
  if (kind === 'podcast') {
    return {
      distinctTracks: msg('music.rewind.distinctTracks.podcast'),
      distinctArtists: msg('music.rewind.distinctArtists.podcast'),
      topArtists: msg('music.rewind.topArtists.podcast'),
      topTracks: msg('music.rewind.topTracks.podcast'),
      topAlbums: msg('music.rewind.topAlbums.podcast'),
    };
  }
  return {
    distinctTracks: msg('music.rewind.distinctTracks'),
    distinctArtists: msg('music.rewind.distinctArtists'),
    topArtists: msg('music.rewind.topArtists'),
    topTracks: msg('music.rewind.topTracks'),
    topAlbums: msg('music.rewind.topAlbums'),
  };
}

/** Aggregate daily recap minutes (`byDay`, up to 365 days) into at most `maxBars` display buckets. */
export function recapChartBuckets(byDay: readonly { date: string; minutes: number }[], maxBars = 31): RecapChartBucket[] {
  if (!byDay.length || maxBars <= 0) return [];
  if (byDay.length <= maxBars) {
    return byDay.map(d => ({
      label: d.date.slice(5),
      minutes: d.minutes,
      dateRange: d.date,
      totalMinutes: d.minutes,
      dayCount: 1,
      tooltip: `${d.date} · ${number(d.minutes)} min`,
    }));
  }
  const step = Math.ceil(byDay.length / maxBars);
  const out: RecapChartBucket[] = [];
  for (let i = 0; i < byDay.length; i += step) {
    const slice = byDay.slice(i, i + step);
    const sum = slice.reduce((acc, d) => acc + d.minutes, 0);
    const first = slice[0]?.date ?? '';
    const last = slice[slice.length - 1]?.date ?? first;
    const dateRange = first === last ? first : `${first} → ${last}`;
    const avg = Math.round(sum / slice.length);
    out.push({
      label: first.slice(5),
      minutes: avg,
      dateRange,
      totalMinutes: sum,
      dayCount: slice.length,
      tooltip: slice.length === 1
        ? `${dateRange} · ${number(sum)} min`
        : `${dateRange} · ${number(sum)} min (${number(avg)} min/day)`,
    });
  }
  return out;
}

/** Format the shareable text summary for a listening recap. */
export function formatRecapSummary(recap: HistoryRecapModel, viewer: string, labels: RecapLabels = recapLabels()): string {
  const topArtist = recap.topArtists[0]?.card;
  const topTrack = recap.topTracks[0]?.card;
  const topAlbum = recap.topAlbums[0]?.card;
  return [
    `${viewer}’s Vela Rewind (${msg(`music.rewind.period.${recap.period}`)})`,
    `${number(recap.minutes)} min · ${number(recap.plays)} plays · ${recap.streak.longest}d streak`,
    topArtist ? `#1 ${labels.topArtists}: ${topArtist.name}` : '',
    topTrack ? `#1 ${labels.topTracks}: ${topTrack.name}` : '',
    topAlbum ? `#1 ${labels.topAlbums}: ${topAlbum.name}` : '',
  ].filter(Boolean).join('\n');
}

/** Format the four headline stat cards for a listening recap. */
export function recapStatCards(recap: HistoryRecapModel, labels: RecapLabels = recapLabels()): { key: string; label: string; value: string; detail: string }[] {
  return [
    { key: 'minutes', label: msg('music.rewind.minutes'), value: number(recap.minutes), detail: durationLabel(recap.minutes * 60) },
    { key: 'plays', label: msg('music.rewind.plays'), value: number(recap.plays), detail: `${number(recap.distinctTracks)} ${labels.distinctTracks.toLowerCase()}` },
    { key: 'artists', label: labels.distinctArtists, value: number(recap.distinctArtists), detail: recap.topArtists[0]?.card.name ?? '' },
    {
      key: 'streak',
      label: msg('music.rewind.currentStreak'),
      value: msg(`music.rewind.streakDays.${plural(recap.streak.current)}`, { count: number(recap.streak.current) }),
      detail: `${msg('music.rewind.longestStreak')}: ${msg(`music.rewind.streakDays.${plural(recap.streak.longest)}`, { count: number(recap.streak.longest) })}`,
    },
  ];
}

/** Format `firstPlayAt` RFC3339 timestamp into a localised "Listening since …" label. */
export function formatFirstPlayLabel(firstPlayAt?: string): string {
  if (!firstPlayAt) return '';
  try {
    const date = new Date(firstPlayAt);
    if (Number.isFinite(date.getTime())) {
      const formatted = new Intl.DateTimeFormat(localeContext().formatLocale, { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
      return msg('music.rewind.firstPlay', { date: formatted });
    }
  } catch { /* fall through */ }
  return '';
}

export interface PlaylistImportMatchModel {
  index: number;
  source: V.ImportSource;
  card: Card;
  by: 'isrc' | 'title';
}

export interface PlaylistImportUnmatchedModel {
  index: number;
  source: V.ImportSource;
  reason: 'not_found' | 'ambiguous';
  candidates: Card[];
}

export interface PlaylistImportModel {
  id: string;
  state: 'reading' | 'matching' | 'done' | 'failed';
  name: string;
  description: string;
  poster: string;
  total: number;
  done: number;
  matched: PlaylistImportMatchModel[];
  unmatched: PlaylistImportUnmatchedModel[];
  error?: string;
  /** Only part of the source playlist was read; `sourceTotal` when the source said its size. */
  truncated?: boolean;
  sourceTotal?: number;
}

export interface DuplicateGroupModel {
  recordingId: string;
  count: number;
  cards: Card[];
  preferredTitleId?: string;
}

export interface DuplicateGroupsList {
  items: DuplicateGroupModel[];
  cursor: string;
  more: boolean;
}

export interface RecordingReleasesModel {
  recordingId: string;
  cards: Card[];
  preferredTitleId?: string;
}

export interface MusicState {
  recent: Loadable<RecentContext[]>;
  liked: Record<string, Loadable<LikedList>>;
  /** null: the title has no lyrics. */
  lyrics: Record<string, Loadable<Lyrics | null>>;
  /** Keyed by `${library ?? 'all'}:${period}:${at ?? ''}`. */
  recaps: Record<string, Loadable<HistoryRecapModel>>;
  playlistImport: Loadable<PlaylistImportModel | null>;
  /** Keyed by libraryId. */
  duplicates: Record<string, Loadable<DuplicateGroupsList>>;
  /** Keyed by titleId. */
  recordings: Record<string, Loadable<RecordingReleasesModel>>;
}

export const initialMusic: MusicState = {
  recent: idle(),
  liked: {},
  lyrics: {},
  recaps: {},
  playlistImport: idle<PlaylistImportModel | null>(),
  duplicates: {},
  recordings: {},
};

export function recapKey(period: V.HistoryRecapPeriod, library?: string, at?: string): string {
  return `${library || 'all'}:${period}:${at || ''}`;
}

function browserTimeZone(): string | undefined {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === 'string' && tz.includes('/') ? tz : undefined;
  } catch {
    return undefined;
  }
}

export class Music {
  constructor(private readonly box: StateBox<VelaState>, private readonly session: Session, private readonly artWidth: () => number) {
    session.onReset(() => this.box.update('music', () => initialMusic));
  }

  get likedAvailable(): boolean { return this.session.features?.favoritesList?.available === true; }
  get lyricsAvailable(): boolean { return this.session.features?.lyrics?.available === true; }
  /** features.loudness: tracks carry measured loudness for levelling and AutoMix's markers. */
  get loudnessAvailable(): boolean { return this.session.features?.loudness?.available === true; }
  get recentAvailable(): boolean { return this.session.features?.playContexts?.available === true; }
  get recapAvailable(): boolean { return this.session.features?.historyRecap?.available === true; }
  get recapPeriods(): V.HistoryRecapPeriod[] {
    const periods = this.session.features?.historyRecap?.periods;
    return periods?.length ? periods : ['week', 'month', 'year', 'all'];
  }
  get playlistImportAvailable(): boolean { return this.session.features?.playlistImport?.available === true; }
  get playlistImportFeature(): V.ServerCapabilities['features']['playlistImport'] {
    return this.session.features?.playlistImport;
  }
  get duplicatesAvailable(): boolean { return this.session.features?.duplicates?.available === true; }

  /** What plays after a title when its queue ends (autoplay); [] when the server has none. */
  async continuation(id: string): Promise<Card[]> {
    if (this.session.features?.continuation?.available !== true) return [];
    const connection = await this.session.ready();
    if (!hasMusicLibrary(connection.adapter)) return [];
    const page = await connection.adapter.titleContinuation(id, 25);
    const images = await connection.images();
    return page.items.flatMap(item => (item.kind === 'title' ? [card(item.title, '', images, this.artWidth())] : [])).filter(c => c.media?.audio);
  }

  /** What the viewer last played from (Home's Recently played and quick tiles). */
  async recent(refresh = false): Promise<void> {
    if (!this.recentAvailable) return;
    const current = this.box.get().music.recent;
    if (current.load === 'loading' || (current.value && !refresh)) return;
    this.box.update('music', music => ({ ...music, recent: loading(current) }));
    try {
      const connection = await this.session.ready();
      if (!hasMusicLibrary(connection.adapter)) throw new Error('Recently played is unavailable');
      const answer = await connection.adapter.recentPlayContexts(20);
      const images = await connection.images();
      const items: RecentContext[] = answer.items.map(item => item.kind === 'title'
        ? { kind: 'title', card: card(item.title, '', images, this.artWidth()), playedAt: item.playedAt }
        : item.kind === 'playlist'
          ? { kind: 'playlist', card: entry({ id: item.playlist.id, kind: 'playlist', name: item.playlist.name, artwork: item.playlist.artwork, targetId: item.playlist.id, itemCount: item.playlist.itemCount, receiptToken: '' }, images, this.artWidth()), playedAt: item.playedAt }
          : { kind: 'favorites', role: item.role, playedAt: item.playedAt });
      this.box.update('music', music => ({ ...music, recent: ready(items) }));
    } catch (error) {
      this.box.update('music', music => ({ ...music, recent: failed(error, current) }));
    }
  }

  /** The viewer's likes of `role`; `more` reads the next page, `refresh` the first again. */
  async liked(role: string, more = false, refresh = false): Promise<void> {
    if (!this.likedAvailable) return;
    const current = this.box.get().music.liked[role];
    if (current?.load === 'loading') return;
    if (current?.value && !more && !refresh && current.load !== 'failed') return;
    if (more && !current?.value?.more) return;
    this.set('liked', role, loading(current));
    try {
      const connection = await this.session.ready();
      if (!hasMusicLibrary(connection.adapter)) throw new Error('Liked lists are unavailable');
      const page = await connection.adapter.favoriteTitles(role, more ? current?.value?.cursor : undefined, 100);
      const images = await connection.images();
      const items = page.items.map(item => ({ ...card(item.title as V.Title, item.receiptToken, images, this.artWidth()), likedAt: item.likedAt }));
      const before = more ? current?.value?.items ?? [] : [];
      this.set('liked', role, ready({ items: [...before, ...items], total: page.total, cursor: page.nextCursor ?? '', more: page.continuation === 'more' }));
    } catch (error) {
      this.set('liked', role, failed(error, current));
    }
  }

  async lyrics(id: string): Promise<void> {
    if (!this.lyricsAvailable) return;
    const current = this.box.get().music.lyrics[id];
    if (current && current.load !== 'failed') return;
    this.set('lyrics', id, loading(current));
    try {
      const connection = await this.session.ready();
      if (!hasMusicLibrary(connection.adapter)) throw new Error('Lyrics are unavailable');
      const answer = await connection.adapter.titleLyrics(id);
      this.set('lyrics', id, ready(answer ? { lines: answer.lines, plain: answer.plain ?? '', instrumental: answer.instrumental, source: answer.source ?? '' } : null));
    } catch (error) {
      this.set('lyrics', id, failed(error, current));
    }
  }

  /** Listening recap ("Rewind") for `period`, optionally scoped to `library` and anchor date `at`. */
  async recap(period: V.HistoryRecapPeriod, library?: string, at?: string, refresh = false): Promise<void> {
    if (!this.recapAvailable) return;
    const key = recapKey(period, library, at);
    const current = this.box.get().music.recaps[key];
    if (current?.load === 'loading' || (current?.value && !refresh && current.load !== 'failed')) return;
    this.set('recaps', key, loading(current));
    try {
      const connection = await this.session.ready();
      if (!hasHistoryRecap(connection.adapter)) throw new Error('Listening recap is unavailable');
      const tz = browserTimeZone();
      const answer = await connection.adapter.historyRecap({
        period,
        ...(library ? { library } : {}),
        ...(at ? { at } : {}),
        ...(tz ? { tz } : {}),
      });
      const images = await connection.images();
      const width = this.artWidth();
      const mapEntry = (e: V.RecapEntry): RecapEntryModel => ({
        card: card(e.title, '', images, width),
        plays: e.plays,
        minutes: e.minutes,
      });
      this.set('recaps', key, ready({
        period: answer.period,
        from: answer.from,
        to: answer.to,
        minutes: answer.minutes,
        plays: answer.plays,
        distinctTracks: answer.distinctTracks,
        distinctArtists: answer.distinctArtists,
        topArtists: answer.topArtists.map(mapEntry),
        topTracks: answer.topTracks.map(mapEntry),
        topAlbums: answer.topAlbums.map(mapEntry),
        streak: answer.streak,
        byDay: answer.byDay,
        ...(answer.firstPlayAt ? { firstPlayAt: answer.firstPlayAt } : {}),
        generatedAt: answer.generatedAt,
      }));
    } catch (error) {
      this.set('recaps', key, failed(error, current));
    }
  }

  /** Start a playlist import from a Spotify/Deezer URL or M3U/CSV text, then read its initial state. */
  async startPlaylistImport(
    library: string,
    source: { url: string } | { file: { name: string; format: V.PlaylistImportFormat; text: string } },
  ): Promise<PlaylistImportModel | null> {
    if (!this.playlistImportAvailable) return null;
    const current = this.box.get().music.playlistImport;
    this.box.update('music', music => ({ ...music, playlistImport: loading(current) }));
    try {
      const connection = await this.session.ready();
      if (!hasPlaylistImports(connection.adapter)) throw new Error('Playlist import is unavailable');
      const job = await connection.adapter.startPlaylistImport({
        idempotencyKey: this.session.key(),
        library,
        ...source,
      });
      return await this.pollPlaylistImport(job.id);
    } catch (error) {
      this.box.update('music', music => ({ ...music, playlistImport: failed(error, current) }));
      return null;
    }
  }

  /** Read the current state of an import job (`reading` | `matching` | `done` | `failed`). */
  async pollPlaylistImport(id: string): Promise<PlaylistImportModel | null> {
    if (!this.playlistImportAvailable) return null;
    const current = this.box.get().music.playlistImport;
    try {
      const connection = await this.session.ready();
      if (!hasPlaylistImports(connection.adapter)) throw new Error('Playlist import is unavailable');
      const answer = await connection.adapter.playlistImport(id);
      const images = await connection.images();
      const width = this.artWidth();
      const art = answer.artwork?.length
        ? entry({ id: answer.id, kind: 'playlist', name: answer.name, artwork: answer.artwork, targetId: answer.id, itemCount: answer.matched.length, receiptToken: '' }, images, width)
        : undefined;
      const model: PlaylistImportModel = {
        id: answer.id,
        state: answer.state,
        name: answer.name,
        description: answer.description ?? '',
        poster: art?.poster ?? '',
        total: answer.total,
        done: answer.done,
        matched: answer.matched.map(m => ({
          index: m.index,
          source: m.source,
          card: card(m.title, '', images, width),
          by: m.by,
        })),
        unmatched: answer.unmatched.map(u => ({
          index: u.index,
          source: u.source,
          reason: u.reason,
          candidates: (u.candidates ?? []).map(t => card(t, '', images, width)),
        })),
        ...(answer.error ? { error: answer.error } : {}),
        ...(answer.truncated ? { truncated: true, ...(typeof answer.sourceTotal === 'number' ? { sourceTotal: answer.sourceTotal } : {}) } : {}),
      };
      this.box.update('music', music => ({ ...music, playlistImport: ready<PlaylistImportModel | null>(model) }));
      return model;
    } catch (error) {
      this.box.update('music', music => ({ ...music, playlistImport: failed<PlaylistImportModel | null>(error, current) }));
      return null;
    }
  }

  /** Save a completed playlist import as a viewer playlist, optionally renaming, excluding matched tracks, or choosing ambiguous release candidates. */
  async savePlaylistImport(
    id: string,
    options: { name?: string; exclude?: number[]; choose?: Record<string, string> } = {},
  ): Promise<V.PlaylistCard | null> {
    if (!this.playlistImportAvailable) return null;
    const connection = await this.session.ready();
    if (!hasPlaylistImports(connection.adapter)) throw new Error('Playlist import is unavailable');
    const hasChoices = options.choose && Object.keys(options.choose).length > 0;
    const created = await connection.adapter.savePlaylistImport(id, {
      idempotencyKey: this.session.key(),
      ...(options.name?.trim() ? { name: options.name.trim() } : {}),
      ...(options.exclude?.length ? { exclude: options.exclude } : {}),
      ...(hasChoices ? { choose: options.choose } : {}),
    });
    return created;
  }

  resetPlaylistImport(): void {
    this.box.update('music', music => ({ ...music, playlistImport: idle<PlaylistImportModel | null>() }));
  }

  /** Duplicate recording groups in `libraryId`, most copies first. */
  async duplicates(libraryId: string, more = false, refresh = false): Promise<void> {
    if (!this.duplicatesAvailable || !libraryId) return;
    const current = this.box.get().music.duplicates[libraryId];
    if (current?.load === 'loading') return;
    if (current?.value && !more && !refresh && current.load !== 'failed') return;
    if (more && !current?.value?.more) return;
    this.set('duplicates', libraryId, loading(current));
    try {
      const connection = await this.session.ready();
      if (!hasLibraryDuplicates(connection.adapter)) throw new Error('Duplicate review is unavailable');
      const page = await connection.adapter.libraryDuplicates(libraryId, more ? current?.value?.cursor : undefined, 50);
      const images = await connection.images();
      const width = this.artWidth();
      const items: DuplicateGroupModel[] = page.items.map(group => ({
        recordingId: group.recordingId,
        count: group.count,
        cards: group.titles.map(t => card(t, '', images, width)),
        ...(group.preferredTitleId ? { preferredTitleId: group.preferredTitleId } : {}),
      }));
      const before = more ? current?.value?.items ?? [] : [];
      this.set('duplicates', libraryId, ready({
        items: [...before, ...items],
        cursor: page.nextCursor ?? '',
        more: page.continuation === 'more',
      }));
    } catch (error) {
      this.set('duplicates', libraryId, failed(error, current));
    }
  }

  /** Every release of `titleId`'s recording (`GET /titles/:id/recording`). */
  async recording(titleId: string, refresh = false): Promise<void> {
    if (!this.duplicatesAvailable || !titleId) return;
    const current = this.box.get().music.recordings[titleId];
    if (current?.load === 'loading' || (current?.value && !refresh && current.load !== 'failed')) return;
    this.set('recordings', titleId, loading(current));
    try {
      const connection = await this.session.ready();
      if (!hasLibraryDuplicates(connection.adapter)) throw new Error('Duplicate review is unavailable');
      const answer = await connection.adapter.titleRecording(titleId);
      const images = await connection.images();
      const width = this.artWidth();
      this.set('recordings', titleId, ready({
        recordingId: answer.recordingId,
        cards: answer.titles.map(t => card(t, '', images, width)),
        ...(answer.preferredTitleId ? { preferredTitleId: answer.preferredTitleId } : {}),
      }));
    } catch (error) {
      this.set('recordings', titleId, failed(error, current));
    }
  }

  /** Set the viewer's preferred release for `recordingId` in `libraryId`, optionally hiding other releases. */
  async setDuplicatePreference(
    libraryId: string,
    recordingId: string,
    preferredTitleId: string,
    hideOtherIds?: string[],
  ): Promise<DuplicateGroupModel | null> {
    if (!this.duplicatesAvailable) return null;
    const connection = await this.session.ready();
    if (!hasLibraryDuplicates(connection.adapter)) throw new Error('Duplicate review is unavailable');
    const updated = await connection.adapter.setDuplicatePreference(libraryId, recordingId, {
      idempotencyKey: this.session.key(),
      preferredTitleId,
      ...(hideOtherIds !== undefined ? { hideOtherIds } : {}),
    });
    const images = await connection.images();
    const width = this.artWidth();
    const model: DuplicateGroupModel = {
      recordingId: updated.recordingId,
      count: updated.count,
      cards: updated.titles.map(t => card(t, '', images, width)),
      ...(updated.preferredTitleId ? { preferredTitleId: updated.preferredTitleId } : {}),
    };
    const existing = this.box.get().music.duplicates[libraryId]?.value;
    if (existing) {
      this.set('duplicates', libraryId, ready({
        ...existing,
        items: existing.items.map(g => (g.recordingId === recordingId ? model : g)),
      }));
    }
    // Update any cached per-title recording release lists that share this recordingId.
    const recordings = { ...this.box.get().music.recordings };
    let changed = false;
    for (const [tid, loadable] of Object.entries(recordings)) {
      if (loadable?.value?.recordingId === recordingId) {
        recordings[tid] = ready({
          recordingId,
          cards: model.cards,
          ...(model.preferredTitleId ? { preferredTitleId: model.preferredTitleId } : {}),
        });
        changed = true;
      }
    }
    if (changed) {
      this.box.update('music', music => ({ ...music, recordings }));
    }
    if (hideOtherIds?.length && this.likedAvailable) {
      void this.liked('track', false, true);
    }
    return model;
  }

  private set<K extends 'liked' | 'lyrics' | 'recaps' | 'duplicates' | 'recordings'>(field: K, key: string, value: MusicState[K][string]): void {
    this.box.update('music', music => ({ ...music, [field]: { ...music[field], [key]: value } }));
  }
}
