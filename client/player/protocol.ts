import {codecFamily} from './video-info';
import type { PlaybackPlan, PlaybackPath, PlayerObservation } from '../../protocol/v0/types';
import type { PlaybackSession, Snapshot } from './model';
/** Protocol paths contain server-qualified codec strings, never guessed capabilities. */
export function sessionFromPlan(plan: PlaybackPlan): PlaybackSession {
  const selected = plan.paths.find(p => p.id === plan.selectedPathId);
  if (!selected) throw new Error('Plan selected path is absent');
  const edition = selected.edition ?? '';
  return {
    id: plan.sessionId, serverState: plan.state, serverControlled: true, selectedSourceId: plan.selectedPathId, mediaId: plan.titleId ?? plan.channelId ?? plan.extraId ?? '', edition,
    position: plan.positionSeconds, duration: plan.durationSeconds, live: !!plan.channelId, livePolicy: plan.livePolicy, liveWindowStart: plan.live?.windowStartSeconds, liveEdge: plan.live?.liveEdgeSeconds, liveMaxDrift: plan.live?.maxDriftSeconds, lowDelay: plan.live?.mode === 'low-delay', sourceGeneration: plan.sourceGeneration, seekGeneration: plan.seekGeneration,
    audioTrackId: plan.selectedAudioTrackId, subtitleTrackId: plan.selectedSubtitleTrackId ?? undefined,
    chapters: plan.chapters,
    audioTracks: plan.audioTracks.map(t => ({ id: t.id, label: t.name, language: t.language, codec: t.codec, channels: t.channels, streamIndex: t.streamIndex })),
    subtitleTracks: plan.subtitleTracks.map(t => ({ id: t.id, label: t.name, language: t.language, codec: t.codec, streamIndex: t.streamIndex,
      url: t.delivery?.kind === 'external' ? t.delivery.url : t.url, delivery: t.delivery, forced: t.forced, hearingImpaired: t.hearingImpaired })),
    onDemandSources: plan.paths.filter(p => p.readiness === 'on-demand' && !!p.sourceId && p.sourceId === selected.sourceId && !!p.timelineId && p.timelineId === selected.timelineId && (p.edition ?? '') === edition).map(p => ({id:p.id,onDemand:true})),
    sources: plan.paths.filter((p): p is PlaybackPath & { readiness: 'ready'; url: string } => p.readiness === 'ready' && (p.edition ?? '') === edition).map(p => ({
      id: p.id, strategy: p.kind, delivery: p.transport, url: p.url, mime: p.mimeType,
      edition: p.edition ?? '', timeline: p.timelineId ?? `unverified:${p.id}`,
      audioTrackId: plan.selectedAudioTrackId,
      boundaries: p.boundaries.filter(b => b.independent).map(b => b.atSeconds),
      recoveryAllowed: p.id === selected.id || !!selected.timelineId && !!p.timelineId && p.boundaries.some(b => b.independent && (b.compatibility === 'verified-timeline' || b.compatibility === 'same-source' && !!p.sourceId && p.sourceId === selected.sourceId) && b.timelineId === selected.timelineId && (!plan.selectedAudioTrackId || b.audioTrackIds.includes(plan.selectedAudioTrackId)) && (!plan.selectedSubtitleTrackId || b.subtitleTrackIds.includes(plan.selectedSubtitleTrackId))),
      quality:p.quality,original: p.original, originalVideo: p.originalVideo, sourceRevision: p.sourceId, timelineOriginSeconds: p.timelineOriginSeconds, initialRenditionId: p.initialRenditionId, audioRenditions: p.audioRenditions,
      renditions: p.qualities.map(q => ({ id: q.id, url: q.url, bandwidth: q.bitrate, height: q.height,width:q.width,codec:q.codec??codecFamily(q.videoCodec),dynamicRange:q.dynamicRange,averageBitrate:q.averageBitrate, audioGroupId: q.audioGroupId, codecStatus: q.codecStatus === 'pending' || !q.videoCodec.trim() ? 'pending' : 'verified',
        mime: `video/mp4; codecs="${q.videoCodec}${q.audioCodec ? `,${q.audioCodec}` : ''}"` })),
    })),
  };
}
/** Deliberately no decoder/bandwidth estimates when the backend cannot observe them. */
export function observation(snapshot: Snapshot, sequence: number): PlayerObservation | null {
  if (!snapshot.sessionId || !snapshot.sourceId) return null;
  return {
    idempotencyKey: `${snapshot.sessionId}:${snapshot.sourceGeneration}:${snapshot.seekGeneration}:${sequence}`,
    sourceGeneration: snapshot.sourceGeneration, seekGeneration: snapshot.seekGeneration,
    sequence, observedAt: new Date().toISOString(), positionSeconds: snapshot.position,
    state: snapshot.state === 'playing' ? 'playing' : snapshot.state === 'ended' ? 'ended' : snapshot.state === 'paused' ? 'paused' : 'buffering',
    playableRanges: snapshot.playable.map(r => ({ startSeconds: r.start, endSeconds: r.end })), selectedPathId: snapshot.sourceId,
    ...(snapshot.throughputBps === null ? {} : { throughputBps: snapshot.throughputBps }),
    ...(snapshot.droppedFrames === null ? {} : { droppedFrames: snapshot.droppedFrames }),
    ...(snapshot.totalFrames === null ? {} : { totalFrames: snapshot.totalFrames }),
    ...(snapshot.audioTrackId === null || snapshot.audioClientOnly ? {} : { audioTrackId: snapshot.audioTrackId }),
    ...(snapshot.subtitleClientOnly ? {} : {subtitleTrackId:snapshot.subtitleReportingId??snapshot.subtitleTrackId}),
    ...(snapshot.failure ? { error: { class: snapshot.failure.kind === 'network' ? 'transient' : snapshot.failure.kind === 'decoder' ? 'decoder' : 'source', message: snapshot.failure.message } } : {}),
  };
}
