import http from 'node:http';
import https from 'node:https';

const port = Number(process.argv[2]);
const configured = process.env.VELA_E2E_SERVER;

if (!Number.isInteger(port) || port < 1 || port > 65_535 || !configured) {
  process.exitCode = 2;
  throw new Error('lab proxy requires a port and VELA_E2E_SERVER');
}

const upstream = new URL(configured);
if (upstream.protocol !== 'http:' || !upstream.hostname.startsWith('192.168.')) {
  process.exitCode = 2;
  throw new Error('lab proxy accepts only the private-LAN HTTP Vela lab');
}

const server = http.createServer((request, response) => {
  const requested = new URL(request.url ?? '/', 'http://localhost');
  const target = new URL(`${requested.pathname}${requested.search}`, upstream.origin);
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
    response.writeHead(incoming.statusCode ?? 502, responseHeaders);
    incoming.pipe(response);
  });

  forwarded.on('error', () => {
    if (!response.headersSent) response.writeHead(502);
    response.end();
  });
  request.on('aborted', () => forwarded.destroy());
  request.pipe(forwarded);
});

server.listen(port, '127.0.0.1');

const close = () => server.close(() => process.exit(0));
process.once('SIGINT', close);
process.once('SIGTERM', close);
