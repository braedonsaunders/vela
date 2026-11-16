// What the player chrome shows, from the server's plan and the view's latest snapshot: the
// clock, the timeline, the choosable tracks, qualities, speeds and chapters, and the playback
// facts for the info card. Pure: no React, no clock. A value the engine has not reported stays
// empty rather than estimated. (The compiled chrome read the same projection from
// client/player/presentation.ts.)
import { msg, number } from '@vela/core';
import { QUALITY_HEADROOM, videoInfo, type VideoInfo } from '../../../../../client/player/video-info';
import type { PlaybackPlan, Snapshot } from '@vela/player-api';

type Path = PlaybackPlan['paths'][number];
type Range = VideoInfo['dynamicRange'];

/** A track as the menus list it: its name, then one muted detail ("English", "TrueHD · 8 ch"). */
export interface TrackOption {
  id: string;
  name: string;
  detail: string;
}

/** A quality: its resolution (or "Original"), what sets it apart, its rate and what it needs. */
export interface QualityOption {
  id: string;
  resolution: string;
  traits: string;
  rate: string;
  needs: string;
  pending: boolean;
}

export interface ChapterMark {
  id: string;
  name: string;
  seconds: number;
  /** Where it starts on the timeline, 0 to 1. */
  at: number;
}

export interface PlayerStats {
  bitrate: string;
  throughput: string;
  required: string;
  /** Measured throughput over what the quality needs; 0 when either is unknown. */
  headroom: number;
  /** Recent throughput samples, each 0 to 1 of the peak. */
  history: number[];
  buffer: string;
  resolution: string;
  video: string;
  delivery: string;
  dropped: string;
}

export interface SubtitleLook {
  size: string;
  background: string;
  color: string;
  position: string;
}

export interface PlayerView {
  state: Snapshot['state'];
  playing: boolean;
  ended: boolean;
  /** The engine is preparing, buffering, seeking or recovering. */
  waiting: boolean;
  position: number;
  duration: number;
  /** Played fraction, 0 to 1. */
  progress: number;
  elapsed: string;
  remaining: string;
  /** Media the engine holds, as fractions of the timeline. */
  buffered: { start: number; end: number }[];
  volume: number;
  muted: boolean;
  speed: number;
  /** The rates the engine offers; empty when it cannot change speed. */
  speeds: number[];
  audio: TrackOption[];
  audioId: string;
  pendingAudioId: string;
  subtitles: TrackOption[];
  subtitleId: string;
  pendingSubtitleId: string;
  subtitleError: string;
  subtitleLook: SubtitleLook | null;
  qualities: QualityOption[];
  /** The engine picks the rendition itself unless one is locked. */
  qualityAuto: boolean;
  lockedQuality: string;
  /** The quality playing: a rendition id, or `path:<id>` for a path of one quality. */
  qualityId: string;
  /** The quality playing, in words ("1080p · 8 Mbps"). */
  quality: string;
  path: string;
  chapters: ChapterMark[];
  stats: PlayerStats;
  pip: boolean;
  fullscreen: boolean;
  /** The engine's own failure, in words ("" while it plays). */
  reason: string;
  recoverable: boolean;
}

/** Seconds as a clock: 4:05, 1:02:09. */
export function timecode(total: number): string {
  const whole = Math.max(0, Math.floor(total));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor(whole / 60) % 60;
  const seconds = whole % 60;
  const two = (n: number) => number(n, { minimumIntegerDigits: 2, useGrouping: false });
  const plain = (n: number) => number(n, { useGrouping: false });
  return hours > 0 ? `${plain(hours)}:${two(minutes)}:${two(seconds)}` : `${plain(minutes)}:${two(seconds)}`;
}

function rate(bps: number | null | undefined): string {
  if (bps == null || !Number.isFinite(bps) || bps <= 0) return '';
  return `${number(bps / 1e6, { maximumFractionDigits: 1 })} Mbps`;
}

function resolutionOf(video: { width: number; height: number } | null | undefined): string {
  if (!video) return '';
  return video.width >= 3800 ? '4K' : `${number(video.height, { useGrouping: false })}p`;
}

function rangeName(range: Range | undefined): string {
  switch (range) {
    case 'dv': return 'Dolby Vision';
    case 'hdr10': return 'HDR10';
    case 'hlg': return 'HLG';
    case 'sdr': return 'SDR';
    default: return '';
  }
}

const CODECS: Record<string, string> = { h264: 'H.264', hevc: 'HEVC', av1: 'AV1', vp9: 'VP9' };

function codecName(codec: string | undefined): string {
  if (!codec) return '';
  return CODECS[codec] ?? codec.toUpperCase();
}

