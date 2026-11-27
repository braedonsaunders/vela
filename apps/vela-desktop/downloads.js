'use strict';
// Offline downloads for the Mac and Linux app (docs/downloads.md, "Desktop"): the main process holds
// the page's DownloadsPort (apps/vela/src/data/downloads-shell.ts) over the fixed bridge in preload.js.
// Files live under userData/vela-downloads/<serverId>/<viewerId>/<titleId>/ as on iOS
// (modules/vela-player/ios/OfflineDownloads.swift): media.<ext> (streamed into media.<ext>.part and
// resumed with Range and If-Range), poster.<ext>, subtitles/<trackId>.<format>; index.json and
// outbox.json at the root, written atomically. Transfer headers stay in memory and go only to the
// request's exact origin; redirects are followed by hand within it. A transfer that dies with the app
// or the network is reported `paused`/`interrupted`, and the core resumes it with fresh credentials.
// No Electron here: main.js supplies the file manager and save dialog, so tests run in Bun.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { safeComponent, inside } = require('./downloads-paths');

const METHODS = ['readSnapshot', 'writeSnapshot', 'freeBytes', 'startTransfer', 'pauseTransfer', 'resumeTransfer',
  'removeTitle', 'removeViewer', 'removeServer', 'reveal', 'exportCopy'];
const PROGRESS_INTERVAL_MS = 250;
const RETRIES = 8;
const REDIRECTS = 5;
const AUX_LIMIT = 20 * 1024 * 1024;
const SNAPSHOT_LIMIT = 64 * 1024 * 1024;
const NETWORK_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ENETUNREACH',
  'ENETDOWN', 'EHOSTUNREACH', 'EHOSTDOWN', 'EPIPE', 'ERR_STREAM_PREMATURE_CLOSE', 'UND_ERR_SOCKET', 'ECONNCLOSED', 'EPROTO']);

const key = (serverId, viewerId, titleId) => `${serverId}/${viewerId}/${titleId}`;
const fail = (code, message, extra = {}) => Object.assign(new Error(message), { downloadCode: code, ...extra });
const backoff = attempt => Math.min(60_000, 2_000 * 2 ** Math.max(0, attempt - 1));

/** A container or subtitle format as a file extension (iOS's sanitizeExtension). */
function extension(value, fallback) {
  const cleaned = String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
  return cleaned || fallback;
}

/** An entity tag without its weak marker and quotes, for comparing the core's and the server's. */
const tagOf = value => typeof value === 'string' ? value.replace(/^W\//, '').replace(/^"|"$/g, '') : undefined;

/** Headers the page asked to send: strings only, no CR/LF, and none the transfer sets itself. */
function cleanHeaders(value) {
  const headers = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return headers;
  for (const [name, text] of Object.entries(value)) {
    if (typeof text !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n\0]/.test(text)) continue;
    if (['range', 'if-range', 'host', 'content-length', 'connection', 'transfer-encoding', 'accept-encoding'].includes(name.toLowerCase())) continue;
    headers[name] = text;
  }
  return headers;
}

function httpUrl(text) {
  if (typeof text !== 'string' || text.length > 16384) return null;
  try {
    const url = new URL(text);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password ? url : null;
  } catch { return null; }
}

/** A DownloadTransferRequest from the page, validated (iOS's parseTransferRequest). */
function parseRequest(value) {
  const request = value && typeof value === 'object' ? value : {};
  const { serverId, viewerId, titleId } = request;
  if (![serverId, viewerId, titleId].every(safeComponent)) throw new Error('Invalid download transfer request');
  const url = httpUrl(request.url);
  if (!url) throw new Error('Invalid download transfer request');
  const byteLength = Number.isSafeInteger(request.byteLength) && request.byteLength > 0 ? request.byteLength : undefined;
  const sidecars = (Array.isArray(request.sidecars) ? request.sidecars : []).flatMap(item => {
    if (!item || typeof item !== 'object' || !safeComponent(item.trackId) || item.trackId.length > 200 || !httpUrl(item.url)) return [];
    return [{ trackId: item.trackId, format: extension(item.format, 'srt'), url: item.url }];
  });
  return {
    serverId, viewerId, titleId,
    key: key(serverId, viewerId, titleId),
    url: url.href,
    headers: cleanHeaders(request.headers),
    container: extension(request.container, 'mp4'),
    byteLength,
    etag: typeof request.etag === 'string' && request.etag ? request.etag : undefined,
    posterUrl: httpUrl(request.posterUrl)?.href,
    sidecars,
  };
}

