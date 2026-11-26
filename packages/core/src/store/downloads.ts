// Offline original-file downloads (iPhone and iPad): the native storage port, the persisted
// index and progress outbox, space admission (any optional cap plus a 2 GB free-space reserve),
// viewer and server isolation, and the locally built PlaybackPlan for offline playback.
import type * as V from '../wire';
import { hasMediaDownloads, hasOfflineProgress, type DownloadResolution, type DownloadSidecar, type OfflineProgressEntry } from '../adapter/capabilities';
import { detailModel } from '../discovery/models';
import type { DetailModel } from '../models';
import { randomId } from '../protocol/id';
import type { AuthPhase } from './auth';
import type { VelaPlatform } from './platform';
import type { Session } from './session';
import { message, ready, type StateBox } from './state';
import type { VelaState } from './index';

/** At least 2 GB of free space must remain on the volume after queued transfers and the new download. */
export const FREE_SPACE_RESERVE_BYTES = 2_000_000_000;

export interface DownloadsSettings {
  wifiOnly: boolean;
  /** Maximum bytes downloads may occupy on disk; null means no cap. */
  capBytes: number | null;
}

export const DEFAULT_DOWNLOAD_SETTINGS: DownloadsSettings = { wifiOnly: true, capBytes: null };

/** Stored download settings, read defensively from device preferences. */
export function storedDownloadSettings(value: unknown): DownloadsSettings {
  const stored = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const wifiOnly = typeof stored.wifiOnly === 'boolean' ? stored.wifiOnly : DEFAULT_DOWNLOAD_SETTINGS.wifiOnly;
  const rawCap = stored.capBytes;
  const capBytes = typeof rawCap === 'number' && Number.isFinite(rawCap) && rawCap > 0
    ? Math.floor(rawCap)
    : null;
  return { wifiOnly, capBytes };
}

export type DownloadStatus = 'queued' | 'downloading' | 'paused' | 'completed' | 'failed';
export type DownloadErrorCode = 'forbidden' | 'rate_limited' | 'no_space' | 'network' | 'corrupt' | 'unknown';

/** A previously verified download kept playable while a replacement copy is downloading. */
export interface VerifiedDownloadCopy {
  mediaPath: string;
  posterPath?: string;
  sidecarPaths?: Record<string, string>;
  byteLength?: number;
  etag?: string;
  sourceId?: string;
  versionId?: string;
  versionLabel?: string;
  originalVideo?: V.OriginalVideo;
  audioTracks: V.Track[];
  subtitleTracks: V.Track[];
  selectedAudioTrackId?: string;
  selectedSubtitleTrackId: string | null;
  chapters: V.Chapter[];
  markers?: V.SkipMarker[];
}

export interface DownloadRecord {
  serverId: string;
  viewerId: string;
  titleId: string;
  title: V.Title;
  versionId?: string;
  versionLabel?: string;
  sourceId?: string;
  mimeType: string;
  container: string;
  byteLength?: number;
  bytesWritten: number;
  etag?: string;
  lastModified?: string;
  status: DownloadStatus;
  error?: string;
  errorCode?: DownloadErrorCode;
  neededBytes?: number;
  createdAt: V.Timestamp;
  completedAt?: V.Timestamp;
  /** Relative path under `vela-downloads/` (never an absolute container path). */
  mediaPath?: string;
  posterPath?: string;
  /** Relative paths under `vela-downloads/` keyed by subtitle track ID. */
  sidecarPaths?: Record<string, string>;
  originalVideo?: V.OriginalVideo;
  audioTracks: V.Track[];
  subtitleTracks: V.Track[];
  selectedAudioTrackId?: string;
  selectedSubtitleTrackId: string | null;
  chapters: V.Chapter[];
  markers?: V.SkipMarker[];
  sidecars: DownloadSidecar[];
  posterUrl?: string;
  /** Server watch state captured at download time, for conflict checks when `lastViewedAt` is absent. */
  baselineWatch?: { positionSeconds: number; played: boolean; lastViewedAt?: V.Timestamp };
  /** Kept when replacing an already-completed download until the new file verifies. */
  previousCompleted?: VerifiedDownloadCopy;
}

export interface DownloadTransferRequest {
  serverId: string;
  viewerId: string;
  titleId: string;
  url: string;
  headers: Record<string, string>;
  container: string;
  mimeType: string;
  byteLength?: number;
  etag?: string;
  wifiOnly: boolean;
  posterUrl?: string;
  sidecars: DownloadSidecar[];
}

export interface DownloadTransferProgress {
  serverId: string;
  viewerId: string;
  titleId: string;
  status: DownloadStatus;
  bytesWritten: number;
  byteLength?: number;
  etag?: string;
  lastModified?: string;
  mediaPath?: string;
  posterPath?: string;
  sidecarPaths?: Record<string, string>;
  error?: string;
  errorCode?: DownloadErrorCode;
  neededBytes?: number;
}

export interface DownloadsSnapshot {
  items: DownloadRecord[];
  outbox: OfflineProgressEntry[];
}

