// Downloads on every client (docs/downloads.md): platform traits, reserve and quota admission,
// what a title offers, desktop download routes, interrupted-transfer resume with fresh
// credentials, the browser's persistence gate, Save file, and per-viewer isolation.
import { describe, expect, test } from 'bun:test';
import type * as V from '../src/wire';
import {
  allowsOfflineRoute,
  autoResumable,
  checkDownloadSpace,
  DEFAULT_DOWNLOAD_TRAITS,
  downloadFileName,
  downloadOffer,
  downloadOfferReason,
  downloadPathSegments,
  Downloads,
  downloadTraits,
  initialDownloads,
  localPlaybackPlan,
  reserveFor,
  resolveDownloadFileUrl,
  validDownloadsBase,
  type DownloadRecord,
  type DownloadSaveRequest,
  type DownloadsPort,
  type DownloadsSnapshot,
  type DownloadsTraits,
  type DownloadTransferRequest,
} from '../src/store/downloads';
import { initialPlayback } from '../src/store/playback';
import { initialAuth } from '../src/store/auth';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';
import type { Session } from '../src/store/session';
import type { DownloadResolution } from '../src/adapter/capabilities';
import { tokens } from './helpers';

const GB = 1_000_000_000;

function title(id = '101', name = 'Heat'): V.Title {
  return {
    id, kind: 'movie', name, summary: '', year: 1995, genres: [], durationSeconds: 6120,
    artwork: [{ id: 'p', kind: 'poster', tag: '1', sizes: [{ width: 0, height: 0, url: 'https://plex.example:32400/thumb' }] }],
    watch: { positionSeconds: 0, played: false, favorite: false, watchlisted: false },
  };
}

function record(overrides: Partial<DownloadRecord> = {}): DownloadRecord {
  const titleId = overrides.titleId ?? '101';
  const serverId = overrides.serverId ?? 'srv';
  const viewerId = overrides.viewerId ?? 'viewer-1';
  return {
    serverId, viewerId, titleId, title: title(titleId), mimeType: 'video/x-matroska', container: 'mkv',
    byteLength: 4 * GB, bytesWritten: 4 * GB, status: 'completed', createdAt: '2026-11-01T00:00:00.000Z',
    mediaPath: `${serverId}/${viewerId}/${titleId}/media.mkv`, posterPath: `${serverId}/${viewerId}/${titleId}/poster.jpg`,
    sidecarPaths: { s1: `${serverId}/${viewerId}/${titleId}/sidecars/s1.vtt` },
    audioTracks: [{ id: 'a1', kind: 'audio', language: 'eng', name: 'AAC', codec: 'aac', default: true }],
    subtitleTracks: [{ id: 's1', kind: 'subtitle', language: 'eng', name: 'English', codec: 'webvtt',
      delivery: { kind: 'external', format: 'webvtt', url: 'https://plex.example:32400/s1.vtt' } }],
    selectedSubtitleTrackId: 's1', chapters: [], sidecars: [],
    ...overrides,
  };
}

const traits = (overrides: Partial<DownloadsTraits> = {}): DownloadsTraits => ({ ...DEFAULT_DOWNLOAD_TRAITS, ...overrides });
const WEB = traits({ engine: 'page', metered: false, reserveBytes: null, saveFile: { capability: true, headers: true } });

