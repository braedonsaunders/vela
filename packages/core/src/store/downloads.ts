// Offline original-file downloads on every client that can hold files (docs/downloads.md): the
// platform storage port, the persisted index and progress outbox, space admission (any optional
// cap plus the platform's free-space reserve), viewer and server isolation, resuming interrupted
// transfers, what a title offers (Download, Save file or nothing), and the locally built
// PlaybackPlan for offline playback.
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
/** `interrupted`: the transfer died with the app, the tab or the network (not the viewer's pause);
 * the core resumes it, with fresh credentials, as soon as it is online again. */
export type DownloadErrorCode = 'forbidden' | 'rate_limited' | 'no_space' | 'network' | 'corrupt' | 'interrupted' | 'unknown';

/** What a platform's downloads engine can do. Ports without traits are iOS's background session. */
export interface DownloadsTraits {
  /** `background`: iOS URLSession; `service`: Android foreground service; `shell`: a desktop app's
   * own process; `page`: the browser page (OPFS). */
  engine: 'background' | 'service' | 'shell' | 'page';
  /** Whether the Wi-Fi-only setting applies (a metered/cellular network exists). */
  metered: boolean;
  /** Free space to keep after every queued transfer; null derives it (see `reserveFor`). */
  reserveBytes: number | null;
  /** The desktop can show a stored file in its folder. */
  reveal: boolean;
  /** The desktop can save a copy of a stored file elsewhere. */
  export: boolean;
  /** Offer Download only while at least this much is free (Android TV); null always offers. */
  minimumFreeToOffer: number | null;
  /** Save file without storing (web): which servers' originals it can save. */
  saveFile: { capability: boolean; headers: boolean } | null;
}

export const DEFAULT_DOWNLOAD_TRAITS: DownloadsTraits = {
  engine: 'background', metered: true, reserveBytes: FREE_SPACE_RESERVE_BYTES, reveal: false, export: false,
  minimumFreeToOffer: null, saveFile: null,
};

/** Read a port's declared traits defensively over the iOS defaults. */
export function downloadTraits(value: Partial<DownloadsTraits> | undefined): DownloadsTraits {
  const traits = { ...DEFAULT_DOWNLOAD_TRAITS, ...(value ?? {}) };
  const bytes = (n: unknown, fallback: number | null) =>
    n === null ? null : typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
  return {
    engine: ['background', 'service', 'shell', 'page'].includes(traits.engine) ? traits.engine : 'background',
    metered: traits.metered === true,
    reserveBytes: bytes(traits.reserveBytes, FREE_SPACE_RESERVE_BYTES),
    reveal: traits.reveal === true,
    export: traits.export === true,
    minimumFreeToOffer: bytes(traits.minimumFreeToOffer, null),
    saveFile: traits.saveFile && typeof traits.saveFile === 'object'
      ? { capability: traits.saveFile.capability === true, headers: traits.saveFile.headers === true }
      : null,
  };
}

/** The web's reserve when a port leaves it to quota: the larger of 10% of quota and 256 MB. */
export const WEB_RESERVE_MIN_BYTES = 256_000_000;

/** Free space to keep: the port's fixed reserve, or for a quota-bound origin 10% of quota (at least 256 MB). */
export function reserveFor(traits: DownloadsTraits, quotaBytes?: number | null): number {
  if (traits.reserveBytes !== null) return traits.reserveBytes;
  const quota = typeof quotaBytes === 'number' && Number.isFinite(quotaBytes) && quotaBytes > 0 ? quotaBytes : 0;
  return Math.max(WEB_RESERVE_MIN_BYTES, Math.floor(quota * 0.1));
}

/** A browser origin's storage: whether it is persistent (not evicted under pressure) and its quota. */
export interface DownloadsStorage {
  persisted: boolean;
  quotaBytes: number | null;
  usageBytes: number | null;
}

/** A Save file request (web): the original fetched straight to a file the viewer keeps. */
export interface DownloadSaveRequest {
  url: string;
  headers: Record<string, string>;
  fileName: string;
  mimeType: string;
  byteLength?: number;
}

/** What a title's download action offers here. */
export type DownloadOffer =
  | { kind: 'download' }
  | { kind: 'save-file' }
  | { kind: 'none'; reason: 'unsupported' | 'not-allowed' | 'kind' | 'space' | 'browser' };

