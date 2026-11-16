// Tells the bundled page it is the standalone desktop app (no server implied by its origin).
'use strict';
const { contextBridge } = require('electron');

const platform = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux';
contextBridge.exposeInMainWorld('__VELA_DESKTOP__', { version: 1, platform });
