import type * as V from '../wire';
import type { ServerAdapter } from './index';
import { hasGoLive, hasPathSwitching, hasProactiveFallback, hasTileReplan, hasTrackChanges, hasVersions } from './capabilities';
import { notOffered } from './errors';

/**
 * Send a player's session command to whichever operation carries it: transport control is core;
 * track changes, path switches and fallback preparation are capabilities.
 */
export async function sendCommand(
  adapter: ServerAdapter,
  sessionId: string,
  command: V.SessionCommand,
): Promise<V.PlaybackPlan> {
  switch (command.kind) {
    case 'tracks':
      if (!hasTrackChanges(adapter)) throw notOffered('Changing tracks during playback');
      return adapter.changeTracks(sessionId, command);
    case 'switch':
      if (!hasPathSwitching(adapter)) throw notOffered('Switching playback paths');
      return adapter.switchPath(sessionId, command);
    case 'prepare-fallback':
      if (!hasProactiveFallback(adapter)) throw notOffered('Proactive fallback');
      return adapter.prepareFallback(sessionId, command);
    case 'replan':
      if (!hasTileReplan(adapter)) throw notOffered('Replanning a multiview tile');
      return adapter.replanTile(sessionId, command);
    case 'goLive':
      if (!hasGoLive(adapter)) throw notOffered('Going back to live');
      return adapter.goLive(sessionId, command);
    case 'version':
      if (!hasVersions(adapter)) throw notOffered('Switching versions');
      return adapter.switchVersion(sessionId, command);
    default:
      return adapter.command(sessionId, command);
  }
}