describe('platform traits and space', () => {
  test('a port without traits is the iOS background session; declared traits are read defensively', () => {
    expect(downloadTraits(undefined)).toEqual(DEFAULT_DOWNLOAD_TRAITS);
    expect(DEFAULT_DOWNLOAD_TRAITS).toMatchObject({ engine: 'background', metered: true, reserveBytes: 2 * GB, saveFile: null });
    expect(downloadTraits({ engine: 'bogus' as never, reserveBytes: -4, minimumFreeToOffer: 6.5 * GB, reveal: 1 as never }))
      .toMatchObject({ engine: 'background', reserveBytes: 2 * GB, minimumFreeToOffer: 6.5 * GB, reveal: false });
    expect(downloadTraits({ engine: 'page', reserveBytes: null }).reserveBytes).toBeNull();
  });

  test('a browser keeps 10% of its quota free, and at least 256 MB; devices keep their fixed reserve', () => {
    expect(reserveFor(WEB, 100 * GB)).toBe(10 * GB);
    expect(reserveFor(WEB, 1 * GB)).toBe(256_000_000);
    expect(reserveFor(WEB, null)).toBe(256_000_000);
    expect(reserveFor(traits(), 100 * GB)).toBe(2 * GB);
  });

  test('admission uses the platform reserve: a browser quota admits what a 2 GB reserve would refuse', () => {
    const params = { requestedBytes: 1 * GB, existingItems: [], serverId: 'srv', viewerId: 'v', titleId: '1', freeBytes: 2.5 * GB, capBytes: null };
    expect(checkDownloadSpace(params)).toMatchObject({ allowed: false, reason: 'free_space', neededBytes: 0.5 * GB });
    expect(checkDownloadSpace({ ...params, reserveBytes: reserveFor(WEB, 3 * GB) })).toEqual({ allowed: true });
    const refused = checkDownloadSpace({ ...params, freeBytes: 1.1 * GB, reserveBytes: 256_000_000 });
    expect(refused).toMatchObject({ allowed: false, neededBytes: 156_000_000 });
    expect(refused.allowed ? '' : refused.message).toContain('to keep 256 MB free');
  });
});

describe('what a title offers', () => {
  const base = { supported: true, traits: traits(), titleKind: 'movie', serverAllows: true, credentials: 'headers' as const, persisted: null, freeBytes: 50 * GB };

  test('tvOS (no port), shows and seasons, and servers that refuse the account offer nothing', () => {
    expect(downloadOffer({ ...base, supported: false })).toEqual({ kind: 'none', reason: 'unsupported' });
    expect(downloadOffer({ ...base, titleKind: 'show' })).toEqual({ kind: 'none', reason: 'kind' });
    expect(downloadOffer({ ...base, titleKind: 'episode' })).toEqual({ kind: 'download' });
    expect(downloadOffer({ ...base, serverAllows: false })).toEqual({ kind: 'none', reason: 'not-allowed' });
  });

  test('a browser downloads into persistent storage, and otherwise saves the file where it can', () => {
    expect(downloadOffer({ ...base, traits: WEB, persisted: true })).toEqual({ kind: 'download' });
    // Unknown persistence asks on the viewer's press.
    expect(downloadOffer({ ...base, traits: WEB, persisted: null })).toEqual({ kind: 'download' });
    expect(downloadOffer({ ...base, traits: WEB, persisted: false })).toEqual({ kind: 'save-file' });
    // Safari and Firefox have no save picker: an Ether grant link still saves; header servers can't.
    const linkOnly = traits({ ...WEB, saveFile: { capability: true, headers: false } });
    expect(downloadOffer({ ...base, traits: linkOnly, persisted: false, credentials: 'none' })).toEqual({ kind: 'save-file' });
    const refused = downloadOffer({ ...base, traits: linkOnly, persisted: false, credentials: 'headers' });
    expect(refused).toEqual({ kind: 'none', reason: 'browser' });
    expect(downloadOfferReason(refused)).toContain('Use the Vela app on your phone or computer');
  });

  test('Android TV offers Download only while it can hold a film; phones and desktops always do', () => {
    const tv = traits({ engine: 'service', minimumFreeToOffer: 6 * GB });
    expect(downloadOffer({ ...base, traits: tv, freeBytes: 3 * GB })).toEqual({ kind: 'none', reason: 'space' });
    expect(downloadOffer({ ...base, traits: tv, freeBytes: 6 * GB })).toEqual({ kind: 'download' });
    expect(downloadOffer({ ...base, traits: traits({ engine: 'service' }), freeBytes: 1 * GB })).toEqual({ kind: 'download' });
    expect(downloadOffer({ ...base, traits: traits({ engine: 'shell', reveal: true, export: true }) })).toEqual({ kind: 'download' });
  });
});