/** A track from the plan (named) or the engine (labelled). */
interface AnyTrack {
  id: string;
  name?: string;
  label?: string;
  language?: string;
  codec?: string;
  channels?: number;
  forced?: boolean;
  hearingImpaired?: boolean;
}

/** Name, language, codec, channels, forced, SDH: the first is the name, the rest its detail. */
function trackOption(track: AnyTrack): TrackOption {
  const parts = [
    track.name ?? track.label ?? '',
    track.language && track.language !== 'und' ? track.language : '',
    (track.codec ?? '').toUpperCase(),
    track.channels ? `${track.channels} ch` : '',
    track.forced ? 'Forced' : '',
    track.hearingImpaired ? 'SDH' : '',
  ];
  const kept = parts.filter((value, index) =>
    value && !parts.slice(0, index).some(previous => previous.toLowerCase().includes(value.toLowerCase())));
  return { id: track.id, name: kept[0] ?? track.id, detail: kept.slice(1).join(' · ') };
}

function stats(snapshot: Snapshot | null): PlayerStats {
  const samples = (snapshot?.throughputHistory ?? []).filter(v => Number.isFinite(v) && v > 0).slice(-30);
  const peak = Math.max(0, ...samples);
  const throughput = snapshot?.throughputBps;
  const required = snapshot?.requiredBandwidthBps;
  const ahead = snapshot?.bufferAheadSeconds;
  const video = snapshot?.video ?? null;
  const dropped = snapshot?.droppedFrames;
  const decoded = snapshot?.totalFrames;
  return {
    bitrate: rate(snapshot?.currentBitrateBps),
    throughput: rate(throughput),
    required: rate(required),
    headroom: throughput && required ? throughput / required : 0,
    history: peak ? samples.map(v => v / peak) : [],
    buffer: ahead == null ? '' : number(ahead, { style: 'unit', unit: 'second', unitDisplay: 'short', maximumFractionDigits: 1 }),
    resolution: resolutionOf(video),
    video: [codecName(video?.codec), rangeName(video?.dynamicRange ?? undefined)].filter(Boolean).join(' · '),
    delivery: snapshot?.strategy ? msg(snapshot.strategy === 'direct' ? 'data.statsDirect' : 'data.statsConverted') : '',
    dropped: dropped == null || decoded == null ? '' : msg('data.frameCount', { dropped: number(dropped), decoded: number(decoded) }),
  };
}

function needs(bitrate: number | undefined): string {
  const needed = rate(bitrate ? bitrate * QUALITY_HEADROOM : undefined);
  return needed ? msg('data.needsBandwidth', { bandwidth: needed }) : '';
}

/** Several paths may play the same title: the one playing, and those it can switch to. */
function siblings(plan: PlaybackPlan, current: Path | undefined): Path[] {
  if (!current?.sourceId || !current.timelineId) return [];
  return plan.paths.filter(p =>
    p.sourceId === current.sourceId &&
    p.timelineId === current.timelineId &&
    (p.edition ?? '') === (current.edition ?? ''));
}

function qualities(plan: PlaybackPlan | null, current: Path | undefined): QualityOption[] {
  if (!plan) return [];
  const originals = plan.paths.filter(p => p.original || p.id === 'primary').map((p): QualityOption => {
    const facts = p.quality ?? videoInfo(p.originalVideo ?? {});
    const range = p.quality?.dynamicRange ?? videoInfo(p.originalVideo ?? {})?.dynamicRange ?? undefined;
    return {
      id: `path:${p.id}`,
      resolution: msg('data.original'),
      traits: [resolutionOf(facts), rangeName(range)].filter(Boolean).join(' · '),
      rate: rate(p.quality?.bitrate),
      needs: '',
      pending: false,
    };
  });
  const renditions = (current?.qualities ?? []).map((q): QualityOption => ({
    id: q.id,
    resolution: resolutionOf(q),
    traits: [q.videoCodec ? codecName(q.videoCodec) : '', rangeName(q.dynamicRange)].filter(Boolean).join(' · '),
    rate: rate(q.bitrate),
    needs: needs(q.bitrate),
    pending: q.codecStatus === 'pending',
  }));
  const switchable = siblings(plan, current)
    .filter(p => !p.original && p.id !== 'primary')
    .filter(p => p.id !== current?.id || !p.qualities.length)
    .filter(p => (p.readiness === 'on-demand' || p.readiness === 'ready') && p.quality)
    .map((p): QualityOption => ({
      id: `path:${p.id}`,
      resolution: resolutionOf(p.quality!),
      traits: [codecName(p.quality!.codec), rangeName(p.quality!.dynamicRange)].filter(Boolean).join(' · '),
      rate: rate(p.quality!.bitrate),
      needs: needs(p.quality!.bitrate),
      pending: false,
    }));
  return [...originals, ...renditions, ...switchable];
}

