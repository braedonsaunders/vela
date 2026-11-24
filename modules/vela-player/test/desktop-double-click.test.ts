// The desktop apps (Windows WebView2, Electron on macOS and Linux) run the web bundle over a native
// player. A double click on the picture reaches their page host as three renders, one command each
// (packages/skin/src/widgets/player/picture-click.ts): the first click's toggle, full screen, and
// the undo. Full screen is the page's; both play commands must reach the native player (issue #40).
import { afterEach, expect, test } from 'bun:test';
import type { Command, VelaPlayerProps } from '@vela/player-api';
import { createWindowsPlayerHost } from '../src/windows/host';

const saved = ['window', 'document', 'ResizeObserver'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
afterEach(() => {
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

const plan = { sessionId: 'session', sourceGeneration: 1, seekGeneration: 1, revision: 1, selectedPathId: 'direct', paths: [{ id: 'direct', transport: 'file' }] };

/** A page with a desktop bridge: Windows exposes WebView2's channel, Electron its own. */
function page(desktop: 'windows' | 'electron') {
  const posted: { kind: string; props?: { command?: Command } }[] = [];
  const fullscreen: string[] = [];
  const bridge = { version: 1, postMessage: (message: never) => posted.push(message), addEventListener() {}, removeEventListener() {} };
  const style = () => ({ getPropertyValue: () => '', getPropertyPriority: () => '', setProperty() {} });
  const doc = {
    fullscreenElement: null as object | null,
    head: { appendChild() {} },
    createElement: () => ({ textContent: '', remove() {} }),
    addEventListener() {}, removeEventListener() {},
    documentElement: { requestFullscreen: async () => { fullscreen.push('enter'); doc.fullscreenElement = {}; } },
    exitFullscreen: async () => { fullscreen.push('exit'); doc.fullscreenElement = null; },
  };
  const win = desktop === 'windows'
    ? { __VELA_WINDOWS__: { version: 1 }, chrome: { webview: bridge } }
    : { __VELA_NATIVE_PLAYER__: bridge };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { ...win, devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
  const node = { style: style(), parentElement: null, getBoundingClientRect: () => ({ x: 0, y: 0, width: 1280, height: 720 }) } as unknown as HTMLElement;
  /** The commands the native player was handed, in order. */
  const commands = () => posted.filter(m => m.kind === 'mount' || m.kind === 'update').map(m => m.props?.command ? `${m.props.command.type}#${m.props.command.id}` : '-');
  return { node, commands, fullscreen };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

for (const desktop of ['windows', 'electron'] as const) {
  test(`${desktop}: a double click's full screen stays the page's and both play commands reach the native player`, async () => {
    const { node, commands, fullscreen } = page(desktop);
    const props = (command?: Command) => ({ plan, command } as unknown as VelaPlayerProps);
    const host = createWindowsPlayerHost(node, props());
    await settle();
    host.update(props({ id: 1, type: 'pause' }));      // the first click
    await settle();
    host.update(props({ id: 2, type: 'fullscreen' }));  // the second, in its own render
    await settle();
    host.update(props({ id: 3, type: 'play' }));        // the undo, UNDO_AFTER_MS later
    await settle();
    expect(fullscreen).toEqual(['enter']);
    expect(commands().filter(c => c !== '-')).toEqual(['pause#1', 'play#3']);
    host.dispose();
  });
}