/** One HTTP(S) request with Node's client, which never follows redirects itself. */
function nodeTransport(address, { headers, signal, timeout = 60_000 }) {
  return new Promise((resolve, reject) => {
    const url = new URL(address);
    const client = url.protocol === 'https:' ? https : http;
    const request = client.request(url, { method: 'GET', headers, signal }, response => {
      resolve({ status: response.statusCode ?? 0, headers: response.headers, body: response });
    });
    // An idle socket (no bytes for a minute) is a network failure; the transfer backs off and resumes.
    request.setTimeout(timeout, () => request.destroy(Object.assign(new Error('Network timeout'), { code: 'ETIMEDOUT' })));
    request.on('error', reject);
    request.end();
  });
}

const discard = response => { try { response.body?.destroy?.(); } catch {} };
const header = (response, name) => {
  const value = response.headers?.[name];
  return Array.isArray(value) ? value[0] : typeof value === 'string' ? value : undefined;
};

function contentRange(text) {
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(text?.trim() ?? '');
  if (!match) return null;
  return { start: Number(match[1]), end: Number(match[2]), total: match[3] === '*' ? undefined : Number(match[3]) };
}

function isNetworkError(error) {
  if (!error || typeof error !== 'object') return false;
  if (NETWORK_CODES.has(error.code) || NETWORK_CODES.has(error.cause?.code)) return true;
  return /socket hang up|aborted|premature close|network/i.test(String(error.message ?? ''));
}

async function writeAtomically(file, data) {
  const temp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  const handle = await fs.promises.open(temp, 'w', 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally { await handle.close(); }
  try { await fs.promises.rename(temp, file); } catch (error) { await fs.promises.rm(temp, { force: true }); throw error; }
  await syncDirectory(path.dirname(file));
}

async function syncDirectory(directory) {
  // Durability of the rename itself; Windows and some file systems refuse directory handles.
  try { const handle = await fs.promises.open(directory, 'r'); try { await handle.sync(); } finally { await handle.close(); } } catch {}
}

async function readJSON(file) {
  try {
    const stat = await fs.promises.stat(file);
    if (stat.size > SNAPSHOT_LIMIT) return undefined;
    return JSON.parse(await fs.promises.readFile(file, 'utf8'));
  } catch { return undefined; }
}

const sizeOf = file => fs.promises.stat(file).then(stat => stat.size, () => 0);

/** The image type of a poster's first bytes: JPEG, PNG, WebP or SVG (as iOS keeps); anything else is dropped.
 * The download route serves every stored file under a sandboxing CSP, so an SVG never runs script. */
function imageExtension(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  const head = bytes.subarray(0, 512).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) return 'svg';
  return null;
}

/** A save-dialog file name from the page: one name, no separators or control characters. */
function exportName(value, container) {
  const base = String(typeof value === 'string' ? value : '').replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 180).trim();
  return base || `Video.${container || 'mkv'}`;
}

class Downloads {
  /**
   * @param {{ root: string, emit?: (event: object) => void, transport?: typeof nodeTransport,
   *   revealFile?: (file: string) => void, chooseSaveFile?: (name: string) => Promise<string | null | undefined>,
   *   delay?: (attempt: number) => number }} options
   */
  constructor({ root, emit = () => {}, transport = nodeTransport, revealFile, chooseSaveFile, delay = backoff }) {
    this.root = path.resolve(root);
    this.emit = emit;
    this.transport = transport;
    this.revealFile = revealFile;
    this.chooseSaveFile = chooseSaveFile;
    this.delay = delay;
    /** Live transfers by key: queued, running, or waiting to retry. Headers live only here. */
    this.transfers = new Map();
    this.active = null;
    this.writes = Promise.resolve();
    this.closed = false;
  }

  titleDir(serverId, viewerId, titleId) {
    const parts = [serverId, viewerId, titleId].filter(part => part !== undefined);
    if (!parts.length || !parts.every(safeComponent)) throw new Error('Invalid download path');
    const directory = path.join(this.root, ...parts);
    if (!inside(this.root, directory)) throw new Error('Invalid download path');
    return directory;
  }