function playingQuality(snapshot: Snapshot | null, s: PlayerStats, path: Path | undefined): string {
  if (s.resolution) return [s.resolution, s.bitrate].filter(Boolean).join(' · ');
  const picked = path?.qualities.find(q => q.id === snapshot?.renditionId) ?? path?.quality;
  if (picked) return `${number(picked.height, { useGrouping: false })}p`;
  if (path?.id === 'primary' || path?.kind === 'direct') return msg('data.original');
  if (snapshot?.backend === 'native-hls') return msg('data.fixedQuality');
  return msg('data.starting');
}

function lockedQuality(snapshot: Snapshot | null, path: Path | undefined): string {
  const fixedPath = path && (path.original || (!path.qualities.length && (path.id === 'primary' || path.quality)));
  return fixedPath ? `path:${path.id}` : snapshot?.lockedQuality ?? '';
}

/** A snapshot belongs to the plan when it names its session and generations. */
export function belongs(snapshot: Snapshot | null, plan: PlaybackPlan | null): snapshot is Snapshot {
  return !!snapshot && !!plan &&
    snapshot.sessionId === plan.sessionId &&
    snapshot.sourceGeneration === plan.sourceGeneration &&
    snapshot.seekGeneration === plan.seekGeneration;
}

export function present(plan: PlaybackPlan | null, own: Snapshot | null): PlayerView {
  const snapshot = belongs(own, plan) ? own : null;
  const position = snapshot?.seekTarget ?? snapshot?.position ?? plan?.positionSeconds ?? 0;
  const duration = snapshot?.duration ?? plan?.durationSeconds ?? 0;
  const path = plan?.paths.find(p => p.id === (snapshot?.sourceId ?? plan.selectedPathId));
  const state: Snapshot['state'] = snapshot?.seekTarget != null ? 'buffering' : snapshot?.state ?? 'loading';
  const facts = stats(snapshot);
  const style = snapshot?.subtitleStyle;
  const rendition = snapshot?.backend === 'mse' || snapshot?.diagnostics?.implementation === 'vela-core';
  return {
    state,
    playing: state === 'playing',
    ended: state === 'ended',
    waiting: state !== 'failed' && ((snapshot?.waiting ?? true) || ['idle', 'loading', 'buffering', 'recovering'].includes(state)),
    position,
    duration,
    progress: duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0,
    elapsed: timecode(position),
    remaining: duration > 0 ? `-${timecode(Math.max(0, duration - position))}` : msg('data.live'),
    buffered: duration > 0 ? (snapshot?.playable ?? []).map(r => ({
      start: Math.max(0, r.start / duration),
      end: Math.min(1, r.end / duration),
    })) : [],
    volume: snapshot?.volume ?? 1,
    muted: snapshot?.muted ?? false,
    speed: snapshot?.speed ?? 1,
    speeds: snapshot?.speeds ?? [],
    audio: (snapshot?.audioTracks ?? plan?.audioTracks ?? []).map(trackOption),
    audioId: snapshot ? snapshot.audioTrackId ?? '' : plan?.selectedAudioTrackId ?? '',
    pendingAudioId: snapshot?.pendingAudioTrackId ?? '',
    subtitles: (snapshot?.subtitleTracks ?? plan?.subtitleTracks ?? []).map(trackOption),
    subtitleId: snapshot ? snapshot.subtitleTrackId ?? '' : plan?.selectedSubtitleTrackId ?? '',
    pendingSubtitleId: snapshot?.pendingSubtitleTrackId ?? '',
    subtitleError: snapshot?.subtitleError ?? '',
    subtitleLook: snapshot?.subtitleStyleAvailable && style ? {
      size: style.subtitleSize,
      background: style.subtitleBackground,
      color: style.subtitleColor,
      position: style.subtitlePosition,
    } : null,
    qualities: qualities(plan, path),
    qualityAuto: rendition && (path?.qualities.length ?? 0) > 1,
    lockedQuality: lockedQuality(snapshot, path),
    qualityId: path?.qualities.some(q => q.id === snapshot?.renditionId) ? snapshot!.renditionId! : path ? `path:${path.id}` : '',
    quality: playingQuality(snapshot, facts, path),
    path: snapshot?.strategy || path?.kind ? msg(`data.${snapshot?.strategy ?? path?.kind}`) : '',
    chapters: (plan?.chapters ?? []).map(c => ({
      id: c.id,
      name: c.name,
      seconds: c.startSeconds,
      at: duration > 0 ? Math.min(1, c.startSeconds / duration) : 0,
    })),
    stats: facts,
    pip: snapshot?.capabilities.pip ?? false,
    fullscreen: snapshot?.capabilities.fullscreen ?? false,
    reason: snapshot?.failure?.message ?? '',
    recoverable: snapshot?.failure?.recoverable ?? true,
  };
}
