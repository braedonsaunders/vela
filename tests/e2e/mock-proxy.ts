import { spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { extname, resolve, sep } from 'node:path';

const port = Number(process.argv[2]);
const configured = process.env.VELA_E2E_SERVER;
const staticRoot = process.env.VELA_E2E_STATIC_ROOT ? resolve(process.env.VELA_E2E_STATIC_ROOT) : '';
const releaseShell = !!staticRoot && existsSync(resolve(staticRoot, 'sw.js'));
const bun = process.env.VELA_E2E_BUN ?? 'bun';

if (!Number.isInteger(port) || port < 1 || port > 65_534 || (!configured && !staticRoot)) {
  process.exitCode = 2;
  throw new Error('mock proxy requires a port and one static web source');
}

const lab = configured ? new URL(configured) : null;
if (lab && (lab.protocol !== 'http:' || !lab.hostname.startsWith('192.168.'))) {
  process.exitCode = 2;
  throw new Error('mock proxy accepts only the private-LAN HTTP Vela lab');
}

const mockPort = port + 1;
const ciPlayerDigest = '0'.repeat(64);
let lastPlaybackBody = '';
const mock = spawn(bun, ['run', 'mock-server/main.ts'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(mockPort),
    DEV_ORIGIN: `http://127.0.0.1:${port}`,
    VELA_MOCK_SILENT_MEDIA: '1',
    VELA_MOCK_DOWNLOADS: '1',
    // Keep the stock catalogue's photo dates stable in both browser runs.
    VELA_MOCK_NOW: '2026-11-26T15:00:00.000Z',
    VELA_MOCK_SPORTS_FREEZE: '1',
    VELA_MOCK_READ_FREEZE: '1',
    ...(process.env.VELA_MOCK_MEDIA_ROOT ? { VELA_MOCK_MEDIA_ROOT: process.env.VELA_MOCK_MEDIA_ROOT } : {}),
    ...(process.env.VELA_MOCK_MUSIC_ROOT ? { VELA_MOCK_MUSIC_ROOT: process.env.VELA_MOCK_MUSIC_ROOT } : {}),
    ...(process.env.VELA_MOCK_FORMATS_ROOT ? { VELA_MOCK_FORMATS_ROOT: process.env.VELA_MOCK_FORMATS_ROOT } : {}),
  },
  stdio: 'inherit',
});

mock.once('error', error => {
  console.error(`mock server could not start: ${error.message}`);
  process.exit(3);
});
mock.once('exit', code => {
  if (!closing && code !== 0) process.exit(code ?? 3);
});

function proxy(request: http.IncomingMessage, response: http.ServerResponse, target: URL, captureBody?: (body: string) => void) {
  const headers: http.IncomingHttpHeaders = { ...request.headers, host: target.host };
  delete headers.connection;
  delete headers['proxy-connection'];

  const transport = target.protocol === 'https:' ? https : http;
  const forwarded = transport.request(target, { method: request.method, headers }, incoming => {
    const responseHeaders = { ...incoming.headers };
    delete responseHeaders.connection;
    delete responseHeaders['transfer-encoding'];
    response.writeHead(incoming.statusCode ?? 502, responseHeaders);
    incoming.once('aborted', () => response.destroy());
    incoming.pipe(response);
  });
  forwarded.on('error', () => {
    if (!response.headersSent) response.writeHead(502);
    response.end();
  });
  request.on('aborted', () => forwarded.destroy());
  if (!captureBody) {
    request.pipe(forwarded);
    return;
  }
  const chunks: Buffer[] = [];
  request.on('data', chunk => chunks.push(Buffer.from(chunk)));
  request.on('end', () => {
    const body = Buffer.concat(chunks);
    captureBody(body.toString());
    forwarded.end(body);
  });
}

/**
 * A network outage between the browser and the server (`POST /__e2e/outage?seconds=12`): every open
 * connection is cut (event streams and media reads included) and, until it ends, every new one is
 * reset before it is answered, as a dropped Wi-Fi link or a restarting proxy does. Only `/__e2e/` answers.
 */
let outageUntil = 0;
const sockets = new Set<import('node:net').Socket>();

