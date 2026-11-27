import { describe, expect, test } from 'bun:test';
import type * as V from '../src/wire';
import {
  allowsOfflineRoute,
  checkDownloadSpace,
  Downloads,
  downloadedDetailModel,
  downloadNeedsReplacement,
  downloadPercent,
  FREE_SPACE_RESERVE_BYTES,
  initialDownloads,
  localPlaybackPlan,
  resolveDownloadFileUrl,
  storedDownloadSettings,
  totalDownloadedBytes,
  visibleDownloads,
  type DownloadRecord,
  type DownloadsPort,
  type DownloadsSnapshot,
  type DownloadTransferProgress,
  type DownloadTransferRequest,
} from '../src/store/downloads';
import { initialPlayback, Playback } from '../src/store/playback';
import { initialAuth } from '../src/store/auth';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type { DownloadResolution } from '../src/adapter/capabilities';
import { tokens } from './helpers';

function sampleTitle(id = '101', name = 'Heat'): V.Title {
  return {
    id,
    kind: 'movie',
    name,
    summary: 'LA crime thriller.',
    year: 1995,
    genres: ['Crime'],
    durationSeconds: 6120,
    artwork: [{ id: 'poster-1', kind: 'poster', tag: '1', sizes: [{ width: 0, height: 0, url: 'https://plex.example:32400/library/metadata/101/thumb/1' }] }],
    watch: { positionSeconds: 180, played: false, favorite: false, watchlisted: false, lastViewedAt: '2026-03-01T12:00:00.000Z' },
  };
}

function sampleRecord(overrides: Partial<DownloadRecord> = {}): DownloadRecord {
  return {
    serverId: 'srv-plex',
    viewerId: 'viewer-1',
    titleId: '101',
    title: sampleTitle(overrides.titleId ?? '101'),
    versionId: '500',
    versionLabel: '4K · HEVC · TrueHD 7.1',
    sourceId: 'part-900',
    mimeType: 'video/x-matroska',
    container: 'mkv',
    byteLength: 4_000_000_000,
    bytesWritten: 4_000_000_000,
    etag: '"etag-900"',
    status: 'completed',
    createdAt: '2026-03-02T10:00:00.000Z',
    completedAt: '2026-03-02T10:15:00.000Z',
    mediaPath: 'srv-plex/viewer-1/101/media.mkv',
    posterPath: 'srv-plex/viewer-1/101/poster.jpg',
    sidecarPaths: { 'sub-ext-1': 'srv-plex/viewer-1/101/sidecars/sub-ext-1.ass' },
    originalVideo: { codec: 'hevc', width: 3840, height: 2160 },
    audioTracks: [
      { id: 'aud-1', streamIndex: 1, kind: 'audio', language: 'eng', name: 'TrueHD 7.1', codec: 'truehd', channels: 8, default: true },
      { id: 'aud-2', streamIndex: 2, kind: 'audio', language: 'eng', name: 'AC3 5.1', codec: 'ac3', channels: 6 },
    ],
    subtitleTracks: [
      { id: 'sub-emb-1', streamIndex: 3, kind: 'subtitle', language: 'eng', name: 'English PGS', codec: 'pgs', default: true, delivery: { kind: 'embedded' } },
      { id: 'sub-ext-1', streamIndex: 4, kind: 'subtitle', language: 'jpn', name: 'Japanese ASS', codec: 'ass', delivery: { kind: 'external', format: 'ass', url: 'https://plex.example:32400/library/streams/4.ass?encoding=utf-8' } },
    ],
    selectedAudioTrackId: 'aud-1',
    selectedSubtitleTrackId: 'sub-emb-1',
    chapters: [{ id: 'ch-1', name: 'Opening', startSeconds: 0, endSeconds: 600 }],
    markers: [{ kind: 'intro', startSeconds: 30, endSeconds: 95 }, { kind: 'credits', startSeconds: 5900, endSeconds: 6120, final: true }],
    sidecars: [{ trackId: 'sub-ext-1', format: 'ass', url: 'https://plex.example:32400/library/streams/4.ass?encoding=utf-8' }],
    posterUrl: 'https://plex.example:32400/library/metadata/101/thumb/1',
    ...overrides,
  };
}

