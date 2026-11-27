import {
  downloadPathSegments,
  type DownloadSaveRequest,
  type DownloadsPort,
  type DownloadsSnapshot,
  type DownloadTransferProgress,
  type DownloadTransferRequest,
} from '@vela/core';
import { openOpfsWriter, writeOpfsFile } from './downloads-opfs-writer';

type Picker = (options: { suggestedName: string }) => Promise<FileSystemFileHandle>;
type Validator = { etag?: string; lastModified?: string };
type LiveTransfer = {
  abort: AbortController;
  stop?: 'pause' | 'interrupted' | 'remove';
  done: Promise<void>;
};

const posterExtensions: Record<string, string> = {
  'image/avif': 'avif', 'image/gif': 'gif', 'image/jpeg': 'jpg', 'image/png': 'png',
  'image/svg+xml': 'svg', 'image/webp': 'webp',
};
const absent = (error: unknown) => error instanceof DOMException && error.name === 'NotFoundError';
const interrupted = { status: 'paused', errorCode: 'interrupted', error: 'Download interrupted' } as const;
const checkpointBytes = 32 * 1024 * 1024;
const maximumCheckpoint = 256 * 1024 * 1024;

type OfflineShell = { prepareOffline?(): unknown; releaseOffline?(): unknown };

export function syncOfflineShell(recordCount: number, shell?: OfflineShell) {
  if (recordCount > 0) shell?.prepareOffline?.();
  else shell?.releaseOffline?.();
}

class TransferError extends Error {
  constructor(readonly code: NonNullable<DownloadTransferProgress['errorCode']>, message: string) {
    super(message);
  }
}

function components(parts: string[]) {
  return parts.map(part => {
    if (part.trim() !== part || /[:/]/.test(part)) throw new Error('Invalid download path');
    return downloadPathSegments(part)[0]!;
  });
}

function extension(value: string, fallback: string) {
  const normalized = value.toLowerCase();
  return /^[a-z0-9]{1,10}$/.test(normalized) ? normalized : fallback;
}

async function directory(root: FileSystemDirectoryHandle, parts: string[], create = false) {
  for (const part of parts) root = await root.getDirectoryHandle(part, { create });
  return root;
}

async function readJson<T>(dir: FileSystemDirectoryHandle, name: string, fallback: T): Promise<T> {
  // A completed staging file survives an interrupted publish on sync-handle-only browsers.
  for (const candidate of [name + '.pending', name]) {
    try {
      const file = await (await dir.getFileHandle(candidate)).getFile();
      return JSON.parse(await file.text()) as T;
    } catch (error) {
      if (!absent(error) && !(error instanceof SyntaxError && candidate.endsWith('.pending'))) throw error;
    }
  }
  return fallback;
}

async function writeJson(dir: FileSystemDirectoryHandle, name: string, value: unknown) {
  const contents = new Blob([JSON.stringify(value)]);
  // createWritable publishes the staging contents atomically on close.
  const staging = await dir.getFileHandle(name + '.pending', { create: true });
  await writeOpfsFile(staging, contents);
  await publishFile(dir, staging, name);
}

async function publishFile(dir: FileSystemDirectoryHandle, staging: FileSystemFileHandle, name: string) {
  const movable = staging as FileSystemFileHandle & { move?(directory: FileSystemDirectoryHandle, name: string): Promise<void> };
  if (movable.move) {
    try {
      await movable.move(dir, name);
      return;
    } catch (error) {
      if (!(error instanceof DOMException) || !['InvalidModificationError', 'NotSupportedError'].includes(error.name)) throw error;
    }
  }
  await writeOpfsFile(await dir.getFileHandle(name, { create: true }), await staging.getFile());
  await dir.removeEntry(staging.name);
}

async function downloadFetch(url: URL, headers: HeadersInit, signal?: AbortSignal): Promise<Response> {
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
    throw new TransferError('forbidden', 'Download URL is unavailable');
  }
  let response: Response;
  try {
    // Fetch hides Location for manual redirects, even on the same origin. Reject
    // redirects so credentials never cross an origin boundary.
    response = await fetch(url, { headers, signal, redirect: 'manual', credentials: 'omit' });
  } catch {
    throw new TransferError('interrupted', 'Download connection interrupted');
  }
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
    throw new TransferError('forbidden', 'Download redirected');
  }
  return response;
}

function requireSuccess(response: Response) {
  if (response.ok) return;
  void response.body?.cancel().catch(() => {});
  const code = response.status === 401 || response.status === 403 ? 'forbidden'
    : response.status === 429 ? 'rate_limited' : 'network';
  throw new TransferError(code, `Download request failed (HTTP ${response.status})`);
}

