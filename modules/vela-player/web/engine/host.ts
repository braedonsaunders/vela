import type { CreateWebPlayerHost, VelaPlayerProps } from '../../../../packages/player-api/src/types';
import { PlaybackEngine } from './engine';
import type { Failure } from './model';
import { sessionFromPlan } from './protocol';
import { playbackMark } from './timing';
import { bundledRuntimeServices } from './host/bundled-runtime';
import { ControllerMediaAccess } from './host/controller-access';
import { createBrowserSurface, pageFullscreenContainer } from './host/surface';
import { createViewEvents, publicFailure } from './host/view-events';

/** Typed DOM seam shared by React Native Web and any other browser shell. */
export const createWebPlayerHost: CreateWebPlayerHost = (element, initialProps, options) => {
  let props = initialProps;
  let revision = 0;
  let disposed = false;
  let lastCommand = -1;
  let lastInput: VelaPlayerProps['plan'] | VelaPlayerProps['session'];
  let planSession = '';
  let planRevision = -1;
  let lastServerError: VelaPlayerProps['serverError'];
  const ambient = props.ambient === true;
  const media = new ControllerMediaAccess(options.access);
  const runtimes = bundledRuntimeServices(options.assetBaseURL);
  const surface = createBrowserSurface(element);
  const events = createViewEvents(
    () => props,
    () => engine,
  );
  // Fullscreen takes the whole page, so the player chrome drawn over the video stays visible.
  // A multiview tile plays beside others: muted until a command, never the viewer's saved volume.
  const engine = new PlaybackEngine(surface.video, events, pageFullscreenContainer(element), ambient, media, runtimes, props.tile !== undefined);

  async function applyCommand(command: NonNullable<VelaPlayerProps['command']>) {
    if (!Number.isSafeInteger(command.id)) {
      props.onError?.({ kind: 'action', message: 'Command requires integer id', recoverable: true });
      return;
    }
    if (command.id <= lastCommand) return;
    lastCommand = command.id;
    let failure: Failure | undefined;
    if (ambient && ['fullscreen', 'pip'].includes(command.type)) {
      failure = { kind: 'action', message: 'Preview controls are unavailable', recoverable: true };
    } else failure = await engine.command(command);
    if (disposed) return;
    props.onCommand?.({
      id: command.id,
      ok: !failure,
      ...(failure ? { failure: publicFailure(failure) } : {}),
    });
  }

  async function apply(next: VelaPlayerProps, currentRevision: number) {
    const changed = await media.refresh();
    if (disposed || currentRevision !== revision) return;
    if (changed) {
      engine.retireMediaAuthorization();
      lastInput = undefined;
      planSession = '';
      planRevision = -1;
    }
    if ((next.ambient === true) !== ambient) throw new Error('Ambient mode requires a new player view');
    if (next.serverError !== lastServerError) {
      lastServerError = next.serverError;
      if (next.serverError) engine.rejectCommand(publicFailure(next.serverError).message);
    }
    if (next.serverError) return;
    const input = next.plan ?? next.session;
    if (!input && lastInput) {
      engine.retireMediaAuthorization();
      lastInput = undefined;
      planSession = '';
      planRevision = -1;
    }
    if (input && input !== lastInput) {
      const plan = next.plan;
      const stale =
        plan &&
        plan.sessionId === planSession &&
        (plan.revision <= planRevision ||
          plan.sourceGeneration < engine.controller.source ||
          plan.seekGeneration < engine.controller.seek);
      if (!stale) {
        const session = plan ? sessionFromPlan(plan, options.access()?.origin ?? location.href) : next.session!;
        if (!session.id || !Array.isArray(session.sources)) throw new Error('Invalid playback session');
        if (plan) {
          planSession = plan.sessionId;
          planRevision = plan.revision;
        }
        lastInput = input;
        const current = engine.snapshot();
        if (current.sessionId !== session.id) playbackMark('plan:received');
        if (
          plan &&
          current.sessionId === session.id &&
          current.sourceId === session.selectedSourceId &&
          current.sourceGeneration === session.sourceGeneration &&
          current.seekGeneration === session.seekGeneration
        )
          engine.updateSession(session);
        else void engine.load(session);
      }
    }
    if (next.command) await applyCommand(next.command);
  }

  function update(next: VelaPlayerProps) {
    if (disposed) return;
    props = next;
    const currentRevision = ++revision;
    void apply(next, currentRevision).catch((error) => {
      if (disposed || currentRevision !== revision) return;
      engine.retireMediaAuthorization();
      props.onError?.(
        publicFailure({
          kind: 'source',
          recoverable: false,
          message: error instanceof Error ? error.message : 'Player update failed',
        }),
      );
    });
  }

  update(initialProps);
  return {
    update,
    dispose() {
      if (disposed) return;
      disposed = true;
      revision++;
      engine.dispose();
      media.dispose();
      surface.dispose();
    },
  };
};