  async ensureRoot() {
    await fs.promises.mkdir(this.root, { recursive: true, mode: 0o700 });
  }

  // ---- The port ----

  async readSnapshot() {
    await this.ensureRoot();
    const records = await readJSON(path.join(this.root, 'index.json'));
    const outbox = await readJSON(path.join(this.root, 'outbox.json'));
    const items = [];
    for (const record of Array.isArray(records) ? records : []) {
      if (!record || typeof record !== 'object' || ![record.serverId, record.viewerId, record.titleId].every(safeComponent)) {
        items.push(record);
        continue;
      }
      const directory = this.titleDir(record.serverId, record.viewerId, record.titleId);
      // An event the page never heard (it reloaded, or quit) is kept beside the files, as on iOS.
      const event = await readJSON(path.join(directory, 'transfer-status.json'));
      let item = event && typeof event === 'object' && event.titleId === record.titleId ? { ...record, ...event } : { ...record };
      if (event?.status === 'completed') {
        delete item.previousCompleted; delete item.error; delete item.errorCode; delete item.neededBytes;
      }
      if ((item.status === 'queued' || item.status === 'downloading') && !this.transfers.has(key(item.serverId, item.viewerId, item.titleId))) {
        const container = extension(item.container, 'mp4');
        item = {
          ...item, status: 'paused', errorCode: 'interrupted', error: 'The download stopped when Vela closed. It resumes when you are online.',
          bytesWritten: await sizeOf(path.join(directory, `media.${container}.part`)),
        };
        delete item.neededBytes;
      }
      items.push(item);
    }
    return { items, outbox: Array.isArray(outbox) ? outbox : [] };
  }

  writeSnapshot(snapshot) {
    const value = snapshot && typeof snapshot === 'object' ? snapshot : {};
    if (!Array.isArray(value.items) || !Array.isArray(value.outbox)) return Promise.reject(new Error('Invalid downloads snapshot'));
    const items = JSON.stringify(value.items);
    const outbox = JSON.stringify(value.outbox);
    if (items.length + outbox.length > SNAPSHOT_LIMIT) return Promise.reject(new Error('Downloads index is too large'));
    // One write at a time, in order, so an older snapshot never lands after a newer one.
    const write = this.writes.then(async () => {
      await this.ensureRoot();
      await writeAtomically(path.join(this.root, 'index.json'), items);
      await writeAtomically(path.join(this.root, 'outbox.json'), outbox);
    });
    this.writes = write.catch(() => {});
    return write;
  }

  async freeBytes() {
    await this.ensureRoot();
    try {
      const stat = await fs.promises.statfs(this.root);
      const free = Number(stat.bavail) * Number(stat.bsize);
      return Number.isFinite(free) && free >= 0 ? free : null;
    } catch { return null; }
  }

  async startTransfer(value) {
    const request = parseRequest(value);
    await this.launch(request, false);
  }

  async resumeTransfer(value) {
    const request = parseRequest(value);
    await this.launch(request, true);
  }

  async pauseTransfer(serverId, viewerId, titleId) {
    const directory = this.titleDir(serverId, viewerId, titleId);
    const transfer = this.transfers.get(key(serverId, viewerId, titleId));
    if (!transfer) return;
    await this.cancel(transfer);
    const bytesWritten = await sizeOf(path.join(directory, `media.${transfer.container}.part`));
    await this.report(transfer, { status: 'paused', bytesWritten, ...(transfer.total ? { byteLength: transfer.total } : {}) });
  }

  async removeTitle(serverId, viewerId, titleId) {
    await this.removeTree([serverId, viewerId, titleId]);
  }

  async removeViewer(serverId, viewerId) {
    await this.removeTree([serverId, viewerId]);
  }

  async removeServer(serverId) {
    await this.removeTree([serverId]);
  }

  async reveal(serverId, viewerId, titleId) {
    const file = await this.mediaFile(serverId, viewerId, titleId);
    if (!file) throw new Error('This download is not stored on this computer');
    this.revealFile?.(file);
  }