describe('download routes and stored paths', () => {
  test('desktop shells resolve stored paths under their own download route only', () => {
    expect(resolveDownloadFileUrl('vela-app://app/vela-downloads/', 'srv/v/1/media.mkv')).toBe('vela-app://app/vela-downloads/srv/v/1/media.mkv');
    expect(resolveDownloadFileUrl('http://vela.localhost/vela-downloads', 'srv/v/1/My Film.mkv')).toBe('http://vela.localhost/vela-downloads/srv/v/1/My%20Film.mkv');
    for (const bad of [
      'vela-app://evil/vela-downloads/', 'http://vela.localhost.evil.com/vela-downloads/', 'https://vela.localhost/vela-downloads/',
      'http://vela.localhost/vela-downloads/../', 'http://user@vela.localhost/vela-downloads/', 'http://vela.localhost/other/',
      'vela-app://app/vela-downloads/?x=1', 'file:///data/../etc/', 'blob:http://vela.localhost/x',
    ]) expect(validDownloadsBase(bad)).toBe(false);
    expect(validDownloadsBase('file:///data/user/0/app.ether.vela/no_backup/vela-downloads/')).toBe(true);
  });

  test('stored paths never leave the downloads root', () => {
    for (const bad of ['../x', 'a/../../b', 'a/./b', '/', '', 'a//b', 'a\\b', 'C:/x', 'a/\u0000b', 'a/\nb']) {
      expect(() => downloadPathSegments(bad)).toThrow('Invalid relative download path');
    }
    expect(downloadPathSegments('/srv/v/1/media.mkv')).toEqual(['srv', 'v', '1', 'media.mkv']);
  });

  test('a local plan uses the port file URLs (blob: on the web) for media and sidecars', () => {
    const urls: Record<string, string> = {
      'srv/viewer-1/101/media.mkv': 'blob:https://ether.example/m', 'srv/viewer-1/101/sidecars/s1.vtt': 'blob:https://ether.example/s',
    };
    const plan = localPlaybackPlan(record(), path => urls[path]!);
    expect(plan.paths[0]).toMatchObject({ url: 'blob:https://ether.example/m', transport: 'file', original: true });
    expect(plan.subtitleTracks[0]?.delivery).toEqual({ kind: 'external', format: 'webvtt', url: 'blob:https://ether.example/s' });
  });

  test('saved and exported file names carry the title, never server IDs, and no path characters', () => {
    expect(downloadFileName(title('101', 'Heat'), 'mkv')).toBe('Heat (1995).mkv');
    expect(downloadFileName({ ...title(), kind: 'episode', name: 'Pilot: Part 1/2', showName: 'Lost', seasonNumber: 1, episodeNumber: 2 }, 'MP4'))
      .toBe('Lost - S01E02 - Pilot Part 1 2.mp4');
    expect(downloadFileName({ ...title(), name: '../..', year: undefined }, '../x')).toBe('Video.mkv');
  });
});

class Port implements DownloadsPort {
  snapshot: DownloadsSnapshot = { items: [], outbox: [] };
  traits?: Partial<DownloadsTraits>;
  free: number | null = 50 * GB;
  persisted = false;
  grant = false;
  started: DownloadTransferRequest[] = [];
  resumed: DownloadTransferRequest[] = [];
  saved: DownloadSaveRequest[] = [];
  fileUrls: string[] = [];
  baseDirectoryUrl() { return 'file:///data/vela-downloads/'; }
  async readSnapshot() { return structuredClone(this.snapshot); }
  async writeSnapshot(snapshot: DownloadsSnapshot) { this.snapshot = structuredClone(snapshot); }
  async freeBytes() { return this.free; }
  async startTransfer(request: DownloadTransferRequest) { this.started.push(request); }
  async pauseTransfer() {}
  async resumeTransfer(request: DownloadTransferRequest) { this.resumed.push(request); }
  async removeTitle() {}
  async removeViewer() {}
  async removeServer() {}
}

class WebPort extends Port {
  override traits = WEB;
  async storage() { return { persisted: this.persisted, quotaBytes: 20 * GB, usageBytes: 1 * GB }; }
  async persist() { this.persisted = this.grant; return this.grant; }
  async fileUrl(path: string) { this.fileUrls.push(path); return `blob:https://ether.example/${encodeURIComponent(path)}`; }
  async saveFile(request: DownloadSaveRequest) { this.saved.push(request); }
}

