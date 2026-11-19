import type { Snapshot, VelaPlayerProps } from '@vela/player-api';
import { defaultSubtitlePreferences } from '../../web/engine/universal/subtitles/types';

/** Native telemetry is sparse; session identity always comes from the authoritative plan. */
export function windowsSnapshot(value: unknown, props: VelaPlayerProps): Snapshot {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<Snapshot>;
  const plan = props.plan;
  const path = plan?.paths.find(path => path.id === plan.selectedPathId);
  const number = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const nullable = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const states: Snapshot['state'][] = ['idle', 'loading', 'playing', 'paused', 'buffering', 'recovering', 'ended', 'failed'];
  const state = states.includes(raw.state!) ? raw.state! : 'loading';
  const audioTracks = raw.audioTracks ?? plan?.audioTracks.map(track => ({ ...track, label: track.name })) ?? [];
  const subtitleTracks = raw.subtitleTracks ?? plan?.subtitleTracks.map(track => ({ ...track, label: track.name })) ?? [];
  const position = Math.max(0, number(raw.position, plan?.positionSeconds ?? 0));
  const bufferAheadSeconds = nullable(raw.bufferAheadSeconds);
  return {
    sessionId: plan?.sessionId ?? null, sourceGeneration: plan?.sourceGeneration ?? 0,
    seekGeneration: plan?.seekGeneration ?? 0, state,
    sourceId: plan?.selectedPathId ?? null, strategy: path?.kind ?? null, backend: raw.backend ?? 'file',
    renditionId: null, qualityIds: [], capabilities: { pip: false, fullscreen: true, audioSwitch: raw.capabilities?.audioSwitch ?? audioTracks.length > 1 },
    lockedQuality: null, audioTracks, subtitleTracks, renditions: [], video: raw.video ?? null, diagnostics: raw.diagnostics,
    currentBitrateBps: null, requiredBandwidthBps: null, bufferAheadSeconds, throughputHistory: [],
    speed: number(raw.speed, 1), speeds: raw.speeds ?? [0.5, 0.75, 1, 1.25, 1.5, 2], pendingSubtitleTrackId: null,
    chapters: plan?.chapters ?? [], subtitleError: null, subtitleStyle: { ...defaultSubtitlePreferences },
    subtitleStyleAvailable: false, subtitleClientOnly: raw.subtitleClientOnly, audioClientOnly: raw.audioClientOnly, live: raw.live ?? null, seekTarget: nullable(raw.seekTarget), waiting: state === 'buffering',
    volume: Math.max(0, Math.min(1, number(raw.volume, 1))), muted: raw.muted === true,
    preparation: state === 'loading' ? 'media-metadata' : null, position,
    duration: nullable(raw.duration) ?? plan?.durationSeconds ?? null,
    playable: bufferAheadSeconds !== null && bufferAheadSeconds > 0 ? [{ start: position, end: position + bufferAheadSeconds }] : [],
    throughputBps: nullable(raw.throughputBps), droppedFrames: nullable(raw.droppedFrames), totalFrames: nullable(raw.totalFrames),
    audioTrackIds: audioTracks.map(track => track.id), audioTrackId: raw.audioTrackId === null ? null : raw.audioTrackId ?? plan?.selectedAudioTrackId ?? null,
    pendingAudioTrackId: null, subtitleTrackId: raw.subtitleTrackId === null ? null : raw.subtitleTrackId ?? plan?.selectedSubtitleTrackId ?? null,
    failure: props.serverError ?? raw.failure ?? null,
  };
}