  async exportCopy(serverId, viewerId, titleId, fileName) {
    const file = await this.mediaFile(serverId, viewerId, titleId);
    if (!file) throw new Error('This download is not stored on this computer');
    const container = path.extname(file).slice(1);
    const target = await this.chooseSaveFile?.(exportName(fileName, container));
    if (typeof target !== 'string' || !target) return false;
    const destination = path.resolve(target);
    const realRoot = await fs.promises.realpath(this.root);
    const parent = await fs.promises.realpath(path.dirname(destination)).catch(() => path.dirname(destination));
    if (parent === realRoot || inside(realRoot, parent)) throw new Error('Choose a folder outside Vela\'s downloads');
    try {
      await pipeline(fs.createReadStream(file), fs.createWriteStream(destination));
    } catch (error) {
      await fs.promises.rm(destination, { force: true }).catch(() => {});
      throw new Error(error?.code === 'ENOSPC' ? 'There is not enough free space to save a copy there' : 'The copy could not be saved');
    }
    return true;
  }

  /** The app is quitting: stop every transfer (its `.part` stays) without reporting; the next launch reports them interrupted. */
  async shutdown() {
    this.closed = true;
    await Promise.all([...this.transfers.values()].map(transfer => this.cancel(transfer)));
  }

  // ---- Transfers ----

  async launch(request, resume) {
    if (this.closed) throw new Error('Vela is closing');
    const previous = this.transfers.get(request.key);
    if (previous) await this.cancel(previous);
    const directory = this.titleDir(request.serverId, request.viewerId, request.titleId);
    await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.promises.rm(path.join(directory, 'transfer-status.json'), { force: true });
    const transfer = { ...request, directory, resume, state: 'queued', attempts: 0, total: request.byteLength, cancelled: false };
    this.transfers.set(request.key, transfer);
    this.pump();
  }

  /** One transfer at a time, in the order they were asked for. */
  pump() {
    if (this.active || this.closed) return;
    const next = [...this.transfers.values()].find(transfer => transfer.state === 'queued');
    if (!next) return;
    this.active = next;
    next.state = 'running';
    next.controller = new AbortController();
    next.running = this.run(next).finally(() => {
      if (this.active === next) this.active = null;
      this.pump();
    });
  }

  async cancel(transfer) {
    transfer.cancelled = true;
    clearTimeout(transfer.timer);
    transfer.controller?.abort();
    if (this.transfers.get(transfer.key) === transfer) this.transfers.delete(transfer.key);
    await transfer.running?.catch(() => {});
  }

  async removeTree(parts) {
    const directory = this.titleDir(...parts);
    const prefix = parts.join('/') + '/';
    await Promise.all([...this.transfers.values()].filter(transfer => (transfer.key + '/').startsWith(prefix)).map(transfer => this.cancel(transfer)));
    await fs.promises.rm(directory, { recursive: true, force: true });
  }

  async mediaFile(serverId, viewerId, titleId) {
    const directory = this.titleDir(serverId, viewerId, titleId);
    const names = await fs.promises.readdir(directory).catch(() => []);
    const name = names.find(entry => /^media\.[a-z0-9]{1,12}$/.test(entry));
    if (!name) return null;
    const file = path.join(directory, name);
    const real = await fs.promises.realpath(file).catch(() => null);
    const realRoot = await fs.promises.realpath(this.root).catch(() => null);
    return real && realRoot && inside(realRoot, real) && (await fs.promises.stat(real)).isFile() ? real : null;
  }

  live(transfer) {
    return !transfer.cancelled && !this.closed && this.transfers.get(transfer.key) === transfer;
  }

  /** Report a transfer's event, keeping every settled one beside its files for a page that missed it. */
  async report(transfer, fields) {
    const event = { serverId: transfer.serverId, viewerId: transfer.viewerId, titleId: transfer.titleId, ...fields };
    if (event.status !== 'downloading') {
      try { await writeAtomically(path.join(transfer.directory, 'transfer-status.json'), JSON.stringify(event)); } catch {}
    }
    try { this.emit(event); } catch {}
  }

