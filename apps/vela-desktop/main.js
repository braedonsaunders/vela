// Vela for macOS and Linux: the Vela web release, bundled, in a Chromium window. The page plays
// original files itself (WebCodecs, WebGPU, WASM audio), so this shell only serves the bundle,
// keeps the window, opens links in the browser and checks Vela's own releases for updates.
// It is standalone: the page is told so, and connects to any Ether, Jellyfin, Emby or Plex server.
'use strict';
const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, screen, session, shell } = require('electron');
const { loadNativeHost, attachNativePlayer, attachFullscreen } = require('./native-player');
const { attachLoadGuard } = require('./load-guard');
const { bundleServer } = require('./bundle-server');
const { Downloads, dispatch: downloadsCall } = require('./downloads');
const { downloadsRoot, downloadsRoute } = require('./downloads-paths');
const nativeAdapter = loadNativeHost();
const fs = require('node:fs');
const path = require('node:path');

const SCHEME = 'vela-app';
const ORIGIN = `${SCHEME}://app`;
const START = `${ORIGIN}/vela/`;
const RELEASES = 'https://api.github.com/repos/braedonsaunders/vela/releases/latest';
const RELEASE_PAGE = 'https://github.com/braedonsaunders/vela/releases/latest';

// The bundled UI: packaged under resources/ui; VELA_UI points a development run at a web release.
const UI = path.resolve(process.env.VELA_UI || path.join(process.resourcesPath || __dirname, 'ui'));

// The app's own origin is a secure context (WebGPU, WebCodecs, AudioWorklet) served from the bundle.
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);
if (process.platform === 'linux') {
  // Chromium keeps WebGPU behind a switch on Linux; without it the page uses the server's other paths.
  if (nativeAdapter) app.commandLine.appendSwitch('ozone-platform', 'x11');
  app.commandLine.appendSwitch('enable-unsafe-webgpu');
  app.commandLine.appendSwitch('enable-features', 'Vulkan,VaapiVideoDecoder');
}
// A film keeps playing at full rate when the window is behind another app or another full-screen
// Space: Chromium otherwise treats an occluded window as a background tab and throttles its
// animation frames, and the player drops every frame it cannot present.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
if (process.env.VELA_DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.VELA_DEBUG_PORT);
if (process.env.VELA_DATA_DIR) app.setPath('userData', path.resolve(process.env.VELA_DATA_DIR));

// ---- Window placement: remembered, otherwise fitting the screen's height at 16:10 ----

const placementFile = () => path.join(app.getPath('userData'), 'window.json');
function placement() {
  try {
    const saved = JSON.parse(fs.readFileSync(placementFile(), 'utf8'));
    const visible = screen.getAllDisplays().some(d => {
      const a = d.workArea;
      return saved.x < a.x + a.width && saved.x + saved.width > a.x && saved.y < a.y + a.height && saved.y + saved.height > a.y;
    });
    if (visible) return saved;
  } catch {}
  const area = screen.getPrimaryDisplay().workArea;
  const height = Math.max(600, Math.round(area.height * 0.9));
  const width = Math.min(Math.round(area.width * 0.9), Math.round((height * 16) / 10));
  return { x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2), width, height, maximized: false };
}
function remember(window) {
  try {
    const bounds = window.isMaximized() || window.isFullScreen() ? window.getNormalBounds() : window.getBounds();
    fs.writeFileSync(placementFile(), JSON.stringify({ ...bounds, maximized: window.isMaximized() }));
  } catch {}
}

/** What the shell had to do for the page to come up, kept beside the profile for a bug report. */
function launchLog(line) {
  const entry = `${new Date().toISOString()} ${line}`;
  console.warn(`[vela] ${entry}`);
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'launch.log'), entry + '\n'); } catch {}
}

// Test only: answer the next document's (or every document's) preload as if it never ran, to
// prove the page and the load guard recover from a missing preload. Unset in normal use.
let droppedPreloads = { once: 1, always: Infinity }[process.env.VELA_TEST_DROP_PRELOAD] ?? 0;

function openExternal(address) {
  try {
    const url = new URL(address);
    if (url.protocol === 'https:' || url.protocol === 'http:') void shell.openExternal(url.href);
  } catch {}
}