/**
 * One decision for every client: whether a title shows Download, Save file, or nothing.
 * - no port (tvOS) or not a movie/episode: nothing;
 * - the server refuses this account (Plex `allowSync`, Ether `features.downloads`, Jellyfin policy): nothing;
 * - a browser whose storage is not persistent: Save file where the browser can save this server's
 *   originals (an Ether grant link anywhere; header-authenticated servers need a save picker);
 * - Android TV below its free-space threshold: nothing (existing downloads stay in the library).
 */
export function downloadOffer(params: {
  supported: boolean;
  traits: DownloadsTraits;
  titleKind: string | undefined;
  serverAllows: boolean;
  /** Whether this server's originals need credential headers (Plex, Jellyfin, Emby) or are capability links (Ether). */
  credentials: 'none' | 'headers';
  persisted: boolean | null;
  freeBytes: number | null;
}): DownloadOffer {
  const { supported, traits, titleKind, serverAllows, credentials, persisted, freeBytes } = params;
  if (!supported) return { kind: 'none', reason: 'unsupported' };
  if (titleKind !== 'movie' && titleKind !== 'episode') return { kind: 'none', reason: 'kind' };
  if (!serverAllows) return { kind: 'none', reason: 'not-allowed' };
  if (traits.engine === 'page' && persisted === false) {
    const save = traits.saveFile;
    if (save && (credentials === 'none' ? save.capability : save.headers)) return { kind: 'save-file' };
    return { kind: 'none', reason: 'browser' };
  }
  if (traits.minimumFreeToOffer !== null && freeBytes !== null && freeBytes < traits.minimumFreeToOffer) {
    return { kind: 'none', reason: 'space' };
  }
  return { kind: 'download' };
}

/** Explains a `none` offer where the viewer can act on it. */
export function downloadOfferReason(offer: DownloadOffer): string {
  if (offer.kind !== 'none') return '';
  if (offer.reason === 'browser') {
    return 'This browser can\'t save videos from this server. Use the Vela app on your phone or computer to download it.';
  }
  if (offer.reason === 'space') return 'This device doesn\'t have enough free storage for downloads.';
  return '';
}

/** A file name for a saved or exported original: the title (and episode), never server IDs or tokens. */
export function downloadFileName(title: Pick<V.Title, 'name' | 'kind' | 'showName' | 'seasonNumber' | 'episodeNumber' | 'year'>, container: string): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const episode = title.kind === 'episode' && title.seasonNumber != null && title.episodeNumber != null
    ? `S${pad(title.seasonNumber)}E${pad(title.episodeNumber)}` : '';
  const parts = title.kind === 'episode'
    ? [title.showName, episode, title.name]
    : [title.name, title.year ? `(${title.year})` : ''];
  const base = parts.filter(Boolean).join(' - ').replace(/ - \(/, ' (')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 150).trim() || 'Video';
  const extension = /^[a-z0-9]{1,8}$/i.test(container) ? container.toLowerCase() : 'mkv';
  return `${base}.${extension}`;
}

const REFUSED = Symbol('refused download');
function refusedDownload(): Error {
  return Object.assign(new Error('Downloads are not allowed for this account on this server'), { [REFUSED]: true });
}
/** The server refused this account (401/403, or its permission says no): not worth retrying. */
function refusal(error: unknown): boolean {
  if (error && typeof error === 'object' && REFUSED in error) return true;
  const status = (error as { status?: unknown } | undefined)?.status;
  return status === 401 || status === 403;
}

/** A transfer the core resumes on its own: interrupted (not paused by the viewer), and not refused. */
export function autoResumable(item: DownloadRecord): boolean {
  return item.status === 'paused' && item.errorCode === 'interrupted';
}

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
  /** Reusing a still-valid Ether grant lets URLSession resume its existing request. */
  grantKey?: string;
  grantExpiresAt?: V.Timestamp;
  status: DownloadStatus;
  error?: string;
  errorCode?: DownloadErrorCode;
  neededBytes?: number;
  createdAt: V.Timestamp;
  completedAt?: V.Timestamp;
  /** Relative path under the port's `vela-downloads/` root (never an absolute path). */
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
  /** What this engine can do; absent means iOS's background session. */
  traits?: Partial<DownloadsTraits>;
  /** The URL a player or image view uses for a stored file (a desktop shell's own download URL, or
   * a `blob:` URL on the web). Absent: the relative path resolves against `baseDirectoryUrl()`. */
  fileUrl?(relativePath: string): Promise<string> | string;
  /** Desktop: show the title's stored original in the system file manager. */
  reveal?(serverId: string, viewerId: string, titleId: string): Promise<void>;
  /** Desktop: save a copy of the stored original where the viewer picks; false when cancelled. */
  exportCopy?(serverId: string, viewerId: string, titleId: string, fileName: string): Promise<boolean>;
  /** Web: the origin's storage persistence and quota. */
  storage?(): Promise<DownloadsStorage>;
  /** Web: ask the browser to keep this origin's storage; resolves whether it now is persistent. */
  persist?(): Promise<boolean>;
  /** Web: fetch the original straight to a file the viewer keeps (no index, no storage). */
  saveFile?(request: DownloadSaveRequest): Promise<void>;
}

