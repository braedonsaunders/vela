import type { Snapshot, VelaPlayerProps } from '@vela/player-api';
import { defaultSubtitlePreferences, type SubtitlePreferences } from '../../web/engine/universal/subtitles/types';
import { mpvPlaybackFormat, type HostOutputFacts, type MpvFacts } from './mpv-format';

/** Native telemetry is sparse; session identity always comes from the authoritative plan. */
export function windowsSnapshot(value: unknown, props: VelaPlayerProps, subtitles?: SubtitlePreferences): Snapshot {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<Snapshot> & { mpv?: MpvFacts; output?: HostOutputFacts };
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
    chapters: plan?.chapters ?? [], subtitleError: null, subtitleStyle: { ...(subtitles ?? defaultSubtitlePreferences) },
    // A host that reports mpv facts draws subtitles with libmpv, which takes the appearance preferences.
    subtitleStyleAvailable: !!subtitles && raw.mpv !== undefined,
    format: raw.mpv ? mpvPlaybackFormat(raw.mpv, raw.output, plan) : raw.format ?? null, subtitleClientOnly: raw.subtitleClientOnly, audioClientOnly: raw.audioClientOnly, live: raw.live ?? null, seekTarget: nullable(raw.seekTarget), waiting: state === 'buffering',
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

/** Polling can deliver a final snapshot from the source retired by a newer prop. */
export function snapshotMatchesPlan(value: unknown, props: VelaPlayerProps): boolean {
  if (!value || typeof value !== 'object') return true;
  const raw = value as Partial<Snapshot>;
  if (raw.sessionId !== undefined && raw.sessionId !== props.plan?.sessionId) return false;
  if (raw.sourceGeneration !== undefined && raw.sourceGeneration !== props.plan?.sourceGeneration) return false;
  if (raw.seekGeneration !== undefined && raw.seekGeneration !== props.plan?.seekGeneration) return false;
  return true;
}
