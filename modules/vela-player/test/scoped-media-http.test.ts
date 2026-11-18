import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Execute the production Apple transport, including URLSession's real redirect behavior.
const appleTest = process.platform === 'darwin' ? test : test.skip;
const scratch = join(homedir(), '.scratch', 'tmp', `vela-scoped-http-${process.pid}`);
const binary = join(scratch, 'probe');
let server: ReturnType<typeof Bun.serve> | undefined;
const seen: { host: string; path: string; headers: Headers }[] = [];
let origin = '';

beforeAll(async () => {
  if (process.platform !== 'darwin') return;
  await mkdir(scratch, { recursive: true });
  const ios = join(import.meta.dir, '..', 'ios');
  const compiler = Bun.spawn(['xcrun', 'swiftc', '-swift-version', '5', '-module-cache-path', join(scratch, 'modules'),
    join(ios, 'MediaAccess.swift'), join(ios, 'ScopedMediaHTTP.swift'),
    join(import.meta.dir, 'fixtures/scoped-http-probe.swift'), '-o', binary], {
    env: { ...process.env, DEVELOPER_DIR: process.env.DEVELOPER_DIR || '/Applications/Xcode.app/Contents/Developer' }, stdout: 'pipe', stderr: 'pipe',
  });
  const [output, errors, status] = await Promise.all([new Response(compiler.stdout).text(), new Response(compiler.stderr).text(), compiler.exited]);
  if (status !== 0) throw new Error(`Swift transport probe did not compile: ${output}${errors}`);
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    const url = new URL(request.url);
    seen.push({ host: url.host, path: url.pathname, headers: new Headers(request.headers) });
    const crossHost = origin.replace('127.0.0.1', 'localhost');
    const redirects: Record<string, string> = {
      '/grant/inside': `${origin}/grant/target`,
      '/grant/outside': `${origin}/outside/target`,
      '/grant/lookalike': `${origin}/granted/target`,
      '/grant/traversal': `${origin}/grant/%2e%2e/outside/target`,
      '/grant/cross': `${crossHost}/grant/target`,
      '/grant/return': `${crossHost}/return`,
      '/return': `${origin}/grant/target`,
    };
    if (redirects[url.pathname]) return Response.redirect(redirects[url.pathname]!, 302);
    if (url.pathname === '/grant/stall') return new Promise<Response>(() => {});
    const body = url.pathname === '/grant/oversized' ? 'x'.repeat(2048) : 'media payload';
    return new Response(body, { status: 206, headers: { 'Content-Range': `bytes 0-${body.length - 1}/${body.length}` } });
  } });
  origin = `http://127.0.0.1:${server.port}`;
}, 60_000);

afterAll(async () => {
  server?.stop(true);
  if (process.platform === 'darwin') await rm(scratch, { recursive: true, force: true });
});

async function request(path: string, mode?: string) {
  seen.length = 0;
  const child = Bun.spawn([binary, origin, `${origin}${path}`, ...(mode ? [mode] : [])], { stdout: 'pipe', stderr: 'pipe' });
  const [output, errors, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(errors).toBe('');
  return { output, status };
}

appleTest('same-origin redirects within the grant retain the media headers', async () => {
  expect(await request('/grant/inside')).toEqual({ output: 'received=13\n', status: 0 });
  expect(seen.at(-1)?.headers.get('x-plex-token')).toBe('test-plex');
  expect(seen.at(-1)?.headers.get('authorization')).toBe('Bearer test-authorization');
});

for (const path of ['/grant/cross', '/grant/outside', '/grant/lookalike', '/grant/traversal', '/grant/return']) {
  appleTest(`redirect ${path} drops every grant header and never restores it`, async () => {
    expect((await request(path)).status).toBe(0);
    expect(seen[0]?.headers.get('x-plex-token')).toBe('test-plex');
    for (const hit of seen.slice(1)) {
      for (const header of ['authorization', 'x-plex-token', 'x-emby-token', 'x-plex-product']) expect(hit.headers.get(header)).toBeNull();
      expect(hit.headers.get('range')).toBe('bytes=0-1023');
    }
  });
}

appleTest('an origin that ignores the requested byte bound is refused', async () => {
  expect((await request('/grant/oversized')).status).toBe(1);
});

appleTest('the production reader seeks cached bytes, reports size, closes and creates independent readers', async () => {
  expect(await request('/grant/target', 'reader')).toEqual({ output: 'reader_ok\n', status: 0 });
});

appleTest('cancellation racing the first read never starts a request', async () => {
  expect(await request('/grant/target', 'cancel-before')).toEqual({ output: 'cancelled\n', status: 0 });
  expect(seen).toHaveLength(0);
});

appleTest('cancellation promptly unblocks a stalled native read', async () => {
  const began = Date.now();
  expect(await request('/grant/stall', 'cancel')).toEqual({ output: 'cancelled\n', status: 0 });
  expect(Date.now() - began).toBeLessThan(2000);
});

appleTest('a retained reader can rewind after cancellation, while final close remains terminal', async () => {
  expect(await request('/grant/target', 'reload')).toEqual({ output: 'reload_ok\n', status: 0 });
});

appleTest('native URL attachments stay within their plan and grant generation and diagnostics omit tokens', async () => {
  expect(await request('/grant/target', 'attachment')).toEqual({ output: 'attachment_ok\n', status: 0 });
});