export function resumeValidator(partial: Validator, expectedETag?: string) {
  if (expectedETag && partial.etag !== expectedETag) return undefined;
  if (partial.etag && !partial.etag.startsWith('W/')) return partial.etag;
  return partial.lastModified;
}

export function resumedLength(response: Response, offset: number, validator?: string) {
  const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range') ?? '');
  if (!offset || response.status !== 206 || !range) return undefined;
  const [, start, end, total] = range.map(Number);
  const etag = response.headers.get('ETag');
  const modified = response.headers.get('Last-Modified');
  if (start !== offset || !Number.isSafeInteger(total) || end !== total - 1 ||
      end < start || (validator?.startsWith('"') && etag && etag !== validator) ||
      (validator && !validator.startsWith('"') && modified && modified !== validator)) return undefined;
  return total;
}

async function transfer(
  root: () => Promise<FileSystemDirectoryHandle>,
  key: string,
  request: DownloadTransferRequest,
  live: LiveTransfer,
  emit: (event: DownloadTransferProgress) => void,
  replace: boolean,
) {
  const { serverId, viewerId, titleId } = request;
  const signal = live.abort.signal;
  let progress: DownloadTransferProgress = { serverId, viewerId, titleId, status: 'downloading', bytesWritten: 0, byteLength: request.byteLength };
  let writer: Awaited<ReturnType<typeof openOpfsWriter>> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const dir = await directory(await root(), key.split('/'), true);
    const media = 'media.' + extension(request.container, 'bin');
    const part = await dir.getFileHandle(media + '.part', { create: true });
    const metadata = media + '.part.json';
    const partial = await readJson<Validator>(dir, metadata, {});
    const validator = resumeValidator(partial, request.etag);
    let offset = !replace && validator ? (await part.getFile()).size : 0;
    const url = new URL(request.url, location.href);
    const headers = new Headers(request.headers);
    if (offset) {
      headers.set('Range', `bytes=${offset}-`);
      headers.set('If-Range', validator!);
    }
    signal.throwIfAborted();
    let response = await downloadFetch(url, headers, signal);
    let total = resumedLength(response, offset, validator);
    if (offset && (response.status === 416 || (response.status === 206 && total === undefined))) {
      await response.body?.cancel().catch(() => {});
      headers.delete('Range');
      headers.delete('If-Range');
      response = await downloadFetch(url, headers, signal);
      total = undefined;
    }
    requireSuccess(response);
    reader = response.body?.getReader();
    if (!reader || (response.status !== 200 && total === undefined))
      throw new TransferError('corrupt', 'Invalid download response');
    if (response.status === 200) offset = 0;
    const etag = response.headers.get('ETag') ?? (offset ? partial.etag : request.etag) ?? undefined;
    const lastModified = response.headers.get('Last-Modified') ?? (offset ? partial.lastModified : undefined);
    const length = Number(response.headers.get('Content-Length')) || undefined;
    const byteLength = total ?? request.byteLength ?? length;
    if (total !== undefined && request.byteLength !== undefined && total !== request.byteLength)
      throw new TransferError('corrupt', 'Download size changed');
    if (offset === 0) {
      // Clear stale bytes before publishing validators for a different representation.
      const reset = await openOpfsWriter(part, 0);
      await reset.close();
      await writeJson(dir, metadata, { etag, lastModified });
    }
    progress = { ...progress, bytesWritten: offset, byteLength, etag, lastModified };
    emit(progress);
    writer = await openOpfsWriter(part, offset);
    let checkpoint = offset;
    let interval = checkpointBytes;
    let reported = performance.now();
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        throw new TransferError('interrupted', 'Download connection interrupted');
      }
      signal.throwIfAborted();
      if (chunk.done) break;
      if (byteLength !== undefined && progress.bytesWritten + chunk.value.byteLength > byteLength)
        throw new TransferError('corrupt', 'Download exceeds its expected size');
      await writer.write(chunk.value as Uint8Array<ArrayBuffer>);
      progress = { ...progress, bytesWritten: progress.bytesWritten + chunk.value.byteLength };
      if (progress.bytesWritten - checkpoint >= interval && typeof part.createWritable === 'function') {
        await writer.close();
        writer = undefined;
        checkpoint = progress.bytesWritten;
        interval = Math.min(maximumCheckpoint, interval * 2);
        writer = await openOpfsWriter(part, checkpoint);
      }
      if (performance.now() - reported >= 200) {
        emit(progress);
        reported = performance.now();
      }
    }
    await writer.close();
    writer = undefined;
    if (byteLength !== undefined && progress.bytesWritten !== byteLength)
      throw new TransferError('interrupted', 'Download connection interrupted');

    async function auxiliary(source: string, name: string) {
      try {
        const target = new URL(source, url);
        if (target.origin !== url.origin) return undefined;
        const response = await downloadFetch(target, request.headers, signal);
        requireSuccess(response);
        const content = await response.blob();
        if (name === 'poster') {
          const type = content.type.split(';')[0]!;
          if (!Object.hasOwn(posterExtensions, type)) return undefined;
          name += '.' + posterExtensions[type];
        }
        await writeOpfsFile(await dir.getFileHandle(name, { create: true }), content);
        return key + '/' + name;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'QuotaExceededError') throw error;
        signal.throwIfAborted();
        return undefined;
      }
    }
    const posterPath = request.posterUrl ? await auxiliary(request.posterUrl, 'poster') : undefined;
    const sidecarPaths: Record<string, string> = Object.create(null);
    for (const [index, sidecar] of request.sidecars.entries()) {
      const path = await auxiliary(sidecar.url, `subtitle-${index}.${extension(sidecar.format, 'txt')}`);
      if (path) sidecarPaths[sidecar.trackId] = path;
    }
    signal.throwIfAborted();
    await publishFile(dir, part, media);
    emit({ ...progress, status: 'completed', mediaPath: key + '/' + media, posterPath, sidecarPaths });
  } catch (error) {
    let failure = error;
    try {
      if (live.stop === 'remove' || (error instanceof TransferError && error.code === 'corrupt')) await writer?.abort();
      else await writer?.close();
    } catch (closeError) {
      failure = closeError;
    }
    if (live.stop === 'remove') return;
    if (failure instanceof DOMException && failure.name === 'QuotaExceededError') {
      const neededBytes = Math.max(0, (progress.byteLength ?? 0) - progress.bytesWritten);
      emit({ ...progress, status: 'paused', errorCode: 'no_space', error: 'Not enough storage for this download', neededBytes });
    } else if (live.stop === 'pause') {
      emit({ ...progress, status: 'paused' });
    } else if (live.stop === 'interrupted' || (failure instanceof TransferError && failure.code === 'interrupted')) {
      emit({ ...progress, ...interrupted });
    } else {
      emit({ ...progress, status: 'failed', errorCode: failure instanceof TransferError ? failure.code : 'unknown',
        error: failure instanceof TransferError ? failure.message : 'Download could not be stored' });
    }
  } finally {
    await reader?.cancel().catch(() => {});
  }
}

