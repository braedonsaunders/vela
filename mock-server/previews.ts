import type { ClientCapabilities, PlaybackPlan, PreviewGrant, Title, TrailerPreviewResponse } from '../protocol/v0/types';
import { mediaRoot } from './media';

export interface PreviewSession { owner: string; viewerId: string; titleId: string; token: string; expires: number; grant: PreviewGrant; ended: boolean }
export const previewSessions = new Map<string, PreviewSession>();
const preparing = new Map<string, number>();

export async function trailerPreview(owner: string, viewerId: string, title: Title, client: ClientCapabilities, accessExpires: number): Promise<TrailerPreviewResponse> {
  if (!['movie', 'show'].includes(title.kind)) return { state: 'unavailable', reason: 'No synthetic trailer for this title kind' };
  if (!client.containers.includes('mp4') || !client.videoCodecs.some(c => c === 'h264' || c.startsWith('avc1')) || !client.audioCodecs.some(c => c === 'aac' || c.startsWith('mp4a'))) return { state: 'unavailable', reason: 'Synthetic trailer requires MP4 H.264/AAC support' };
  if (!await Bun.file(`${mediaRoot}/direct.mp4`).exists()) return { state: 'unavailable', reason: 'Generate local synthetic media first' };
  const now = Date.now();
  for (const [id, p] of previewSessions) if (p.expires <= now || p.ended) previewSessions.delete(id);
  // Preparing is bounded cache work, never a playback session or grant.
  const readyAt = preparing.get(title.id) ?? now + 1000;
  preparing.set(title.id, readyAt);
  if (now < readyAt) return { state: 'preparing', retryAfterSeconds: 1 };
  const existing = [...previewSessions.values()].find(p => p.owner === owner && p.titleId === title.id);
  if (existing) return { state: 'ready', grant: existing.grant };
  for (const p of previewSessions.values()) if (p.viewerId === viewerId) p.ended = true;
  const id = crypto.randomUUID(), token = crypto.randomUUID(), expires = Math.min(accessExpires, now + 60000);
  const grant: PreviewGrant = { sessionId: id, url: `/sessions/media/${id}/${token}/direct.mp4`, mimeType: 'video/mp4', expiresAt: new Date(expires).toISOString(), purpose: 'preview', sourceGeneration: 1, seekGeneration: 1 };
  previewSessions.set(id, { owner, viewerId, titleId: title.id, token, expires, grant, ended: false });
  return { state: 'ready', grant };
}

export function stopPreview(p: PreviewSession): PlaybackPlan {
  p.ended = true;
  return { sessionId: p.grant.sessionId, titleId: p.titleId, purpose: 'preview', revision: 2, sourceGeneration: p.grant.sourceGeneration, seekGeneration: p.grant.seekGeneration,
    state: 'ended', positionSeconds: 0, paths: [], selectedPathId: '', audioTracks: [], subtitleTracks: [], selectedSubtitleTrackId: null, chapters: [], fallback: { state: 'unsupported' } };
}
