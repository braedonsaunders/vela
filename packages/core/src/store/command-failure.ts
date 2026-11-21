// What the player says when a session command fails. The server's own words ("stale generation",
// "not available") and error codes never reach the screen: a command the viewer asked for gets
// viewer copy, and one the engine sent on its own (an automatic quality or recovery switch, a
// fallback it prepares) fails silently, because the engine plans again from the next plan.
import type * as V from '../wire';
import { VelaError } from '../adapter/errors';

/** Who sent a session command: the viewer's own choice, or the engine on its own. */
export type CommandOrigin = 'viewer' | 'engine';

/** The server moved the session to newer generations than the command was planned against. */
export function staleGeneration(error: unknown): error is VelaError {
  return error instanceof VelaError && error.detail.code === 'stale_generation';
}

const copy: Partial<Record<V.SessionCommand['kind'], string>> = {
  seek: 'Could not move to that point. Playback continues.',
  pause: 'Could not pause. Try again.',
  resume: 'Could not resume. Try again.',
  tracks: 'Could not change the audio or subtitles. Playback continues.',
  switch: 'Could not change the quality. Playback continues.',
};

/**
 * The words for a failed command, or '' to stay silent. A command that lost to a newer
 * generation is silent: the session already moved on (a version switch, a recovery) and the newer
 * plan describes what plays. Engine-initiated commands and stops are always silent.
 */
export function commandFailure(command: Pick<V.SessionCommand, 'kind'>, error: unknown, origin: CommandOrigin): string {
  if (origin === 'engine' && command.kind === 'switch') return '';
  if (command.kind === 'prepare-fallback' || command.kind === 'stop') return '';
  if (staleGeneration(error)) return '';
  return copy[command.kind] ?? 'Something went wrong. Playback continues.';
}

/**
 * Who sent an engine's session command. A path switch is the viewer's only while their quality
 * pick of that path (`path:<id>`) is pending; any other switch is the engine's own (automatic
 * quality, recovery). Every other command follows something the viewer did.
 */
export function commandOrigin(command: V.SessionCommand, pendingQuality: string | undefined): CommandOrigin {
  return command.kind === 'switch' && pendingQuality !== `path:${command.pathId}` ? 'engine' : 'viewer';
}