async function saveFile(request: DownloadSaveRequest, picker?: Picker) {
  let url: URL;
  try {
    url = new URL(request.url, location.href);
  } catch {
    throw new Error('Download URL is unavailable');
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error('Download URL is unavailable');
  if (!Object.keys(request.headers).length) {
    const link = document.createElement('a');
    link.href = url.href;
    link.download = request.fileName;
    document.body.append(link);
    try { link.click(); } finally { link.remove(); }
    return;
  }
  if (!picker) throw new Error('This browser cannot save files that require authorization headers');
  let handle: FileSystemFileHandle;
  try {
    handle = await picker({ suggestedName: request.fileName });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error('Could not choose a download destination');
  }
  const response = await downloadFetch(url, request.headers);
  requireSuccess(response);
  if (!response.body) throw new Error('Download response has no body');
  try {
    await response.body.pipeTo(await handle.createWritable());
  } catch {
    await response.body.cancel().catch(() => {});
    throw new Error('Could not save the download');
  }
}

/** The OPFS port where the browser has it. */
export function browserDownloads(): DownloadsPort | undefined {
  const storage = globalThis.navigator?.storage;
  if (!storage?.getDirectory) return undefined;
  const picker = (globalThis as typeof globalThis & { showSaveFilePicker?: Picker }).showSaveFilePicker?.bind(globalThis);
  const root = async () => (await storage.getDirectory()).getDirectoryHandle('vela-downloads', { create: true });
  const listeners = new Set<(event: DownloadTransferProgress) => void>();
  const urls = new Map<string, Promise<string>>();
  const live = new Map<string, LiveTransfer>();
  let writes = Promise.resolve();
  let recordCount: number | undefined;
  const syncShell = () => {
    if (recordCount === undefined) return;
    const shell = (globalThis as typeof globalThis & { velaPwa?: OfflineShell }).velaPwa;
    syncOfflineShell(recordCount, shell);
  };

  const stop = (job: LiveTransfer, reason: NonNullable<LiveTransfer['stop']>) => {
    job.stop ??= reason;
    if (reason === 'remove') job.stop = reason;
    job.abort.abort();
    return job.done;
  };
  const interrupt = () => { for (const job of live.values()) void stop(job, 'interrupted'); };
  const start = async (request: DownloadTransferRequest, replace: boolean) => {
    const key = components([request.serverId, request.viewerId, request.titleId]).join('/');
    if (live.has(key)) return;
    const emit = (event: DownloadTransferProgress) => {
      if (event.status === 'completed') revoke(key);
      for (const listener of listeners) listener(event);
    };
    const job: LiveTransfer = { abort: new AbortController(), done: Promise.resolve() };
    live.set(key, job);
    job.done = transfer(root, key, request, job, emit, replace).finally(() => live.delete(key));
    if (navigator.onLine === false) void stop(job, 'interrupted');
  };
  const revoke = (prefix: string) => {
    for (const [path, url] of urls) if (path.startsWith(prefix + '/')) {
      urls.delete(path);
      void url.then(value => URL.revokeObjectURL(value), () => {});
    }
  };
  const remove = async (...ids: string[]) => {
    const parts = components(ids);
    const prefix = parts.join('/');
    await Promise.all([...live].filter(([key]) => key === prefix || key.startsWith(prefix + '/'))
      .map(([, job]) => stop(job, 'remove')));
    revoke(prefix);
    try {
      const parent = await directory(await root(), parts.slice(0, -1));
      await parent.removeEntry(parts.at(-1)!, { recursive: true });
    } catch (error) {
      if (!absent(error)) throw error;
    }
  };

  return {
    traits: { engine: 'page', metered: false, reserveBytes: null, reveal: false, export: false,
      minimumFreeToOffer: null, saveFile: { capability: true, headers: !!picker } },
    baseDirectoryUrl: () => 'opfs:',
    async storage() {
      const [persisted, { quota, usage }] = await Promise.all([storage.persisted(), storage.estimate()]);
      return { persisted, quotaBytes: quota ?? null, usageBytes: usage ?? null };
    },
    persist: () => storage.persist(),
    async freeBytes() {
      const { quota, usage } = await storage.estimate();
      return quota === undefined || usage === undefined ? null : Math.max(0, quota - usage);
    },
    async readSnapshot() {
      await writes;
      const dir = await root();
      const [items, outbox] = await Promise.all([
        readJson<DownloadsSnapshot['items']>(dir, 'index.json', []),
        readJson<DownloadsSnapshot['outbox']>(dir, 'outbox.json', []),
      ]);
      recordCount = items.length;
      syncShell();
      return { items: items.map(item =>
        (item.status === 'queued' || item.status === 'downloading') &&
        !live.has([item.serverId, item.viewerId, item.titleId].join('/'))
          ? { ...item, ...interrupted } : item), outbox };
    },
    writeSnapshot(snapshot) {
      const pending = writes.then(async () => {
        const dir = await root();
        await writeJson(dir, 'index.json', snapshot.items);
        await writeJson(dir, 'outbox.json', snapshot.outbox);
        recordCount = snapshot.items.length;
        syncShell();
      });
      writes = pending.catch(() => {});
      return pending;
    },
    async fileUrl(path) {
      const parts = components(path.split('/'));
      if (parts.length < 4) throw new Error('Invalid download file path');
      let pending = urls.get(path);
      if (!pending) {
        pending = (async () => {
          const dir = await directory(await root(), parts.slice(0, -1));
          return URL.createObjectURL(await (await dir.getFileHandle(parts.at(-1)!)).getFile());
        })();
        urls.set(path, pending);
        void pending.catch(() => { if (urls.get(path) === pending) urls.delete(path); });
      }
      return pending;
    },
    startTransfer: request => start(request, true),
    resumeTransfer: request => start(request, false),
    async pauseTransfer(...ids) {
      const job = live.get(components(ids).join('/'));
      if (job) await stop(job, 'pause');
    },
    removeTitle: remove,
    removeViewer: remove,
    removeServer: remove,
    subscribe(listener) {
      if (!listeners.size) {
        globalThis.addEventListener('offline', interrupt);
        globalThis.addEventListener('pagehide', interrupt);
        navigator.serviceWorker?.addEventListener('controllerchange', syncShell);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          globalThis.removeEventListener('offline', interrupt);
          globalThis.removeEventListener('pagehide', interrupt);
          navigator.serviceWorker?.removeEventListener('controllerchange', syncShell);
        }
      };
    },
    saveFile: request => saveFile(request, picker),
  };
}
