// What the player chrome shows, from the server's plan and the view's latest snapshot: the
// clock, the timeline, the choosable tracks, qualities, speeds and chapters, and the playback
// facts for the info card. Pure: no React, no clock. A value the engine has not reported stays
// empty rather than estimated.
import { msg, number, second } from '@vela/core';
import { QUALITY_HEADROOM, videoInfo, type VideoInfo } from '../../../../../modules/vela-player/web/engine/video-info';
import type { PlaybackPlan, Snapshot } from '@vela/player-api';
import { formatLines, type FormatLines } from './format';

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
  /** Equivalent server path/rendition identities, for current and pending checks. */
  aliases: string[];
  resolution: string;
  traits: string;
  rate: string;
  needs: string;
  /** An actionable choice; missing codec metadata is not a switch in progress. */
  disabledReason: string;
  /** The source file itself, not a conversion of it. */
  original: boolean;
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
  /** The subtitle delay in seconds (positive shows cues later); null where the engine has none. */
  subtitleOffset: number | null;
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
  /** Source → output video and audio, from the engine's format facts. */
  format: FormatLines;
  /** The delivery choices the engine honours (audio menu), in order, with their current values. */
  output: { name: string; value: string }[];
  pip: boolean;
  fullscreen: boolean;
  /** The engine's own failure, in words ("" while it plays). */
  reason: string;
  recoverable: boolean;
}

/** Nudges the subtitle delay by a step ('+0.1', '-0.5'), or back to zero ('0'); positive shows cues later. */
export function nextSubtitleOffset(offset: number, step: string): number {
  const next = step === '0' ? 0 : offset + Number(step);
  return Math.max(-600, Math.min(600, Math.round(next * 1000) / 1000));
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
    case 'dv':
      return 'Dolby Vision';
    case 'hdr10':
      return 'HDR10';
    case 'hlg':
      return 'HLG';
    case 'sdr':
      return 'SDR';
    default:
      return '';
  }
}

const CODECS: Record<string, string> = { h264: 'H.264', hevc: 'HEVC', av1: 'AV1', vp9: 'VP9' };

function codecName(codec: string | undefined): string {
  if (!codec) return '';
  const family = /^(avc1|avc3)/i.test(codec) ? 'h264' : /^(hvc1|hev1)/i.test(codec) ? 'hevc' : /^av01/i.test(codec) ? 'av1' : /^vp09/i.test(codec) ? 'vp9' : codec;
  return CODECS[family] ?? codec.toUpperCase();
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

/** Metadata and engine discovery complement each other; an empty early snapshot must not
 * erase the plan's embedded or external tracks. Engine labels win for the same identity. */
function trackOptions(planned: AnyTrack[], observed: AnyTrack[]): TrackOption[] {
  return [...new Map([...planned, ...observed].map(track => [track.id, track])).values()].map(trackOption);
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
  const kept = parts.filter(
    (value, index) =>
      value && !parts.slice(0, index).some(previous => previous.toLowerCase().includes(value.toLowerCase())),
  );
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
    buffer: ahead == null ? '' : second(ahead, 1),
    resolution: resolutionOf(video),
    video: [codecName(video?.codec), rangeName(video?.dynamicRange ?? undefined)].filter(Boolean).join(' · '),
    delivery: snapshot?.strategy
      ? msg(snapshot.strategy === 'direct' ? 'data.statsDirect' : 'data.statsConverted')
      : '',
    dropped:
      dropped == null || decoded == null
        ? ''
        : msg('data.frameCount', { dropped: number(dropped), decoded: number(decoded) }),
  };
}

function needs(bitrate: number | undefined): string {
  const needed = rate(bitrate ? bitrate * QUALITY_HEADROOM : undefined);
  return needed ? msg('data.needsBandwidth', { bandwidth: needed }) : '';
}

/** Several paths may play the same title: the one playing, and those it can switch to. */
function siblings(plan: PlaybackPlan, current: Path | undefined): Path[] {
  if (!current?.sourceId || !current.timelineId) return [];
  return plan.paths.filter(
    p =>
      p.sourceId === current.sourceId &&
      p.timelineId === current.timelineId &&
      (p.edition ?? '') === (current.edition ?? ''),
  );
}

