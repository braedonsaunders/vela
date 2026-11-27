// Tells the bundled page it is the standalone desktop app (no server implied by its origin).
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Check in first, synchronously, so the shell knows this document has its preload (see load-guard.js).
let shell;
try { shell = ipcRenderer.sendSync('vela:shell-ready') || {}; } catch { shell = {}; }
if (!shell.drop) start(shell);

function start(shell) {
  const platform = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux';
  contextBridge.exposeInMainWorld('__VELA_DESKTOP__', { version: 1, platform });

  // Keep the native drag region in the page's bar while leaving controls interactive.
  if (platform === 'mac') {
    window.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = `
        [data-vela-mac-topbar] { -webkit-app-region: drag; }
        body:not(.vela-fullscreen) [data-vela-mac-topbar] { padding-left: 80px !important; }
        [data-vela-mac-topbar] :is(button, input, select, a, [role], [tabindex]) { -webkit-app-region: no-drag; }
        body:not(.vela-fullscreen):not(.vela-nodrag)::before { content: ''; position: fixed; top: 0; left: 0;
          width: 80px; height: 32px; z-index: 2147483647; -webkit-app-region: drag; }
      `;
      document.head.appendChild(style);
      let scheduled = false;
      // macOS takes every mouse event inside a drag region, whatever the page draws over it: no drag
      // region while the player is open (its controls sit where the bar was) or the window or page is
      // full screen (where moving the mouse must bring the player's controls up).
      const update = () => {
        scheduled = false;
        const off = document.body.classList.contains('vela-fullscreen') || !!document.fullscreenElement
          || /\/watch(\/|$)/.test(location.pathname);
        document.body.classList.toggle('vela-nodrag', off);
        const bars = [...document.querySelectorAll('[role="navigation"]')];
        const top = off ? undefined : bars.find(el => { const r = el.getBoundingClientRect(); return r.top < 32 && r.bottom > 0 && r.width > 0; });
        for (const bar of bars) bar.toggleAttribute('data-vela-mac-topbar', bar === top);
      };
      const schedule = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(update); } };
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
      window.addEventListener('resize', schedule);
      document.addEventListener('fullscreenchange', schedule);
      window.addEventListener('popstate', schedule);
      schedule();
    });
  }
  ipcRenderer.on('vela:fullscreen', (_event, full) => {
    document.body?.classList.toggle('vela-fullscreen', full);
    if (!full && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    window.dispatchEvent(new CustomEvent('vela:fullscreen', { detail: full }));
    window.dispatchEvent(new Event('resize'));
  });
  ipcRenderer.on('vela:find', () => window.dispatchEvent(new Event('vela:find')));

  // Offline downloads (docs/downloads.md, "Desktop bridge (version 1)"): a fixed call and subscribe
  // over IPC to main's downloads.js, never ipcRenderer itself. Main answers only the trusted main frame.
  if (shell.downloads) {
    const listeners = new Set();
    let subscribed = false;
    ipcRenderer.on('vela:downloads-event', (_event, data) => {
      for (const listener of listeners) { try { listener(data); } catch {} }
    });
    contextBridge.exposeInMainWorld('__VELA_DOWNLOADS__', {
      version: 1,
      base: 'vela-app://app/vela-downloads/',
      call: (method, ...args) => ipcRenderer.invoke('vela:downloads-call', String(method), args).catch(error => {
        // Electron prefixes the main process's message with the channel; the page sees the message alone.
        throw new Error(String(error?.message ?? error).replace(/^Error invoking remote method '[^']*': (?:Error: )?/, ''));
      }),
      subscribe: listener => {
        if (typeof listener !== 'function') return () => {};
        listeners.add(listener);
        if (!subscribed) { subscribed = true; ipcRenderer.send('vela:downloads-subscribe'); }
        return () => { listeners.delete(listener); };
      },
    });
  }

  // Expose only the fixed playback transport, never ipcRenderer itself.
  if (shell.native) {
    const listeners = new Set();
    ipcRenderer.on('vela:native-event', (_event, data) => {
      for (const listener of listeners) listener({ data });
    });
    contextBridge.exposeInMainWorld('__VELA_NATIVE_PLAYER__', {
      version: 1,
      postMessage: message => ipcRenderer.send('vela:native-message', message),
      addEventListener: (type, listener) => { if (type === 'message') listeners.add(listener); },
      removeEventListener: (type, listener) => { if (type === 'message') listeners.delete(listener); },
    });
  }
}