/** The native host port for background transfers, file storage and atomic index persistence. */
export interface DownloadsPort {
  /** Current base `file://` URL of `Application Support/vela-downloads/`. */
  baseDirectoryUrl(): Promise<string> | string;
  /** Read `index.json` and `outbox.json` from disk. */
  readSnapshot(): Promise<DownloadsSnapshot>;
  /** Atomically write `index.json` and `outbox.json` beside the downloaded files. */
  writeSnapshot(snapshot: DownloadsSnapshot): Promise<void>;
  /** Free bytes available on the volume (`volumeAvailableCapacityForImportantUsageKey` on iOS). */
  freeBytes(): Promise<number | null>;
  /** Enqueue or start a background download task (and its sidecars/poster). */
  startTransfer(request: DownloadTransferRequest): Promise<void>;
  /** Pause an in-flight or queued download, keeping resume data when available. */
  pauseTransfer(serverId: string, viewerId: string, titleId: string): Promise<void>;
  /** Resume a paused download with fresh URL and headers. */
  resumeTransfer(request: DownloadTransferRequest): Promise<void>;
  /** Cancel any transfer and remove one title's downloaded directory. */
  removeTitle(serverId: string, viewerId: string, titleId: string): Promise<void>;
  /** Cancel active transfers and remove all downloaded files for one viewer on a server. */
  removeViewer(serverId: string, viewerId: string): Promise<void>;
  /** Cancel active transfers and remove all viewers' downloaded files for a server. */
  removeServer(serverId: string): Promise<void>;
  /** Subscribe to background transfer progress, completion and failure events. */
  subscribe?(listener: (event: DownloadTransferProgress) => void): () => void;
}

export interface DownloadsState {
  supported: boolean;
  hydrated: boolean;
  /** Downloads for the currently selected server and viewer. */
  items: DownloadRecord[];
  /** All downloads stored on this device across servers and viewers. */
  allItems: DownloadRecord[];
  /** Pending offline watch progress entries waiting to be replayed. */
  outbox: OfflineProgressEntry[];
  settings: DownloadsSettings;
  freeBytes: number | null;
  usedBytes: number;
  error: string;
}

export const initialDownloads: DownloadsState = {
  supported: false,
  hydrated: false,
  items: [],
  allItems: [],
  outbox: [],
  settings: DEFAULT_DOWNLOAD_SETTINGS,
  freeBytes: null,
  usedBytes: 0,
  error: '',
};

/** Human-readable byte count for space deficit messages and storage summaries. */
export function formatDownloadBytes(bytes: number): string {
  const positive = Math.max(0, bytes);
  if (positive >= 1_000_000_000) return `${(positive / 1_000_000_000).toFixed(1)} GB`;
  if (positive >= 1_000_000) return `${Math.ceil(positive / 1_000_000)} MB`;
  if (positive >= 1_000) return `${Math.ceil(positive / 1_000)} KB`;
  return `${Math.ceil(positive)} B`;
}

export type SpaceCheckResult =
  | { allowed: true }
  | { allowed: false; reason: 'cap' | 'free_space'; neededBytes: number; message: string };

/**
 * Space admission before starting or resuming a download:
 * `requestedBytes` (Part.size) plus bytes still owed by queued/active transfers must fit any
 * configured cap and leave at least 2 GB (`FREE_SPACE_RESERVE_BYTES`) free on the volume.
 */
export function checkDownloadSpace(params: {
  requestedBytes?: number;
  existingItems: readonly DownloadRecord[];
  serverId: string;
  viewerId: string;
  titleId: string;
  freeBytes: number | null;
  capBytes: number | null;
}): SpaceCheckResult {
  const { requestedBytes, existingItems, serverId, viewerId, titleId, freeBytes, capBytes } = params;
  const target = existingItems.find(item =>
    item.serverId === serverId && item.viewerId === viewerId && item.titleId === titleId);
  const alreadyWritten = target && target.status !== 'completed' ? Math.max(0, target.bytesWritten) : 0;
  const totalForTarget = Math.max(alreadyWritten, requestedBytes ?? target?.byteLength ?? 0);
  const remainingForTarget = Math.max(0, totalForTarget - alreadyWritten);

  let usedByOthers = 0;
  let owedByOthers = 0;
  for (const item of existingItems) {
    const isTarget = item.serverId === serverId && item.viewerId === viewerId && item.titleId === titleId;
    if (isTarget) {
      if (item.previousCompleted?.byteLength) usedByOthers += Math.max(0, item.previousCompleted.byteLength);
      continue;
    }
    const onDisk = item.status === 'completed'
      ? Math.max(item.bytesWritten, item.byteLength ?? 0)
      : Math.max(0, item.bytesWritten) + Math.max(0, item.previousCompleted?.byteLength ?? 0);
    usedByOthers += onDisk;
    if (item.status === 'queued' || item.status === 'downloading') {
      owedByOthers += Math.max(0, (item.byteLength ?? 0) - Math.max(0, item.bytesWritten));
    }
  }

  if (capBytes !== null && capBytes > 0) {
    const totalCommitted = usedByOthers + owedByOthers + totalForTarget;
    if (totalCommitted > capBytes) {
      const neededBytes = totalCommitted - capBytes;
      return {
        allowed: false,
        reason: 'cap',
        neededBytes,
        message: `Download storage limit reached (${formatDownloadBytes(neededBytes)} over your ${formatDownloadBytes(capBytes)} limit).`,
      };
    }
  }

  if (freeBytes !== null && Number.isFinite(freeBytes)) {
    const requiredFree = owedByOthers + remainingForTarget + FREE_SPACE_RESERVE_BYTES;
    if (freeBytes < requiredFree) {
      const neededBytes = requiredFree - Math.max(0, freeBytes);
      return {
        allowed: false,
        reason: 'free_space',
        neededBytes,
        message: `Not enough free storage (${formatDownloadBytes(neededBytes)} more needed to keep 2.0 GB free).`,
      };
    }
  }

  return { allowed: true };
}

