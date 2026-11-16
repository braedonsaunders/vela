import type { Command } from '../model';
import type { HostContext } from './state';
import { readPosition } from './position';
import { candidateSources } from './quality';
import { requestTracks } from './authorizations';
import { activateSource } from './media';
import { nativeAudio, applyNativeAudio } from './platform';
import { ensureOverlay, applySubtitle } from './subtitles';
export async function selectAudioFromCommand(
  context: HostContext,
  command: Extract<
    Command,
    {
      type: 'audio';
    }
  >,
) {
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
  const selected = command.trackId
    ? context.session.current?.subtitleTracks.find((t) => t.id === command.trackId)
    : null;
  if (command.trackId && !selected) throw new Error('Unknown subtitle track');
  const current = context.session.current?.subtitleTracks.find((t) => t.id === context.tracks.subtitle);
  if (selected?.delivery?.kind === 'burn-in' || current?.delivery?.kind === 'burn-in') {
    requestTracks(context, { subtitle: command.trackId });
    return true;
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