export interface DownloadsState {
  supported: boolean;
  traits: DownloadsTraits;
  /** Web: whether the browser keeps this origin's storage; null where not applicable or unknown. */
  persisted: boolean | null;
  /** Web: the origin's storage quota in bytes, when known. */
  quotaBytes: number | null;
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
  traits: DEFAULT_DOWNLOAD_TRAITS,
  persisted: null,
  quotaBytes: null,
  hydrated: false,
  items: [],
  allItems: [],
  outbox: [],
  settings: DEFAULT_DOWNLOAD_SETTINGS,
  freeBytes: null,
  usedBytes: 0,
  error: '',
};

/** Whole percent for a transfer whose total size is known. */
export function downloadPercent(item: Pick<DownloadRecord, 'byteLength' | 'bytesWritten'> | undefined): number | undefined {
  if (!item?.byteLength || !Number.isFinite(item.byteLength) || item.byteLength < 0) return undefined;
  return Number.isFinite(item.bytesWritten) ? Math.max(0, Math.min(100, Math.floor(100 * item.bytesWritten / item.byteLength))) : undefined;
}

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
 * configured cap and leave the platform's reserve free (2 GB, `FREE_SPACE_RESERVE_BYTES`, on
 * devices and desktops; a share of quota in a browser, where `freeBytes` is quota minus usage).
 */
