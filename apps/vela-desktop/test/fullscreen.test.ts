import { expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
const { attachFullscreen } = require('../native-player.js');

function fixture() {
  const window = new EventEmitter() as any;
  const contents = new EventEmitter() as any;
  const scripts: string[] = [], events: unknown[] = [], changes: boolean[] = [];
  window.full = false; window.destroyed = false;
  window.isDestroyed = () => window.destroyed;
  window.isFullScreen = () => window.full;
  window.setFullScreen = (full: boolean) => { changes.push(full); window.full = full; };
  window.webContents = contents;
  contents.send = (...args: unknown[]) => events.push(args);
  contents.executeJavaScript = async (script: string) => { scripts.push(script); return true; };
  return { window, contents, scripts, events, changes };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

test('native fullscreen exit clears document state and informs the page', async () => {
  const f = fixture(), dispose = attachFullscreen(f.window, 'darwin');
  f.contents.emit('enter-html-full-screen');
  expect(f.changes).toEqual([true]);
  f.window.emit('enter-full-screen');
  f.window.full = false;
  f.window.emit('leave-full-screen');
  await flush();
  expect(f.events).toEqual([['vela:fullscreen', true], ['vela:fullscreen', false]]);
  expect(f.scripts).toHaveLength(1);
  expect(f.scripts[0]).toContain('document.exitFullscreen()');
  dispose();
  expect(f.window.listenerCount('leave-full-screen')).toBe(0);
  expect(f.contents.listenerCount('before-input-event')).toBe(0);
});

test('Escape stays available to menus outside fullscreen and exits native-only fullscreen', async () => {
  const f = fixture(), dispose = attachFullscreen(f.window, 'darwin');
  let prevented = 0;
  const event = { preventDefault() { prevented++; } };
  f.contents.emit('before-input-event', event, { type: 'keyDown', key: 'Escape' });
  expect(prevented).toBe(0);
  f.window.full = true;
  f.contents.executeJavaScript = async () => false;
  f.contents.emit('before-input-event', event, { type: 'keyDown', key: 'Escape' });
  await flush(); await flush();
  expect(prevented).toBe(1);
  expect(f.changes).toEqual([false]);
  dispose();
});

test('HTML exit leaves native fullscreen and F11 remains a Linux window shortcut', () => {
  const f = fixture(), dispose = attachFullscreen(f.window, 'linux');
  const event = { preventDefault() {} };
  f.contents.emit('before-input-event', event, { type: 'keyDown', key: 'F11' });
  f.contents.emit('leave-html-full-screen');
  expect(f.changes).toEqual([true, false]);
  dispose();
});
