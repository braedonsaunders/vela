// __VELA_SHELL__ is replaced by the packager with exact URLs and SHA-256 values.
const shell = __VELA_SHELL__;
const cacheName = `vela-shell-${shell.version}-${shell.digest}`;
const assets = new Map(shell.files.map(file => [new URL(file.url, self.location.origin).href, file]));
const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(cacheName);
  try {
    for (const file of shell.files) {
      const url = new URL(file.url, self.location.origin).href;
      const response = await fetch(url, { cache: 'reload', redirect: 'error', credentials: 'omit' });
      if (!response.ok || await hash(await response.clone().arrayBuffer()) !== file.sha256) throw new Error('Shell digest mismatch');
      await cache.put(url, response);
    }
  } catch (error) { await caches.delete(cacheName); throw error; }
})()));
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE' && event.source?.url && new URL(event.source.url).origin === self.location.origin) event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith('vela-shell-') && name !== cacheName) await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/vela/v0/') || url.pathname.startsWith('/sessions/')) return;
  if (request.mode === 'navigate' && (url.pathname === '/vela' || url.pathname.startsWith('/vela/'))) {
    event.respondWith(fetch(request).catch(async () => await (await caches.open(cacheName)).match(shell.offlineUrl) || new Response('<h1>You’re offline</h1><p>Reconnect to browse and play.</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
    return;
  }
  // Exact allowlist only. Fixed-name native modules, APIs, artwork and media are never intercepted.
  if (!assets.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName), cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request, { redirect: 'error' });
    if (response.ok && await hash(await response.clone().arrayBuffer()) === assets.get(url.href).sha256) await cache.put(request, response.clone());
    return response;
  })());
});