/** Total bytes currently occupied on disk across all download records. */
export function totalDownloadedBytes(items: readonly DownloadRecord[]): number {
  let total = 0;
  for (const item of items) {
    if (item.status === 'completed') {
      total += Math.max(item.bytesWritten, item.byteLength ?? 0);
    } else {
      total += Math.max(0, item.bytesWritten) + Math.max(0, item.previousCompleted?.byteLength ?? 0);
    }
  }
  return total;
}

/** Downloads visible to the active viewer on the selected server (other Plex Home members' files stay hidden). */
export function visibleDownloads(items: readonly DownloadRecord[], serverId: string, viewerId: string): DownloadRecord[] {
  if (!serverId || !viewerId) return [];
  return items.filter(item => item.serverId === serverId && item.viewerId === viewerId);
}

/**
 * Resolve a relative path from `index.json` against the current container's base `vela-downloads/`
 * `file://` URL. Storing relative paths keeps files valid when iOS rotates the app container UUID.
 */
export function resolveDownloadFileUrl(baseDirectoryUrl: string, relativePath: string): string {
  const trimmed = relativePath.trim().replace(/^\/+/, '');
  if (!trimmed || trimmed.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new Error('Invalid relative download path');
  }
  const normalizedBase = baseDirectoryUrl.endsWith('/') ? baseDirectoryUrl : `${baseDirectoryUrl}/`;
  const base = new URL(normalizedBase);
  if (base.protocol !== 'file:') throw new Error('Downloads base directory must be a file: URL');
  const resolved = new URL(trimmed, base);
  if (resolved.protocol !== 'file:' || !resolved.pathname.startsWith(base.pathname)) {
    throw new Error('Download path escapes base directory');
  }
  return resolved.href;
}

/** Whether a record has a verified local copy ready for offline playback (including while a replacement downloads). */
export function isPlayableDownload(item: DownloadRecord | undefined): item is DownloadRecord {
  if (!item) return false;
  if (item.status === 'completed' && !!item.mediaPath) return true;
  return !!item.previousCompleted?.mediaPath;
}

/** Whether the server's file has changed since a completed download was saved. */
export function downloadNeedsReplacement(
  item: DownloadRecord,
  current: Pick<DownloadResolution, 'sourceId' | 'byteLength' | 'etag'>,
): boolean {
  if (item.status !== 'completed') return false;
  if (item.sourceId && current.sourceId && item.sourceId !== current.sourceId) return true;
  if (item.etag && current.etag && item.etag !== current.etag) return true;
  if (item.byteLength && current.byteLength && item.byteLength !== current.byteLength) return true;
  return false;
}

/**
 * Build a local `PlaybackPlan` from a downloaded record: one ready `original` path with
 * `transport: 'file'` and a `file://` URL, embedded tracks with their stream indexes, and
 * downloaded external subtitle sidecars rewritten to `file://` URLs.
 */
export function localPlaybackPlan(
  item: DownloadRecord,
  baseDirectoryUrl: string,
  options?: { positionSeconds?: number; sessionId?: string },
): V.PlaybackPlan {
  const verified: VerifiedDownloadCopy | DownloadRecord =
    item.status === 'completed' && item.mediaPath ? item : item.previousCompleted ?? item;
  if (!verified.mediaPath) throw new Error('Download has no verified local media file');
  const mediaUrl = resolveDownloadFileUrl(baseDirectoryUrl, verified.mediaPath);
  const sidecarPaths = verified.sidecarPaths ?? {};
  const subtitleTracks: V.Track[] = [];
  for (const track of verified.subtitleTracks) {
    if (track.delivery?.kind === 'external') {
      const rel = sidecarPaths[track.id];
      if (!rel) continue;
      const localUrl = resolveDownloadFileUrl(baseDirectoryUrl, rel);
      subtitleTracks.push({
        ...track,
        ...(track.url ? { url: localUrl } : {}),
        delivery: { ...track.delivery, url: localUrl },
      });
    } else if (!track.delivery || track.delivery.kind === 'embedded') {
      subtitleTracks.push({ ...track, delivery: { kind: 'embedded' } });
    }
  }
  const selectedSubtitleTrackId =
    verified.selectedSubtitleTrackId && subtitleTracks.some(t => t.id === verified.selectedSubtitleTrackId)
      ? verified.selectedSubtitleTrackId
      : null;
  const selectedAudioTrackId =
    verified.selectedAudioTrackId && verified.audioTracks.some(t => t.id === verified.selectedAudioTrackId)
      ? verified.selectedAudioTrackId
      : verified.audioTracks.find(t => t.default)?.id ?? verified.audioTracks[0]?.id;
  const duration = item.title.durationSeconds ?? 0;
  const rawPosition = options?.positionSeconds ?? item.title.watch?.positionSeconds ?? 0;
  const positionSeconds = duration > 0 ? Math.min(Math.max(0, rawPosition), duration) : Math.max(0, rawPosition);
  return {
    sessionId: options?.sessionId ?? `local-${item.titleId}-${randomId()}`,
    revision: 1,
    sourceGeneration: 0,
    seekGeneration: 0,
    titleId: item.titleId,
    title: item.title.name,
    state: 'ready',
    positionSeconds,
    durationSeconds: duration,
    paths: [
      {
        id: 'original',
        kind: 'direct',
        transport: 'file',
        mimeType: item.mimeType,
        readiness: 'ready',
        url: mediaUrl,
        original: true,
        range: true,
        ...(verified.byteLength ? { byteLength: verified.byteLength } : {}),
        ...(verified.sourceId ? { sourceId: verified.sourceId, timelineId: verified.sourceId, timelineOriginSeconds: 0 } : {}),
        ...(verified.originalVideo ? { originalVideo: verified.originalVideo } : {}),
        qualities: [],
        boundaries: [],
      },
    ],
    selectedPathId: 'original',
    audioTracks: verified.audioTracks,
    subtitleTracks,
    ...(selectedAudioTrackId ? { selectedAudioTrackId } : {}),
    selectedSubtitleTrackId,
    chapters: verified.chapters,
    ...(verified.markers?.length ? { markers: verified.markers } : {}),
    fallback: { state: 'unsupported', reason: 'Playing downloaded original file locally' },
  };
}

