import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { extname, resolve, sep } from 'node:path';

const port = Number(process.argv[2]);
const configured = process.env.VELA_E2E_SERVER;
const staticRoot = process.env.VELA_E2E_STATIC_ROOT ? resolve(process.env.VELA_E2E_STATIC_ROOT) : '';
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
  const headers = { ...request.headers, host: target.host };
  delete headers.connection;
  delete headers['proxy-connection'];

  const transport = target.protocol === 'https:' ? https : http;
  const forwarded = transport.request(target, { method: request.method, headers }, incoming => {
    const responseHeaders = { ...incoming.headers };
    delete responseHeaders.connection;
    delete responseHeaders['transfer-encoding'];
    response.writeHead(incoming.statusCode ?? 502, responseHeaders);
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

const server = http.createServer((request, response) => {
  const requested = new URL(request.url ?? '/', 'http://localhost');
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
    const capturePlayback = request.method === 'POST' && requested.pathname === '/vela/v0/playback'
      ? (body: string) => { lastPlaybackBody = body; }
      : undefined;
    proxy(request, response, new URL(`${requested.pathname}${requested.search}`, `http://127.0.0.1:${mockPort}`), capturePlayback);
    return;
  }
  if (!lab && requested.pathname === '/vela/pwa.js') {
    response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end('export {};\n');
    return;
  }
  if (!lab && requested.pathname === `/vela/player/${ciPlayerDigest}/capabilities.json`) {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ schemaVersion: 1, embeddedSubtitleFormats: [] }));
    return;
  }
  if (lab && (requested.pathname.startsWith('/vela/player/') || requested.pathname === '/vela/pwa.js')) {
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
  });
  if (method === 'HEAD') response.end();
  else createReadStream(file).pipe(response);
}

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
