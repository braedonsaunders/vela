import { expect, test } from 'bun:test';
import { probeEther } from '../src/adapter/probe';

test('detects only a public Vela JSON capabilities response', async () => {
  let mode = 'ok';
  const server = Bun.serve({ port: 0, async fetch() {
    if (mode === 'slow') { await Bun.sleep(100); return new Response('late'); }
    if (mode === 'html') return new Response('<html>login</html>', { status: 401, headers: { 'content-type': 'text/html' } });
    if (mode === 'missing') return new Response('', { status: 404 });
    if (mode === 'bad') return new Response('{', { headers: { 'content-type': 'application/json' } });
    return Response.json({ protocolVersion: 0, server: { id: 'a', name: 'Ether' }, features: {} });
  } });
  try {
    const origin = `http://127.0.0.1:${server.port}`;
    expect(await probeEther(origin)).toEqual({ origin, id: 'a', name: 'Ether', plexAccountSignIn: false });
    for (mode of ['html', 'missing', 'bad', 'slow']) expect(await probeEther(origin, 10)).toBeNull();
  } finally { server.stop(true); }
});
