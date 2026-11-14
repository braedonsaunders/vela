import type { PlaybackPlan, PlayerObservation } from '../../protocol/v0/types';
import type { PlaybackSession, Snapshot } from './model';
/** Protocol paths contain server-qualified codec strings, never guessed capabilities. */
export function sessionFromPlan(plan: PlaybackPlan): PlaybackSession {
  const selected = plan.paths.find(p => p.id === plan.selectedPathId);
  if (!selected) throw new Error('Plan selected path is absent');
  const edition = selected.edition ?? '';
  return {
    id: plan.sessionId, mediaId: plan.titleId ?? plan.channelId ?? plan.extraId ?? '', edition,
    position: plan.positionSeconds, live: !!plan.live, liveWindowStart: plan.live?.windowStartSeconds, liveMaxDrift: plan.live?.maxDriftSeconds, lowDelay: plan.live?.mode === 'low-delay', sourceGeneration: plan.sourceGeneration, seekGeneration: plan.seekGeneration,
    audioTrackId: plan.selectedAudioTrackId, subtitleTrackId: plan.selectedSubtitleTrackId ?? undefined,
    audioTracks: plan.audioTracks.map(t => ({ id: t.id, label: t.name, language: t.language })),
    subtitleTracks: plan.subtitleTracks.filter(t => t.codec.toLowerCase() === 'webvtt' || t.codec.toLowerCase() === 'vtt').map(t => ({ id: t.id, label: t.name, language: t.language, url: t.url })),
    sources: plan.paths.filter(p => p.readiness === 'ready' && (p.edition ?? '') === edition).map(p => ({
      id: p.id, strategy: p.kind, delivery: p.transport, url: p.url, mime: p.mimeType,
      edition: p.edition ?? '', timeline: p.timelineId ?? `unverified:${p.id}`,
      audioTrackId: plan.selectedAudioTrackId,
      recoveryAllowed: p.id === selected.id || !!selected.timelineId && !!p.timelineId && p.boundaries.some(b => b.independent && b.compatibility === 'verified-timeline' && b.timelineId === selected.timelineId && (!plan.selectedAudioTrackId || b.audioTrackIds.includes(plan.selectedAudioTrackId)) && (!plan.selectedSubtitleTrackId || b.subtitleTrackIds.includes(plan.selectedSubtitleTrackId))),
      renditions: p.qualities.map(q => ({ id: q.id, url: q.url, bandwidth: q.bitrate, height: q.height,
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
    ...(snapshot.audioTrackId === null ? {} : { audioTrackId: snapshot.audioTrackId }), subtitleTrackId: snapshot.subtitleTrackId,
    ...(snapshot.failure ? { error: { class: snapshot.failure.kind === 'network' ? 'transient' : snapshot.failure.kind === 'decoder' ? 'decoder' : 'source', message: snapshot.failure.message } } : {}),
  };
}