function harness(port: Port, phase: 'signed-in' | 'offline' = 'signed-in') {
  let headerToken = 1;
  const resolved: string[] = [];
  const resolution = (): DownloadResolution => ({
    title: title('101'), url: 'https://plex.example:32400/library/parts/9/file.mkv?download=1',
    headers: { 'X-Plex-Token': `token-${headerToken++}` }, mimeType: 'video/x-matroska', container: 'mkv',
    byteLength: 4 * GB, etag: '"e"', sourceId: 'part-9', audioTracks: [], subtitleTracks: [],
    selectedSubtitleTrackId: null, chapters: [], sidecars: [],
  });
  let allows = true;
  const adapter = {
    detail: async () => ({ title: title() }),
    downloadsAvailable: async () => allows,
    resolveDownload: async (id: string) => { resolved.push(id); return resolution(); },
  };
  const connection = { record: { id: 'srv', kind: 'plex' as const, name: 'Plex', origin: 'https://plex.example:32400', basePath: '/' }, adapter };
  let viewer = tokens('token', 'viewer-1');
  const session = {
    onReset: () => () => {},
    selected: () => connection,
    ready: async () => connection,
    tokens: async () => viewer,
    declared: async () => ({ subtitleFormats: ['webvtt'] }),
    declaredForDownload: async () => ({ subtitleFormats: ['webvtt'] }),
    key: () => `idem-${resolved.length}`,
  } as unknown as Session;
  const box = new StateBox({
    auth: { ...initialAuth, phase, serverId: 'srv', viewer: 'Viewer 1', viewerId: 'viewer-1' },
    downloads: { ...initialDownloads }, titles: {}, playback: initialPlayback,
  } as unknown as VelaState);
  const downloads = new Downloads(box, session, { downloads: port } as never);
  return {
    box, downloads, resolved,
    refuse() { allows = false; },
    switchViewer(viewerId: string) {
      viewer = tokens(`token-${viewerId}`, viewerId);
      box.update('auth', a => ({ ...a, viewerId, viewer: viewerId }));
    },
  };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 10));

