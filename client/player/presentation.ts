import { QUALITY_HEADROOM, videoInfo, type VideoInfo } from './video-info';
import { clock, number, msg, setLocale } from '../foundation/i18n';
import type { PlaybackPlan } from '../wire/v0/types';
import type { Snapshot } from './model';
const snapshots = new Map<string, Snapshot>();
const errors = new Map<string, string>();
function trackLabel(track: {
  name?: string;
  label?: string;
  language?: string;
  codec?: string;
  channels?: number;
  forced?: boolean;
  hearingImpaired?: boolean;
}) {
  const parts = [
    track.name ?? track.label ?? '',
    track.language && track.language !== 'und' ? track.language : '',
    (track.codec ?? '').toUpperCase(),
    track.channels ? `${track.channels} ch` : '',
    track.forced ? 'Forced' : '',
    track.hearingImpaired ? 'SDH' : '',
  ];
  return parts
    .filter(
      (value, index) =>
        value &&
        !parts.slice(0, index).some((previous) => previous.toLowerCase().includes(value.toLowerCase())),
    )
    .join(' · ');
}
const rateLabel = (bps: number | null | undefined) =>
  bps != null && Number.isFinite(bps) && bps > 0
    ? `${number(bps / 1e6, { maximumFractionDigits: 1 })} Mbps`
    : '';
