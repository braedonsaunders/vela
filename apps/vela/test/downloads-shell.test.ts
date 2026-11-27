import { expect, test } from 'bun:test';
import { desktopDownloadsBridge, shellDownloads, type DesktopDownloadsBridge } from '../src/data/downloads-shell';

function bridge(base: string, calls: unknown[][] = []): DesktopDownloadsBridge {
  return {
    version: 1, base,
    call: async (method, ...args) => {
      calls.push([method, ...args]);
      return method === 'freeBytes' ? -1 : method === 'exportCopy' ? true : method === 'readSnapshot' ? { items: 'x' } : undefined;
    },
    subscribe: () => () => {},
  };
}

test('only a shell bridge on one of the two app download routes is used', () => {
  expect(desktopDownloadsBridge({})).toBeUndefined();
  expect(desktopDownloadsBridge({ __VELA_DOWNLOADS__: bridge('vela-app://app/vela-downloads/') })?.base).toBe('vela-app://app/vela-downloads/');
  expect(desktopDownloadsBridge({ __VELA_DOWNLOADS__: bridge('http://vela.localhost/vela-downloads/') })).toBeDefined();
  for (const base of ['https://plex.example/vela-downloads/', 'file:///Users/x/', 'vela-app://app/vela-downloads/../'])
    expect(desktopDownloadsBridge({ __VELA_DOWNLOADS__: bridge(base) })).toBeUndefined();
  expect(desktopDownloadsBridge({ __VELA_DOWNLOADS__: { ...bridge('vela-app://app/vela-downloads/'), version: 2 } })).toBeUndefined();
});

test('the shell port declares desktop traits and reads shell answers defensively', async () => {
  const calls: unknown[][] = [];
  const port = shellDownloads(bridge('vela-app://app/vela-downloads/', calls));
  expect(port.traits).toMatchObject({ engine: 'shell', metered: false, reveal: true, export: true });
  expect(await port.freeBytes()).toBeNull();
  expect(await port.readSnapshot()).toEqual({ items: [], outbox: [] });
  expect(await port.exportCopy!('s', 'v', 't', 'Heat (1995).mkv')).toBe(true);
  expect(calls.at(-1)).toEqual(['exportCopy', 's', 'v', 't', 'Heat (1995).mkv']);
});
