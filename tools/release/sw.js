// The packager supplies only release-inventoried static resources and real app routes.
const shell = __VELA_SHELL__;
const cacheName = `vela-shell-${shell.version}-${shell.digest}`;
const assets = new Map([...shell.files, ...shell.staticFiles].map(file => [
  new URL(file.url, self.location.origin).href, file,
]));
const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  b => b.toString(16).padStart(2, '0')).join('');
const pattern = path => new RegExp('^' + path.split('/').map(part =>
  part.startsWith(':') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/') + '$');
const routes = shell.routes.map(pattern);
// Offline downloads (docs/downloads.md): once a viewer stores a browser download the page asks for
// the whole verified app (entry HTML and every static file); offline, its Downloads and Watch routes
// then open the app instead of offline.html. The set is written to its own cache and marked complete
// last, so a half-finished copy is never served; deleting the last download releases it.
const offline = shell.offline;
const offlineName = `vela-offline-${shell.version}-${shell.digest}`;
const offlineComplete = new URL('/vela/.offline-complete', self.location.origin).href;
const offlineRoutes = (offline?.routes ?? []).map(pattern);
const sameOrigin = event => !!event.source?.url && new URL(event.source.url).origin === self.location.origin;
async function completeOffline() {
  if (!offline || !(await caches.has(offlineName))) return undefined;
  const cache = await caches.open(offlineName);
  return (await cache.match(offlineComplete)) ? cache : undefined;
}
let precaching;
function precacheOffline() {
  return precaching ??= (async () => {
    if (!offline || await completeOffline()) return;
    await caches.delete(offlineName);
    const cache = await caches.open(offlineName);
    try {
      for (const file of [offline.entry, ...shell.staticFiles]) {
        const url = new URL(file.url, self.location.origin).href;
        const response = await fetch(url, { cache: 'reload', redirect: 'error', credentials: 'omit' });
        if (!response.ok || await hash(await response.clone().arrayBuffer()) !== file.sha256) {
          throw new Error('Offline digest mismatch');
        }
        await cache.put(url, response);
      }
      await cache.put(offlineComplete, new Response('1'));
    } catch (error) {
      await caches.delete(offlineName);
      throw error;
    }
  })().finally(() => { precaching = undefined; });
}
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(cacheName);
  try {
    for (const file of shell.files) {
      const url = new URL(file.url, self.location.origin).href;
      const response = await fetch(url, { cache: 'reload', redirect: 'error', credentials: 'omit' });
      if (!response.ok || await hash(await response.clone().arrayBuffer()) !== file.sha256) {
        throw new Error('Shell digest mismatch');
      }
      await cache.put(url, response);
    }
  } catch (error) {
    await caches.delete(cacheName);
    throw error;
  }
})()));
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE' && event.source?.url
    && new URL(event.source.url).origin === self.location.origin) event.waitUntil(self.skipWaiting());
  if (event.data?.type === 'PRECACHE_OFFLINE' && sameOrigin(event)) event.waitUntil(precacheOffline().catch(() => {}));
  if (event.data?.type === 'RELEASE_OFFLINE' && sameOrigin(event)) {
    event.waitUntil(Promise.resolve(precaching).catch(() => {}).then(() => caches.delete(offlineName)));
  }
});
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const name of await caches.keys()) {
    if ((name.startsWith('vela-shell-') && name !== cacheName) || (name.startsWith('vela-offline-') && name !== offlineName)) {
      await caches.delete(name);
    }
  }
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin
    || url.pathname.startsWith('/vela/v0/') || url.pathname.startsWith('/sessions/')) return;
  if (request.mode === 'navigate' && routes.some(route => route.test(url.pathname))) {
    event.respondWith(fetch(request).catch(async () =>
      (offlineRoutes.some(route => route.test(url.pathname))
        && await (await completeOffline())?.match(new URL(offline.entry.url, self.location.origin).href))
      || await (await caches.open(cacheName)).match(shell.offlineUrl)
      || new Response('You’re offline. Reconnect to browse and play.', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })));
    return;
  }
  // Never cache API, artwork grants, media or mutable metadata. Every admitted byte is digest verified.
  if (!assets.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request) || await (await completeOffline())?.match(request);
    if (cached) return cached;
    const response = await fetch(request, { redirect: 'error', credentials: 'omit' });
    if (response.ok && await hash(await response.clone().arrayBuffer()) === assets.get(url.href).sha256) {
      await cache.put(request, response.clone());
    }
    return response;
  })());
});