function qualities(plan: PlaybackPlan | null, current: Path | undefined, snapshot: Snapshot | null): QualityOption[] {
  if (!plan) return [];
  const originals = plan.paths
    .filter(p => p.original || p.id === 'primary' || p.kind === 'direct' && p.transport === 'file')
    .filter(p => p.readiness === 'ready' || p.readiness === 'on-demand')
    .filter(p => !current || ((!p.sourceId || !current.sourceId || p.sourceId === current.sourceId)
      && (!p.timelineId || !current.timelineId || p.timelineId === current.timelineId)
      && (p.edition ?? '') === (current.edition ?? '')))
    .sort((a, b) => Number(b.id === current?.id) - Number(a.id === current?.id))
    .slice(0, 1)
    .map((p): QualityOption => {
      const facts = p.quality ?? videoInfo(p.originalVideo ?? {});
      const range = p.quality?.dynamicRange ?? videoInfo(p.originalVideo ?? {})?.dynamicRange ?? undefined;
      return {
        id: `path:${p.id}`,
        aliases: [],
        resolution: msg('data.original'),
        traits: [resolutionOf(facts), codecName(facts?.codec), rangeName(range)].filter(Boolean).join(' · '),
        rate: rate(p.quality?.bitrate),
        needs: '',
        disabledReason: '',
        original: true,
      };
    });
  // Plex/Jellyfin may publish a fixed HLS URL; its ladder arrives from the
  // engine's manifest probe rather than the server plan.
  const ladder = [...(current?.qualities ?? [])];
  for (const q of snapshot?.renditions ?? []) {
    if (!q.height || !q.width) continue;
    const entry = { id: q.id, width: q.width, height: q.height, bitrate: q.bitrateBps || q.bandwidth,
      videoCodec: q.codec ?? '', dynamicRange: q.dynamicRange, codecStatus: q.codecStatus, url: '' };
    const index = ladder.findIndex(value => value.id === q.id);
    if (index >= 0) ladder[index] = { ...ladder[index]!, ...entry };
    else ladder.push(entry);
  }
  const renditions = ladder.map(
    (q): QualityOption => ({
      id: q.id,
      aliases: [],
      resolution: resolutionOf(q),
      traits: [q.videoCodec ? codecName(q.videoCodec) : '', rangeName(q.dynamicRange)].filter(Boolean).join(' · '),
      rate: rate(q.bitrate),
      needs: needs(q.bitrate),
      disabledReason: '',
      original: false,
    }),
  );
  const switchable = siblings(plan, current)
    .filter(p => !p.original && p.id !== 'primary' && !(p.kind === 'direct' && p.transport === 'file'))
    .filter(p => (p.readiness === 'on-demand' || p.readiness === 'ready') && p.quality)
    .map(
      (p): QualityOption => ({
        id: `path:${p.id}`,
        aliases: [],
        resolution: resolutionOf(p.quality!),
        traits: [codecName(p.quality!.codec), rangeName(p.quality!.dynamicRange)].filter(Boolean).join(' · '),
        rate: rate(p.quality!.bitrate),
        needs: needs(p.quality!.bitrate),
        disabledReason: '',
        original: false,
      }),
    );
  // A server path and its HLS rendition can describe the same viewer choice.
  // Prefer a usable server switch to an unverified rendition; otherwise keep
  // the current HLS ladder so pinning remains local to that source.
  const byResolution = new Map<string, QualityOption>();
  for (const option of [...switchable, ...renditions]) {
    const existing = byResolution.get(option.resolution);
    const rendition = ladder.find(q => q.id === option.id);
    if (!existing || (rendition && rendition.codecStatus !== 'pending')) byResolution.set(option.resolution, option);
  }
  for (const option of [...originals, ...renditions, ...switchable]) option.aliases = [option.id];
  for (const option of [...renditions, ...switchable]) {
    const chosen = byResolution.get(option.resolution)!;
    if (!chosen.aliases.includes(option.id)) chosen.aliases.push(option.id);
  }
  for (const limitation of plan.qualityLimitations ?? []) {
    // A height of 0 is a session-wide denial (conversion off, service down, owner policy): one
    // explanatory row, never a fabricated "0p" resolution.
    const sessionWide = !(limitation.height > 0);
    const resolution = sessionWide ? msg('player.qualitySessionLimited') : limitation.height >= 2160 ? '4K' : `${limitation.height}p`;
    if (!byResolution.has(resolution)) byResolution.set(resolution, {
      id: sessionWide ? 'unavailable:session' : `unavailable:${limitation.height}`, aliases: [], resolution, traits: '', rate: '', needs: '',
      disabledReason: qualityLimitReason(limitation.reason), original: false,
    });
  }
  const order = (option: QualityOption) => option.resolution === '4K' ? 2160 : Number.parseInt(option.resolution) || 0;
  return [...originals, ...[...byResolution.values()].sort((a, b) => order(b) - order(a))];
}

const QUALITY_REASONS = ['output_profile_unavailable', 'transcoding_disabled', 'quality_service_unavailable', 'owner_policy', 'decoder_profile_limit'];

/** Ether's quality limitation codes as viewer text; an unknown code is never shown raw. */
export function qualityLimitReason(code: string | undefined): string {
  if (!code) return msg('player.qualityUnavailable');
  if (QUALITY_REASONS.includes(code)) return msg(`player.qualityReason.${code}`);
  // A server may already send viewer text; a bare machine code it does not explain stays hidden.
  return /^[a-z0-9_.-]+$/.test(code) ? msg('player.qualityReason.other') : code;
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
  return fixedPath ? `path:${path.id}` : (snapshot?.lockedQuality ?? '');
}