  /** GET with the transfer's headers, following redirects by hand within the exact origin. */
  async fetchScoped(address, headers, signal, timeout) {
    const origin = new URL(address).origin;
    let current = address;
    for (let hop = 0; ; hop++) {
      const response = await this.transport(current, { headers, signal, timeout });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      discard(response);
      const location = header(response, 'location');
      let next;
      try { next = location ? new URL(location, current) : null; } catch { next = null; }
      if (!next || !httpUrl(next.href)) throw fail('unknown', 'The server answered the download with an invalid redirect');
      if (next.origin !== origin) throw fail('unknown', 'The server sent the download to another address, so Vela stopped it');
      if (hop >= REDIRECTS) throw fail('unknown', 'The server redirected the download too many times');
      current = next.href;
    }
  }

  async run(transfer) {
    try {
      await this.transferMedia(transfer);
    } catch (error) {
      if (!this.live(transfer)) return;
      if (error?.downloadCode === 'restart') {
        // The partial file belongs to another version of the original: start again from the first byte.
        transfer.resume = false;
        transfer.state = 'queued';
        return;
      }
      if (error?.downloadCode === undefined && error?.code === 'ENOSPC') {
        const written = await sizeOf(this.partOf(transfer));
        return this.noSpace(transfer, written);
      }
      if (error?.downloadCode === 'no_space') return this.noSpace(transfer, error.bytesWritten ?? 0);
      if ((error?.downloadCode === 'network' && !error.final) || (error?.downloadCode === undefined && isNetworkError(error))) return this.retry(transfer);
      const code = error?.downloadCode ?? 'unknown';
      const message = error?.downloadCode ? error.message : 'The download could not be saved';
      this.transfers.delete(transfer.key);
      await this.report(transfer, {
        status: 'failed', bytesWritten: await sizeOf(this.partOf(transfer)), ...(transfer.total ? { byteLength: transfer.total } : {}),
        error: message, errorCode: code,
      });
    }
  }

  partOf(transfer) {
    return path.join(transfer.directory, `media.${transfer.container}.part`);
  }

  async noSpace(transfer, written) {
    this.transfers.delete(transfer.key);
    // The core pauses every other queued title for space; so does the queue here.
    for (const other of [...this.transfers.values()]) if (other.state === 'queued' || other.state === 'waiting') await this.cancel(other);
    const neededBytes = transfer.total ? Math.max(0, transfer.total - written) : undefined;
    await this.report(transfer, {
      status: 'failed', bytesWritten: written, ...(transfer.total ? { byteLength: transfer.total } : {}),
      error: 'Not enough free storage space to finish downloading', errorCode: 'no_space', ...(neededBytes ? { neededBytes } : {}),
    });
  }

  /** A network failure: wait (2 s doubling to 60 s) and resume from the partial file; after that, leave it to the core. */
  async retry(transfer) {
    transfer.attempts += 1;
    const bytesWritten = await sizeOf(this.partOf(transfer));
    const byteLength = transfer.total ? { byteLength: transfer.total } : {};
    if (transfer.attempts > RETRIES) {
      this.transfers.delete(transfer.key);
      await this.report(transfer, { status: 'paused', bytesWritten, ...byteLength, errorCode: 'interrupted', error: 'The download was interrupted. It resumes when you are online.' });
      return;
    }
    transfer.state = 'waiting';
    transfer.resume = true;
    await this.report(transfer, { status: 'paused', bytesWritten, ...byteLength, errorCode: 'interrupted', error: 'Waiting for the network to continue the download' });
    if (!this.live(transfer)) return;
    transfer.timer = setTimeout(() => {
      if (!this.live(transfer) || transfer.state !== 'waiting') return;
      transfer.state = 'queued';
      this.pump();
    }, this.delay(transfer.attempts));
    transfer.timer.unref?.();
  }

