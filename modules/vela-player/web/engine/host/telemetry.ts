import { QUALITY_HEADROOM } from '../video-info';
import { bufferAhead, STREAM_RENDITION } from '../pipeline';
import type { Snapshot } from '../model';
import type { HostContext } from './state';
import { nativeAudio, pipAvailable, fullscreenAvailable } from './platform';
import { liveSnapshot } from './live';
import { readPosition, readDuration } from './position';
import { browserFormat } from './browser-format';
import { muxedAudioTrack } from '../muxed-audio';
import { unplayablePaths } from './playability';

export function snapshotHost(context: HostContext): Snapshot {
  const ranges = context.surface.video.buffered;
  const quality = context.surface.video.getVideoPlaybackQuality?.();
  const listedAudio =
    context.media.runtime && context.media.runtime.supportsLocalAudioSwitch !== false
      ? context.media.runtime.audioTrackIds
      : context.session.current?.serverControlled
        ? context.session.current.audioTracks.map((t) => t.id)
        : context.media.backend === 'mse'
          ? (context.media.pipeline?.audioTracks ?? [])
          : (context.session.current?.audioTracks
              .filter((t) => !!nativeAudio(context, t.id))
              .map((t) => t.id) ?? []);
  // A stream played by the browser with its audio muxed in knows no track of its own: it carries
  // the plan's track (muxed-audio.ts), which the menu lists and observations report.
  const muxedAudio =
    !context.media.runtime && !context.media.pipeline?.audioTrackId && context.session.current
      ? muxedAudioTrack(context.session.current.audioTracks, context.session.current.audioTrackId ?? context.tracks.audio)
      : null;
  const audioTrackIds = listedAudio.length ? listedAudio : muxedAudio ? [muxedAudio] : [];
  const subtitleTracks =
    context.tracks.overlay?.tracks.map((track) => ({
      id: track.id,
      label: track.label,
      language: track.language,
      codec: track.codec,
      streamIndex: track.streamIndex ?? undefined,
      forced: track.forced,
      delivery: track.delivery.kind === 'external' ? undefined : track.delivery,
    })) ??
    context.session.current?.subtitleTracks.map(({ url, delivery, ...track }) => ({
      ...track,
      delivery: delivery?.kind === 'external' ? undefined : delivery,
    })) ??
    [];
  const burned =
    !!context.tracks.subtitle &&
    context.session.current?.subtitleTracks.some(
      (track) => track.id === context.tracks.subtitle && track.delivery?.kind === 'burn-in',
    ) &&
    !context.tracks.overlay?.tracks.some(
      (track) => track.id === context.tracks.subtitle && track.delivery.kind === 'embedded',
    );
  const subtitleId =
    context.tracks.overlay && !burned ? context.tracks.overlay.selected : context.tracks.subtitle;
  const selectedSubtitle = context.tracks.overlay?.tracks.find((track) => track.id === subtitleId);
  const audioId =
    context.media.runtime?.readout.audioTrackId ??
    context.media.pipeline?.audioTrackId ??
    context.tracks.audio ??
    muxedAudio;
  const readout = context.media.runtime?.readout;
  const rendition =
    context.media.pipeline?.current ??
    context.media.source?.renditions?.find(
      (r) =>
        r.id ===
        (context.quality.manual ?? context.quality.automatic.id ?? context.media.source?.initialRenditionId),
    );
  const bitrate = rendition?.bandwidth ?? context.media.source?.quality?.bitrate;
  const currentBitrateBps = bitrate && Number.isFinite(bitrate) && bitrate > 0 ? bitrate : null;
  const video =
    readout?.video ??
    (context.surface.video.videoWidth > 0
      ? {
          width: context.surface.video.videoWidth,
          height: context.surface.video.videoHeight,
          codec: rendition?.codec ?? '',
          dynamicRange: rendition?.dynamicRange ?? null,
        }
      : null);
  const ahead = context.media.runtime
    ? (readout?.bufferAheadSeconds ?? null)
    : context.surface.video.readyState >= 1
      ? bufferAhead(context.surface.video)
      : null;
  return {
    sessionId: context.session.current?.id ?? null,
    sourceGeneration: context.session.controller.source,
    seekGeneration: context.session.controller.seek,
    state: context.session.pendingSeek ? 'buffering' : context.playback.status,
    sourceId: context.media.source?.id ?? null,
    strategy: context.media.source?.strategy ?? null,
    diagnostics:
      context.media.runtime || context.tracks.subtitleFailureNotes.length || context.recovery.history.length
        ? {
            implementation: context.media.runtime?.implementation,
            metadataDiscrepancies: context.media.runtime?.readout.metadataDiscrepancies ?? [],
            subtitleFailures: [...context.tracks.subtitleFailureNotes],
            recoveryHistory: context.recovery.history.snapshot(),
          }
        : undefined,
    backend: context.media.backend,
    // A stream played without a ladder is no quality the plan names.
    renditionId: context.media.pipeline?.current
      ? context.media.pipeline.current.id === STREAM_RENDITION
        ? null
        : context.media.pipeline.current.id
      : (context.media.backend === 'webgpu'
        ? context.quality.automatic.id
        : context.media.backend === 'native-hls'
          ? (context.quality.manual ?? context.media.source?.initialRenditionId ?? null)
          : null),
    qualityIds:
      context.media.pipeline?.qualityIds ??
      (context.media.backend === 'webgpu' ? (context.media.source?.renditions?.map((r) => r.id) ?? []) : []),
    capabilities: {
      pip: pipAvailable(context),
      fullscreen: fullscreenAvailable(context),
      audioSwitch: audioTrackIds.length > 1,
    },
    lockedQuality: context.quality.manual,
    audioTracks:
      context.media.runtime?.supportsLocalAudioSwitch !== false
        ? (context.media.runtime?.audioTracks ?? context.session.current?.audioTracks ?? [])
        : (context.session.current?.audioTracks ?? []),
    subtitleTracks,
    renditions:
      context.media.source?.renditions?.map(({ url, ...rendition }) => ({
        ...rendition,
        bitrateBps: rendition.bandwidth,
        requiredBandwidthBps: rendition.bandwidth * QUALITY_HEADROOM,
      })) ?? [],
    video,
    format: context.media.runtime
      ? (readout?.format ?? null)
      : browserFormat(
          video,
          context.session.current?.audioTracks.find((track) => track.id === audioId),
        ),
    currentBitrateBps,
    requiredBandwidthBps: currentBitrateBps === null ? null : currentBitrateBps * QUALITY_HEADROOM,
    bufferAheadSeconds: ahead,
    loadProgress: context.media.runtime
      ? (readout?.loadProgress ?? null)
      : (context.media.pipeline?.receivedBytes ?? 0) + context.watchdog.loadEvents,
    throughputHistory: context.media.pipeline?.bandwidth.history ?? readout?.throughputHistory ?? [],
    speed: context.session.current?.live ? 1 : context.playback.speed,
    speeds:
      context.session.current?.live || (context.media.runtime && !context.media.runtime.setSpeed)
        ? []
        : [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
    pendingSubtitleTrackId: context.tracks.pendingTracks?.subtitle ?? context.tracks.overlay?.pending ?? null,
    chapters: context.session.current?.chapters ?? [],
    subtitleError: context.tracks.overlay?.error ?? null,
    subtitleStyle: context.tracks.subtitleStyle,
    subtitleStyleAvailable:
      !!context.tracks.overlay &&
      !burned &&
      (!selectedSubtitle || ['srt', 'webvtt', 'tx3g'].includes(selectedSubtitle.codec)),
    subtitleReportingId: selectedSubtitle?.serverId ?? subtitleId,
    subtitleClientOnly: !!selectedSubtitle && !selectedSubtitle.serverId,
    audioClientOnly: !!audioId && !context.session.current?.audioTracks.some((track) => track.id === audioId),
    live: liveSnapshot(context),
    seekTarget: context.session.pendingSeek?.position ?? null,
    waiting:
      !!context.session.pendingSeek ||
      ['loading', 'buffering', 'recovering'].includes(context.playback.status) ||
      (context.playback.wantsPlay && context.surface.video.seeking),
    volume: context.surface.video.volume,
    muted: context.surface.video.muted,
    preparation:
      ['loading', 'buffering'].includes(context.playback.status) &&
      (context.media.runtime?.readout.frames ?? quality?.totalVideoFrames ?? 0) === 0
        ? context.surface.video.readyState < 1
          ? 'media-metadata'
          : context.surface.video.paused
            ? 'starting'
            : 'initial-buffer'
        : null,
    position: readPosition(context),
    duration: readDuration(context),
    playable: context.media.runtime
      ? ahead !== null && ahead > 0
        ? [{ start: readPosition(context), end: readPosition(context) + ahead }]
        : []
      : Array.from({ length: Math.min(ranges.length, 32) }, (_, i) => ({
          start: context.media.nativeOrigin + ranges.start(i),
          end: context.media.nativeOrigin + ranges.end(i),
        })),
    throughputBps: context.media.pipeline?.bandwidth.bps ?? readout?.throughputBps ?? null,
    droppedFrames:
      context.playback.terminalMedia?.dropped ??
      context.media.runtime?.readout.dropped ??
      quality?.droppedVideoFrames ??
      null,
    totalFrames:
      context.playback.terminalMedia?.frames ??
      context.media.runtime?.readout.frames ??
      quality?.totalVideoFrames ??
      null,
    audioTrackIds,
    audioTrackId: audioId,
    pendingAudioTrackId:
      context.tracks.pendingTracks?.audio ??
      context.media.runtime?.pendingAudioTrackId ??
      context.media.pipeline?.pendingAudioTrackId ??
      null,
    subtitleTrackId: subtitleId,
    unplayablePaths: unplayablePaths(context),
    failure: context.playback.failure,
  };
}
export function observationAllowed(context: HostContext) {
  // A newly authorized seek must not overwrite the broker target with the
  // previous audio clock while the replacement epoch is still opening.
  return (
    context.session.current?.serverState !== 'ended' &&
    !context.session.pendingSeek &&
    !context.session.pendingSwitch &&
    (context.watchdog.frameSeen ||
      context.playback.status === 'failed' ||
      context.playback.status === 'ended')
  );
}