function createWindow() {
  const place = placement();
  const window = new BrowserWindow({
    ...place,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Vela',
    backgroundColor: '#090b0e',
    transparent: !!nativeAdapter,
    fullscreenable: true,
    darkTheme: true,
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 14 } } : {}),
    autoHideMenuBar: true,
    icon: process.platform === 'linux' ? path.join(__dirname, 'build', 'icon.png') : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The page talks to whichever servers the viewer adds, none of which name this origin in CORS
      // (and LAN servers are often plain HTTP). Only the bundle ever loads here: navigation away from
      // it is refused and links open in the system browser.
      webSecurity: false,
      spellcheck: false,
      backgroundThrottling: false,
      devTools: !app.isPackaged || process.env.VELA_DEVTOOLS === '1',
    },
  });
  const nativePlayer = nativeAdapter ? attachNativePlayer(window, nativeAdapter) : null;
  window.__velaNativePlayer = nativePlayer;
  const resetNative = () => {
    nativePlayer?.receive({ kind: 'dispose', id: window.__velaPlayerId });
    nativePlayer?.receive({ kind: 'media-access', origin: null });
  };
  window.webContents.on('render-process-gone', resetNative);
  window.webContents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => {
    if (mainFrame && !_inPlace) resetNative();
  });
  window.on('closed', () => void nativePlayer?.dispose());
  if (place.maximized) window.maximize();
  window.once('ready-to-show', () => window.show());
  window.on('close', () => remember(window));
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(START) || url === `${ORIGIN}/vela`) return;
    event.preventDefault();
    openExternal(url);
  });
  const detachFullscreen = attachFullscreen(window);
  window.once('closed', detachFullscreen);
  // A failed load is reported (and recovered) through did-fail-load.
  const load = () => window.loadURL(START).catch(() => {});
  const guard = attachLoadGuard(window, { load, log: launchLog });
  window.__velaLoadGuard = guard;
  window.once('closed', guard.dispose);
  void load();
  return window;
}

function menu() {
  const mac = process.platform === 'darwin';
  return Menu.buildFromTemplate([
    ...(mac ? [{ label: 'Vela', submenu: [
      { role: 'about' },
      { label: 'Check for Updates…', click: () => void checkForUpdates(true) },
      { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
      { type: 'separator' }, { role: 'quit' },
    ] }] : []),
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Find', accelerator: 'CommandOrControl+F', click: (_item, window) => window?.webContents.send('vela:find') },
        ...(app.isPackaged ? [] : [{ role: 'reload' }]),
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      ],
    },
    ...(mac ? [{ label: 'Window', submenu: [
      { role: 'close' }, { role: 'minimize' }, { role: 'zoom' },
      { type: 'separator' }, { role: 'front' },
    ] }] : [{ role: 'windowMenu' }]),
    {
      role: 'help',
      submenu: [
        { label: 'Vela on GitHub', click: () => openExternal('https://github.com/braedonsaunders/vela') },
        ...(!mac ? [{ label: 'Check for Updates…', click: () => void checkForUpdates(true) }] : []),
      ],
    },
  ]);
}

// ---- Offline downloads (downloads.js): one engine in main, events only to the windows that subscribed ----

let downloads = null;
const downloadSubscribers = new Set();
function downloadsEngine() {
  return downloads ??= new Downloads({
    root: downloadsRoot(app.getPath('userData')),
    emit: event => {
      for (const contents of downloadSubscribers) {
        if (contents.isDestroyed() || !contents.mainFrame?.url.startsWith(START)) { downloadSubscribers.delete(contents); continue; }
        contents.send('vela:downloads-event', event);
      }
    },
    revealFile: file => shell.showItemInFolder(file),
    chooseSaveFile: async name => {
      const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const options = { title: 'Save a copy', defaultPath: path.join(app.getPath('downloads'), name), properties: ['createDirectory', 'showOverwriteConfirmation'] };
      const { canceled, filePath } = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
      return canceled ? null : filePath;
    },
  });
}

// ---- Updates: from Vela's own GitHub releases, independent of any server ----

function newer(latest, current) {
  const a = latest.split('.').map(Number), b = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  return false;
}

