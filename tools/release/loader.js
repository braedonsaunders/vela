// Tiny same-origin engine selector. No Exact runtime or API responses are cached here.
const started = performance.now();
const status = document.querySelector('[role=status]');
const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key, value) => { try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key); } catch {} };
try {
  const response = await fetch('/vela/engines.json', { cache: 'no-store', redirect: 'error' });
  if (!response.ok) throw new Error('The installed engine list is unavailable.');
  const manifest = await response.json();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.version)) throw new Error('The installed release version is invalid.');
  const entries = Object.entries(manifest.engines ?? {}).filter(([id, entry]) => /^[a-z][a-z0-9-]*$/.test(id) && entry.base === `/vela/engines/${id}/${manifest.version}/`);
  const engines = Object.fromEntries(entries);
  if (!engines.cinematic) throw new Error('The default engine is missing.');
  // Descriptor only. No runtime/worker request until the host's beta gate admits it.
  delete window.velaUniversalAssets;
  const universal = manifest.universalAssets;
  if (universal !== undefined) {
    if (!universal || !/^[a-f0-9]{16}$/.test(universal.assetKey) || typeof universal.baseURL !== 'string') throw new Error('Invalid universal asset descriptor');
    const base = new URL(universal.baseURL, location.origin);
    if (base.origin !== location.origin || base.pathname !== `/vela/universal/${universal.assetKey}/` || base.search || base.hash || base.username || base.password) throw new Error('Universal assets outside installed runtime');
    window.velaUniversalAssets = Object.freeze({baseURL:base.href,assetKey:universal.assetKey});
  }
  window.velaEngines = entries.map(([id]) => id);
  let picked = read('vela.engine'), serverDefault = read('vela.engine.default');
  if (picked && !engines[picked]) { write('vela.engine', null); picked = null; }
  // A first visit has no stored server default; negotiation is public and needs no session.
  if (!picked && !engines[serverDefault]) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 2000);
    try {
      let id = read('vela.loader.device');
      if (!id) { id = `loader-${Date.now()}-${Math.random().toString(36).slice(2)}`; write('vela.loader.device', id); }
      const negotiated = await fetch('/vela/v0/negotiate', { method: 'POST', redirect: 'error', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotencyKey: `loader-${Date.now()}-${Math.random().toString(36).slice(2)}`, client: { device: { id, name: 'Vela web loader', platform: 'web', appVersion: manifest.version }, protocolVersions: [0], containers: [], videoCodecs: [], audioCodecs: [], subtitleFormats: [], hls: false, mse: false } }) });
      if (negotiated.ok) { serverDefault = (await negotiated.json()).capabilities?.defaultSkinId; if (engines[serverDefault]) write('vela.engine.default', serverDefault); }
    } catch {} finally { clearTimeout(timer); }
  }
  const engine = picked || (engines[serverDefault] ? serverDefault : 'cinematic');
  const page = await fetch(engines[engine].base + 'index.html', { redirect: 'error', cache: 'no-store' });
  if (!page.ok) throw new Error('The selected engine is unavailable.');
  const html = await page.text();
  window.velaEngineLoad = { engine, started, selectedAt: performance.now(), entryBytes: engines[engine].appBytes, entryGzipBytes: engines[engine].appGzipBytes };
  document.open(); document.write(html); document.close();
} catch (error) {
  status.textContent = navigator.onLine ? `${error.message} Reload to try again.` : 'You’re offline. Reconnect to open Vela.';
}
