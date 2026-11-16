import type { Command } from '../model';
import type { HostContext } from './state';
import { readPosition } from './position';
import { candidateSources } from './quality';
import { requestTracks, requestSwitch } from './authorizations';
import { activateSource } from './media';
import { executeCommand } from './commands';
export async function switchPathFromCommand(
  context: HostContext,
  command: Extract<
    Command,
    {
      type: 'switchPath';
    }
  >,
) {
  const source =
    candidateSources(context).find((s) => s.id === command.pathId) ??
    context.session.current?.onDemandSources?.find((s) => s.id === command.pathId);
  if (!source || source.id === context.media.source?.id) return true;
  if (context.session.current?.serverControlled) {
    // A local original-track choice must reach Ether before conversion;
    // otherwise a switch could silently restore the default audio/PGS.
    const audio =
      context.tracks.audio &&
      context.session.current.audioTracks.some((t) => t.id === context.tracks.audio) &&
      context.tracks.audio !== context.session.current.audioTrackId
        ? context.tracks.audio
        : undefined;
    const subtitle = context.tracks.overlay?.tracks.find((t) => t.id === context.tracks.subtitle);
    const burn =
      subtitle?.delivery.kind === 'embedded' && subtitle.codec === 'pgs' ? subtitle.serverId : undefined;
    if (audio || burn) {
      context.tracks.deferredPath = source.id;
      context.tracks.deferredPosition = readPosition(context);
      requestTracks(context, { ...(audio ? { audio } : {}), ...(burn ? { subtitle: burn } : {}) });
    } else requestSwitch(context, { id: source.id, onDemand: true }, readPosition(context));
  } else if (!('onDemand' in source) && source.recoveryAllowed !== false)
    await activateSource(context, source, readPosition(context));
  return true;
}
export async function selectQualityFromCommand(
  context: HostContext,
  command: Extract<
    Command,
    {
      type: 'quality';
    }
  >,
) {
  if (command.renditionId?.startsWith('path:')) {
    const failure = await executeCommand(context, {
      id: command.id,
      type: 'switchPath',
      pathId: command.renditionId.slice(5),
    });
    if (failure) throw new Error(failure.message);
    return true;
  }
  const chosen = context.media.source?.renditions?.find((r) => r.id === command.renditionId);
  if (command.renditionId && !chosen) throw new Error('Unknown quality rendition');
  if (context.media.source?.delivery !== 'hls') {
    if (command.renditionId) throw new Error('Original quality is fixed');
    return true;
  }
  context.quality.manual = command.renditionId;
  if (context.media.runtime) {
    const previous = context.quality.automatic.id;
    context.quality.automatic.pin(command.renditionId, context.media.source.renditions ?? []);
    if (!command.renditionId || command.renditionId === previous) return true;
  }
  if (context.media.pipeline && (!chosen || context.media.pipeline.qualityIds.includes(chosen.id)))
    context.media.pipeline.abr.manual = command.renditionId;
  else if (context.media.source)
    await activateSource(context, context.media.source, readPosition(context), false, true);
  return true;
}
