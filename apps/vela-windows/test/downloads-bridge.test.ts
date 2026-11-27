import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { DESKTOP_DOWNLOAD_METHODS, desktopDownloadsBridge, shellDownloads } from '../../vela/src/data/downloads-shell';

const mainWindow = readFileSync(new URL('../MainWindow.cs', import.meta.url), 'utf8');
const downloads = readFileSync(new URL('../Downloads.cs', import.meta.url), 'utf8');
const logic = readFileSync(new URL('./downloads-logic/Program.cs', import.meta.url), 'utf8');
const script = mainWindow.match(/private const string DownloadsBridge = """\n([\s\S]*?)\n\s*""";/)![1];

type Listener = (event: { data: unknown }) => void;
function page(options: { origin?: string; top?: boolean } = {}) {
  const posted: any[] = [];
  const listeners: Listener[] = [];
  const window: any = {
    chrome: { webview: { postMessage: (message: unknown) => posted.push(structuredClone(message)), addEventListener: (_: string, listener: Listener) => listeners.push(listener) } },
  };
  window.top = options.top === false ? {} : window;
  runInNewContext(script, { window, location: { origin: options.origin ?? 'http://vela.localhost' }, setTimeout, Map, Set, Array, Promise, Error, Object });
  const deliver = (data: unknown) => listeners.forEach(listener => listener({ data }));
  return { window, posted, deliver };
}

describe('Windows downloads bridge', () => {
  test('installs a frozen version 1 bridge the page accepts', () => {
    const { window } = page();
    const bridge = desktopDownloadsBridge(window);
    expect(bridge?.base).toBe('http://vela.localhost/vela-downloads/');
    expect(Object.isFrozen(window.__VELA_DOWNLOADS__)).toBe(true);
    expect(() => { window.__VELA_DOWNLOADS__ = {}; }).toThrow();
    expect(shellDownloads(bridge!).baseDirectoryUrl()).toBe('http://vela.localhost/vela-downloads/');
  });

  test('is absent outside the app\'s own top-level document', () => {
    expect(page({ origin: 'http://192.168.1.2:32400' }).window.__VELA_DOWNLOADS__).toBeUndefined();
    expect(page({ top: false }).window.__VELA_DOWNLOADS__).toBeUndefined();
  });

  test('calls carry a request id and settle on the matching reply only', async () => {
    const { window, posted, deliver } = page();
    const port = shellDownloads(desktopDownloadsBridge(window)!);
    const free = port.freeBytes();
    const removed = port.removeTitle('s', 'v', 't');
    expect(posted).toEqual([
      { kind: 'downloads-call', requestId: 'downloads-1', method: 'freeBytes', args: [] },
      { kind: 'downloads-call', requestId: 'downloads-2', method: 'removeTitle', args: ['s', 'v', 't'] },
    ]);
    deliver({ kind: 'downloads-reply', requestId: 'downloads-9', ok: true, value: 1 });
    deliver({ kind: 'downloads-reply', requestId: 'downloads-2', ok: false, error: 'The download is in use. Stop playing it and try again.' });
    deliver({ kind: 'downloads-reply', requestId: 'downloads-1', ok: true, value: 123_456 });
    expect(await free).toBe(123_456);
    await expect(removed).rejects.toThrow('The download is in use');
  });

  test('refuses unknown methods without messaging the host', async () => {
    const { window, posted } = page();
    await expect(window.__VELA_DOWNLOADS__.call('deleteEverything')).rejects.toThrow('Unknown downloads method');
    expect(posted).toEqual([]);
  });

  test('delivers transfer events to subscribers until they unsubscribe', () => {
    const { window, deliver } = page();
    const seen: unknown[] = [];
    const unsubscribe = shellDownloads(desktopDownloadsBridge(window)!).subscribe!(event => seen.push(event));
    const event = { serverId: 's', viewerId: 'v', titleId: 't', status: 'downloading', bytesWritten: 10 };
    deliver({ kind: 'downloads-event', event });
    deliver({ kind: 'event', event });
    unsubscribe();
    deliver({ kind: 'downloads-event', event });
    expect(seen).toEqual([event]);
  });

  test('the shell, the host allowlist and the injected script name the same methods', () => {
    const host = downloads.match(/internal static readonly string\[\] Methods =\s*\[([\s\S]*?)\];/)![1].match(/"(\w+)"/g)!.map(s => s.slice(1, -1));
    const injected = script.match(/const methods = \[([\s\S]*?)\];/)![1].match(/'(\w+)'/g)!.map(s => s.slice(1, -1));
    expect(host).toEqual([...DESKTOP_DOWNLOAD_METHODS]);
    expect(injected).toEqual([...DESKTOP_DOWNLOAD_METHODS]);
  });

  test('the logic check uses the app origin', () => {
    const origin = mainWindow.match(/internal const string AppOrigin = "([^"]+)"/)![1];
    expect(logic).toContain(`internal const string AppOrigin = "${origin}"`);
    expect(script).toContain(`location.origin === '${origin}'`);
  });
});