/** A snapshot belongs to the plan when it names its session and generations. */
export function belongs(snapshot: Snapshot | null, plan: PlaybackPlan | null): snapshot is Snapshot {
  return (
    !!snapshot &&
    !!plan &&
    snapshot.sessionId === plan.sessionId &&
    snapshot.sourceGeneration === plan.sourceGeneration &&
    snapshot.seekGeneration === plan.seekGeneration
  );
}

/** Server acceptance can precede the engine switching; only its fresh, ready snapshot settles the choice. */
export function qualityReached(id: string, snapshot: Snapshot | null, plan: PlaybackPlan | null): boolean {
  if (!belongs(snapshot, plan) || snapshot.waiting || snapshot.state === 'failed') return false;
  if (id === 'auto') return !snapshot.lockedQuality;
  return id.startsWith('path:') ? snapshot.sourceId === id.slice(5) : snapshot.renditionId === id;
}

export function present(plan: PlaybackPlan | null, own: Snapshot | null): PlayerView {
  const snapshot = belongs(own, plan) ? own : null;
  const position = snapshot?.seekTarget ?? snapshot?.position ?? plan?.positionSeconds ?? 0;
  const duration = snapshot?.duration ?? plan?.durationSeconds ?? 0;
  const path = plan?.paths.find(p => p.id === (snapshot?.sourceId ?? plan.selectedPathId));
  const state: Snapshot['state'] = snapshot?.seekTarget != null ? 'buffering' : (snapshot?.state ?? 'loading');
  const facts = stats(snapshot);
  const style = snapshot?.subtitleStyle;
  const rendition = snapshot?.backend === 'mse' || snapshot?.diagnostics?.implementation === 'vela-core';
  return {
    state,
    playing: state === 'playing',
    ended: state === 'ended',
    waiting:
      state !== 'failed' &&
      ((snapshot?.waiting ?? true) || ['idle', 'loading', 'buffering', 'recovering'].includes(state)),
    position,
    duration,
    progress: duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0,
    elapsed: timecode(position),
    remaining: duration > 0 ? `-${timecode(Math.max(0, duration - position))}` : plan?.live ? msg('data.live') : '',
    buffered:
      duration > 0
        ? (snapshot?.playable ?? []).map(r => ({
            start: Math.max(0, r.start / duration),
            end: Math.min(1, r.end / duration),
          }))
        : [],
    volume: snapshot?.volume ?? 1,
    muted: snapshot?.muted ?? false,
    speed: snapshot?.speed ?? 1,
    speeds: snapshot?.speeds ?? [],
    audio: trackOptions(plan?.audioTracks ?? [], snapshot?.audioTracks ?? []),
    audioId: snapshot?.audioTrackId ?? plan?.selectedAudioTrackId ?? plan?.audioTracks.find(track => track.default)?.id ?? '',
    pendingAudioId: snapshot?.pendingAudioTrackId ?? '',
    subtitles: trackOptions(plan?.subtitleTracks ?? [], snapshot?.subtitleTracks ?? []),
    subtitleId: snapshot ? (snapshot.subtitleTrackId ?? '') : (plan?.selectedSubtitleTrackId ?? ''),
    pendingSubtitleId: snapshot?.pendingSubtitleTrackId ?? '',
    subtitleError: snapshot?.subtitleError ?? '',
    subtitleLook:
      snapshot?.subtitleStyleAvailable && style
        ? {
            size: style.subtitleSize,
            background: style.subtitleBackground,
            color: style.subtitleColor,
            position: style.subtitlePosition,
          }
        : null,
    subtitleOffset: style && Number.isFinite(style.offsetSeconds) ? style.offsetSeconds : null,
    qualities: qualities(plan, path, snapshot),
    qualityAuto: rendition && Math.max(path?.qualities.length ?? 0, snapshot?.renditions?.length ?? 0) > 1,
    lockedQuality: lockedQuality(snapshot, path),
    qualityId: snapshot?.renditions?.some(q => q.id === snapshot.renditionId) || path?.qualities.some(q => q.id === snapshot?.renditionId)
      ? snapshot!.renditionId!
      : path
        ? `path:${path.id}`
        : '',
    quality: playingQuality(snapshot, facts, path),
    path: snapshot?.strategy || path?.kind ? msg(`data.${snapshot?.strategy ?? path?.kind}`) : '',
    chapters: (plan?.chapters ?? []).map(c => ({
      id: c.id,
      name: c.name,
      seconds: c.startSeconds,
      at: duration > 0 ? Math.min(1, c.startSeconds / duration) : 0,
    })),
    stats: facts,
    format: formatLines(snapshot?.format),
    output: (snapshot?.outputPreferencesAvailable ?? []).flatMap(name => {
      const value = snapshot?.outputPreferences?.[name];
      return value ? [{ name, value }] : [];
    }),
    pip: snapshot?.capabilities.pip ?? false,
    fullscreen: snapshot?.capabilities.fullscreen ?? false,
    reason: snapshot?.failure?.message ?? '',
    recoverable: snapshot?.failure?.recoverable ?? true,
  };
}
