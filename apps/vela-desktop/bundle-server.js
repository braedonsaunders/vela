'use strict';
// The app's own origin answered from the bundled web release: /vela/... from the bundle, the app's
// routes by index.html, anything else a 404.
const fs = require('node:fs');
const path = require('node:path');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4', '.txt': 'text/plain',
};

const missing = () => new Response(null, { status: 404 });

function bundleServer(root) {
  const UI = path.resolve(root);
  return async function serve(request) {
    const url = new URL(request.url);
    if (url.host !== 'app' || request.method !== 'GET' || !(url.pathname === '/vela' || url.pathname.startsWith('/vela/'))) return missing();
    let relative;
    try { relative = decodeURIComponent(url.pathname.slice('/vela'.length)).replace(/^\/+/, ''); } catch { return missing(); }
    let file = path.resolve(UI, relative);
    if (file !== UI && !file.startsWith(UI + path.sep)) return missing();
    // The PWA's service worker belongs to the web; the app's bundle is its own cache.
    if (relative === 'pwa.js' || relative === 'sw.js') return new Response('', { headers: { 'content-type': 'text/javascript' } });
    let stat = await fs.promises.stat(file).catch(() => undefined);
    if (!stat?.isFile() && !path.extname(relative)) {
      file = path.join(UI, 'index.html');
      stat = await fs.promises.stat(file).catch(() => undefined);
    }
    if (!stat?.isFile()) return missing();
    const immutable = /^(_expo\/static|assets|player)\//.test(relative);
    // A file-backed Blob, never a Node stream: Chromium cancels requests mid-body (a navigation, an
    // image replaced while loading), and Response's adapter for a Node stream then closes the
    // cancelled web stream again. That throws in the main process, whose error dialog stops the
    // app before the page can draw.
    return new Response(await fs.openAsBlob(file), {
      headers: {
        'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'content-length': String(stat.size),
        'cache-control': immutable ? 'max-age=31536000, immutable' : 'no-cache',
      },
    });
  };
}

module.exports = { bundleServer, TYPES };