export function checkDownloadSpace(params: {
  requestedBytes?: number;
  existingItems: readonly DownloadRecord[];
  serverId: string;
  viewerId: string;
  titleId: string;
  freeBytes: number | null;
  capBytes: number | null;
  reserveBytes?: number;
}): SpaceCheckResult {
  const { requestedBytes, existingItems, serverId, viewerId, titleId, freeBytes, capBytes } = params;
  const reserve = params.reserveBytes !== undefined && Number.isFinite(params.reserveBytes) && params.reserveBytes >= 0
    ? params.reserveBytes : FREE_SPACE_RESERVE_BYTES;
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
    const requiredFree = owedByOthers + remainingForTarget + reserve;
    if (freeBytes < requiredFree) {
      const neededBytes = requiredFree - Math.max(0, freeBytes);
      return {
        allowed: false,
        reason: 'free_space',
        neededBytes,
        message: `Not enough free storage (${formatDownloadBytes(neededBytes)} more needed to keep ${formatDownloadBytes(reserve)} free).`,
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

/** The segments of an index path, refusing anything that could leave its title's directory. */
export function downloadPathSegments(relativePath: string): string[] {
  const segments = relativePath.trim().replace(/^\/+/, '').split('/');
  if (!relativePath.trim() || segments.some(segment => !segment || segment === '.' || segment === '..' ||
      segment.includes('\\') || /[\u0000-\u001f\u007f]/.test(segment) || /^[a-z]:$/i.test(segment))) {
    throw new Error('Invalid relative download path');
  }
  return segments;
}

/**
 * Whether `baseDirectoryUrl` is a downloads root the core may resolve against: a native `file:///`
 * directory, or a desktop shell's own download route (`vela-app://app/vela-downloads/`,
 * `http://vela.localhost/vela-downloads/`): no credentials, query, fragment or encoded separators.
 */
export function validDownloadsBase(baseDirectoryUrl: string): boolean {
  // Swift supplies an escaped absolute base URL and raw path components. React Native's URL
  // parser does not implement pathname semantics for file: URLs.
  if (/^file:\/\/\/[^?#]+$/.test(baseDirectoryUrl)) return !/(^|\/)\.\.?(\/|$)/.test(baseDirectoryUrl.slice(7));
  return /^(vela-app:\/\/app|http:\/\/vela\.localhost)\/vela-downloads\/?$/.test(baseDirectoryUrl);
}

/**
 * Resolve a relative path from `index.json` against the current base `vela-downloads/` URL.
 * Storing relative paths keeps files valid when iOS rotates the app container UUID.
 */
export function resolveDownloadFileUrl(baseDirectoryUrl: string, relativePath: string): string {
  const segments = downloadPathSegments(relativePath);
  if (!validDownloadsBase(baseDirectoryUrl)) {
    throw new Error('Downloads base directory must be a file: URL or the app\'s download route');
  }
  const base = baseDirectoryUrl.endsWith('/') ? baseDirectoryUrl : `${baseDirectoryUrl}/`;
  return base + segments.map(encodeURIComponent).join('/');
}

/** Resolves stored relative paths to the URLs players and images use. */
export type DownloadFileResolver = (relativePath: string) => string;

/** Every stored file a record's verified copy plays or shows: media, sidecars and poster. */
export function downloadFilePaths(item: DownloadRecord): string[] {
  const verified: VerifiedDownloadCopy | DownloadRecord =
    item.status === 'completed' && item.mediaPath ? item : item.previousCompleted ?? item;
  return [verified.mediaPath, verified.posterPath ?? item.posterPath, ...Object.values(verified.sidecarPaths ?? {})]
    .filter((path): path is string => typeof path === 'string' && !!path);
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
  base: string | DownloadFileResolver,
  options?: { positionSeconds?: number; sessionId?: string },
): V.PlaybackPlan {
  const verified: VerifiedDownloadCopy | DownloadRecord =
    item.status === 'completed' && item.mediaPath ? item : item.previousCompleted ?? item;
  if (!verified.mediaPath) throw new Error('Download has no verified local media file');
  const resolve: DownloadFileResolver = typeof base === 'string' ? path => resolveDownloadFileUrl(base, path) : base;
  const mediaUrl = resolve(verified.mediaPath);
  const sidecarPaths = verified.sidecarPaths ?? {};
  const subtitleTracks: V.Track[] = [];
  for (const track of verified.subtitleTracks) {
    if (track.delivery?.kind === 'external') {
      const rel = sidecarPaths[track.id];
      if (!rel) continue;
      const localUrl = resolve(rel);
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
export function downloadedDetailModel(item: DownloadRecord, base?: string | DownloadFileResolver, artWidth = 2560): DetailModel {
  const model = detailModel({
    title: item.title,
    canPlay: true,
    extras: [],
    chapters: item.chapters,
    cast: [],
    crew: [],
  }, undefined, artWidth);
  const posterPath = (item.status === 'completed' ? item.posterPath : item.previousCompleted?.posterPath) ?? item.posterPath;
  if (posterPath && base && model.title[0]) {
    try {
      const localPoster = typeof base === 'string' ? resolveDownloadFileUrl(base, posterPath) : base(posterPath);
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
  private readonly pendingTransferEvents: DownloadTransferProgress[] = [];
  private replaying: Promise<void> | undefined;
  private lastAuthPhase: AuthPhase | undefined;
  private hydrating: Promise<void> | undefined;
  private resuming: Promise<void> | undefined;
  /** Whether this session asked the browser to keep its storage (see refreshStorage). */
  private askedPersist = false;
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
      const traits = downloadTraits(this.port.traits);
      this.box.update('downloads', state => ({ ...state, supported: true, traits }));
      this.unsubscribePort = this.port.subscribe?.(event => {
        if (!this.state.hydrated) this.pendingTransferEvents.push(event);
        else void this.applyTransferEvent(event).catch(() => {});
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
    if (serverId && viewerId && (phase === 'signed-in' || phase === 'offline')) {
      const changed = this.activeViewer?.serverId !== serverId || this.activeViewer?.viewerId !== viewerId;
      this.activeViewer = { serverId, viewerId };
      if (changed) this.syncVisible();
    } else if (phase === 'signed-out') {
      this.syncVisible();
    }
    // After the visible list follows the viewer: hydration may have finished before sign-in did.
    if (enteredOnline && this.state.outbox.length) void this.replayProgress();
    if (enteredOnline && this.state.hydrated) void this.resumeInterrupted();
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

  /** What a title of `titleKind` offers here: Download, Save file (a browser without persistent
   * storage), or nothing, from the platform, the server's permission and the device's space. */
  async offer(titleKind: string | undefined): Promise<DownloadOffer> {
    if (!this.port) return { kind: 'none', reason: 'unsupported' };
    let serverAllows = false;
    let credentials: 'none' | 'headers' = 'headers';
    try {
      serverAllows = await this.canDownload();
      const { adapter } = this.session.selected();
      if (hasMediaDownloads(adapter)) credentials = adapter.downloadCredentials ?? 'headers';
    } catch {
      serverAllows = false;
    }
    if (serverAllows) await this.refreshStorage();
    const { traits, persisted, freeBytes } = this.state;
    return downloadOffer({ supported: true, traits, titleKind, serverAllows, credentials, persisted, freeBytes });
  }

  /** Re-read free space and, in a browser, storage persistence and quota. */
  async refreshStorage(): Promise<void> {
    if (!this.port) return;
    const [freeBytes, storage] = await Promise.all([
      this.port.freeBytes().catch(() => null),
      this.port.storage?.().catch(() => undefined),
    ]);
    // A browser reports storage as not persistent until the page asks; only an answer to that ask
    // (made on the viewer's first Download press) turns Download into Save file.
    const persisted = storage ? (storage.persisted ? true : this.askedPersist ? false : null) : undefined;
    this.box.update('downloads', state => ({
      ...state,
      freeBytes,
      ...(storage ? { persisted, quotaBytes: storage.quotaBytes } : {}),
    }));
  }

  /** The reserve this platform keeps free (2 GB, or a share of a browser's quota). */
  private reserve(): number {
    return reserveFor(this.state.traits, this.state.quotaBytes);
  }

  /** A browser stores downloads only once its storage is persistent; ask on the viewer's press. */
  private async ensurePersistent(): Promise<boolean> {
    if (this.state.traits.engine !== 'page' || !this.port?.persist) return true;
    if (this.state.persisted === true) return true;
    this.askedPersist = true;
    const persisted = await this.port.persist().catch(() => false);
    this.box.update('downloads', state => ({ ...state, persisted }));
    return persisted;
  }

  /** Resolve every stored file a record uses to the URL its player or image view opens. */
  private async resolver(item: DownloadRecord): Promise<DownloadFileResolver> {
    const port = this.port!;
    if (!port.fileUrl) {
      const base = await port.baseDirectoryUrl();
      return path => resolveDownloadFileUrl(base, path);
    }
    const urls = new Map<string, string>();
    for (const path of downloadFilePaths(item)) {
      downloadPathSegments(path);
      urls.set(path, await port.fileUrl(path));
    }
    return path => {
      const url = urls.get(path);
      if (!url) throw new Error('Download file is not stored');
      return url;
    };
  }

  /** Hydrate the index, outbox and free space from the native downloads host once at startup. */
  hydrate(): Promise<void> {
    if (!this.port) return Promise.resolve();
    if (this.state.hydrated) return Promise.resolve();
    return this.hydrating ??= this.readFromPort().then(async () => {
      for (const event of this.pendingTransferEvents.splice(0)) {
        await this.applyTransferEvent(event).catch(() => {});
      }
      void this.replayProgress();
      void this.resumeInterrupted();
    }).finally(() => {
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
    const resolve = await this.resolver(record);
    const current = this.item(titleId);
    if (!isPlayableDownload(current) || record.serverId !== current.serverId || record.viewerId !== current.viewerId) return null;
    return localPlaybackPlan(current, current === record ? resolve : await this.resolver(current), options);
  }

  async posterFor(titleId: string): Promise<string | undefined> {
    const item = this.item(titleId);
    const path = item?.status === 'completed' ? item.posterPath : item?.previousCompleted?.posterPath;
    if (!this.port || !path || !item) return undefined;
    const resolve = await this.resolver(item);
    const current = this.item(titleId);
    if (current?.serverId !== item.serverId || current.viewerId !== item.viewerId) return undefined;
    return resolve(path);
  }

  /** Build a `DetailModel` for `titleId` from the local index, seeding `state.titles[titleId]` when offline. */
  async detailFor(titleId: string, artWidth = 2560): Promise<DetailModel | null> {
    const record = this.item(titleId);
    if (!record) return null;
    const base = this.port ? await this.resolver(record).catch(() => undefined) : undefined;
    const detail = downloadedDetailModel(record, base, artWidth);
    if (this.item(titleId) === record && !this.box.get().titles[titleId]?.value) {
      this.box.update('titles', titles => ({ ...titles, [titleId]: ready(detail) }));
    }
    return detail;
  }

  /** Resolve a title's original file from the server, check space, and enqueue its background transfer. */
  async enqueue(titleId: string, options?: { versionId?: string }): Promise<DownloadRecord | null> {
    if (!this.port) return null;
    let pending: DownloadRecord | undefined;
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
      if (!await this.ensurePersistent()) {
        throw new Error('This browser may clear stored videos, so Vela saves the file to your computer instead.');
      }
      if (this.port.storage) await this.refreshStorage();
      const currentViewer = () => {
        const { auth } = this.box.get();
        return auth.phase === 'signed-in' && auth.serverId === serverId && auth.viewerId === viewerId;
      };
      const client = await this.session.declared().catch(() => undefined);
      const grantKey = this.session.key();
      const resolved = await adapter.resolveDownload(titleId, {
        versionId: options?.versionId,
        subtitleFormats: client?.subtitleFormats,
        idempotencyKey: grantKey,
      });
      const freeBytes = await this.port.freeBytes().catch(() => null);
      if (!currentViewer()) return null;
      const space = checkDownloadSpace({
        requestedBytes: resolved.byteLength,
        existingItems: this.state.allItems,
        serverId,
        viewerId,
        titleId,
        freeBytes,
        capBytes: this.state.settings.capBytes,
        reserveBytes: this.reserve(),
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
        ...(resolved.expiresAt ? { grantKey, grantExpiresAt: resolved.expiresAt } : {}),
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
      pending = record;
      await this.upsertRecord(record, freeBytes, '');
      if (!currentViewer() || this.item(titleId) !== record) return null;
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
      const text = message(error, 'Download could not be started');
      if (pending && this.item(titleId) === pending) {
        await this.upsertRecord({ ...pending, status: 'failed', error: text }, undefined, text).catch(() => {});
      } else this.box.update('downloads', state => ({ ...state, error: text }));
      return null;
    }
  }

  /** Pause an in-flight or queued download. */
  async pause(titleId: string): Promise<void> {
    if (!this.port) return;
    const record = this.item(titleId);
    if (!record || (record.status !== 'queued' && record.status !== 'downloading')) return;
    await this.port.pauseTransfer(record.serverId, record.viewerId, titleId);
    const current = this.item(titleId);
    if (current?.viewerId === record.viewerId && current.serverId === record.serverId &&
        (current.status === 'queued' || current.status === 'downloading')) {
      await this.upsertRecord({ ...current, status: 'paused' });
    }
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
      if (adapter.downloadsAvailable && !(await adapter.downloadsAvailable())) throw refusedDownload();
      const client = await this.session.declared().catch(() => undefined);
      const expires = Date.parse(record.grantExpiresAt ?? '');
      const grantKey = record.grantKey && expires > Date.now() + 30_000 ? record.grantKey : this.session.key();
      const resolved = await adapter.resolveDownload(titleId, {
        versionId: record.versionId,
        subtitleFormats: client?.subtitleFormats,
        idempotencyKey: grantKey,
      });
      if (this.item(titleId) !== record) return false;
      const sameSource = (!record.sourceId || !resolved.sourceId || record.sourceId === resolved.sourceId) &&
        (!record.byteLength || !resolved.byteLength || record.byteLength === resolved.byteLength) &&
        (!record.etag || !resolved.etag || record.etag === resolved.etag);
      const freeBytes = await this.port.freeBytes().catch(() => null);
      if (this.item(titleId) !== record) return false;
      const space = checkDownloadSpace({
        requestedBytes: resolved.byteLength ?? record.byteLength,
        existingItems: sameSource ? this.state.allItems : this.state.allItems.map(item => item === record ? { ...item, bytesWritten: 0 } : item),
        serverId: record.serverId,
        viewerId: record.viewerId,
        titleId,
        freeBytes,
        capBytes: this.state.settings.capBytes,
        reserveBytes: this.reserve(),
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
      const updated: DownloadRecord = {
        ...record,
        sourceId: resolved.sourceId,
        container: resolved.container,
        mimeType: resolved.mimeType,
        originalVideo: resolved.originalVideo,
        audioTracks: resolved.audioTracks,
        subtitleTracks: resolved.subtitleTracks,
        selectedAudioTrackId: resolved.selectedAudioTrackId,
        selectedSubtitleTrackId: resolved.selectedSubtitleTrackId,
        chapters: resolved.chapters,
        markers: resolved.markers,
        byteLength: resolved.byteLength ?? (sameSource ? record.byteLength : undefined),
        bytesWritten: sameSource ? record.bytesWritten : 0,
        etag: resolved.etag ?? (sameSource ? record.etag : undefined),
        grantKey: resolved.expiresAt ? grantKey : undefined,
        grantExpiresAt: resolved.expiresAt,
        status: 'queued',
        error: undefined,
        errorCode: undefined,
        neededBytes: undefined,
      };
      await this.upsertRecord(updated, freeBytes, '');
      if (this.item(titleId) !== updated) return false;
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
      // A refusal (permission withdrawn, grant revoked) ends the transfer instead of retrying it.
      const current = this.item(titleId);
      if (refusal(error) && current === record) {
        await this.upsertRecord({ ...record, status: 'failed', errorCode: 'forbidden', error: text }, undefined, text).catch(() => {});
      } else this.box.update('downloads', state => ({ ...state, error: text }));
      return false;
    }
  }

  /**
   * Resume, one at a time, the active viewer's transfers that died with the app, the tab or the
   * network (`paused` + `interrupted`). Each resume re-resolves the download, so fresh headers or a
   * fresh grant are minted and no port keeps credentials. A refusal leaves the record failed.
   */
  resumeInterrupted(): Promise<void> {
    if (!this.port || this.box.get().auth.phase !== 'signed-in') return Promise.resolve();
    return this.resuming ??= (async () => {
      const tried = new Set<string>();
      for (;;) {
        const { phase, serverId, viewerId } = this.box.get().auth;
        if (phase !== 'signed-in') return;
        const next = visibleDownloads(this.state.allItems, serverId, viewerId)
          .find(item => autoResumable(item) && !tried.has(item.titleId));
        if (!next) return;
        tried.add(next.titleId);
        await this.resume(next.titleId).catch(() => false);
      }
    })().finally(() => { this.resuming = undefined; });
  }

  /**
   * Save file (a browser without persistent storage): resolve the original with the server's
   * permission checks and hand it to the port, which saves it straight to a file the viewer keeps.
   */
  async saveFile(titleId: string, options?: { versionId?: string }): Promise<boolean> {
    if (!this.port?.saveFile) return false;
    try {
      const connection = await this.session.ready();
      const adapter = connection.adapter;
      if (!hasMediaDownloads(adapter)) throw new Error('Downloads are not supported on this server');
      if (adapter.downloadsAvailable && !(await adapter.downloadsAvailable())) {
        throw new Error('Downloads are not allowed for this account on this server');
      }
      const resolved = await adapter.resolveDownload(titleId, { versionId: options?.versionId, idempotencyKey: this.session.key() });
      await this.port.saveFile({
        url: resolved.url,
        headers: resolved.headers,
        fileName: downloadFileName(resolved.title, resolved.container),
        mimeType: resolved.mimeType,
        ...(resolved.byteLength ? { byteLength: resolved.byteLength } : {}),
      });
      return true;
    } catch (error) {
      if ((error as { name?: unknown } | undefined)?.name === 'AbortError') return false;
      this.box.update('downloads', state => ({ ...state, error: message(error, 'The file could not be saved') }));
      return false;
    }
  }

  /** Desktop: show a stored title's original in the system file manager. */
  async reveal(titleId: string): Promise<void> {
    const item = this.item(titleId);
    if (!this.port?.reveal || !isPlayableDownload(item)) return;
    await this.port.reveal(item.serverId, item.viewerId, titleId);
  }

  /** Desktop: save a copy of a stored title's original where the viewer picks. */
  async exportCopy(titleId: string): Promise<boolean> {
    const item = this.item(titleId);
    if (!this.port?.exportCopy || !isPlayableDownload(item)) return false;
    return this.port.exportCopy(item.serverId, item.viewerId, titleId, downloadFileName(item.title, item.container));
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
        // Moving again (an engine that resumed by itself) clears the reason it had stopped.
        : event.status === 'downloading' || event.status === 'queued'
          ? { error: undefined, errorCode: undefined, neededBytes: undefined }
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
