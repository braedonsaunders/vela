// Vela for macOS and Linux: the Vela web release, bundled, in a Chromium window. The page plays
// original files itself (WebCodecs, WebGPU, WASM audio), so this shell only serves the bundle,
// keeps the window, opens links in the browser and checks Vela's own releases for updates.
// It is standalone: the page is told so, and connects to any Ether, Jellyfin, Emby or Plex server.
'use strict';
const { app, BrowserWindow, Menu, dialog, net, protocol, screen, session, shell } = require('electron');
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

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4', '.txt': 'text/plain',
};

/** /vela/... from the bundle; the app's routes are answered by index.html; anything else is a 404. */
async function serve(request) {
  const url = new URL(request.url);
  if (url.host !== 'app' || request.method !== 'GET' || !(url.pathname === '/vela' || url.pathname.startsWith('/vela/'))) {
    return new Response(null, { status: 404 });
  }
  const relative = decodeURIComponent(url.pathname.slice('/vela'.length)).replace(/^\/+/, '');
  let file = path.resolve(UI, relative);
  if (file !== UI && !file.startsWith(UI + path.sep)) return new Response(null, { status: 404 });
  // The PWA's service worker belongs to the web; the app's bundle is its own cache.
  if (relative === 'pwa.js' || relative === 'sw.js') return new Response('', { headers: { 'content-type': 'text/javascript' } });
  let stat = await fs.promises.stat(file).catch(() => undefined);
  if (!stat?.isFile() && !path.extname(relative)) {
    file = path.join(UI, 'index.html');
    stat = await fs.promises.stat(file).catch(() => undefined);
  }
  if (!stat?.isFile()) return new Response(null, { status: 404 });
  const immutable = /^(_expo\/static|assets|player)\//.test(relative);
  return new Response(fs.createReadStream(file), {
    headers: {
      'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': String(stat.size),
      'cache-control': immutable ? 'max-age=31536000, immutable' : 'no-cache',
    },
  });
}

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
    darkTheme: true,
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
  // Fullscreen comes from the page (the player's button or F) or the menu (F11, Ctrl+Cmd+F).
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11' && process.platform !== 'darwin') {
      event.preventDefault();
      window.setFullScreen(!window.isFullScreen());
    }
  });
  void window.loadURL(START);
  return window;
}

function menu() {
  const mac = process.platform === 'darwin';
  return Menu.buildFromTemplate([
    ...(mac ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Vela on GitHub', click: () => openExternal('https://github.com/braedonsaunders/vela') },
        { label: 'Check for Updates…', click: () => void checkForUpdates(true) },
      ],
    },
  ]);
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
    protocol.handle(SCHEME, serve);
    // Only fullscreen is ever granted to the page (cameras, location and the rest are refused).
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'fullscreen'));
    Menu.setApplicationMenu(menu());
    // A packaged app carries its icon; a development run would otherwise show Electron's.
    if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(path.join(__dirname, 'build', 'icon.png'));
    createWindow();
    setTimeout(() => void checkForUpdates(), 5000);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
