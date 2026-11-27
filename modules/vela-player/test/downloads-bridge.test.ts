import { expect, mock, test } from 'bun:test';

// Android's Expo bridge converts neither undefined nor nested null into a Kotlin map: JSON text crosses instead.
test('the Android downloads bridge hands the native module JSON text', async () => {
  const calls: unknown[] = [];
  mock.module('react-native', () => ({ Platform: { OS: 'android', isTV: false } }));
  mock.module('expo-modules-core', () => ({
    requireNativeModule: () => ({
      downloadsBaseDirectoryUrl: () => 'file:///data/user/0/app/no_backup/vela-downloads/',
      downloadsReadSnapshot: async () => JSON.stringify({ items: [{ titleId: 't', error: null }], outbox: [] }),
      downloadsWriteSnapshot: async (snapshot: string) => { calls.push(JSON.parse(snapshot)); },
      downloadsStartTransfer: async (request: string) => { calls.push(JSON.parse(request)); },
      downloadsResumeTransfer: async (request: string) => { calls.push(JSON.parse(request)); },
    }),
  }));
  const { velaDownloads } = await import('../src/downloads');
  expect(velaDownloads?.traits.engine).toBe('service');
  expect(await velaDownloads!.readSnapshot()).toEqual({ items: [{ titleId: 't', error: null }], outbox: [] });
  await velaDownloads!.writeSnapshot({ items: [{ titleId: 't', error: undefined, selectedSubtitleTrackId: null, bytesWritten: 3 }], outbox: [] });
  const request = { serverId: 's', viewerId: 'v', titleId: 't', url: 'https://example.com/a', headers: {}, container: 'mkv',
    mimeType: 'video/x-matroska', byteLength: undefined, etag: undefined, wifiOnly: true, posterUrl: undefined, sidecars: [] };
  await velaDownloads!.startTransfer(request);
  await velaDownloads!.resumeTransfer(request);
  expect(calls[0]).toEqual({ items: [{ titleId: 't', selectedSubtitleTrackId: null, bytesWritten: 3 }], outbox: [] });
  for (const call of calls.slice(1)) {
    expect(Object.keys(call as object)).not.toContain('byteLength');
    expect(Object.keys(call as object)).not.toContain('posterUrl');
    expect(call).toMatchObject({ titleId: 't', wifiOnly: true, sidecars: [] });
  }
});