  async transferMedia(transfer) {
    const signal = transfer.controller.signal;
    const part = this.partOf(transfer);
    const final = path.join(transfer.directory, `media.${transfer.container}`);
    const pinFile = path.join(transfer.directory, 'transfer.json');
    // What the partial file is a copy of (never a URL or header): its container, size and validators.
    const pin = await readJSON(pinFile);
    let existing = await sizeOf(part);
    const sameFile = pin && pin.container === transfer.container
      && (!transfer.etag || !pin.etag || tagOf(transfer.etag) === tagOf(pin.etag))
      && (!transfer.byteLength || !pin.byteLength || transfer.byteLength === pin.byteLength);
    const validator = pin?.etag && !/^W\//.test(pin.etag) ? pin.etag : pin?.lastModified;
    const resuming = transfer.resume && existing > 0 && sameFile && !!validator;
    if (!resuming) {
      await fs.promises.rm(part, { force: true });
      existing = 0;
    }
    const headers = { ...transfer.headers, 'Accept-Encoding': 'identity' };
    if (resuming) { headers.Range = `bytes=${existing}-`; headers['If-Range'] = validator; }
    if (!this.live(transfer)) return;
    await this.report(transfer, { status: 'downloading', bytesWritten: existing, ...(transfer.total ? { byteLength: transfer.total } : {}) });

    const response = await this.fetchScoped(transfer.url, headers, signal);
    const status = response.status;
    if (status === 416 && resuming) {
      discard(response);
      // The partial file is already whole: finish it. Otherwise it is not this file any more.
      if (pin?.byteLength && existing === pin.byteLength) return this.finish(transfer, part, final, pinFile, existing, pin);
      throw fail('restart', 'restart');
    }
    if (status === 401 || status === 403) { discard(response); throw fail('forbidden', 'Downloads are not allowed for this title or account'); }
    if (status === 429) { discard(response); throw fail('rate_limited', 'Download limit reached; please try again later'); }
    if (status === 408 || status >= 500) { discard(response); throw fail('network', `Server answered with HTTP ${status}`); }
    if (status !== 200 && status !== 206) { discard(response); throw fail('network', `Server answered with HTTP ${status}`, { final: true }); }
    const etag = header(response, 'etag');
    const lastModified = header(response, 'last-modified');
    if (transfer.etag && etag && tagOf(transfer.etag) !== tagOf(etag)) {
      discard(response);
      throw fail('corrupt', 'The original file changed. Retry to get a fresh download.');
    }
    let offset = 0;
    let total;
    if (status === 206) {
      const range = contentRange(header(response, 'content-range'));
      if (!resuming) { discard(response); throw fail('corrupt', 'The server returned part of the file. Retry the download.'); }
      if (!range || range.start !== existing) { discard(response); throw fail('restart', 'restart'); }
      if (pin?.etag && etag && tagOf(pin.etag) !== tagOf(etag)) { discard(response); throw fail('restart', 'restart'); }
      offset = existing;
      total = range.total;
    } else {
      const length = Number(header(response, 'content-length'));
      total = Number.isSafeInteger(length) && length > 0 ? length : undefined;
    }
    total = transfer.byteLength ?? total;
    transfer.total = total;
    if (!this.live(transfer)) { discard(response); return; }
    await writeAtomically(pinFile, JSON.stringify({ container: transfer.container, byteLength: total, etag: etag ?? transfer.etag, lastModified }));

    let written = offset;
    let lastEmit = 0;
    const counter = new Transform({
      transform: (chunk, _encoding, callback) => {
        written += chunk.length;
        if (total && written > total) { callback(fail('corrupt', 'The server sent more than the whole file. Retry the download.')); return; }
        const now = Date.now();
        if (now - lastEmit >= PROGRESS_INTERVAL_MS && this.live(transfer)) {
          lastEmit = now;
          void this.report(transfer, { status: 'downloading', bytesWritten: written, ...(total ? { byteLength: total } : {}) });
        }
        callback(null, chunk);
      },
    });
    try {
      await pipeline(response.body, counter, fs.createWriteStream(part, { flags: offset > 0 ? 'a' : 'w', mode: 0o600 }), { signal });
    } catch (error) {
      if (error?.code === 'ENOSPC') throw fail('no_space', 'Not enough free storage space', { bytesWritten: written });
      throw error;
    }
    if (!this.live(transfer)) return;
    const actual = await sizeOf(part);
    if (total && actual < total) throw fail('network', 'The connection closed before the whole file arrived');
    if (actual <= 0 || (total && actual !== total)) {
      await fs.promises.rm(part, { force: true });
      throw fail('corrupt', `The downloaded file was incomplete (${actual} of ${total ?? 0} bytes)`);
    }
    return this.finish(transfer, part, final, pinFile, actual, { etag: etag ?? transfer.etag ?? pin?.etag, lastModified: lastModified ?? pin?.lastModified });
  }