async function checkForUpdates(asked = false) {
  if (process.env.VELA_NO_UPDATE_CHECK === '1') return;
  const stamp = path.join(app.getPath('userData'), 'update-check.txt');
  try {
    if (!asked && fs.existsSync(stamp) && Date.now() - fs.statSync(stamp).mtimeMs < 12 * 3600 * 1000) return;
    fs.writeFileSync(stamp, new Date().toISOString());
    const response = await net.fetch(RELEASES, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Vela/${app.getVersion()}` } });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    const release = await response.json();
    const latest = String(release.tag_name || '').replace(/^v/, '');
    const parent = BrowserWindow.getAllWindows()[0];
    if (!/^\d+\.\d+\.\d+$/.test(latest) || !newer(latest, app.getVersion())) {
      if (asked) await dialog.showMessageBox(parent, { message: `Vela ${app.getVersion()} is up to date.` });
      return;
    }
    const { response: choice } = await dialog.showMessageBox(parent, {
      type: 'info', buttons: ['Download', 'Later'], defaultId: 0, cancelId: 1,
      message: `Vela ${latest} is available`, detail: `You have ${app.getVersion()}. Download the new version from GitHub?`,
    });
    if (choice === 0) openExternal(release.html_url || RELEASE_PAGE);
  } catch (error) {
    if (asked) await dialog.showMessageBox(BrowserWindow.getAllWindows()[0], { type: 'warning', message: 'Could not check for updates.', detail: String(error.message || error) });
  }
}

// ---- Lifecycle ----

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  app.whenReady().then(() => {
    protocol.handle(SCHEME, bundleServer(UI, { downloads: downloadsRoute(downloadsRoot(app.getPath('userData'))) }));
    const trusted = event => event.senderFrame === event.sender.mainFrame
      && event.senderFrame?.url.startsWith(START);
    // Every document's preload checks in before the page's scripts run; the guard reloads a
    // document that finishes loading without it.
    ipcMain.on('vela:shell-ready', event => {
      if (!trusted(event)) { event.returnValue = { native: false }; return; }
      if (droppedPreloads > 0) {
        droppedPreloads -= 1;
        launchLog('test: treating this document\'s preload as missing (VELA_TEST_DROP_PRELOAD)');
        event.returnValue = { drop: true };
        return;
      }
      BrowserWindow.fromWebContents(event.sender)?.__velaLoadGuard?.checkIn();
      event.returnValue = { native: !!nativeAdapter, downloads: true };
    });
    // The page's DownloadsPort (apps/vela/src/data/downloads-shell.ts): the trusted main frame only,
    // allowlisted methods, validated arguments; errors carry messages, never URLs or headers.
    ipcMain.handle('vela:downloads-call', async (event, method, args) => {
      if (!trusted(event)) throw new Error('Downloads are not available here');
      return downloadsCall(downloadsEngine(), method, args);
    });
    ipcMain.on('vela:downloads-subscribe', event => {
      if (!trusted(event)) return;
      const contents = event.sender;
      if (downloadSubscribers.has(contents)) return;
      downloadSubscribers.add(contents);
      contents.once('destroyed', () => downloadSubscribers.delete(contents));
      downloadsEngine();
    });
    ipcMain.on('vela:native-message', (event, message) => {
      if (!trusted(event) || !nativeAdapter) return;
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window || !message || typeof message !== 'object') return;
      if (message.kind === 'capabilities') {
        Promise.resolve().then(() => nativeAdapter.capabilities()).then(value => {
          if (!window.isDestroyed()) event.sender.send('vela:native-event', { kind: 'capabilities', requestId: message.requestId, value });
        }).catch(() => {
          if (!window.isDestroyed()) event.sender.send('vela:native-event', { kind: 'capabilities', requestId: message.requestId, error: true });
        });
      } else if (message.kind === 'diagnostics') {
        window.__velaNativePlayer?.diagnostics().then(value => {
          if (!window.isDestroyed()) event.sender.send('vela:native-event', { kind: 'diagnostics', requestId: message.requestId, value });
        }).catch(() => {});
      } else {
        if (message.kind === 'mount') window.__velaPlayerId = message.id;
        void window.__velaNativePlayer?.receive(message);
      }
    });
    // Only fullscreen, and keeping the screen awake while a film plays, are ever granted to the page.
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'fullscreen' || permission === 'screen-wake-lock'));
    Menu.setApplicationMenu(menu());
    // A packaged app carries its icon; a development run would otherwise show Electron's.
    if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(path.join(__dirname, 'build', 'icon.png'));
    createWindow();
    setTimeout(() => void checkForUpdates(), 5000);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  // Closing the app stops transfers; their partial files stay, and the next launch resumes them (interrupted).
  app.on('before-quit', () => { void downloads?.shutdown(); });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
