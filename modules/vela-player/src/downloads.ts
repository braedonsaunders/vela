// Offline original-file downloads bridge on iPhone and iPad (packages/core DownloadsPort).
// Supported on iOS and iPadOS (`Platform.OS === 'ios' && !Platform.isTV`); undefined on web, tvOS and Android.
import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

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
  errorCode?: 'forbidden' | 'rate_limited' | 'no_space' | 'network' | 'corrupt' | 'unknown';
  neededBytes?: number;
}

export interface NativeDownloadsSnapshot<TItem = any, TOutbox = any> {
  items: TItem[];
  outbox: TOutbox[];
}

export interface VelaDownloadsPort {
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
  downloadsReadSnapshot?(): Promise<NativeDownloadsSnapshot>;
  downloadsWriteSnapshot?(snapshot: NativeDownloadsSnapshot): Promise<void>;
  downloadsStartTransfer?(request: NativeDownloadTransferRequest): Promise<void>;
  downloadsResumeTransfer?(request: NativeDownloadTransferRequest): Promise<void>;
  downloadsPauseTransfer?(serverId: string, viewerId: string, titleId: string): Promise<void>;
  downloadsRemoveTitle?(serverId: string, viewerId: string, titleId: string): Promise<void>;
  downloadsRemoveViewer?(serverId: string, viewerId: string): Promise<void>;
  downloadsRemoveServer?(serverId: string): Promise<void>;
  addListener?(event: 'onDownload', listener: (event: NativeDownloadTransferProgress) => void): { remove(): void };
}

function createVelaDownloads(): VelaDownloadsPort | undefined {
  if (Platform.OS !== 'ios' || Platform.isTV) return undefined;
  let mod: NativeDownloadsModule | undefined;
  try {
    mod = requireNativeModule<NativeDownloadsModule>('VelaPlayer');
  } catch {
    return undefined;
  }
  if (!mod?.downloadsBaseDirectoryUrl) return undefined;
  const native = mod;
  return {
    baseDirectoryUrl: () => native.downloadsBaseDirectoryUrl?.() ?? '',
    readSnapshot: async () => {
      const snap = await native.downloadsReadSnapshot?.();
      return {
        items: Array.isArray(snap?.items) ? snap.items : [],
        outbox: Array.isArray(snap?.outbox) ? snap.outbox : [],
      };
    },
    writeSnapshot: async (snapshot) => {
      await native.downloadsWriteSnapshot?.({
        items: Array.isArray(snapshot?.items) ? snapshot.items : [],
        outbox: Array.isArray(snapshot?.outbox) ? snapshot.outbox : [],
      });
    },
    freeBytes: async () => (await native.downloadsFreeBytes?.()) ?? null,
    startTransfer: async (request) => {
      await native.downloadsStartTransfer?.(request);
    },
    pauseTransfer: async (serverId, viewerId, titleId) => {
      await native.downloadsPauseTransfer?.(serverId, viewerId, titleId);
    },
    resumeTransfer: async (request) => {
      await native.downloadsResumeTransfer?.(request);
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
