'use strict';
// Offline downloads' files on disk (docs/downloads.md, "Local file routes"): every way from a URL or an
// index path to a stored file goes through here. A path is decoded, refused when it could leave its
// folder (`..`, `.`, empty segments, backslashes, NULs, drive letters, encoded separators), joined
// under the downloads root, resolved through symlinks, and must still lie inside the resolved root.
// No Electron here, so the shell's route, the downloader and both native hosts share it and tests run in Bun.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/** The page's base for stored files; `vela-app://app/vela-downloads/<serverId>/<viewerId>/<titleId>/<file>`. */
const DOWNLOADS_BASE = 'vela-app://app/vela-downloads/';
const ROUTE_PREFIX = '/vela-downloads/';

/** `userData/vela-downloads`, beside the rest of the app's data (VELA_DATA_DIR moves userData). */
function downloadsRoot(userData) {
  return path.join(userData, 'vela-downloads');
}

/** One server, viewer, title or track ID used as a directory or file name. */
function safeComponent(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 255 && value !== '.' && value !== '..'
    && !/[/\\]/.test(value) && !/[\u0000-\u001f\u007f]/.test(value) && !/^[a-z]:$/i.test(value);
}

/** Segments of a decoded relative path, or null when any could leave its folder. */
function segmentsOf(relative) {
  if (typeof relative !== 'string' || !relative) return null;
  const segments = relative.split('/');
  return segments.every(safeComponent) ? segments : null;
}

/** The decoded segments of a route path after `/vela-downloads/`, refusing encoded separators before decoding. */
function routeSegments(encoded) {
  if (typeof encoded !== 'string' || !encoded || /%(?:2f|5c|00|2e)/i.test(encoded) || encoded.includes('\\')) return null;
  let decoded;
  try { decoded = encoded.split('/').map(decodeURIComponent); } catch { return null; }
  return decoded.every(safeComponent) ? decoded : null;
}