  async finish(transfer, part, final, pinFile, size, validators) {
    const handle = await fs.promises.open(part, 'r+');
    try { await handle.sync(); } finally { await handle.close(); }
    if (!this.live(transfer)) return;
    await fs.promises.rename(part, final);
    await syncDirectory(transfer.directory);
    await fs.promises.rm(pinFile, { force: true });
    const posterPath = await this.fetchPoster(transfer).catch(() => undefined);
    const sidecarPaths = await this.fetchSidecars(transfer).catch(() => ({}));
    if (!this.live(transfer)) return;
    this.transfers.delete(transfer.key);
    const relative = name => `${transfer.serverId}/${transfer.viewerId}/${transfer.titleId}/${name}`;
    await this.report(transfer, {
      status: 'completed', bytesWritten: size, byteLength: size, mediaPath: relative(path.basename(final)),
      ...(validators?.etag ? { etag: validators.etag } : {}),
      ...(validators?.lastModified ? { lastModified: validators.lastModified } : {}),
      ...(posterPath ? { posterPath } : {}),
      ...(Object.keys(sidecarPaths).length ? { sidecarPaths } : {}),
    });
  }

  /** A poster or sidecar: the transfer's headers only on its exact origin, redirects within that origin, a size cap. */
  async fetchAuxiliary(transfer, address) {
    const url = httpUrl(address);
    if (!url) return null;
    const headers = url.origin === new URL(transfer.url).origin ? { ...transfer.headers } : {};
    const response = await this.fetchScoped(url.href, headers, transfer.controller.signal, 20_000);
    if (response.status < 200 || response.status >= 300) { discard(response); return null; }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > AUX_LIMIT) { discard(response); return null; }
      chunks.push(chunk);
    }
    return size ? Buffer.concat(chunks) : null;
  }

  async fetchPoster(transfer) {
    if (!transfer.posterUrl) return undefined;
    const bytes = await this.fetchAuxiliary(transfer, transfer.posterUrl);
    const type = bytes && imageExtension(bytes);
    if (!type || !this.live(transfer)) return undefined;
    const name = `poster.${type}`;
    await writeAtomically(path.join(transfer.directory, name), bytes);
    return `${transfer.serverId}/${transfer.viewerId}/${transfer.titleId}/${name}`;
  }

  async fetchSidecars(transfer) {
    const out = {};
    if (!transfer.sidecars.length) return out;
    const directory = path.join(transfer.directory, 'subtitles');
    await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
    for (const sidecar of transfer.sidecars) {
      if (!this.live(transfer)) break;
      const bytes = await this.fetchAuxiliary(transfer, sidecar.url).catch(() => null);
      if (!bytes) continue;
      const name = `${sidecar.trackId}.${sidecar.format}`;
      await writeAtomically(path.join(directory, name), bytes);
      out[sidecar.trackId] = `${transfer.serverId}/${transfer.viewerId}/${transfer.titleId}/subtitles/${name}`;
    }
    return out;
  }
}

/** One bridge call from the trusted page: an allowlisted method with validated arguments. */
async function dispatch(downloads, method, args) {
  if (typeof method !== 'string' || !METHODS.includes(method)) throw new Error('Unknown downloads method');
  const list = Array.isArray(args) ? args : [];
  const ids = count => {
    const values = list.slice(0, count);
    if (values.length !== count || !values.every(safeComponent)) throw new Error('Invalid download');
    return values;
  };
  switch (method) {
    case 'readSnapshot': return downloads.readSnapshot();
    case 'writeSnapshot': return downloads.writeSnapshot(list[0]);
    case 'freeBytes': return downloads.freeBytes();
    case 'startTransfer': return downloads.startTransfer(list[0]);
    case 'resumeTransfer': return downloads.resumeTransfer(list[0]);
    case 'pauseTransfer': return downloads.pauseTransfer(...ids(3));
    case 'removeTitle': return downloads.removeTitle(...ids(3));
    case 'removeViewer': return downloads.removeViewer(...ids(2));
    case 'removeServer': return downloads.removeServer(...ids(1));
    case 'reveal': return downloads.reveal(...ids(3));
    case 'exportCopy': {
      const [serverId, viewerId, titleId] = ids(3);
      return downloads.exportCopy(serverId, viewerId, titleId, typeof list[3] === 'string' ? list[3] : '');
    }
  }
}

module.exports = { Downloads, dispatch, parseRequest, cleanHeaders, exportName, imageExtension, nodeTransport, METHODS, backoff };
