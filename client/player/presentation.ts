import { clock, number, msg, setLocale } from '../foundation/i18n';
import type { PlaybackPlan, Track } from '../../protocol/v0/types';
import type { Snapshot } from './model';
const snapshots = new Map<string, Snapshot>();
const errors = new Map<string, string>();
function trackLabel(track: Track) {
  const parts = [track.name, track.language !== 'und' ? track.language : '', track.codec.toUpperCase(),
    track.channels ? `${track.channels} ch` : '', track.forced ? 'Forced' : '', track.hearingImpaired ? 'SDH' : ''];
  return parts.filter((value,index) => value && !parts.slice(0,index).some(previous => previous.toLowerCase().includes(value.toLowerCase()))).join(' · ');
}
/** Pure presentation projection for Exact's data realm: no browser API or clock. */
export function playerPresentation(planJson: string, eventJson: string, replyJson: string, localeJSON: string) {
  setLocale(localeJSON);
  let plan = (planJson ? JSON.parse(planJson) : null) as PlaybackPlan | null;
  const reply = (replyJson ? JSON.parse(replyJson) : null) as PlaybackPlan | null;
  if (reply && (!plan || reply.sessionId === plan.sessionId && reply.revision > plan.revision)) plan = reply;
  const event = eventJson ? JSON.parse(eventJson) : null;
  const currentGeneration = (value: { sourceGeneration?: number; seekGeneration?: number }) => !!plan && value.sourceGeneration === plan.sourceGeneration && value.seekGeneration === plan.seekGeneration;
  const errorKey = plan ? `${plan.sessionId}:${plan.sourceGeneration}:${plan.seekGeneration}` : '';
  if (plan && event?.type === 'snapshot' && event.snapshot.sessionId === plan.sessionId && currentGeneration(event.snapshot)) {
    snapshots.set(plan.sessionId, event.snapshot);
    if (!event.snapshot.failure) errors.delete(errorKey);
  }
  if (plan && event?.type === 'error' && event.sessionId === plan.sessionId && currentGeneration(event)) errors.set(errorKey, event.failure.message);
  if (snapshots.size > 8) snapshots.delete(snapshots.keys().next().value!);
  if (errors.size > 8) errors.delete(errors.keys().next().value!);
  const cached = plan ? snapshots.get(plan.sessionId) : undefined;
  const snapshot = cached && currentGeneration(cached) ? cached : undefined;
  const position = snapshot?.seekTarget ?? snapshot?.position ?? plan?.positionSeconds ?? 0;
  const duration = snapshot?.duration ?? plan?.durationSeconds ?? 0;
  const path = plan?.paths.find(p => p.id === (snapshot?.sourceId ?? plan.selectedPathId));
  const state = snapshot?.seekTarget != null ? 'buffering' : snapshot?.state ?? 'loading';
  const quality = path?.qualities.find(q => q.id === snapshot?.renditionId);
  const capability = snapshot?.capabilities;
  const selectedAudio = plan?.audioTracks.find(t => t.id === snapshot?.audioTrackId || !snapshot && t.id === plan.selectedAudioTrackId);
  const subtitles = plan?.subtitleTracks ?? [];
  const sourceGeneration = snapshot?.sourceGeneration ?? plan?.sourceGeneration ?? 0;
  const seekGeneration = snapshot?.seekGeneration ?? plan?.seekGeneration ?? 0;
  return {
    planJson: plan ? JSON.stringify(plan) : "",
    stopCommandJson: plan && plan.state !== 'ended' ? JSON.stringify({ type: 'session-command', sessionId: plan.sessionId,
      command: { kind: 'stop', sourceGeneration, seekGeneration, idempotencyKey: `stop-${plan.sessionId}-${sourceGeneration}-${seekGeneration}` } }) : '',
    waiting: snapshot?.waiting ?? state === 'loading', volume: snapshot?.volume ?? 1, muted: snapshot?.muted ?? false,
    speed: snapshot?.speed ?? 1, speeds: snapshot?.speeds ?? [],
    preparation: snapshot?.preparation ? msg(`data.preparation.${snapshot.preparation}`) : !snapshot ? msg('data.preparation.media-metadata') : '',
    ready: !!snapshot && !['idle','loading'].includes(state), state, playing: state === 'playing', position, duration,
    elapsed: clock(position), remaining: duration > 0 ? clock(Math.max(0, duration - position)) : msg('data.live'),
    progress: duration > 0 ? Math.min(100, position / duration * 100) : 0,
    reason: snapshot?.failure?.message ?? '', actionError: plan ? errors.get(errorKey) ?? '' : '',
    path: snapshot?.strategy || path?.kind ? msg(`data.${snapshot?.strategy ?? path?.kind}`) : '', backend: snapshot?.backend ?? '',
    quality: quality || path?.quality ? `${number((quality ?? path!.quality!).height, {useGrouping:false})}p` : path?.id === 'primary' || path?.kind === 'direct' ? msg('data.original') : snapshot?.backend === 'native-hls' ? msg('data.fixedQuality') : msg('data.starting'),
    lockedQuality: path?.original || path && !path.qualities.length && (path.id === 'primary' || path.quality) ? `path:${path.id}` : snapshot?.lockedQuality ?? '',
    qualityAuto: snapshot?.backend === 'mse' && (path?.qualities.length ?? 0) > 1,
    pendingAudioId: snapshot?.pendingAudioTrackId ?? '',
    pendingSubtitleId: snapshot?.pendingSubtitleTrackId ?? '',
    audioId: snapshot?.audioTrackId ?? plan?.selectedAudioTrackId ?? '', audioLabel: selectedAudio?.name ?? msg('data.originalAudio'),
    subtitleId: snapshot?.subtitleTrackId ?? plan?.selectedSubtitleTrackId ?? '',
    audio: (plan?.audioTracks ?? []).map(t => ({ id: t.id, label: trackLabel(t) })),
    subtitles: subtitles.map(t => ({ id: t.id, label: trackLabel(t) })),
    qualities: [
      ...(plan?.paths ?? []).filter(p => p.original || p.id === 'primary').map(p => ({id:`path:${p.id}`,label:msg('data.original')})),
      ...(path?.qualities ?? []).map(q => ({id:q.id,label:`${number(q.height,{useGrouping:false})}p${q.codecStatus === 'pending' ? ` · ${msg('data.starting')}` : ''}`})),
      ...(plan?.paths ?? []).filter(p => (p.id !== path?.id || !p.qualities.length) && (p.readiness === 'on-demand' || p.readiness === 'ready') && p.quality &&
        !!path?.sourceId && p.sourceId === path.sourceId && !!path?.timelineId && p.timelineId === path.timelineId && (p.edition ?? '') === (path.edition ?? ''))
        .map(p => ({id:`path:${p.id}`,label:`${number(p.quality!.height,{useGrouping:false})}p`})),
    ],
    paths: (plan?.paths ?? []).filter(p => (p.readiness === 'ready' || p.readiness === 'on-demand') &&
      (p.id === path?.id || !!path?.sourceId && p.sourceId === path.sourceId && !!path?.timelineId && p.timelineId === path.timelineId && (p.edition ?? '') === (path.edition ?? '')))
      .map(p => ({ id: p.id, label: p.original ? msg('data.original') : p.quality ? `${number(p.quality.height,{useGrouping:false})}p · ${msg(`data.${p.kind}`)}` : msg(`data.${p.kind}`) })),
    pathId: path?.id ?? '',
    chapters: (plan?.chapters ?? []).map(c => ({ id: c.id, label: `${clock(c.startSeconds)} · ${c.name}`, seconds: c.startSeconds, percent: duration > 0 ? c.startSeconds / duration * 100 : 0 })),
    buffered: (snapshot?.playable ?? []).map((r,i) => ({ id: String(i), left: duration > 0 ? Math.max(0, r.start / duration * 100) : 0, width: duration > 0 ? Math.min(100, (r.end - r.start) / duration * 100) : 0 })),
    pip: capability?.pip ?? false, fullscreen: capability?.fullscreen ?? false,
  };
}
