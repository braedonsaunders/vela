'use strict';
const path = require('node:path');

function loadNativeHost(platform = process.platform) {
  if (!['darwin', 'linux'].includes(platform)) return null;
  try {
    const adapter = require(path.join(__dirname, platform === 'darwin' ? 'mac' : 'linux', 'host.js'));
    return adapter.available() ? adapter : null;
  } catch { return null; }
}

/** One serialized host lifecycle per window. No callback can outlive its mount. */
function attachNativePlayer(window, adapter) {
  let current = null;
  let access = null;
  let tail = Promise.resolve();
  let closed = false;
  const background = on => { if (!window.isDestroyed()) window.setBackgroundColor(on ? '#00000000' : '#090b0e'); };
  const stop = async () => {
    const old = current; current = null;
    try { await old?.host?.destroy(); } finally { background(false); }
  };
  const receive = message => {
    tail = tail.then(async () => {
      if (closed || !message || typeof message.kind !== 'string') return;
      if (message.kind === 'media-access') {
        access = message.origin ? { origin: message.origin, pathPrefix: message.pathPrefix, headers: message.headers, generation: message.generation } : null;
        await current?.host?.setAccess(access); return;
      }
      if (message.kind === 'mount') {
        await stop();
        const mount = { id: message.id, host: null }; current = mount;
        const emit = (event, value) => {
          if (closed || current !== mount || window.isDestroyed()) return;
          if (event === 'fallback') { receive({ kind: 'dispose', id: mount.id }); }
          window.webContents.send('vela:native-event', { kind: 'event', id: mount.id, event, value });
        };
        mount.host = await adapter.create({ window, emit });
        if (closed) { await stop(); return; }
        await mount.host.setAccess(access);
        background(true);
        await mount.host.update(message.props); return;
      }
      if (!current || message.id !== current.id) return;
      if (message.kind === 'caption-insets') {
        const zoom = window.webContents.getZoomFactor?.() ?? 1;
        const insets = Object.fromEntries(['left', 'right', 'top', 'bottom'].map(key =>
          [key, Math.max(0, Number(message.insets?.[key]) || 0) * zoom]));
        await current.host.setCaptionInsets?.(insets, message.mpv);
      }
      if (message.kind === 'update') await current.host.update(message.props);
      if (message.kind === 'bounds') {
        const rect = message.bounds;
        if (!rect || !['x', 'y', 'width', 'height', 'scaleFactor'].every(key => Number.isFinite(rect[key])) || rect.width < 0 || rect.height < 0) return;
        const zoom = window.webContents.getZoomFactor?.() ?? 1;
        await current.host.setBounds({ x: rect.x * zoom, y: rect.y * zoom, width: rect.width * zoom, height: rect.height * zoom, scaleFactor: rect.scaleFactor / zoom });
      }
      if (message.kind === 'dispose') await stop();
    }).catch(async () => {
      const id = current?.id;
      try { await stop(); } catch {}
      if (id && !closed && !window.isDestroyed()) window.webContents.send('vela:native-event', { kind: 'event', id, event: 'fallback', value: null });
    });
    return tail;
  };
  return { receive, diagnostics: () => tail.then(() => current?.host?.diagnostics?.() ?? null), dispose() { closed = true; access = null; tail = tail.then(stop).catch(() => {}); return tail; } };
}
module.exports = { loadNativeHost, attachNativePlayer };

/** Native and document fullscreen can leave independently (Escape, menu, Space). */
function attachFullscreen(window, platform = process.platform) {
  const contents = window.webContents;
  let htmlFullscreen = false;
  const exitDocument = () => Promise.resolve().then(() => contents.executeJavaScript(
    'document.fullscreenElement ? document.exitFullscreen().then(() => true) : false',
  )).catch(() => false);
  const nativeChanged = () => {
    if (window.isDestroyed()) return;
    const full = window.isFullScreen();
    contents.send('vela:fullscreen', full);
    if (!full) void exitDocument();
  };
  const enterHTML = () => { htmlFullscreen = true; window.setFullScreen(true); };
  const leaveHTML = () => { htmlFullscreen = false; window.setFullScreen(false); };
  const input = (event, key) => {
    if (key.type !== 'keyDown') return;
    if (key.key === 'Escape' && (window.isFullScreen() || htmlFullscreen)) {
      event.preventDefault();
      void exitDocument().then(exited => {
        if (!exited && !window.isDestroyed()) window.setFullScreen(false);
      });
    }
    if (key.key === 'F11' && platform !== 'darwin') {
      event.preventDefault();
      window.setFullScreen(!window.isFullScreen());
    }
  };
  window.on('enter-full-screen', nativeChanged);
  window.on('leave-full-screen', nativeChanged);
  contents.on('enter-html-full-screen', enterHTML);
  contents.on('leave-html-full-screen', leaveHTML);
  contents.on('before-input-event', input);
  return () => {
    window.off('enter-full-screen', nativeChanged);
    window.off('leave-full-screen', nativeChanged);
    contents.off('enter-html-full-screen', enterHTML);
    contents.off('leave-html-full-screen', leaveHTML);
    contents.off('before-input-event', input);
  };
}
module.exports.attachFullscreen = attachFullscreen;
