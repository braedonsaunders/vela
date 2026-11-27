import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { DownloadGrant, DownloadRequest, OfflineWatchRequest, TitleDetail, WatchState } from '../packages/protocol/types';
import { faults, formatsRoot, mediaRoot, originalFixture, serveMedia } from './media';
import { sidecarFixture } from './sessions';

const enabled = process.env.VELA_MOCK_DOWNLOADS === '1';
const maxPerDay = 3;
const ticketLifetime = 15 * 60_000;
const tickets = new Map<string, { owner: string; resource: string; etag: string; expires: number }>();
const counts = new Map<string, number>();

export function downloadFeature(viewerId?: string) {
  const used = viewerId ? counts.get(viewerDay(viewerId)) ?? 0 : 0;
  return { enabled, ...(enabled ? { maxPerDay, remainingToday: maxPerDay - used } : {}) };
}

function viewerDay(viewerId: string): string {
  return `${viewerId}/${new Date().toISOString().slice(0, 10)}`;
}

async function fileIdentity(path: string): Promise<string> {
  const file = Bun.file(path);
  const stat = await file.stat();
  return `"${createHash('sha256').update(JSON.stringify([path, stat.size, stat.mtimeMs, stat.ino])).digest('hex')}"`;
}

function downloadError(status: number, code: string, message: string): never {
  throw Response.json({
    error: { class: status === 409 ? 'conflict' : status === 503 ? 'source' : 'policy', code, message, retry: { allowed: false } },
  }, { status });
}

export async function issueDownload(owner: string, viewerId: string, detail: TitleDetail, request: DownloadRequest): Promise<DownloadGrant> {
  if (!enabled || !detail.canPlay || !['movie', 'episode'].includes(detail.title.kind)) {
    downloadError(403, 'download_not_allowed', 'This original is unavailable to download');
  }
  // The available mock releases share the same deterministic original fixture.
  const available = ['0', '1', '2'].map(slot => `${detail.title.id}-0000-4000-8000-${slot.padStart(12, '0')}`);
  if (request.versionId !== undefined && !available.includes(request.versionId)) {
    downloadError(409, 'version_unavailable', 'This download version is unavailable');
  }
  const resource = originalFixture.name ? `original/${originalFixture.name}` : 'direct.mp4';
  const path = originalFixture.name ? join(formatsRoot, originalFixture.name) : join(mediaRoot, resource);
  const file = Bun.file(path);
  if (!await file.exists()) downloadError(503, 'media_not_generated', 'Generate the mock original fixture first');
  const etag = await fileIdentity(path);
  const day = viewerDay(viewerId);
  const used = counts.get(day) ?? 0;
  if (used >= maxPerDay) downloadError(429, 'download_limit', 'Daily download limit reached');
  const now = Date.now();
  for (const [ticket, grant] of tickets) if (grant.expires <= now) tickets.delete(ticket);
  const expires = now + ticketLifetime;
  const ticket = randomUUID();
  counts.set(day, used + 1);
  tickets.set(ticket, { owner, resource, etag, expires });
  const container = resource.split('.').at(-1)!;
  const mimeType = ({ mkv: 'video/x-matroska', webm: 'video/webm', mov: 'video/quicktime' } as Record<string, string>)[container] ?? 'video/mp4';
  return {
    url: `/vela/v0/download/${ticket}`, etag, expiresAt: new Date(expires).toISOString(),
    mimeType, container, byteLength: file.size, sourceId: resource,
    originalVideo: originalFixture.video ?? { codec: 'h264' },
    audioTracks: originalFixture.audio ?? [],
    // With the sidecar fixture on (POST /__admin/sidecar {"enabled":true}), the generated original carries an
    // external WebVTT sidecar that the download fetches through the same ticket.
    subtitleTracks: sidecarFixture.enabled && !originalFixture.name ? [{ id: 'sub-en', kind: 'subtitle', language: 'en',
      name: 'English · sidecar', codec: 'webvtt', delivery: { kind: 'external', format: 'webvtt', url: `/vela/v0/download/${ticket}/subtitles.vtt` } }]
      : originalFixture.subtitles ?? [],
    chapters: detail.chapters ?? [],
  };
}

export async function serveDownload(req: Request, ticket: string, active: (owner: string) => boolean, sidecar = false): Promise<Response> {
  const grant = tickets.get(ticket);
  if (!grant || grant.expires <= Date.now() || !active(grant.owner)) return new Response(null, { status: 404 });
  if (sidecar) return serveMedia(req, 'subtitles.vtt', false);
  const path = grant.resource.startsWith('original/')
    ? join(formatsRoot, grant.resource.slice(9))
    : join(mediaRoot, grant.resource);
  if (await fileIdentity(path).catch(() => undefined) !== grant.etag) return new Response(null, { status: 409 });
  const truncate = req.method === 'GET' && faults.downloadTruncate > 0;
  if (truncate) faults.downloadTruncate--;
  return serveMedia(req, grant.resource, truncate, grant.etag);
}

export function applyOfflineWatch(watch: WatchState, body: OfflineWatchRequest): boolean {
  if (typeof body.positionSeconds !== 'number' || !Number.isFinite(body.positionSeconds) || body.positionSeconds < 0 ||
      typeof body.observedAt !== 'string' || !Number.isFinite(Date.parse(body.observedAt)) ||
      (body.played !== undefined && body.played !== true)) {
    throw Response.json({ error: { class: 'request', code: 'invalid_offline_progress', message: 'Valid positionSeconds and observedAt required', retry: { allowed: false } } }, { status: 400 });
  }
  if (watch.lastViewedAt && Date.parse(watch.lastViewedAt) >= Date.parse(body.observedAt)) return false;
  watch.positionSeconds = body.played ? 0 : body.positionSeconds;
  watch.played = watch.played || body.played === true;
  watch.lastViewedAt = body.observedAt;
  return true;
}
