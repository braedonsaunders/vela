import { expect, test } from 'bun:test';
import { desktopMediaAuthorization, setWindowsMediaAccess } from '../src/windows/bridge';
import type { VelaPlayerProps } from '@vela/player-api';

const props = { plan: { sessionId: 'session', sourceGeneration: 1, seekGeneration: 2, revision: 3, selectedPathId: 'hls', paths: [{ id: 'hls', transport: 'hls', readiness: 'ready', url: '/media/index.m3u8' }] } } as VelaPlayerProps;

test('desktop HLS authorization cannot attach after credential rotation', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { __VELA_NATIVE_PLAYER__: { version: 1, postMessage() {} } } });
  try {
    let release!: (url: string) => void;
    let requested!: () => void;
    const started = new Promise<void>(resolve => { requested = resolve; });
    setWindowsMediaAccess({ origin: 'https://media.invalid', pathPrefix: '/media/', headers: async () => ({ Authorization: 'fixture' }), nativeURL: async () => { requested(); return new Promise<string>(resolve => { release = resolve; }); } });
    const stale = desktopMediaAuthorization(props);
    await started;
    setWindowsMediaAccess(null);
    release('https://media.invalid/media/index.m3u8?token=fixture');
    expect(await stale).toBeNull();
    setWindowsMediaAccess({ origin: 'https://media.invalid', pathPrefix: '/media/', headers: async () => ({ Authorization: 'fixture' }) });
    const refused = await desktopMediaAuthorization(props);
    expect(refused?.mediaAuthorization?.ok).toBe(false);
    expect(refused?.nativeMedia).toBeUndefined();
    setWindowsMediaAccess({ origin: 'https://media.invalid', pathPrefix: '/media/', headers: async () => ({ Authorization: 'fixture' }), nativeURL: async source => {
      expect(source).toBe('/media/index.m3u8');
      return 'https://media.invalid/media/index.m3u8?token=fixture';
    } });
    const prepared = await desktopMediaAuthorization(props);
    expect(prepared?.mediaAuthorization?.ok).toBe(true);
    expect(prepared?.nativeMedia?.planId).toBe('session:1:2:3:hls');
    expect(prepared?.nativeMedia?.source).toBe('/media/index.m3u8');
    expect(prepared?.nativeMedia?.generation).toBe(prepared?.mediaAuthorization?.generation);
  } finally {
    setWindowsMediaAccess(null);
    if (original) Object.defineProperty(globalThis, 'window', original);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
