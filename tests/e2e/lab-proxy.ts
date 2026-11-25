import http from 'node:http';
import https from 'node:https';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const port = Number(process.argv[2]);
const configured = process.env.VELA_E2E_SERVER;
const plexTokenFile = process.env.VELA_E2E_PLEX_TOKEN_FILE ?? '';
const plexSecretPath = process.env.VELA_E2E_PLEX_SECRET_PATH ?? '';
const sessionDir = process.env.VELA_E2E_SESSION_DIR ?? '';

if (!Number.isInteger(port) || port < 1 || port > 65_535 || !configured) {
  process.exitCode = 2;
  throw new Error('lab proxy requires a port and VELA_E2E_SERVER');
}

const upstream = new URL(configured);
if (upstream.protocol !== 'http:' || !upstream.hostname.startsWith('192.168.')) {
  process.exitCode = 2;
  throw new Error('lab proxy accepts only the private-LAN HTTP Vela lab');
}

let grant: { accessToken: string; refreshToken: string } | null = null;
let device: unknown = null;
let plexReads = 0;
let bootstrapRowNames: string[] | null = null;

const server = http.createServer((request, response) => {
  const requested = new URL(request.url ?? '/', 'http://localhost');
  if (plexSecretPath && requested.pathname === plexSecretPath) {
    void sendPlexToken(request, response);
    return;
  }
  if (request.method === 'GET' && requested.pathname === '/__e2e/bootstrap-row-names') {
    const body = JSON.stringify(bootstrapRowNames ?? []);
    response.writeHead(bootstrapRowNames ? 200 : 425, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(body),
    });
    response.end(body);
    return;
  }
  const target = new URL(`${requested.pathname}${requested.search}`, upstream.origin);
  const capturesAuthRequest = request.method === 'POST'
    && (requested.pathname === '/vela/v0/auth/sign-in' || requested.pathname === '/vela/v0/auth/refresh');
  const headers = { ...request.headers, host: target.host };
  delete headers.connection;
  delete headers['proxy-connection'];

  const transport = target.protocol === 'https:' ? https : http;
  const forwarded = transport.request(target, {
    method: request.method,
    headers,
  }, incoming => {
    const responseHeaders = { ...incoming.headers };
    delete responseHeaders.connection;
    delete responseHeaders['transfer-encoding'];
    const capturesGrant = request.method === 'POST'
      && (requested.pathname === '/vela/v0/auth/sign-in' || requested.pathname === '/vela/v0/auth/refresh');
    const capturesBootstrap = request.method === 'GET' && requested.pathname === '/vela/v0/bootstrap';
    if (!capturesGrant && !capturesBootstrap) {
      response.writeHead(incoming.statusCode ?? 502, responseHeaders);
      incoming.pipe(response);
      return;
    }
    const chunks: Buffer[] = [];
    incoming.on('data', chunk => chunks.push(Buffer.from(chunk)));
    incoming.on('end', () => {
      const body = Buffer.concat(chunks);
      if ((incoming.statusCode ?? 500) < 300) {
        try {
          const value = JSON.parse(body.toString()) as {
            accessToken?: unknown;
            refreshToken?: unknown;
            rows?: { name?: unknown; items?: unknown[] }[];
          };
          if (capturesGrant && typeof value.accessToken === 'string' && typeof value.refreshToken === 'string') grant = value as typeof grant;
          if (capturesBootstrap && Array.isArray(value.rows)) {
            bootstrapRowNames = value.rows
              .filter(row => Array.isArray(row.items) && row.items.length > 0 && typeof row.name === 'string')
              .map(row => row.name as string);
          }
        } catch { /* The upstream response still belongs to the app. */ }
      }
      response.writeHead(incoming.statusCode ?? 502, { ...responseHeaders, 'content-length': String(body.length) });
      response.end(body);
    });
  });

  forwarded.on('error', () => {
    if (!response.headersSent) response.writeHead(502);
    response.end();
  });
  request.on('aborted', () => forwarded.destroy());
  if (!capturesAuthRequest) {
    request.pipe(forwarded);
    return;
  }
  const chunks: Buffer[] = [];
  request.on('data', chunk => chunks.push(Buffer.from(chunk)));
  request.on('end', () => {
    const body = Buffer.concat(chunks);
    try {
      const value = JSON.parse(body.toString()) as { device?: unknown };
      if (value.device && typeof value.device === 'object') device = value.device;
    } catch { /* The upstream still validates the original request body. */ }
    forwarded.end(body);
  });
});

async function sendPlexToken(request: http.IncomingMessage, response: http.ServerResponse) {
  try {
    if (request.method !== 'GET' || ++plexReads > 6 || !plexTokenFile.endsWith('/prod-readiness-private/owner-token')) throw new Error('refused');
    const mode = (await stat(plexTokenFile)).mode & 0o777;
    if (mode !== 0o600) throw new Error('refused');
    const token = (await readFile(plexTokenFile, 'utf8')).trim();
    if (!token) throw new Error('refused');
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(token) });
    response.end(token);
  } catch {
    response.writeHead(404, { 'Cache-Control': 'no-store' });
    response.end();
  }
}

server.listen(port, '127.0.0.1');

let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  let exitCode = 0;
  if (grant && device && sessionDir) {
    try {
      const safeRoot = join(homedir(), '.scratch', 'tmp') + '/';
      if (!sessionDir.startsWith(safeRoot) || ((await stat(sessionDir)).mode & 0o777) !== 0o700) throw new Error('unsafe session directory');
      await writeFile(join(sessionDir, `${process.pid}.json`), JSON.stringify({ grant, device }), { mode: 0o600 });
    } catch (error) {
      console.error(`dedicated viewer cleanup handoff failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      exitCode = 4;
    }
  }
  grant = null;
  server.close(() => process.exit(exitCode));
};
process.once('SIGINT', close);
process.once('SIGTERM', close);
