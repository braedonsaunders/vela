import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { bundleServer } = require('../bundle-server.js');

const parent = mkdtempSync(join(tmpdir(), 'vela-bundle-'));
const root = join(parent, 'ui');
afterAll(() => rmSync(parent, { recursive: true, force: true }));
mkdirSync(join(root, '_expo/static/js'), { recursive: true });
writeFileSync(join(root, 'index.html'), '<!doctype html><title>Vela</title>');
writeFileSync(join(root, '_expo/static/js/entry.js'), 'x'.repeat(256 * 1024));
writeFileSync(join(root, 'routes.json'), '{}');
writeFileSync(join(parent, 'outside-vela-bundle.txt'), 'secret');
const serve = bundleServer(root);
const get = (path: string, method = 'GET') => serve(new Request(`vela-app://app${path}`, { method }));

test('serves bundle files with their type, length and cache policy', async () => {
  const entry = await get('/vela/_expo/static/js/entry.js');
  expect(entry.status).toBe(200);
  expect(entry.headers.get('content-type')).toBe('text/javascript');
  expect(entry.headers.get('content-length')).toBe(String(256 * 1024));
  expect(entry.headers.get('cache-control')).toBe('max-age=31536000, immutable');
  expect((await entry.arrayBuffer()).byteLength).toBe(256 * 1024);
  const routes = await get('/vela/routes.json');
  expect(routes.headers.get('cache-control')).toBe('no-cache');
  expect(await routes.text()).toBe('{}');
});

test('app routes are answered by index.html; missing files, other hosts and methods are 404', async () => {
  for (const path of ['/vela', '/vela/', '/vela/sign-in', '/vela/library/abc']) {
    const response = await get(path);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<title>Vela</title>');
  }
  expect((await get('/vela/missing.js')).status).toBe(404);
  expect((await get('/other/index.html')).status).toBe(404);
  expect((await get('/vela/index.html', 'POST')).status).toBe(404);
  expect((await serve(new Request('vela-app://elsewhere/vela/'))).status).toBe(404);
});

test('never leaves the bundle, and a malformed escape is a 404 rather than a throw', async () => {
  expect((await get('/vela/..%2Foutside-vela-bundle.txt')).status).toBe(404);
  expect((await get('/vela/%2e%2e/outside-vela-bundle.txt')).status).not.toBe(200);
  expect((await get('/vela/%E0%A4%A')).status).toBe(404);
});

test('the web service worker is replaced by an empty script', async () => {
  const worker = await get('/vela/sw.js');
  expect(worker.headers.get('content-type')).toBe('text/javascript');
  expect(await worker.text()).toBe('');
});

test('a body cancelled mid-read settles quietly', async () => {
  const errors: unknown[] = [];
  const record = (error: unknown) => errors.push(error);
  process.on('uncaughtException', record);
  process.on('unhandledRejection', record);
  try {
    for (let i = 0; i < 20; i++) {
      const reader = (await get('/vela/_expo/static/js/entry.js')).body!.getReader();
      await reader.read();
      const pending = reader.read().catch(() => undefined);
      await reader.cancel();
      await pending;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  } finally {
    process.off('uncaughtException', record);
    process.off('unhandledRejection', record);
  }
  expect(errors).toEqual([]);
});