describe('interrupted transfers resume with fresh credentials', () => {
  test('an interrupted transfer resumes once online; a pause the viewer chose stays paused', async () => {
    expect(autoResumable(record({ status: 'paused', errorCode: 'interrupted' }))).toBe(true);
    expect(autoResumable(record({ status: 'paused' }))).toBe(false);
    expect(autoResumable(record({ status: 'failed', errorCode: 'interrupted' }))).toBe(false);
    const port = new Port();
    port.snapshot.items = [
      record({ titleId: '101', status: 'paused', errorCode: 'interrupted', bytesWritten: 1 * GB, etag: '"e"', sourceId: 'part-9' }),
      record({ titleId: '102', status: 'paused', bytesWritten: 1 * GB }),
    ];
    const h = harness(port, 'offline');
    await h.downloads.hydrate();
    await settle();
    expect(port.resumed).toHaveLength(0);
    h.box.update('auth', auth => ({ ...auth, phase: 'signed-in' }));
    await settle();
    expect(h.resolved).toEqual(['101']);
    expect(port.resumed).toHaveLength(1);
    // Re-resolving minted new headers; the partial file is kept because the source is unchanged.
    expect(port.resumed[0]).toMatchObject({ titleId: '101', headers: { 'X-Plex-Token': 'token-1' } });
    expect(h.downloads.item('101')).toMatchObject({ status: 'queued', bytesWritten: 1 * GB, errorCode: undefined });
    expect(h.downloads.item('102')?.status).toBe('paused');
  });

  test('a transfer interrupted by quitting resumes on relaunch when hydration finishes before sign-in', async () => {
    const port = new Port();
    port.snapshot.items = [record({ status: 'paused', errorCode: 'interrupted', bytesWritten: 1 * GB, etag: '"e"', sourceId: 'part-9' })];
    const h = harness(port, 'offline');
    // Launch: no viewer known yet while the index loads.
    h.box.update('auth', auth => ({ ...auth, phase: 'signed-out', serverId: '', viewerId: '' }));
    await h.downloads.hydrate();
    await settle();
    expect(h.box.get().downloads.items).toEqual([]);
    h.box.update('auth', auth => ({ ...auth, phase: 'signed-in', serverId: 'srv', viewerId: 'viewer-1' }));
    await settle();
    expect(port.resumed.map(request => request.titleId)).toEqual(['101']);
  });

  test('an engine that resumes by itself clears the reason it had stopped', async () => {
    const port = new Port();
    port.snapshot.items = [record({ status: 'downloading', bytesWritten: 1 * GB })];
    const h = harness(port, 'offline');
    await h.downloads.hydrate();
    const base = { serverId: 'srv', viewerId: 'viewer-1', titleId: '101' };
    await h.downloads.applyTransferEvent({ ...base, status: 'paused', bytesWritten: 2 * GB, errorCode: 'interrupted', error: 'Waiting for Wi-Fi' });
    expect(h.downloads.item('101')).toMatchObject({ status: 'paused', error: 'Waiting for Wi-Fi' });
    await h.downloads.applyTransferEvent({ ...base, status: 'downloading', bytesWritten: 2.1 * GB });
    expect(h.downloads.item('101')).toMatchObject({ status: 'downloading', error: undefined, errorCode: undefined, neededBytes: undefined });
  });

  test('a transfer the server now refuses stays put rather than retrying forever', async () => {
    const port = new Port();
    port.snapshot.items = [record({ status: 'paused', errorCode: 'interrupted', bytesWritten: 1 * GB })];
    const h = harness(port);
    h.refuse();
    await h.downloads.hydrate();
    await settle();
    expect(port.resumed).toHaveLength(0);
    expect(h.downloads.item('101')).toMatchObject({ status: 'failed', errorCode: 'forbidden' });
  });
});

describe('the browser', () => {
  test('stores a download only after the browser makes storage persistent, then saves files instead', async () => {
    const port = new WebPort();
    const h = harness(port);
    await h.downloads.hydrate();
    // Not yet persistent and never asked: Download, which asks on the press.
    expect(await h.downloads.offer('movie')).toEqual({ kind: 'download' });
    expect(await h.downloads.enqueue('101')).toBeNull();
    expect(await h.downloads.offer('movie')).toEqual({ kind: 'save-file' });
    expect(port.started).toHaveLength(0);
    expect(h.box.get().downloads).toMatchObject({ persisted: false });
    expect(h.box.get().downloads.error).toContain('saves the file to your downloads');

    expect(await h.downloads.saveFile('101')).toBe(true);
    expect(port.saved).toEqual([{
      url: 'https://plex.example:32400/library/parts/9/file.mkv?download=1', headers: { 'X-Plex-Token': 'token-1' },
      fileName: 'Heat (1995).mkv', mimeType: 'video/x-matroska', byteLength: 4 * GB,
    }]);
  });

  test('a persistent origin downloads against its quota, and plays through blob: URLs', async () => {
    const port = new WebPort();
    port.grant = true;
    port.free = 19 * GB;
    const h = harness(port);
    await h.downloads.hydrate();
    expect(await h.downloads.enqueue('101')).not.toBeNull();
    expect(port.started).toHaveLength(1);
    expect(h.box.get().downloads).toMatchObject({ persisted: true, quotaBytes: 20 * GB });
    // 4 GB plus 10% of the 20 GB quota must stay free.
    port.free = 5.9 * GB;
    expect(await h.downloads.enqueue('101')).toBeNull();
    expect(h.box.get().downloads.error).toContain('to keep 2.0 GB free');

    port.snapshot.items = [record({ serverId: 'srv', viewerId: 'viewer-1' })];
    const fresh = harness(port);
    await fresh.downloads.hydrate();
    const plan = await fresh.downloads.planFor('101');
    expect(plan?.paths[0]?.url).toBe(`blob:https://ether.example/${encodeURIComponent('srv/viewer-1/101/media.mkv')}`);
  });
});