class FakeDownloadsPort implements DownloadsPort {
  snapshot: DownloadsSnapshot = { items: [], outbox: [] };
  free: number | null = 20_000_000_000;
  baseUrl = 'file:///var/mobile/Containers/Data/Application/UUID-1111/Library/Application%20Support/vela-downloads/';
  started: DownloadTransferRequest[] = [];
  paused: { serverId: string; viewerId: string; titleId: string }[] = [];
  resumed: DownloadTransferRequest[] = [];
  removedTitles: { serverId: string; viewerId: string; titleId: string }[] = [];
  removedViewers: { serverId: string; viewerId: string }[] = [];
  removedServers: string[] = [];
  private listeners = new Set<(event: DownloadTransferProgress) => void>();

  baseDirectoryUrl() { return this.baseUrl; }
  async readSnapshot() { return structuredClone(this.snapshot); }
  async writeSnapshot(snapshot: DownloadsSnapshot) { this.snapshot = structuredClone(snapshot); }
  async freeBytes() { return this.free; }
  async startTransfer(request: DownloadTransferRequest) { this.started.push(request); }
  async pauseTransfer(serverId: string, viewerId: string, titleId: string) { this.paused.push({ serverId, viewerId, titleId }); }
  async resumeTransfer(request: DownloadTransferRequest) { this.resumed.push(request); }
  async removeTitle(serverId: string, viewerId: string, titleId: string) { this.removedTitles.push({ serverId, viewerId, titleId }); }
  async removeViewer(serverId: string, viewerId: string) { this.removedViewers.push({ serverId, viewerId }); }
  async removeServer(serverId: string) { this.removedServers.push(serverId); }
  subscribe(listener: (event: DownloadTransferProgress) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(event: DownloadTransferProgress) {
    for (const listener of this.listeners) listener(event);
  }
}

describe('Downloads storage & space checks', () => {
  test('storedDownloadSettings normalizes wifiOnly and capBytes', () => {
    expect(storedDownloadSettings(null)).toEqual({ wifiOnly: true, capBytes: null });
    expect(storedDownloadSettings({ wifiOnly: false, capBytes: 10_000_000_000.9 })).toEqual({ wifiOnly: false, capBytes: 10_000_000_000 });
    expect(storedDownloadSettings({ wifiOnly: 'no', capBytes: -5 })).toEqual({ wifiOnly: true, capBytes: null });
  });

  test('checkDownloadSpace enforces the 2 GB free-space reserve and queued transfer commitments', () => {
    const queuedOther = sampleRecord({
      titleId: '102',
      status: 'downloading',
      byteLength: 3_000_000_000,
      bytesWritten: 1_000_000_000, // still owes 2 GB
    });
    // Requested 4 GB + 2 GB owed by 102 + 2 GB reserve = 8 GB free required.
    const denied = checkDownloadSpace({
      requestedBytes: 4_000_000_000,
      existingItems: [queuedOther],
      serverId: 'srv-plex',
      viewerId: 'viewer-1',
      titleId: '101',
      freeBytes: 7_500_000_000,
      capBytes: null,
    });
    expect(denied).toMatchObject({
      allowed: false,
      reason: 'free_space',
      neededBytes: 500_000_000,
    });

    const allowed = checkDownloadSpace({
      requestedBytes: 4_000_000_000,
      existingItems: [queuedOther],
      serverId: 'srv-plex',
      viewerId: 'viewer-1',
      titleId: '101',
      freeBytes: 8_000_000_000,
      capBytes: null,
    });
    expect(allowed).toEqual({ allowed: true });
    expect(FREE_SPACE_RESERVE_BYTES).toBe(2_000_000_000);
  });

  test('checkDownloadSpace enforces an optional storage cap across on-disk and queued bytes', () => {
    const completed = sampleRecord({ titleId: '100', byteLength: 5_000_000_000, bytesWritten: 5_000_000_000, status: 'completed' });
    const queued = sampleRecord({ titleId: '102', byteLength: 3_000_000_000, bytesWritten: 500_000_000, status: 'queued' });
    // 5 GB on disk + 3 GB committed for 102 + 4 GB requested = 12 GB > 10 GB cap
    const result = checkDownloadSpace({
      requestedBytes: 4_000_000_000,
      existingItems: [completed, queued],
      serverId: 'srv-plex',
      viewerId: 'viewer-1',
      titleId: '101',
      freeBytes: 50_000_000_000,
      capBytes: 10_000_000_000,
    });
    expect(result).toMatchObject({
      allowed: false,
      reason: 'cap',
      neededBytes: 2_000_000_000,
    });
  });

  test('resolveDownloadFileUrl resolves relative paths against current container UUID and rejects traversal', () => {
    const baseA = 'file:///var/mobile/Containers/Data/Application/UUID-AAAA/Library/Application%20Support/vela-downloads/';
    const baseB = 'file:///var/mobile/Containers/Data/Application/UUID-BBBB/Library/Application%20Support/vela-downloads';
    expect(resolveDownloadFileUrl(baseA, 'srv-plex/viewer-1/101/media.mkv')).toBe(
      'file:///var/mobile/Containers/Data/Application/UUID-AAAA/Library/Application%20Support/vela-downloads/srv-plex/viewer-1/101/media.mkv',
    );
    expect(resolveDownloadFileUrl(baseB, 'srv-plex/viewer-1/101/media.mkv')).toBe(
      'file:///var/mobile/Containers/Data/Application/UUID-BBBB/Library/Application%20Support/vela-downloads/srv-plex/viewer-1/101/media.mkv',
    );
    expect(() => resolveDownloadFileUrl(baseA, '../secrets.json')).toThrow('Invalid relative download path');
    expect(() => resolveDownloadFileUrl('https://plex.example/downloads/', 'a/b.mkv')).toThrow('Downloads base directory must be a file: URL');
  });

  test('localPlaybackPlan builds a single direct file:// plan with embedded tracks, sidecars, chapters and markers', () => {
    const base = 'file:///var/mobile/Containers/Data/Application/UUID-1234/Library/Application%20Support/vela-downloads/';
    const item = sampleRecord();
    const plan = localPlaybackPlan(item, base);
    expect(plan.selectedPathId).toBe('original');
    expect(plan.paths).toHaveLength(1);
    expect(plan.paths[0]).toMatchObject({
      id: 'original',
      kind: 'direct',
      transport: 'file',
      mimeType: 'video/x-matroska',
      readiness: 'ready',
      original: true,
      range: true,
      byteLength: 4_000_000_000,
      sourceId: 'part-900',
      url: `${base}srv-plex/viewer-1/101/media.mkv`,
      originalVideo: { codec: 'hevc', width: 3840, height: 2160 },
    });
    expect(plan.positionSeconds).toBe(180);
    expect(plan.durationSeconds).toBe(6120);
    expect(plan.selectedAudioTrackId).toBe('aud-1');
    expect(plan.selectedSubtitleTrackId).toBe('sub-emb-1');
    expect(plan.audioTracks.map(t => [t.id, t.streamIndex])).toEqual([['aud-1', 1], ['aud-2', 2]]);
    expect(plan.subtitleTracks).toEqual([
      expect.objectContaining({ id: 'sub-emb-1', streamIndex: 3, delivery: { kind: 'embedded' } }),
      expect.objectContaining({
        id: 'sub-ext-1',
        streamIndex: 4,
        delivery: { kind: 'external', format: 'ass', url: `${base}srv-plex/viewer-1/101/sidecars/sub-ext-1.ass` },
      }),
    ]);
    expect(plan.chapters).toEqual([{ id: 'ch-1', name: 'Opening', startSeconds: 0, endSeconds: 600 }]);
    expect(plan.markers).toEqual([
      { kind: 'intro', startSeconds: 30, endSeconds: 95 },
      { kind: 'credits', startSeconds: 5900, endSeconds: 6120, final: true },
    ]);
  });

  test('downloadedDetailModel rewrites poster to local file:// URL when available', () => {
    const base = 'file:///var/mobile/Containers/Data/Application/UUID-1234/Library/Application%20Support/vela-downloads/';
    const detail = downloadedDetailModel(sampleRecord(), base);
    expect(detail.title[0]?.poster).toBe(`${base}srv-plex/viewer-1/101/poster.jpg`);
  });

  test('downloadNeedsReplacement detects part id, etag or size changes on the server', () => {
    const item = sampleRecord();
    expect(downloadNeedsReplacement(item, { sourceId: 'part-900', byteLength: 4_000_000_000, etag: '"etag-900"' })).toBe(false);
    expect(downloadNeedsReplacement(item, { sourceId: 'part-901', byteLength: 4_000_000_000, etag: '"etag-900"' })).toBe(true);
    expect(downloadNeedsReplacement(item, { sourceId: 'part-900', byteLength: 4_100_000_000, etag: '"etag-900"' })).toBe(true);
    expect(downloadNeedsReplacement(item, { sourceId: 'part-900', byteLength: 4_000_000_000, etag: '"etag-new"' })).toBe(true);
  });

  test('allowsOfflineRoute permits /downloads and /watch/<id> for downloaded titles when auth.phase is offline', () => {
    const hasDownload = (id: string) => id === '101';
    expect(allowsOfflineRoute('offline', '/downloads', hasDownload)).toBe(true);
    expect(allowsOfflineRoute('offline', '/watch/101', hasDownload)).toBe(true);
    expect(allowsOfflineRoute('offline', '/watch/999', hasDownload)).toBe(false);
    expect(allowsOfflineRoute('offline', '/library/1', hasDownload)).toBe(false);
    expect(allowsOfflineRoute('signed-out', '/downloads', hasDownload)).toBe(false);
    expect(allowsOfflineRoute('signed-out', '/watch/101', hasDownload)).toBe(false);
  });
});

describe('Downloads slice isolation, lifecycle & replacement', () => {
  function createHarness() {
    const port = new FakeDownloadsPort();
    const resolution: DownloadResolution = {
      title: sampleTitle('101'),
      versionId: '500',
      versionLabel: '4K · HEVC',
      url: 'https://plex.example:32400/library/parts/900/file.mkv?download=1',
      headers: { 'X-Plex-Token': 'token-1', 'X-Plex-Client-Identifier': 'client-1' },
      mimeType: 'video/x-matroska',
      container: 'mkv',
      byteLength: 4_000_000_000,
      etag: '"etag-900"',
      sourceId: 'part-900',
      originalVideo: { codec: 'hevc', width: 3840, height: 2160 },
      audioTracks: [{ id: 'aud-1', streamIndex: 1, kind: 'audio', language: 'eng', name: 'TrueHD', codec: 'truehd', default: true }],
      subtitleTracks: [],
      selectedAudioTrackId: 'aud-1',
      selectedSubtitleTrackId: null,
      chapters: [],
      sidecars: [],
      posterUrl: 'https://plex.example:32400/library/metadata/101/thumb/1',
    };
    const resetListeners: ((kind: 'session' | 'server', refused?: boolean) => void)[] = [];
    const replayed: import('../src/adapter/capabilities').OfflineProgressEntry[] = [];
    let rejectReplay = false;
    let serverWatch = sampleTitle().watch;
    const adapter = {
      detail: async () => ({ title: { ...sampleTitle(), watch: serverWatch } }),
      replayWatchProgress: async (_id: string, entry: import('../src/adapter/capabilities').OfflineProgressEntry) => {
        if (rejectReplay) throw new Error('Network is down');
        replayed.push(entry);
        return { accepted: true };
      },
      downloadsAvailable: async () => true,
      resolveDownload: async () => resolution,
    };
    let activeServerId = 'srv-plex';
    let activeViewer = tokens('token-1', 'viewer-1');
    const connection = {
      get record() { return { id: activeServerId, kind: 'plex' as const, name: 'Plex', origin: 'https://plex.example:32400', basePath: '/' }; },
      adapter,
    };
    const session = {
      onReset: (fn: (kind: 'session' | 'server', refused?: boolean) => void) => { resetListeners.push(fn); return () => {}; },
      selected: () => connection,
      ready: async () => connection,
      tokens: async () => activeViewer,
      declared: async () => ({ subtitleFormats: ['ass', 'webvtt'] }),
      key: () => 'idem-1',
    } as unknown as Session;
    const box = new StateBox({
      auth: { ...initialAuth, phase: 'signed-in', serverId: 'srv-plex', viewer: 'Viewer 1', viewerId: 'viewer-1' },
      downloads: { ...initialDownloads },
      titles: {},
      playback: initialPlayback,
    } as unknown as VelaState);
    const downloads = new Downloads(box, session, { downloads: port } as any);
    return {
      port,
      box,
      downloads,
      resolution,
      session,
      replayed,
      setServerWatch(watch: V.WatchState | undefined) { serverWatch = watch; },
      failReplay(fail: boolean) { rejectReplay = fail; },
      switchViewer(viewerId: string, serverId = activeServerId) {
        activeServerId = serverId;
        activeViewer = tokens(`token-${viewerId}`, viewerId);
        box.update('auth', a => ({ ...a, serverId, viewerId, viewer: viewerId }));
      },
      triggerReset(kind: 'session' | 'server', refused?: boolean) {
        for (const fn of resetListeners) fn(kind, refused);
      },
    };
  }

  test('offline playback opens the original and persists progress without a server session', async () => {
    const h = createHarness();
    h.box.update('auth', auth => ({ ...auth, phase: 'offline' }));
    h.port.snapshot.items = [sampleRecord()];
    const playback = new Playback(h.box, h.session, () => {}, () => {}, undefined, h.downloads);
    await playback.start({ kind: 'title', id: '101' });
    const plan = h.box.get().playback.plan!;
    expect(plan.paths[0]?.url).toEndWith('/101/media.mkv');
    expect(plan.positionSeconds).toBe(180);
    expect(h.box.get().titles['101']?.value?.title[0]?.name).toBe('Heat');
    await playback.observe(plan.sessionId, {
      state: 'paused', positionSeconds: 228, observedAt: '2026-03-04T11:13:00.000Z',
      idempotencyKey: 'observe', sequence: 1, playableRanges: [], selectedPathId: 'original',
      sourceGeneration: 0, seekGeneration: 0,
    });
    await playback.stop();
    expect(h.port.snapshot.outbox).toMatchObject([{ titleId: '101', positionSeconds: 228, completed: false }]);
    expect(h.replayed).toEqual([]);

    h.failReplay(true);
    h.box.update('auth', auth => ({ ...auth, phase: 'signed-in' }));
    await h.downloads.replayProgress();
    expect(h.port.snapshot.outbox).toHaveLength(1);
    h.failReplay(false);
    await h.downloads.replayProgress();
    expect(h.replayed).toMatchObject([{ titleId: '101', positionSeconds: 228 }]);
    expect(h.port.snapshot.outbox).toEqual([]);
  });

  test('newer server activity wins over an offline checkpoint', async () => {
    const h = createHarness();
    h.box.update('auth', auth => ({ ...auth, phase: 'offline' }));
    h.port.snapshot.items = [sampleRecord()];
    await h.downloads.hydrate();
    await h.downloads.recordProgress({ titleId: '101', positionSeconds: 228, observedAt: '2026-03-04T11:13:00.000Z' });
    h.setServerWatch({ ...sampleTitle().watch!, lastViewedAt: '2026-03-04T11:14:00.000Z', positionSeconds: 405 });
    h.box.update('auth', auth => ({ ...auth, phase: 'signed-in' }));
    await h.downloads.replayProgress();
    expect(h.replayed).toEqual([]);
    expect(h.port.snapshot.outbox).toEqual([]);
    expect(h.downloads.item('101')?.title.watch?.positionSeconds).toBe(405);
  });

  test('viewer isolation hides other Plex Home members downloads while counting total disk usage', async () => {
    const h = createHarness();
    const viewer1Item = sampleRecord({ viewerId: 'viewer-1', titleId: '101', byteLength: 3_000_000_000, bytesWritten: 3_000_000_000 });
    const viewer2Item = sampleRecord({ viewerId: 'viewer-2', titleId: '202', byteLength: 2_000_000_000, bytesWritten: 2_000_000_000 });
    h.port.snapshot = { items: [viewer1Item, viewer2Item], outbox: [] };
    await h.downloads.hydrate();

    expect(h.box.get().downloads.items.map(i => i.titleId)).toEqual(['101']);
    expect(h.box.get().downloads.usedBytes).toBe(5_000_000_000);
    expect(totalDownloadedBytes(h.box.get().downloads.allItems)).toBe(5_000_000_000);

    // Switching Plex Home profile shows only viewer-2's downloads without deleting viewer-1's files.
    h.switchViewer('viewer-2');
    expect(h.box.get().downloads.items.map(i => i.titleId)).toEqual(['202']);
    expect(h.box.get().downloads.allItems).toHaveLength(2);
    expect(visibleDownloads(h.box.get().downloads.allItems, 'srv-plex', 'viewer-1').map(i => i.titleId)).toEqual(['101']);
  });

  test('replacing a completed download keeps previousCompleted playable until the new transfer completes', async () => {
    const h = createHarness();
    const existing = sampleRecord({ status: 'completed', mediaPath: 'srv-plex/viewer-1/101/media-old.mkv', sourceId: 'part-old' });
    h.port.snapshot = { items: [existing], outbox: [] };
    await h.downloads.hydrate();

    h.resolution.sourceId = 'part-new';
    const queued = await h.downloads.enqueue('101');
    expect(queued?.status).toBe('queued');
    expect(queued?.previousCompleted?.mediaPath).toBe('srv-plex/viewer-1/101/media-old.mkv');
    // Still playable via the previous completed copy while downloading the replacement:
    expect(h.downloads.isPlayable('101')).toBe(true);
    const planDuringReplace = await h.downloads.planFor('101');
    expect(planDuringReplace?.paths[0]?.url).toContain('media-old.mkv');

    // Once the replacement completes, the new file takes over and previousCompleted is cleared:
    await h.downloads.applyTransferEvent({
      serverId: 'srv-plex',
      viewerId: 'viewer-1',
      titleId: '101',
      status: 'completed',
      bytesWritten: 4_000_000_000,
      byteLength: 4_000_000_000,
      mediaPath: 'srv-plex/viewer-1/101/media-new.mkv',
    });
    const updated = h.downloads.item('101');
    expect(updated?.status).toBe('completed');
    expect(updated?.previousCompleted).toBeUndefined();
    const planAfterReplace = await h.downloads.planFor('101');
    expect(planAfterReplace?.paths[0]?.url).toContain('media-new.mkv');
  });

  test('out-of-space transfer event pauses all queued/active transfers and surfaces neededBytes', async () => {
    const h = createHarness();
    h.port.snapshot = {
      items: [
        sampleRecord({ titleId: '101', status: 'downloading', bytesWritten: 1_000_000_000 }),
        sampleRecord({ titleId: '102', status: 'queued', bytesWritten: 0 }),
      ],
      outbox: [],
    };
    await h.downloads.hydrate();

    await h.downloads.applyTransferEvent({
      serverId: 'srv-plex',
      viewerId: 'viewer-1',
      titleId: '101',
      status: 'paused',
      bytesWritten: 1_000_000_000,
      errorCode: 'no_space',
      neededBytes: 1_500_000_000,
      error: 'Not enough free storage (1.5 GB more needed).',
    });

    expect(h.downloads.item('101')).toMatchObject({ status: 'paused', errorCode: 'no_space', neededBytes: 1_500_000_000 });
    expect(h.downloads.item('102')).toMatchObject({ status: 'paused', errorCode: 'no_space', neededBytes: 1_500_000_000 });
    expect(h.box.get().downloads.error).toContain('1.5 GB');
  });

  test('a refused session keeps downloads; removeViewer and removeServer clean up only the affected scope', async () => {
    const h = createHarness();
    h.port.snapshot = {
      items: [
        sampleRecord({ serverId: 'srv-plex', viewerId: 'viewer-1', titleId: '101' }),
        sampleRecord({ serverId: 'srv-plex', viewerId: 'viewer-2', titleId: '202' }),
        sampleRecord({ serverId: 'srv-other', viewerId: 'viewer-9', titleId: '909' }),
      ],
      outbox: [
        { serverId: 'srv-plex', viewerId: 'viewer-1', titleId: '101', positionSeconds: 300, durationSeconds: 6120, completed: false, observedAt: '2026-03-02T12:00:00.000Z', idempotencyKey: 'k1' },
        { serverId: 'srv-plex', viewerId: 'viewer-2', titleId: '202', positionSeconds: 400, durationSeconds: 6120, completed: false, observedAt: '2026-03-02T12:00:00.000Z', idempotencyKey: 'k2' },
      ],
    };
    h.box.update('auth', auth => ({ ...auth, phase: 'offline' }));
    await h.downloads.hydrate();

    // A 401 refused session keeps viewer-1's files and outbox, waiting for viewer-1 to sign in again:
    h.triggerReset('server', true);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(h.port.removedViewers).toEqual([]);
    expect(h.box.get().downloads.allItems.map(i => `${i.serverId}:${i.viewerId}:${i.awaitingSignIn === true}`))
      .toEqual(['srv-plex:viewer-1:true', 'srv-plex:viewer-2:false', 'srv-other:viewer-9:false']);
    expect(h.box.get().downloads.outbox).toHaveLength(2);
    // An explicit removal of viewer-1 (sign-out) does delete them:
    await h.downloads.removeViewer('srv-plex', 'viewer-1');
    expect(h.port.removedViewers).toEqual([{ serverId: 'srv-plex', viewerId: 'viewer-1' }]);
    expect(h.box.get().downloads.outbox.map(e => `${e.serverId}:${e.viewerId}`)).toEqual(['srv-plex:viewer-2']);

    // Removing srv-plex removes all remaining viewers on srv-plex, leaving srv-other untouched:
    await h.downloads.removeServer('srv-plex');
    expect(h.port.removedServers).toEqual(['srv-plex']);
    expect(h.box.get().downloads.allItems.map(i => `${i.serverId}:${i.viewerId}`)).toEqual(['srv-other:viewer-9']);
  });
});

test('download progress stays within the file size and distinguishes an unknown total', () => {
  expect(downloadPercent({ bytesWritten: 9, byteLength: 10 })).toBe(90);
  expect(downloadPercent({ bytesWritten: 100, byteLength: 10 })).toBe(100);
  expect(downloadPercent({ bytesWritten: -1, byteLength: 10 })).toBe(0);
  expect(downloadPercent({ bytesWritten: 10 })).toBeUndefined();
});
