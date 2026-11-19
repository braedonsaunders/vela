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

test('preload clears document fullscreen on native exit on Linux too', async () => {
  const { runInNewContext } = await import('node:vm');
  const listeners = new Map<string, Function>();
  const dispatched: any[] = [];
  let exits = 0;
  const document: any = { fullscreenElement: {}, body: { classList: { toggle() {} } }, exitFullscreen: async () => { exits++; document.fullscreenElement = null; } };
  class Event { constructor(public type: string) {} }
  class CustomEvent extends Event { detail: unknown; constructor(type: string, init: any) { super(type); this.detail = init.detail; } }
  runInNewContext(await Bun.file(new URL('../preload.js', import.meta.url)).text(), {
    require: () => ({ contextBridge: { exposeInMainWorld() {} }, ipcRenderer: { on: (name: string, listener: Function) => listeners.set(name, listener), sendSync: () => false } }),
    process: { platform: 'linux' }, document, Event, CustomEvent,
    window: { dispatchEvent: (event: unknown) => dispatched.push(event) },
  });
  listeners.get('vela:fullscreen')?.({}, false);
  await flush();
  expect(exits).toBe(1);
  expect(document.fullscreenElement).toBeNull();
  expect(dispatched.map(event => [event.type, event.detail])).toEqual([['vela:fullscreen', false], ['resize', undefined]]);
});