describe('per viewer and per server', () => {
  test('another viewer on the device can neither see nor play a download, nor resolve its files', async () => {
    const port = new WebPort();
    port.snapshot.items = [record({ viewerId: 'viewer-1' }), record({ viewerId: 'viewer-2', titleId: '202' })];
    const h = harness(port, 'offline');
    await h.downloads.hydrate();
    expect(h.box.get().downloads.items.map(item => item.titleId)).toEqual(['101']);
    h.switchViewer('viewer-2');
    await settle();
    expect(h.box.get().downloads.items.map(item => item.titleId)).toEqual(['202']);
    port.fileUrls = [];
    expect(await h.downloads.planFor('101')).toBeNull();
    expect(await h.downloads.posterFor('101')).toBeUndefined();
    expect(h.downloads.isPlayable('101')).toBe(false);
    expect(port.fileUrls).toEqual([]);
    expect((await h.downloads.planFor('202'))?.titleId).toBe('202');
  });
});

describe('a refused session keeps downloads (docs/downloads.md)', () => {
  const outboxEntry = { serverId: 'srv', viewerId: 'viewer-1', titleId: '101', positionSeconds: 300, durationSeconds: 6120, completed: false,
    observedAt: '2026-11-27T12:00:00.000Z', idempotencyKey: 'k1' };

  test('signed out after a 401, the files stay listed and playable; the same viewer gets them back', async () => {
    const port = new Port();
    port.snapshot = { items: [record({ viewerId: 'viewer-1' })], outbox: [outboxEntry] };
    const h = harness(port);
    await h.downloads.hydrate();
    await h.downloads.awaitSignIn('srv', 'viewer-1');
    h.box.update('auth', auth => ({ ...auth, phase: 'signed-out', viewerId: '', viewer: '' }));
    await settle();
    expect(h.box.get().downloads.items.map(item => [item.titleId, item.awaitingSignIn])).toEqual([['101', true]]);
    expect(h.box.get().downloads.outbox).toHaveLength(1);
    expect((await h.downloads.planFor('101'))?.paths[0]?.url).toContain('/srv/viewer-1/101/media.mkv');
    // Offline progress while waiting still lands in the outbox under the record's own viewer.
    await h.downloads.recordProgress({ titleId: '101', positionSeconds: 400, observedAt: '2026-11-27T13:00:00.000Z' });
    expect(h.box.get().downloads.outbox.map(entry => [entry.viewerId, entry.positionSeconds])).toEqual([['viewer-1', 400]]);
    expect(allowsOfflineRoute('signed-out', '/downloads', () => true, true)).toBe(true);
    expect(allowsOfflineRoute('signed-out', '/downloads', () => true)).toBe(false);

    h.box.update('auth', auth => ({ ...auth, phase: 'signed-in', viewerId: 'viewer-1', viewer: 'Viewer 1' }));
    await settle();
    expect(h.downloads.item('101')?.awaitingSignIn).toBeUndefined();
    expect(port.snapshot.items[0]?.awaitingSignIn).toBeUndefined();
  });

  test('another viewer signing in sees none of them, and deletes them only when asked', async () => {
    const port = new Port();
    port.snapshot = { items: [record({ viewerId: 'viewer-1', awaitingSignIn: true }), record({ viewerId: 'viewer-2', titleId: '202' })], outbox: [outboxEntry] };
    const h = harness(port);
    h.switchViewer('viewer-2');
    await h.downloads.hydrate();
    await settle();
    expect(h.box.get().downloads.items.map(item => item.titleId)).toEqual(['202']);
    expect(h.box.get().downloads.awaitingElsewhere).toBe(1);
    expect(await h.downloads.planFor('101')).toBeNull();
    expect(port.snapshot.items).toHaveLength(2);
    await h.downloads.removeAwaitingElsewhere();
    expect(port.snapshot.items.map(item => item.viewerId)).toEqual(['viewer-2']);
    expect(port.snapshot.outbox).toEqual([]);
    expect(h.box.get().downloads.awaitingElsewhere).toBe(0);
  });
});