/** Whether `file` lies strictly inside `root` (both already resolved). */
function inside(root, file) {
  const relative = path.relative(root, file);
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * The stored file `segments` names under `root`, through symlinks, or null when it is missing, not a
 * regular file, or resolves outside the root. Only `<serverId>/<viewerId>/<titleId>/…` paths name files:
 * the root's own index, outbox and in-progress `.part` files are never served.
 */
function storedFileSync(root, segments) {
  if (!segments || segments.length < 4) return null;
  const name = segments[segments.length - 1];
  if (name.endsWith('.part') || name === 'transfer.json' || name === 'transfer-status.json') return null;
  try {
    const realRoot = fs.realpathSync(root);
    const real = fs.realpathSync(path.join(realRoot, ...segments));
    if (!inside(realRoot, real) || !fs.statSync(real).isFile()) return null;
    return real;
  } catch { return null; }
}

async function storedFile(root, segments) {
  if (!segments || segments.length < 4) return null;
  const name = segments[segments.length - 1];
  if (name.endsWith('.part') || name === 'transfer.json' || name === 'transfer-status.json') return null;
  try {
    const realRoot = await fs.promises.realpath(root);
    const real = await fs.promises.realpath(path.join(realRoot, ...segments));
    if (!inside(realRoot, real) || !(await fs.promises.stat(real)).isFile()) return null;
    return real;
  } catch { return null; }
}

/** The encoded part of a `vela-app://app/vela-downloads/…` URL, or null for any other URL. */
function downloadRouteOf(address) {
  let url;
  try { url = new URL(address); } catch { return null; }
  if (url.protocol !== 'vela-app:' || url.host !== 'app' || url.username || url.password || url.search || url.hash) return null;
  if (!url.pathname.startsWith(ROUTE_PREFIX)) return null;
  // URL parsing already collapsed dot segments; refuse any that were spelled in the original.
  const raw = String(address).replace(/^vela-app:\/\/app/i, '').split(/[?#]/)[0];
  if (raw !== url.pathname) return null;
  return url.pathname.slice(ROUTE_PREFIX.length);
}

/** The validated local path a `vela-app://app/vela-downloads/…` URL names, or null. */
function localDownloadPath(root, address) {
  const route = downloadRouteOf(address);
  return route === null ? null : storedFileSync(root, routeSegments(route));
}

/**
 * Native hosts open a downloaded file from disk, never through a grant. Rewrites a plan's media and
 * sidecar URLs on the shell's download route to `file://` URLs of their validated local files. A plan
 * that already names `file:` (or any scheme but http, https and the download route) came from somewhere
 * other than this mapping and is refused, as is a download URL whose file is not stored.
 */
function localizePlayback(props, root) {
  if (!props || typeof props !== 'object' || !props.plan || typeof props.plan !== 'object') return props;
  const map = address => {
    if (typeof address !== 'string' || !address) return address;
    if (/^vela-app:/i.test(address)) {
      const file = localDownloadPath(root, address);
      if (!file) throw new Error('Downloaded file unavailable');
      return pathToFileURL(file).href;
    }
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(address)?.[1]?.toLowerCase();
    if (scheme && scheme !== 'http' && scheme !== 'https') throw new Error('Invalid URL');
    return address;
  };
  const plan = props.plan;
  const paths = Array.isArray(plan.paths) ? plan.paths.map(item => item && typeof item === 'object' && 'url' in item ? { ...item, url: map(item.url) } : item) : plan.paths;
  const subtitleTracks = Array.isArray(plan.subtitleTracks) ? plan.subtitleTracks.map(track => {
    if (!track || typeof track !== 'object') return track;
    const next = { ...track };
    if ('url' in next) next.url = map(next.url);
    if (next.delivery && typeof next.delivery === 'object' && 'url' in next.delivery) next.delivery = { ...next.delivery, url: map(next.delivery.url) };
    return next;
  }) : plan.subtitleTracks;
  return { ...props, plan: { ...plan, paths, subtitleTracks } };
}

/** The validated local path of a `file:` URL that `localizePlayback` produced, or null. */
function localFileOf(root, address) {
  if (typeof address !== 'string' || !/^file:/i.test(address)) return null;
  let file;
  try { file = require('node:url').fileURLToPath(address); } catch { return null; }
  try {
    const realRoot = fs.realpathSync(root);
    const real = fs.realpathSync(file);
    if (!inside(realRoot, real) || !fs.statSync(real).isFile()) return null;
    const segments = path.relative(realRoot, real).split(path.sep);
    return storedFileSync(realRoot, segments) === real ? real : null;
  } catch { return null; }
}

const TYPES = {
  '.mkv': 'video/x-matroska', '.mk3d': 'video/x-matroska', '.mka': 'audio/x-matroska', '.mp4': 'video/mp4', '.m4v': 'video/mp4',
  '.mov': 'video/quicktime', '.webm': 'video/webm', '.ts': 'video/mp2t', '.m2ts': 'video/mp2t', '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg',
  '.vtt': 'text/vtt; charset=utf-8', '.webvtt': 'text/vtt; charset=utf-8', '.srt': 'application/x-subrip; charset=utf-8',
  '.ass': 'text/x-ssa; charset=utf-8', '.ssa': 'text/x-ssa; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
};
function contentType(file) {
  return TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

/**
 * A single `Range: bytes=` request against a file of `size` bytes: `{start, end}` (inclusive), `null` for
 * no (or an ignorable) range, or `'unsatisfiable'`. Multiple ranges are answered whole, as servers may.
 */
function parseRange(header, size) {
  if (typeof header !== 'string' || !header.trim()) return null;
  const match = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (suffix === 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (match[2] && Number(match[2]) < start) return null;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || size === 0) return 'unsatisfiable';
  return { start, end };
}

/**
 * `vela-app://app/vela-downloads/<rel>` answered from `root` with byte ranges, for the page's images
 * and subtitles and the web engine when there is no native host. Anything not stored is a 404.
 */
function downloadsRoute(root) {
  return async function serve(request) {
    const missing = () => new Response(null, { status: 404 });
    if (request.method !== 'GET' && request.method !== 'HEAD') return missing();
    const route = downloadRouteOf(request.url);
    if (route === null) return missing();
    const file = await storedFile(root, routeSegments(route));
    if (!file) return missing();
    const stat = await fs.promises.stat(file).catch(() => undefined);
    if (!stat?.isFile()) return missing();
    const headers = {
      'content-type': contentType(file),
      'accept-ranges': 'bytes',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    };
    const range = parseRange(request.headers.get('range'), stat.size);
    if (range === 'unsatisfiable') {
      return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${stat.size}` } });
    }
    const head = request.method === 'HEAD';
    // A file-backed Blob (and slices of it), never a Node stream: see bundle-server.js.
    const blob = head ? null : await fs.openAsBlob(file);
    if (range) {
      return new Response(blob ? blob.slice(range.start, range.end + 1) : null, {
        status: 206,
        headers: { ...headers, 'content-range': `bytes ${range.start}-${range.end}/${stat.size}`, 'content-length': String(range.end - range.start + 1) },
      });
    }
    return new Response(blob, { status: 200, headers: { ...headers, 'content-length': String(stat.size) } });
  };
}

module.exports = {
  DOWNLOADS_BASE, downloadsRoot, safeComponent, segmentsOf, routeSegments, downloadRouteOf, storedFile, storedFileSync,
  localDownloadPath, localizePlayback, localFileOf, parseRange, contentType, downloadsRoute, inside,
};