function resolutionLabel(video: { width: number; height: number } | null | undefined) {
  return video ? (video.width >= 3800 ? '4K' : `${number(video.height, { useGrouping: false })}p`) : '';
}
function rangeLabel(value: VideoInfo['dynamicRange']) {
  return value === 'dv'
    ? 'Dolby Vision'
    : value === 'hdr10'
      ? 'HDR10'
      : value === 'hlg'
        ? 'HLG'
        : value === 'sdr'
          ? 'SDR'
          : '';
}
function playerStats(snapshot: Snapshot | undefined) {
  const required = snapshot?.requiredBandwidthBps,
    throughput = snapshot?.throughputBps,
    video = snapshot?.video;
  const values = (snapshot?.throughputHistory ?? [])
      .filter((value) => Number.isFinite(value) && value > 0)
      .slice(-30),
    peak = Math.max(0, ...values);
  const ahead = snapshot?.bufferAheadSeconds,
    decoded = snapshot?.totalFrames,
    dropped = snapshot?.droppedFrames;
  const codec = video?.codec
    ? (({ h264: 'H.264', hevc: 'HEVC', av1: 'AV1', vp9: 'VP9' } as Record<string, string>)[video.codec] ??
      video.codec.toUpperCase())
    : '';
  return {
    bitrateLabel: rateLabel(snapshot?.currentBitrateBps),
    throughputLabel: rateLabel(throughput),
    requiredLabel: rateLabel(required),
    headroom: throughput && required ? throughput / required : 0,
    throughputHistory: peak ? values.map((value) => value / peak) : [],
    bufferAhead: ahead ?? -1,
    bufferLabel:
      ahead == null
        ? ''
        : number(ahead, { style: 'unit', unit: 'second', unitDisplay: 'short', maximumFractionDigits: 1 }),
    resolutionLabel: resolutionLabel(video),
    videoLabel: [codec, rangeLabel(video?.dynamicRange ?? null)].filter(Boolean).join(' · '),
    deliveryLabel: snapshot?.strategy
      ? msg(snapshot.strategy === 'direct' ? 'data.statsDirect' : 'data.statsConverted')
      : '',
    dropped: dropped ?? -1,
    droppedLabel:
      dropped == null || decoded == null
        ? ''
        : msg('data.frameCount', { dropped: number(dropped), decoded: number(decoded) }),
  };
}
function qualityLabel(
  target: {
    width: number;
    height: number;
    bitrate: number;
    dynamicRange?: VideoInfo['dynamicRange'];
    codec?: string;
  },
  name?: string,
) {
  return [
    name ?? resolutionLabel(target),
    target.codec?.toUpperCase() ?? '',
    rangeLabel(target.dynamicRange ?? null),
    rateLabel(target.bitrate),
    rateLabel(target.bitrate)
      ? msg('data.needsBandwidth', { bandwidth: rateLabel(target.bitrate * QUALITY_HEADROOM) })
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
/** Pure presentation projection for Exact's data realm: no browser API or clock. */
export function playerPresentation(
  planJson: string,
  eventJson: string,
  replyJson: string,
  localeJSON: string,
) {
  setLocale(localeJSON);
  let plan = (planJson ? JSON.parse(planJson) : null) as PlaybackPlan | null;
  const reply = (replyJson ? JSON.parse(replyJson) : null) as PlaybackPlan | null;
  if (reply && (!plan || (reply.sessionId === plan.sessionId && reply.revision > plan.revision)))
    plan = reply;
  const event = eventJson ? JSON.parse(eventJson) : null;
  const currentGeneration = (value: { sourceGeneration?: number; seekGeneration?: number }) =>
    !!plan &&
    value.sourceGeneration === plan.sourceGeneration &&
    value.seekGeneration === plan.seekGeneration;
  const errorKey = plan ? `${plan.sessionId}:${plan.sourceGeneration}:${plan.seekGeneration}` : '';
  if (
    plan &&
    event?.type === 'snapshot' &&
    event.snapshot.sessionId === plan.sessionId &&
    currentGeneration(event.snapshot)
  ) {
    snapshots.set(plan.sessionId, event.snapshot);
    if (!event.snapshot.failure) errors.delete(errorKey);
  }
  if (plan && event?.type === 'error' && event.sessionId === plan.sessionId && currentGeneration(event))
    errors.set(errorKey, event.failure.message);
  if (snapshots.size > 8) snapshots.delete(snapshots.keys().next().value!);
  if (errors.size > 8) errors.delete(errors.keys().next().value!);
  const cached = plan ? snapshots.get(plan.sessionId) : undefined;
  const snapshot = cached && currentGeneration(cached) ? cached : undefined;
  const position = snapshot?.seekTarget ?? snapshot?.position ?? plan?.positionSeconds ?? 0;
  const duration = snapshot?.duration ?? plan?.durationSeconds ?? 0;
  const path = plan?.paths.find((p) => p.id === (snapshot?.sourceId ?? plan.selectedPathId));
  const state = snapshot?.seekTarget != null ? 'buffering' : (snapshot?.state ?? 'loading');
  const quality = path?.qualities.find((q) => q.id === snapshot?.renditionId);
  const stats = playerStats(snapshot);
  const capability = snapshot?.capabilities;
  const selectedAudio = plan?.audioTracks.find(
    (t) => t.id === snapshot?.audioTrackId || (!snapshot && t.id === plan.selectedAudioTrackId),
  );
  const subtitles = snapshot?.subtitleTracks ?? plan?.subtitleTracks ?? [];
  const sourceGeneration = snapshot?.sourceGeneration ?? plan?.sourceGeneration ?? 0;
  const seekGeneration = snapshot?.seekGeneration ?? plan?.seekGeneration ?? 0;
  return {
    stats,
    planJson: plan ? JSON.stringify(plan) : '',
    stopCommandJson:
      plan && plan.state !== 'ended'
        ? JSON.stringify({
            type: 'session-command',
            sessionId: plan.sessionId,
            command: {
              kind: 'stop',
              sourceGeneration,
              seekGeneration,
              idempotencyKey: `stop-${plan.sessionId}-${sourceGeneration}-${seekGeneration}`,
            },
          })
        : '',
    waiting: snapshot?.waiting ?? state === 'loading',
    volume: snapshot?.volume ?? 1,
    muted: snapshot?.muted ?? false,
    speed: snapshot?.speed ?? 1,
    speeds: snapshot?.speeds ?? [],
    pendingSubtitleId: snapshot?.pendingSubtitleTrackId ?? '',
    subtitleError: snapshot?.subtitleError ?? '',
    subtitleStyleAvailable: snapshot?.subtitleStyleAvailable ?? false,
    subtitleSize: snapshot?.subtitleStyle?.subtitleSize ?? 'medium',
    subtitleBackground: snapshot?.subtitleStyle?.subtitleBackground ?? 'shadow',
    subtitleColor: snapshot?.subtitleStyle?.subtitleColor ?? 'white',
    subtitlePosition: snapshot?.subtitleStyle?.subtitlePosition ?? 'bottom',
    preparation: snapshot?.preparation
      ? msg(`data.preparation.${snapshot.preparation}`)
      : !snapshot
        ? msg('data.preparation.media-metadata')
        : '',
    ready: !!snapshot && !['idle', 'loading'].includes(state),
    state,
    playing: state === 'playing',
    position,
    duration,
    elapsed: clock(position),
    remaining: duration > 0 ? clock(Math.max(0, duration - position)) : msg('data.live'),
    progress: duration > 0 ? Math.min(100, (position / duration) * 100) : 0,
    reason: snapshot?.failure?.message ?? '',
    actionError: plan ? (errors.get(errorKey) ?? '') : '',
    path: snapshot?.strategy || path?.kind ? msg(`data.${snapshot?.strategy ?? path?.kind}`) : '',
    backend: snapshot?.backend ?? '',
    quality: stats.resolutionLabel
      ? [stats.resolutionLabel, stats.bitrateLabel].filter(Boolean).join(' · ')
      : quality || path?.quality
        ? `${number((quality ?? path!.quality!).height, { useGrouping: false })}p`
        : path?.id === 'primary' || path?.kind === 'direct'
          ? msg('data.original')
          : snapshot?.backend === 'native-hls'
            ? msg('data.fixedQuality')
            : msg('data.starting'),
    lockedQuality:
      path?.original || (path && !path.qualities.length && (path.id === 'primary' || path.quality))
        ? `path:${path.id}`
        : (snapshot?.lockedQuality ?? ''),
    qualityAuto:
      (snapshot?.backend === 'mse' || snapshot?.diagnostics?.implementation === 'vela-core') &&
      (path?.qualities.length ?? 0) > 1,
    pendingAudioId: snapshot?.pendingAudioTrackId ?? '',
    audioId: snapshot ? (snapshot.audioTrackId ?? '') : (plan?.selectedAudioTrackId ?? ''),
    audioLabel: selectedAudio?.name ?? msg('data.originalAudio'),
    subtitleId: snapshot ? (snapshot.subtitleTrackId ?? '') : (plan?.selectedSubtitleTrackId ?? ''),
    audio: (snapshot?.audioTracks ?? plan?.audioTracks ?? []).map((t) => ({
      id: t.id,
      label: trackLabel(t),
    })),
    subtitles: subtitles.map((t) => ({ id: t.id, label: trackLabel(t) })),
    qualities: [
      ...(plan?.paths ?? [])
        .filter((p) => p.original || p.id === 'primary')
        .map((p) => ({
          id: `path:${p.id}`,
          label: [
            msg('data.original'),
            resolutionLabel(p.quality ?? videoInfo(p.originalVideo ?? {})),
            rangeLabel(p.quality?.dynamicRange ?? videoInfo(p.originalVideo ?? {})?.dynamicRange ?? null),
            rateLabel(p.quality?.bitrate),
          ]
            .filter(Boolean)
            .join(' · '),
        })),
      ...(path?.qualities ?? []).map((q) => ({
        id: q.id,
        label: qualityLabel(q) + (q.codecStatus === 'pending' ? ` · ${msg('data.starting')}` : ''),
      })),
      ...(plan?.paths ?? [])
        .filter(
          (p) =>
            !p.original &&
            p.id !== 'primary' &&
            (p.id !== path?.id || !p.qualities.length) &&
            (p.readiness === 'on-demand' || p.readiness === 'ready') &&
            p.quality &&
            !!path?.sourceId &&
            p.sourceId === path.sourceId &&
            !!path?.timelineId &&
            p.timelineId === path.timelineId &&
            (p.edition ?? '') === (path.edition ?? ''),
        )
        .map((p) => ({ id: `path:${p.id}`, label: qualityLabel(p.quality!) })),
    ],
    paths: (plan?.paths ?? [])
      .filter(
        (p) =>
          (p.readiness === 'ready' || p.readiness === 'on-demand') &&
          (p.id === path?.id ||
            (!!path?.sourceId &&
              p.sourceId === path.sourceId &&
              !!path?.timelineId &&
              p.timelineId === path.timelineId &&
              (p.edition ?? '') === (path.edition ?? ''))),
      )
      .map((p) => ({
        id: p.id,
        label: p.original
          ? msg('data.original')
          : p.quality
            ? `${number(p.quality.height, { useGrouping: false })}p · ${msg(`data.${p.kind}`)}`
            : msg(`data.${p.kind}`),
      })),
    pathId: path?.id ?? '',
    chapters: (plan?.chapters ?? []).map((c) => ({
      id: c.id,
      label: `${clock(c.startSeconds)} · ${c.name}`,
      seconds: c.startSeconds,
      percent: duration > 0 ? (c.startSeconds / duration) * 100 : 0,
    })),
    buffered: (snapshot?.playable ?? []).map((r, i) => ({
      id: String(i),
      left: duration > 0 ? Math.max(0, (r.start / duration) * 100) : 0,
      width: duration > 0 ? Math.min(100, ((r.end - r.start) / duration) * 100) : 0,
    })),
    pip: capability?.pip ?? false,
    fullscreen: capability?.fullscreen ?? false,
  };
}
