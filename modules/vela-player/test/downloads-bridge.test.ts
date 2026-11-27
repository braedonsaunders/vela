import { expect, mock, test } from 'bun:test';

// Android's Expo bridge refuses `undefined` fields, which optional record and request fields carry.
test('the Android downloads bridge hands the native module plain JSON data', async () => {
  const calls: unknown[] = [];
  mock.module('react-native', () => ({ Platform: { OS: 'android', isTV: false } }));
  mock.module('expo-modules-core', () => ({
    requireNativeModule: () => ({
      downloadsBaseDirectoryUrl: () => 'file:///data/user/0/app/no_backup/vela-downloads/',
      downloadsWriteSnapshot: async (snapshot: unknown) => { calls.push(snapshot); },
      downloadsStartTransfer: async (request: unknown) => { calls.push(request); },
      downloadsResumeTransfer: async (request: unknown) => { calls.push(request); },
    }),
  }));
  const { velaDownloads } = await import('../src/downloads');
  expect(velaDownloads?.traits.engine).toBe('service');
  await velaDownloads!.writeSnapshot({ items: [{ titleId: 't', error: undefined, bytesWritten: 3 }], outbox: [] });
  const request = { serverId: 's', viewerId: 'v', titleId: 't', url: 'https://example.com/a', headers: {}, container: 'mkv',
    mimeType: 'video/x-matroska', byteLength: undefined, etag: undefined, wifiOnly: true, posterUrl: undefined, sidecars: [] };
  await velaDownloads!.startTransfer(request);
  await velaDownloads!.resumeTransfer(request);
  expect(calls[0]).toEqual({ items: [{ titleId: 't', bytesWritten: 3 }], outbox: [] });
  for (const call of calls.slice(1)) {
    expect(Object.keys(call as object)).not.toContain('byteLength');
    expect(Object.keys(call as object)).not.toContain('posterUrl');
    expect(call).toMatchObject({ titleId: 't', wifiOnly: true, sidecars: [] });
  }
});
