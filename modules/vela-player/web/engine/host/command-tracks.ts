import type { Command, Source, Track } from '../model';
import type { HostContext } from './state';
import { readPosition } from './position';
import { candidateSources } from './quality';
import { requestTracks } from './authorizations';
import { activateSource } from './media';
import { nativeAudio, applyNativeAudio } from './platform';
import { ensureOverlay, applySubtitle } from './subtitles';

/**
 * A server transcode does not contain an unselected embedded subtitle.  Its track list still
 * describes the source file, so treating those entries like local WebVTT makes native HLS reject
 * the choice without ever asking the server. External documents remain local; entering or leaving
 * a server-rendered selection replaces the transcode generation.
 */
export function requiresServerSubtitleSelection(
  serverControlled: boolean,
  source: Pick<Source, 'strategy'> | undefined,
  track: Track | null | undefined,
): boolean {
  if (!serverControlled || !track) return false;
  if (track.delivery?.kind === 'burn-in') return true;
  const localDocument = track.delivery?.kind === 'external' || !!track.url;
  return source?.strategy === 'transcode' && !localDocument;
}
export async function selectAudioFromCommand(
  context: HostContext,
  command: Extract<
    Command,
    {
      type: 'audio';
    }
  >,
) {
  if (command.trackId === context.tracks.audio) return true;
  if (
    !(
      context.media.runtime && context.media.runtime.supportsLocalAudioSwitch !== false
        ? context.media.runtime.audioTrackIds
        : (context.session.current?.audioTracks.map((track) => track.id) ?? [])
    ).includes(command.trackId)
  )
    throw new Error('Unknown audio track');
  if (context.media.runtime && context.media.runtime.supportsLocalAudioSwitch !== false) {
    const original = context.media.runtime;
    await original.selectAudio(command.trackId);
    if (context.media.runtime !== original || original.readout.audioTrackId !== command.trackId) return false;
    context.tracks.audio = command.trackId;
    context.tracks.audioPreference = command.trackId;
    return true;
  }
  if (context.media.pipeline?.audioTracks.includes(command.trackId)) {
    context.tracks.audioPreference = command.trackId;
    try {
      await context.media.pipeline.selectAudio(command.trackId);
    } catch (error) {
      if (context.tracks.audioPreference === command.trackId)
        context.tracks.audioPreference = context.tracks.audio ?? undefined;
      throw error;
    }
    return true;
  }
  if (context.session.current?.serverControlled && !nativeAudio(context, command.trackId)) {
    requestTracks(context, { audio: command.trackId });
    return true;
  }
  const previous = context.tracks.audio;
  context.tracks.audio = command.trackId;
  if (applyNativeAudio(context)) return true;
  const source = candidateSources(context).find(
    (s) => s.audioTrackId === command.trackId && s.timeline === context.media.source?.timeline,
  );
  if (!source) {
    context.tracks.audio = previous;
    throw new Error('Audio selection requires a compatible server source');
  }
  await activateSource(context, source, readPosition(context));
  return true;
}
export async function selectSubtitleFromCommand(
  context: HostContext,
  command: Extract<
    Command,
    {
      type: 'subtitle';
    }
  >,
) {
  if (command.trackId === context.tracks.subtitle) return true;
  const selected = command.trackId
    ? context.session.current?.subtitleTracks.find((t) => t.id === command.trackId)
    : null;
  if (command.trackId && !selected) throw new Error('Unknown subtitle track');
  const current = context.session.current?.subtitleTracks.find((t) => t.id === context.tracks.subtitle);
  if (
    requiresServerSubtitleSelection(
      !!context.session.current?.serverControlled,
      context.media.source,
      selected,
    ) ||
    requiresServerSubtitleSelection(
      !!context.session.current?.serverControlled,
      context.media.source,
      current,
    )
  ) {
    requestTracks(context, { subtitle: command.trackId });
    return true;
  }
  if (context.media.runtime?.supportsSubtitles) {
    const overlay = await ensureOverlay(context);
    const local = overlay.tracks.find((track) => track.id === command.trackId);
    const burned = context.session.current?.subtitleTracks.some(
      (t) => t.id === context.tracks.subtitle && t.delivery?.kind === 'burn-in',
    );
    if (!burned && (command.trackId === null || (local?.delivery.kind !== 'burn-in' && !!local))) {
      context.tracks.subtitlePreference = command.trackId;
      context.tracks.subtitle = command.trackId;
      await overlay.select(command.trackId);
      return true;
    }
  }
  if (context.media.runtime && command.trackId && context.session.current?.serverControlled) {
    requestTracks(context, { subtitle: command.trackId });
    return true;
  }
  if (context.media.runtime && command.trackId)
    throw new Error('This source has no installed subtitle renderer');
  if (
    command.trackId &&
    !context.session.current?.subtitleTracks.some((t) => t.id === command.trackId && t.url)
  )
    throw new Error('Unknown WebVTT track');
  context.tracks.subtitlePreference = command.trackId;
  context.tracks.subtitle = command.trackId;
  applySubtitle(context);
  return true;
}