const server = http.createServer((request, response) => {
  const requested = new URL(request.url ?? '/', 'http://localhost');
  if (requested.pathname === '/__e2e/outage' && request.method === 'POST') {
    const seconds = Number(requested.searchParams.get('seconds'));
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 120) {
      response.writeHead(400).end();
      return;
    }
    outageUntil = Date.now() + seconds * 1000;
    response.writeHead(204, { Connection: 'close', 'Cache-Control': 'no-store' }).end();
    for (const socket of sockets) if (socket !== request.socket) socket.destroy();
    return;
  }
  if (Date.now() < outageUntil && !requested.pathname.startsWith('/__e2e/')) {
    request.socket.destroy();
    return;
  }
  if (requested.pathname === '/__e2e/last-playback') {
    if (request.method === 'DELETE') {
      lastPlaybackBody = '';
      response.writeHead(204).end();
      return;
    }
    if (request.method === 'GET' && lastPlaybackBody) {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(lastPlaybackBody);
      return;
    }
    response.writeHead(425, { 'Cache-Control': 'no-store' }).end();
    return;
  }
  const useMock = requested.pathname.startsWith('/vela/v0/')
    || requested.pathname.startsWith('/__admin/')
    || requested.pathname.startsWith('/sessions/media/')
    || requested.pathname.startsWith('/reading/media/');
  if (useMock) {
    request.headers['x-vela-language'] = 'en';
    request.headers['x-vela-screen-renderer'] = '19';
    const capturePlayback = request.method === 'POST' && requested.pathname === '/vela/v0/playback'
      ? (body: string) => { lastPlaybackBody = body; }
      : undefined;
    proxy(request, response, new URL(`${requested.pathname}${requested.search}`, `http://127.0.0.1:${mockPort}`), capturePlayback);
    return;
  }
  if (staticRoot && requested.pathname === '/vela/__e2e/offline-shell.js') {
    void mockOfflineShell(response);
    return;
  }
  if (!lab && !releaseShell && requested.pathname === '/vela/pwa.js') {
    response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end('export {};\n');
    return;
  }
  if (!lab && requested.pathname === `/vela/player/${ciPlayerDigest}/capabilities.json`) {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ schemaVersion: 1, embeddedSubtitleFormats: [] }));
    return;
  }
  if (lab && !releaseShell && (requested.pathname.startsWith('/vela/player/') || requested.pathname === '/vela/pwa.js')) {
    proxy(request, response, new URL(`${requested.pathname}${requested.search}`, lab.origin));
    return;
  }
  if (staticRoot) {
    void localStatic(requested.pathname, request.method ?? 'GET', response);
    return;
  }
  if (lab) {
    proxy(request, response, new URL(`${requested.pathname}${requested.search}`, lab.origin));
    return;
  }
  response.writeHead(404).end();
});

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
};

// Expo's plain CI export has no release service worker. Stage only static
// resources in this fixture: API, artwork and media still go through the network.
async function mockOfflineShell(response: http.ServerResponse) {
  try {
    const roots = ['_expo/static', 'assets'].map(path => resolve(staticRoot, path)).filter(existsSync);
    const files = (await Promise.all(roots.map(path => readdir(path, { recursive: true, withFileTypes: true })))).flat();
    const urls = files.filter(file => file.isFile()).map(file =>
      '/vela/' + resolve(file.parentPath, file.name).slice(staticRoot.length + 1)
        .split(sep).join('/'));
    const assets = ['/vela/index.html', ...urls];
    // Playwright blocks service workers' own network in an offline context,
    // so these resources must be in CacheStorage before the offline transition.
    response.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8', 'Service-Worker-Allowed': '/vela/',
      'Cache-Control': 'no-store',
    }).end(`
      const assets = ${JSON.stringify(assets)};
      const cache = caches.open('mock-downloads-shell');
      self.addEventListener('install', event => event.waitUntil(cache.then(value => value.addAll(assets)).then(() => self.skipWaiting())));
      self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
      self.addEventListener('fetch', event => {
        const { pathname, origin } = new URL(event.request.url);
        if (event.request.method !== 'GET' || origin !== self.location.origin) return;
        const shell = event.request.mode === 'navigate' && /^\\/vela\\/(?:downloads|watch\\/[^/]+)$/.test(pathname);
        if (shell || pathname.startsWith('/vela/_expo/static/') || pathname.startsWith('/vela/assets/')) {
          event.respondWith(cache.then(value => value.match(shell ? '/vela/index.html' : event.request))
            .then(cached => cached || fetch(event.request)));
        }
      });
    `);
  } catch {
    response.writeHead(500).end();
  }
}

async function localStatic(pathname: string, method: string, response: http.ServerResponse) {
  const relative = decodeURIComponent(pathname).replace(/^\/vela\/?/, '').replace(/^\/+/, '');
  let file = resolve(staticRoot, relative || 'index.html');
  if (file !== staticRoot && !file.startsWith(staticRoot + sep)) {
    response.writeHead(400).end();
    return;
  }
  const found = await stat(file).catch(() => null);
  if (!found?.isFile()) file = resolve(staticRoot, 'index.html');
  const fallback = await stat(file).catch(() => null);
  if (!fallback?.isFile()) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream',
    'Content-Length': fallback.size,
    'Cache-Control': 'no-store',
    ...(pathname === '/vela/sw.js' ? { 'Service-Worker-Allowed': '/vela' } : {}),
  });
  if (method === 'HEAD') response.end();
  else createReadStream(file).pipe(response);
}

server.on('connection', socket => {
  sockets.add(socket);
  socket.once('close', () => sockets.delete(socket));
});
server.listen(port, '127.0.0.1');

let closing = false;
const close = () => {
  if (closing) return;
  closing = true;
  server.close();
  if (mock.exitCode === null && mock.signalCode === null) mock.kill('SIGTERM');
  const finish = () => process.exit(0);
  if (mock.exitCode !== null || mock.signalCode !== null) finish();
  else mock.once('exit', finish);
  setTimeout(() => {
    if (mock.exitCode === null && mock.signalCode === null) mock.kill('SIGKILL');
  }, 5_000).unref();
};
process.once('SIGINT', close);
process.once('SIGTERM', close);