/** Build a `DetailModel` from a downloaded record so `/watch/[id]` and title views have metadata offline. */
export function downloadedDetailModel(item: DownloadRecord, baseDirectoryUrl?: string, artWidth = 2560): DetailModel {
  const model = detailModel({
    title: item.title,
    canPlay: true,
    extras: [],
    chapters: item.chapters,
    cast: [],
    crew: [],
  }, undefined, artWidth);
  const posterPath = (item.status === 'completed' ? item.posterPath : item.previousCompleted?.posterPath) ?? item.posterPath;
  if (posterPath && baseDirectoryUrl && model.title[0]) {
    try {
      const localPoster = resolveDownloadFileUrl(baseDirectoryUrl, posterPath);
      model.title[0] = { ...model.title[0], poster: localPoster, backdrop: model.title[0].backdrop || localPoster };
    } catch {
      // Keep original artwork reference if local poster path cannot be resolved.
    }
  }
  return model;
}

/**
 * Whether a route is permitted when `auth.phase` is `'signed-out'` or `'offline'`.
 * While `'offline'`, `/downloads` and `/watch/<id>` for a playable downloaded title are allowed through.
 */
export function allowsOfflineRoute(
  phase: AuthPhase,
  pathname: string,
  hasPlayableDownload: (titleId: string) => boolean,
): boolean {
  if (pathname === '/sign-in' || pathname === '/connect') return true;
  if (phase !== 'offline') return false;
  if (pathname === '/downloads') return true;
  const watchMatch = /^\/watch\/([^/?#]+)$/.exec(pathname);
  if (watchMatch) {
    try {
      return hasPlayableDownload(decodeURIComponent(watchMatch[1]!));
    } catch {
      return false;
    }
  }
  return false;
}

export function offlineProgressSuperseded(entry: OfflineProgressEntry, watch: V.WatchState | undefined): boolean {
  if (entry.completed && watch?.played) return true;
  if (watch?.lastViewedAt) return Date.parse(watch.lastViewedAt) >= Date.parse(entry.observedAt);
  return !entry.baseline || (watch?.positionSeconds ?? 0) !== entry.baseline.positionSeconds ||
    (watch?.played ?? false) !== entry.baseline.played;
}

export class Downloads {
  private readonly port: DownloadsPort | undefined;
  private writing = Promise.resolve();
  private replaying: Promise<void> | undefined;
  private lastAuthPhase: AuthPhase | undefined;
  private hydrating: Promise<void> | undefined;
  private unsubscribePort: (() => void) | undefined;
  /** The last non-empty `(serverId, viewerId)` seen in `auth`, so a refused token can clean up its viewer. */
  private activeViewer: { serverId: string; viewerId: string } | undefined;

  constructor(
    private readonly box: StateBox<VelaState>,
    private readonly session: Session,
    platform: VelaPlatform,
  ) {
    this.port = platform.downloads;
    if (this.port) {
      this.box.update('downloads', state => ({ ...state, supported: true }));
      this.unsubscribePort = this.port.subscribe?.(event => {
        void this.applyTransferEvent(event).catch(() => {});
      });
    }
    this.box.subscribe(() => this.syncActiveViewer());
    session.onReset((_kind, refused) => {
      if (refused && this.activeViewer) {
        const { serverId, viewerId } = this.activeViewer;
        this.activeViewer = undefined;
        void this.removeViewer(serverId, viewerId).catch(() => {});
      } else {
        this.syncVisible();
      }
    });
  }

  private get state(): DownloadsState {
    return this.box.get().downloads;
  }

  private syncActiveViewer(): void {
    const { serverId, viewerId, phase } = this.box.get().auth;
    const enteredOnline = phase === 'signed-in' && this.lastAuthPhase !== phase;
    this.lastAuthPhase = phase;
    if (enteredOnline && this.state.outbox.length) void this.replayProgress();
    if (serverId && viewerId && (phase === 'signed-in' || phase === 'offline')) {
      const changed = this.activeViewer?.serverId !== serverId || this.activeViewer?.viewerId !== viewerId;
      this.activeViewer = { serverId, viewerId };
      if (changed) this.syncVisible();
    } else if (phase === 'signed-out') {
      this.syncVisible();
    }
  }

  private syncVisible(): void {
    const { serverId, viewerId } = this.box.get().auth;
    const allItems = this.state.allItems;
    const items = visibleDownloads(allItems, serverId, viewerId);
    const usedBytes = totalDownloadedBytes(allItems);
    if (items.length !== this.state.items.length || usedBytes !== this.state.usedBytes ||
        items.some((item, i) => item !== this.state.items[i])) {
      this.box.update('downloads', state => ({ ...state, items, usedBytes }));
    }
  }

  /** Whether the selected server and current platform support downloading original files. */
  get available(): boolean {
    if (!this.port) return false;
    try {
      return hasMediaDownloads(this.session.selected().adapter);
    } catch {
      return false;
    }
  }

  async canDownload(): Promise<boolean> {
    if (!this.port || this.box.get().auth.phase !== 'signed-in') return false;
    const { adapter } = this.session.selected();
    return hasMediaDownloads(adapter) && (await adapter.downloadsAvailable?.() ?? true);
  }

  /** Hydrate the index, outbox and free space from the native downloads host once at startup. */
  hydrate(): Promise<void> {
    if (!this.port) return Promise.resolve();
    if (this.state.hydrated) return Promise.resolve();
    return this.hydrating ??= this.readFromPort().then(() => { void this.replayProgress(); }).finally(() => {
      this.hydrating = undefined;
    });
  }

  private async readFromPort(): Promise<void> {
    if (!this.port) return;
    try {
      const [snapshot, freeBytes] = await Promise.all([
        this.port.readSnapshot(),
        this.port.freeBytes().catch(() => null),
      ]);
      const allItems = Array.isArray(snapshot.items) ? snapshot.items : [];
      const outbox = Array.isArray(snapshot.outbox) ? snapshot.outbox : [];
      const { serverId, viewerId } = this.box.get().auth;
      this.box.update('downloads', state => ({
        ...state,
        supported: true,
        hydrated: true,
        allItems,
        items: visibleDownloads(allItems, serverId, viewerId),
        outbox,
        freeBytes,
        usedBytes: totalDownloadedBytes(allItems),
      }));
    } catch {
      this.box.update('downloads', state => ({ ...state, supported: true, hydrated: true }));
    }
  }

  /** Load device-wide download preferences (`wifiOnly`, `capBytes`). */
  loadSettings(stored: unknown): void {
    const settings = storedDownloadSettings(stored);
    this.box.update('downloads', state => ({ ...state, settings }));
  }

  setWifiOnly(wifiOnly: boolean): void {
    if (wifiOnly === this.state.settings.wifiOnly) return;
    this.box.update('downloads', state => ({ ...state, settings: { ...state.settings, wifiOnly } }));
  }

  setCapBytes(capBytes: number | null): void {
    const normalized = typeof capBytes === 'number' && Number.isFinite(capBytes) && capBytes > 0 ? Math.floor(capBytes) : null;
    if (normalized === this.state.settings.capBytes) return;
    this.box.update('downloads', state => ({ ...state, settings: { ...state.settings, capBytes: normalized } }));
  }

  clearError(): void {
    if (this.state.error) this.box.update('downloads', state => ({ ...state, error: '' }));
  }

  /** Find a download record for the currently active server and viewer. */
  item(titleId: string): DownloadRecord | undefined {
    const { serverId, viewerId } = this.box.get().auth;
    return this.state.allItems.find(item =>
      item.serverId === serverId && item.viewerId === viewerId && item.titleId === titleId);
  }

  /** Whether `titleId` has a verified local download for the currently active server and viewer. */
  isPlayable(titleId: string): boolean {
    return isPlayableDownload(this.item(titleId));
  }

  /** Build a local `PlaybackPlan` for `titleId` if it is downloaded for the active viewer. */
  async planFor(titleId: string, options?: { positionSeconds?: number; sessionId?: string; versionId?: string; sourceId?: string }): Promise<V.PlaybackPlan | null> {
    if (!this.port) return null;
    await this.hydrate();
    const phase = this.box.get().auth.phase;
    const record = this.item(titleId);
    if ((phase !== 'offline' && phase !== 'signed-in') || !isPlayableDownload(record)) return null;
    const verified = record.status === 'completed' ? record : record.previousCompleted;
    if (phase === 'signed-in' && ((options?.versionId && verified?.versionId !== options.versionId) ||
        (options?.sourceId && verified?.sourceId !== options.sourceId))) return null;
    const base = await this.port.baseDirectoryUrl();
    const current = this.item(titleId);
    if (!isPlayableDownload(current) || record.serverId !== current.serverId || record.viewerId !== current.viewerId) return null;
    return localPlaybackPlan(current, base, options);
  }

  /** Build a `DetailModel` for `titleId` from the local index, seeding `state.titles[titleId]` when offline. */
  async detailFor(titleId: string, artWidth = 2560): Promise<DetailModel | null> {
    const record = this.item(titleId);
    if (!record) return null;
    const base = this.port ? await Promise.resolve(this.port.baseDirectoryUrl()).catch(() => undefined) : undefined;
    const detail = downloadedDetailModel(record, base, artWidth);
    if (this.item(titleId) === record && !this.box.get().titles[titleId]?.value) {
      this.box.update('titles', titles => ({ ...titles, [titleId]: ready(detail) }));
    }
    return detail;
  }

  /** Resolve a title's original file from the server, check space, and enqueue its background transfer. */
  async enqueue(titleId: string, options?: { versionId?: string }): Promise<DownloadRecord | null> {
    if (!this.port) return null;
    try {
      const connection = await this.session.ready();
      const adapter = connection.adapter;
      if (!hasMediaDownloads(adapter)) throw new Error('Downloads are not supported on this server');
      if (adapter.downloadsAvailable && !(await adapter.downloadsAvailable())) {
        throw new Error('Downloads are not allowed for this account on this server');
      }
      const tokens = await this.session.tokens(connection);
      const serverId = connection.record.id;
      const viewerId = tokens?.viewer.id || this.box.get().auth.viewerId;
      if (!serverId || !viewerId) throw new Error('Sign in required');
      const client = await this.session.declared().catch(() => undefined);
      const resolved = await adapter.resolveDownload(titleId, {
        versionId: options?.versionId,
        subtitleFormats: client?.subtitleFormats,
        idempotencyKey: this.session.key(),
      });
      const freeBytes = await this.port.freeBytes().catch(() => null);
      const space = checkDownloadSpace({
        requestedBytes: resolved.byteLength,
        existingItems: this.state.allItems,
        serverId,
        viewerId,
        titleId,
        freeBytes,
        capBytes: this.state.settings.capBytes,
      });
      if (!space.allowed) {
        this.box.update('downloads', state => ({ ...state, freeBytes, error: space.message }));
        return null;
      }
      const existing = this.state.allItems.find(item =>
        item.serverId === serverId && item.viewerId === viewerId && item.titleId === titleId);
      const previousCompleted: VerifiedDownloadCopy | undefined =
        existing?.status === 'completed' && existing.mediaPath
          ? {
              mediaPath: existing.mediaPath,
              posterPath: existing.posterPath,
              sidecarPaths: existing.sidecarPaths,
              byteLength: existing.byteLength,
              etag: existing.etag,
              sourceId: existing.sourceId,
              versionId: existing.versionId,
              versionLabel: existing.versionLabel,
              originalVideo: existing.originalVideo,
              audioTracks: existing.audioTracks,
              subtitleTracks: existing.subtitleTracks,
              selectedAudioTrackId: existing.selectedAudioTrackId,
              selectedSubtitleTrackId: existing.selectedSubtitleTrackId,
              chapters: existing.chapters,
              markers: existing.markers,
            }
          : existing?.previousCompleted;
      const record: DownloadRecord = {
        serverId,
        viewerId,
        titleId,
        title: resolved.title,
        versionId: resolved.versionId,
        versionLabel: resolved.versionLabel,
        sourceId: resolved.sourceId,
        mimeType: resolved.mimeType,
        container: resolved.container,
        byteLength: resolved.byteLength,
        bytesWritten: 0,
        etag: resolved.etag,
        status: 'queued',
        createdAt: new Date().toISOString(),
        originalVideo: resolved.originalVideo,
        audioTracks: resolved.audioTracks,
        subtitleTracks: resolved.subtitleTracks,
        selectedAudioTrackId: resolved.selectedAudioTrackId,
        selectedSubtitleTrackId: resolved.selectedSubtitleTrackId,
        chapters: resolved.chapters,
        markers: resolved.markers,
        sidecars: resolved.sidecars,
        posterUrl: resolved.posterUrl,
        baselineWatch: resolved.title.watch
          ? {
              positionSeconds: resolved.title.watch.positionSeconds,
              played: resolved.title.watch.played,
              ...(resolved.title.watch.lastViewedAt ? { lastViewedAt: resolved.title.watch.lastViewedAt } : {}),
            }
          : { positionSeconds: 0, played: false },
        ...(previousCompleted ? { previousCompleted } : {}),
      };
      await this.upsertRecord(record, freeBytes, '');
      await this.port.startTransfer({
        serverId,
        viewerId,
        titleId,
        url: resolved.url,
        headers: resolved.headers,
        container: resolved.container,
        mimeType: resolved.mimeType,
        byteLength: resolved.byteLength,
        etag: resolved.etag,
        wifiOnly: this.state.settings.wifiOnly,
        posterUrl: resolved.posterUrl,
        sidecars: resolved.sidecars,
      });
      return record;
    } catch (error) {
      this.box.update('downloads', state => ({ ...state, error: message(error, 'Download could not be started') }));
      return null;
    }
  }

  /** Pause an in-flight or queued download. */
  async pause(titleId: string): Promise<void> {
    if (!this.port) return;
    const record = this.item(titleId);
    if (!record || (record.status !== 'queued' && record.status !== 'downloading')) return;
    await this.port.pauseTransfer(record.serverId, record.viewerId, titleId);
    await this.upsertRecord({ ...record, status: 'paused' });
  }

  /** Resume a paused or failed download after re-checking space and minting fresh headers/grant. */
  async resume(titleId: string): Promise<boolean> {
    if (!this.port) return false;
    const record = this.item(titleId);
    if (!record || (record.status !== 'paused' && record.status !== 'failed')) return false;
    try {
      const connection = await this.session.ready();
      const adapter = connection.adapter;
      if (!hasMediaDownloads(adapter)) throw new Error('Downloads are not supported on this server');
      const client = await this.session.declared().catch(() => undefined);
      const resolved = await adapter.resolveDownload(titleId, {
        versionId: record.versionId,
        subtitleFormats: client?.subtitleFormats,
        idempotencyKey: this.session.key(),
      });
      const freeBytes = await this.port.freeBytes().catch(() => null);
      const space = checkDownloadSpace({
        requestedBytes: resolved.byteLength ?? record.byteLength,
        existingItems: this.state.allItems,
        serverId: record.serverId,
        viewerId: record.viewerId,
        titleId,
        freeBytes,
        capBytes: this.state.settings.capBytes,
      });
      if (!space.allowed) {
        await this.upsertRecord({
          ...record,
          status: 'paused',
          errorCode: 'no_space',
          neededBytes: space.neededBytes,
          error: space.message,
        }, freeBytes, space.message);
        return false;
      }
      const sameSource = (!record.sourceId || !resolved.sourceId || record.sourceId === resolved.sourceId) &&
        (!record.byteLength || !resolved.byteLength || record.byteLength === resolved.byteLength) &&
        (!record.etag || !resolved.etag || record.etag === resolved.etag);
      const updated: DownloadRecord = {
        ...record,
        byteLength: resolved.byteLength ?? record.byteLength,
        bytesWritten: sameSource ? record.bytesWritten : 0,
        etag: resolved.etag ?? record.etag,
        status: 'queued',
        error: undefined,
        errorCode: undefined,
        neededBytes: undefined,
      };
      await this.upsertRecord(updated, freeBytes, '');
      await this.port.resumeTransfer({
        serverId: record.serverId,
        viewerId: record.viewerId,
        titleId,
        url: resolved.url,
        headers: resolved.headers,
        container: resolved.container,
        mimeType: resolved.mimeType,
        byteLength: updated.byteLength,
        etag: updated.etag,
        wifiOnly: this.state.settings.wifiOnly,
        posterUrl: resolved.posterUrl,
        sidecars: resolved.sidecars,
      });
      return true;
    } catch (error) {
      const text = message(error, 'Download could not be resumed');
      this.box.update('downloads', state => ({ ...state, error: text }));
      return false;
    }
  }

  /** Remove one downloaded title (or cancel its active transfer) for the active viewer. */
  async remove(titleId: string): Promise<void> {
    const { serverId, viewerId } = this.box.get().auth;
    if (!serverId || !viewerId) return;
    await this.port?.removeTitle(serverId, viewerId, titleId);
    const allItems = this.state.allItems.filter(item =>
      !(item.serverId === serverId && item.viewerId === viewerId && item.titleId === titleId));
    await this.commitSnapshot(allItems, this.state.outbox);
  }

  /** Remove all downloads for the currently active viewer on the selected server. */
  async removeAll(): Promise<void> {
    const { serverId, viewerId } = this.box.get().auth;
    if (!serverId || !viewerId) return;
    await this.removeViewer(serverId, viewerId);
  }

  /** Cancel active transfers and delete all downloads & outbox entries for one viewer on a server (sign-out or 401). */
  async removeViewer(serverId: string, viewerId: string): Promise<void> {
    if (!serverId || !viewerId) return;
    await this.port?.removeViewer(serverId, viewerId).catch(() => {});
    const allItems = this.state.allItems.filter(item =>
      !(item.serverId === serverId && item.viewerId === viewerId));
    const outbox = this.state.outbox.filter(entry =>
      !(entry.serverId === serverId && entry.viewerId === viewerId));
    await this.commitSnapshot(allItems, outbox);
  }

  /** Cancel active transfers and delete all viewers' downloads & outbox entries for a removed server. */
  async removeServer(serverId: string): Promise<void> {
    if (!serverId) return;
    await this.port?.removeServer(serverId).catch(() => {});
    const allItems = this.state.allItems.filter(item => item.serverId !== serverId);
    const outbox = this.state.outbox.filter(entry => entry.serverId !== serverId);
    await this.commitSnapshot(allItems, outbox);
  }

  /** Apply a progress, pause, completion or failure event from the native background downloader. */
  async applyTransferEvent(event: DownloadTransferProgress): Promise<void> {
    const index = this.state.allItems.findIndex(item =>
      item.serverId === event.serverId && item.viewerId === event.viewerId && item.titleId === event.titleId);
    if (index < 0) return;
    const current = this.state.allItems[index]!;
    const completed = event.status === 'completed';
    const next: DownloadRecord = {
      ...current,
      status: event.status,
      bytesWritten: Math.max(0, event.bytesWritten),
      ...(event.byteLength !== undefined ? { byteLength: event.byteLength } : {}),
      ...(event.etag !== undefined ? { etag: event.etag } : {}),
      ...(event.lastModified !== undefined ? { lastModified: event.lastModified } : {}),
      ...(event.mediaPath !== undefined ? { mediaPath: event.mediaPath } : {}),
      ...(event.posterPath !== undefined ? { posterPath: event.posterPath } : {}),
      ...(event.sidecarPaths !== undefined ? { sidecarPaths: event.sidecarPaths } : {}),
      ...(completed ? { completedAt: new Date().toISOString(), previousCompleted: undefined, error: undefined, errorCode: undefined, neededBytes: undefined } : {}),
      ...(event.status === 'failed' || event.status === 'paused'
        ? { error: event.error, errorCode: event.errorCode, neededBytes: event.neededBytes }
        : {}),
    };
    const allItems = [...this.state.allItems];
    allItems[index] = next;
    // Out-of-space mid-transfer pauses the queue and surfaces how much space is needed.
    if (event.errorCode === 'no_space') {
      for (let i = 0; i < allItems.length; i++) {
        const item = allItems[i]!;
        if (i !== index && (item.status === 'queued' || item.status === 'downloading')) {
          allItems[i] = { ...item, status: 'paused', errorCode: 'no_space', neededBytes: event.neededBytes, error: event.error };
        }
      }
    }
    const bannerError = event.errorCode === 'no_space' && event.error ? event.error : this.state.error;
    await this.commitSnapshot(allItems, this.state.outbox, undefined, bannerError);
  }

  /** Record local/offline watch progress into the download record and the progress outbox (one entry per server, viewer and title). */
  async recordProgress(params: {
    titleId: string;
    positionSeconds: number;
    durationSeconds?: number;
    completed?: boolean;
    observedAt?: V.Timestamp;
  }): Promise<void> {
    const { serverId, viewerId } = this.box.get().auth;
    if (!serverId || !viewerId) return;
    const record = this.item(params.titleId);
    if (!record || !Number.isFinite(params.positionSeconds)) return;
    const duration = params.durationSeconds ?? record?.title.durationSeconds ?? 0;
    const position = Math.max(0, params.positionSeconds);
    const observedAt = params.observedAt ?? new Date().toISOString();
    const existingOutbox = this.state.outbox.find(entry =>
      entry.serverId === serverId && entry.viewerId === viewerId && entry.titleId === params.titleId);
    // Once a title has reached its natural end offline, never un-watch it in the coalesced outbox entry.
    const completed = (params.completed === true) || (existingOutbox?.completed === true);
    if (existingOutbox && (Date.parse(existingOutbox.observedAt) > Date.parse(observedAt) ||
        (existingOutbox.positionSeconds === position && existingOutbox.completed === completed))) return;
    const nextEntry: OfflineProgressEntry = {
      serverId,
      viewerId,
      titleId: params.titleId,
      positionSeconds: position,
      durationSeconds: duration,
      completed,
      observedAt,
      idempotencyKey: `offline-watch-${params.titleId}-${randomId()}`,
      baseline: existingOutbox?.baseline ?? record?.baselineWatch,
    };
    const outbox = [
      ...this.state.outbox.filter(entry =>
        !(entry.serverId === serverId && entry.viewerId === viewerId && entry.titleId === params.titleId)),
      nextEntry,
    ];
    const allItems = this.state.allItems.map(item => {
      if (item.serverId !== serverId || item.viewerId !== viewerId || item.titleId !== params.titleId) return item;
      const played = item.title.watch?.played || completed;
      return {
        ...item,
        title: {
          ...item.title,
          watch: {
            positionSeconds: completed ? 0 : position,
            played,
            favorite: item.title.watch?.favorite ?? false,
            watchlisted: item.title.watch?.watchlisted ?? false,
            lastViewedAt: observedAt,
          },
        },
      };
    });
    await this.commitSnapshot(allItems, outbox);
  }

  /** Replay only entries belonging to the authenticated viewer, retaining failed writes for retry. */
  replayProgress(): Promise<void> {
    const { auth, playback } = this.box.get();
    if (!this.port || auth.phase !== 'signed-in' || !this.state.outbox.length || playback?.sessionId.startsWith('local-')) return Promise.resolve();
    return this.replaying ??= this.flushProgress().catch(() => {}).finally(() => { this.replaying = undefined; });
  }

  private async flushProgress(): Promise<void> {
    const { serverId, viewerId } = this.box.get().auth;
    const epoch = this.session.epoch;
    const connection = await this.session.ready();
    const api = connection.adapter;
    if (!hasOfflineProgress(api) || connection.record.id !== serverId ||
        (await this.session.tokens(connection))?.viewer.id !== viewerId) return;
    const stillOnline = () => {
      const auth = this.box.get().auth;
      return this.session.epoch === epoch && auth.phase === 'signed-in' && auth.serverId === serverId && auth.viewerId === viewerId;
    };
    await this.writing;
    for (const entry of this.state.outbox) {
      if (!stillOnline()) return;
      if (entry.serverId !== serverId || entry.viewerId !== viewerId) continue;
      try {
        const watch = (await api.detail(entry.titleId, true)).title.watch;
        if (!stillOnline()) return;
        if (!this.state.outbox.includes(entry)) continue;
        const skip = offlineProgressSuperseded(entry, watch);
        if (!skip) await api.replayWatchProgress(entry.titleId, entry);
        if (!stillOnline()) return;
        const baseline = skip ? watch : {
          positionSeconds: entry.completed ? 0 : entry.positionSeconds,
          played: entry.completed || watch?.played === true,
          lastViewedAt: entry.observedAt,
        };
        const allItems = this.state.allItems.map(item => {
          if (item.serverId !== serverId || item.viewerId !== viewerId || item.titleId !== entry.titleId) return item;
          const title = skip && baseline && this.state.outbox.includes(entry)
            ? { ...item.title, watch: { favorite: false, watchlisted: false, ...item.title.watch, ...baseline } }
            : item.title;
          return { ...item, title, baselineWatch: baseline };
        });
        const outbox = this.state.outbox.filter(pending => pending !== entry).map(pending =>
          pending.serverId === serverId && pending.viewerId === viewerId && pending.titleId === entry.titleId
            ? { ...pending, baseline } : pending);
        await this.commitSnapshot(allItems, outbox);
      } catch {
        if (!stillOnline()) return;
      }
    }
  }

  private async upsertRecord(record: DownloadRecord, freeBytes?: number | null, error?: string): Promise<void> {
    const allItems = [
      ...this.state.allItems.filter(item =>
        !(item.serverId === record.serverId && item.viewerId === record.viewerId && item.titleId === record.titleId)),
      record,
    ];
    await this.commitSnapshot(allItems, this.state.outbox, freeBytes, error);
  }

  private async commitSnapshot(
    allItems: DownloadRecord[],
    outbox: OfflineProgressEntry[],
    freeBytes: number | null | undefined = undefined,
    error: string | undefined = undefined,
  ): Promise<void> {
    const { serverId, viewerId } = this.box.get().auth;
    this.box.update('downloads', state => ({
      ...state,
      allItems,
      items: visibleDownloads(allItems, serverId, viewerId),
      outbox,
      usedBytes: totalDownloadedBytes(allItems),
      ...(freeBytes !== undefined ? { freeBytes } : {}),
      ...(error !== undefined ? { error } : {}),
    }));
    const write = this.writing.then(() => this.port?.writeSnapshot({ items: allItems, outbox }));
    this.writing = write.catch(() => {});
    await write;
  }
}
