// App-owned Expo HTML loads this install/update bridge. No credentials or API access.
let deferred, registration;
const listeners = new Set();
const state = { installable: false, installed: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true, updateAvailable: false, offline: !navigator.onLine };
function offlineMessage(type) {
  const worker = navigator.serviceWorker?.controller || registration?.active;
  if (!worker) return false;
  worker.postMessage({ type });
  return true;
}
function notify() { const snapshot = Object.freeze({ ...state }); for (const listener of listeners) listener(snapshot); window.dispatchEvent(new CustomEvent('vela:pwa-state', { detail: snapshot })); }
window.velaPwa = {
  get state() { return Object.freeze({ ...state }); },
  subscribe(listener) { listeners.add(listener); listener(Object.freeze({ ...state })); return () => listeners.delete(listener); },
  async install() {
    if (!deferred) return false;
    const prompt = deferred; deferred = undefined; state.installable = false; notify();
    await prompt.prompt(); return (await prompt.userChoice).outcome === 'accepted';
  },
  applyUpdate() { if (!registration?.waiting) return false; registration.waiting.postMessage({ type: 'ACTIVATE_UPDATE' }); return true; },
  // Offline downloads: keep (or release) the verified app so Downloads and Watch open offline.
  prepareOffline() { return offlineMessage('PRECACHE_OFFLINE'); },
  releaseOffline() { return offlineMessage('RELEASE_OFFLINE'); },
};
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferred = event; state.installable = !state.installed; notify(); });
window.addEventListener('appinstalled', () => { deferred = undefined; state.installed = true; state.installable = false; notify(); });
window.addEventListener('online', () => { state.offline = false; notify(); });
window.addEventListener('offline', () => { state.offline = true; notify(); });
if ('serviceWorker' in navigator && window.isSecureContext) {
  let controlled = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (controlled) location.reload(); controlled = true; });
  navigator.serviceWorker.register('/vela/sw.js', { scope: '/vela', updateViaCache: 'none' }).then(value => {
    registration = value;
    const update = () => { state.updateAvailable = !!value.waiting; notify(); };
    update(); value.addEventListener('updatefound', () => { const worker = value.installing; worker?.addEventListener('statechange', update); });
  }).catch(() => { /* Browsing stays available if installation is blocked by host policy. */ });
}
notify();
