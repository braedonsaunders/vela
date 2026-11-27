// The desktop apps' downloads (docs/downloads.md): the page's DownloadsPort over the fixed bridge
// each shell installs before the page runs. Electron's preload exposes it from the main process
// (apps/vela-desktop/downloads.js); the Windows host injects the same shape over WebView2 messages
// (apps/vela-windows/Downloads.cs). The shell transfers, stores and serves the files; the page keeps
// the index logic in packages/core. Credentials pass through a transfer request and are held in
// the shell's memory only.
import type { DownloadsPort, DownloadsSnapshot, DownloadTransferProgress } from '@vela/core';

/** What a shell installs as `window.__VELA_DOWNLOADS__` (version 1). */
export interface DesktopDownloadsBridge {
  version: 1;
  /** The shell's own download route: `vela-app://app/vela-downloads/` or `http://vela.localhost/vela-downloads/`. */
  base: string;
  /** One of DESKTOP_DOWNLOAD_METHODS; rejects with a message (never a URL or header) on failure. */
  call(method: DesktopDownloadMethod, ...args: unknown[]): Promise<unknown>;
  /** Transfer progress, completion and failure events. */
  subscribe(listener: (event: DownloadTransferProgress) => void): () => void;
}

export const DESKTOP_DOWNLOAD_METHODS = [
  'readSnapshot', 'writeSnapshot', 'freeBytes', 'startTransfer', 'pauseTransfer', 'resumeTransfer',
  'removeTitle', 'removeViewer', 'removeServer', 'reveal', 'exportCopy',
] as const;
export type DesktopDownloadMethod = typeof DESKTOP_DOWNLOAD_METHODS[number];

const BASES = ['vela-app://app/vela-downloads/', 'http://vela.localhost/vela-downloads/'];

/** The bridge, when this page runs in a desktop shell that installed a valid one. */
export function desktopDownloadsBridge(scope: unknown = globalThis): DesktopDownloadsBridge | undefined {
  const bridge = (scope as { __VELA_DOWNLOADS__?: Partial<DesktopDownloadsBridge> }).__VELA_DOWNLOADS__;
  if (!bridge || bridge.version !== 1 || typeof bridge.call !== 'function' || typeof bridge.subscribe !== 'function') return undefined;
  if (typeof bridge.base !== 'string' || !BASES.includes(bridge.base)) return undefined;
  return bridge as DesktopDownloadsBridge;
}

const snapshotOf = (value: unknown): DownloadsSnapshot => {
  const snapshot = value && typeof value === 'object' ? value as Partial<DownloadsSnapshot> : {};
  return { items: Array.isArray(snapshot.items) ? snapshot.items : [], outbox: Array.isArray(snapshot.outbox) ? snapshot.outbox : [] };
};

/** The page's DownloadsPort over a desktop shell's bridge. */
export function shellDownloads(bridge: DesktopDownloadsBridge): DownloadsPort {
  const call = (method: DesktopDownloadMethod, ...args: unknown[]) => bridge.call(method, ...args);
  return {
    traits: { engine: 'shell', metered: false, reserveBytes: 2_000_000_000, reveal: true, export: true, minimumFreeToOffer: null, saveFile: null },
    baseDirectoryUrl: () => bridge.base,
    readSnapshot: async () => snapshotOf(await call('readSnapshot')),
    writeSnapshot: async snapshot => { await call('writeSnapshot', snapshotOf(snapshot)); },
    freeBytes: async () => {
      const free = await call('freeBytes');
      return typeof free === 'number' && Number.isFinite(free) && free >= 0 ? free : null;
    },
    startTransfer: async request => { await call('startTransfer', request); },
    pauseTransfer: async (serverId, viewerId, titleId) => { await call('pauseTransfer', serverId, viewerId, titleId); },
    resumeTransfer: async request => { await call('resumeTransfer', request); },
    removeTitle: async (serverId, viewerId, titleId) => { await call('removeTitle', serverId, viewerId, titleId); },
    removeViewer: async (serverId, viewerId) => { await call('removeViewer', serverId, viewerId); },
    removeServer: async serverId => { await call('removeServer', serverId); },
    reveal: async (serverId, viewerId, titleId) => { await call('reveal', serverId, viewerId, titleId); },
    exportCopy: async (serverId, viewerId, titleId, fileName) => (await call('exportCopy', serverId, viewerId, titleId, fileName)) === true,
    subscribe: listener => bridge.subscribe(listener),
  };
}
