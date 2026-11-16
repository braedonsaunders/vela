import type { BrowserRuntimeServices } from './host/services';
import type { Command, EngineEvent, PlaybackSession, Snapshot } from './model';
import type { BrowserMediaAccess } from './media-auth';
import type { HostContext, ExtendedVideo } from './host/state';
import { retireMediaAuthorization, loadSession, updateSession } from './host/session';
import { observationAllowed, snapshotHost } from './host/telemetry';
import { rejectCommand } from './host/authorizations';
import { executeCommand } from './host/commands';
import { disposeHost } from './host/lifecycle';
import { createHostContext } from './host/context';
/** Framework-independent browser host facade; React and native-view adapters share this seam. */
export class PlaybackEngine {
  private readonly context: HostContext;
  constructor(
    video: ExtendedVideo,
    deliver: (event: EngineEvent) => void,
    fullscreenContainer: HTMLElement = video,
    ambient = false,
    mediaAccess?: BrowserMediaAccess,
    runtimes?: BrowserRuntimeServices,
  ) {
    this.context = createHostContext(video, deliver, fullscreenContainer, ambient, mediaAccess, runtimes);
  }
  get video() {
    return this.context.surface.video;
  }
  get controller() {
    return this.context.session.controller;
  }
  /** A server/principal/credential switch retires every old private reader. */
  retireMediaAuthorization() {
    return retireMediaAuthorization(this.context);
  }
  get observationAllowed() {
    return observationAllowed(this.context);
  }
  snapshot(): Snapshot {
    return snapshotHost(this.context);
  }
  load(session: PlaybackSession) {
    return loadSession(this.context, session);
  }
  /** A server readiness/observation revision is not a new playback attempt. */
  updateSession(session: PlaybackSession) {
    return updateSession(this.context, session);
  }
  rejectCommand(message: string) {
    return rejectCommand(this.context, message);
  }
  command(command: Command) {
    return executeCommand(this.context, command);
  }
  dispose() {
    return disposeHost(this.context);
  }
}
