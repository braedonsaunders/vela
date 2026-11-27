// Offline original-file downloads bridge (packages/core DownloadsPort, docs/downloads.md): iPhone and
// iPad (URLSession background session) and Android phones, tablets and TVs (a foreground download
// service). Undefined on tvOS, which has no durable local storage, and on web (apps/vela's web port).
import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
import { nativeDownloadsSupported, nativeDownloadsTraits, type NativeDownloadsTraits } from './downloads-traits';

export { ANDROID_TV_MINIMUM_FREE_TO_OFFER, nativeDownloadsSupported, nativeDownloadsTraits, type NativeDownloadsTraits } from './downloads-traits';

export interface NativeDownloadSidecar {
  trackId: string;
  format: string;
  url: string;
}

export interface NativeDownloadTransferRequest {
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
  sidecars: NativeDownloadSidecar[];
}

export interface NativeDownloadTransferProgress {
  serverId: string;
  viewerId: string;
  titleId: string;
  status: 'queued' | 'downloading' | 'paused' | 'completed' | 'failed';
  bytesWritten: number;
  byteLength?: number;
  etag?: string;
  lastModified?: string;
  mediaPath?: string;
  posterPath?: string;
  sidecarPaths?: Record<string, string>;
  error?: string;
  errorCode?: 'forbidden' | 'rate_limited' | 'no_space' | 'network' | 'corrupt' | 'interrupted' | 'unknown';
  neededBytes?: number;
}

export interface NativeDownloadsSnapshot<TItem = any, TOutbox = any> {
  items: TItem[];
  outbox: TOutbox[];
}

export interface VelaDownloadsPort {
  traits: NativeDownloadsTraits;
  baseDirectoryUrl(): Promise<string> | string;
  readSnapshot(): Promise<NativeDownloadsSnapshot>;
  writeSnapshot(snapshot: NativeDownloadsSnapshot): Promise<void>;
  freeBytes(): Promise<number | null>;
  startTransfer(request: NativeDownloadTransferRequest): Promise<void>;
  pauseTransfer(serverId: string, viewerId: string, titleId: string): Promise<void>;
  resumeTransfer(request: NativeDownloadTransferRequest): Promise<void>;
  removeTitle(serverId: string, viewerId: string, titleId: string): Promise<void>;
  removeViewer(serverId: string, viewerId: string): Promise<void>;
  removeServer(serverId: string): Promise<void>;
  subscribe(listener: (event: NativeDownloadTransferProgress) => void): () => void;
}

interface NativeDownloadsModule {
  downloadsBaseDirectoryUrl?(): string;
  downloadsFreeBytes?(): Promise<number | null>;
  /** Android: JSON text (see jsonBridge). */
  downloadsReadSnapshot?(): Promise<NativeDownloadsSnapshot | string>;
  downloadsWriteSnapshot?(snapshot: NativeDownloadsSnapshot | string): Promise<void>;
  downloadsStartTransfer?(request: NativeDownloadTransferRequest | string): Promise<void>;
  downloadsResumeTransfer?(request: NativeDownloadTransferRequest | string): Promise<void>;
  downloadsPauseTransfer?(serverId: string, viewerId: string, titleId: string): Promise<void>;
  downloadsRemoveTitle?(serverId: string, viewerId: string, titleId: string): Promise<void>;
  downloadsRemoveViewer?(serverId: string, viewerId: string): Promise<void>;
  downloadsRemoveServer?(serverId: string): Promise<void>;
  addListener?(event: 'onDownload', listener: (event: NativeDownloadTransferProgress) => void): { remove(): void };
}

/** Android's Expo bridge converts neither `undefined` nor nested `null` into a Kotlin map, and records and
 * requests carry both (optional and cleared fields): there, snapshots and requests cross as JSON text. */
const jsonBridge = Platform.OS === 'android';
function out<T>(value: T): T | string {
  return jsonBridge ? JSON.stringify(value) : value;
}

function createVelaDownloads(): VelaDownloadsPort | undefined {
  if (!nativeDownloadsSupported(Platform.OS, !!Platform.isTV)) return undefined;
  let mod: NativeDownloadsModule | undefined;
  try {
    mod = requireNativeModule<NativeDownloadsModule>('VelaPlayer');
  } catch {
    return undefined;
  }
  if (!mod?.downloadsBaseDirectoryUrl) return undefined;
  const native = mod;
  return {
    traits: nativeDownloadsTraits(Platform.OS, !!Platform.isTV),
    baseDirectoryUrl: () => native.downloadsBaseDirectoryUrl?.() ?? '',
    readSnapshot: async () => {
      const raw: NativeDownloadsSnapshot | string | undefined = await native.downloadsReadSnapshot?.();
      const snap: NativeDownloadsSnapshot | undefined = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return {
        items: Array.isArray(snap?.items) ? snap.items : [],
        outbox: Array.isArray(snap?.outbox) ? snap.outbox : [],
      };
    },
    writeSnapshot: async (snapshot) => {
      await native.downloadsWriteSnapshot?.(out({
        items: Array.isArray(snapshot?.items) ? snapshot.items : [],
        outbox: Array.isArray(snapshot?.outbox) ? snapshot.outbox : [],
      }));
    },
    freeBytes: async () => (await native.downloadsFreeBytes?.()) ?? null,
    startTransfer: async (request) => {
      await native.downloadsStartTransfer?.(out(request));
    },
    pauseTransfer: async (serverId, viewerId, titleId) => {
      await native.downloadsPauseTransfer?.(serverId, viewerId, titleId);
    },
    resumeTransfer: async (request) => {
      await native.downloadsResumeTransfer?.(out(request));
    },
    removeTitle: async (serverId, viewerId, titleId) => {
      await native.downloadsRemoveTitle?.(serverId, viewerId, titleId);
    },
    removeViewer: async (serverId, viewerId) => {
      await native.downloadsRemoveViewer?.(serverId, viewerId);
    },
    removeServer: async (serverId) => {
      await native.downloadsRemoveServer?.(serverId);
    },
    subscribe: (listener) => {
      const sub = native.addListener?.('onDownload', (event) => listener(event));
      return () => sub?.remove();
    },
  };
}

export const velaDownloads: VelaDownloadsPort | undefined = createVelaDownloads();
