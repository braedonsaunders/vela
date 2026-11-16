import { createBrowserSurface } from './host/surface';
import { PlaybackEngine } from './engine';
import { MediaAccess, redactMediaError } from './media-auth';
import type { Command, PlaybackSession } from './model';
import type { PlaybackPlan } from '../../../../protocol/v0/types';
import { observation, sessionFromPlan } from './protocol';
import { playbackMark } from './timing';
import { loadedRuntimeServices } from './universal/loader';
export interface BrowserPlayerView {
  media: MediaAccess;
  engine: PlaybackEngine;
  video: HTMLVideoElement;
  sessionJson: string;
  lastCommand: number;
  endedReport: string;
  reportedFailure: string;
  serverError: string;
  planRevision: number;
  planSession: string;
  sequence: number;
  lastReport: number;
  reportedTracks: string;
}
export function createBrowserPlayerView(
  element: HTMLElement,
  json: string,
  event: (kind: number, payload: string) => void,
): BrowserPlayerView {
  const ambient = (JSON.parse(json) as Record<string, string>).ambient === 'true';
  const { video } = createBrowserSurface(element);
  const media = new MediaAccess((request) => event(8, JSON.stringify(request)));
  const handle: BrowserPlayerView = {
    media,
    engine: undefined!,
    video,
    sessionJson: '',
    lastCommand: -1,
    planRevision: -1,
    planSession: '',
    sequence: 0,
    lastReport: 0,
    serverError: '',
    endedReport: '',
    reportedFailure: '',
    reportedTracks: '',
  };
  handle.engine = new PlaybackEngine(
    video,
    (value) => {
      if (value.type === 'error')
        value = { ...value, failure: { ...value.failure, message: redactMediaError(value.failure.message) } };
      else if (value.type === 'snapshot' && value.snapshot.failure)
        value = {
          ...value,
          snapshot: {
            ...value.snapshot,
            failure: { ...value.snapshot.failure, message: redactMediaError(value.snapshot.failure.message) },
          },
        };
      event(8, JSON.stringify(value));
      const now = performance.now();
      const failureKey =
        value.type === 'snapshot' && value.snapshot.failure
          ? [
              value.snapshot.sessionId,
              value.snapshot.sourceGeneration,
              value.snapshot.seekGeneration,
              value.snapshot.sourceId,
              value.snapshot.failure.kind,
              value.snapshot.failure.message,
            ]
              .map(String)
              .join(':')
          : '';
      const trackKey =
        value.type === 'snapshot'
          ? JSON.stringify([
              value.snapshot.sessionId,
              value.snapshot.sourceGeneration,
              value.snapshot.seekGeneration,
              value.snapshot.audioTrackId,
              value.snapshot.subtitleTrackId,
            ])
          : '';
      if (
        value.type === 'snapshot' &&
        handle.engine.observationAllowed &&
        (now - handle.lastReport >= 1000 ||
          (failureKey !== '' && failureKey !== handle.reportedFailure) ||
          trackKey !== handle.reportedTracks)
      ) {
        if (failureKey) handle.reportedFailure = failureKey;
        const endedKey = [
          value.snapshot.sessionId,
          value.snapshot.sourceGeneration,
          value.snapshot.seekGeneration,
        ]
          .map(String)
          .join(':');
        if (value.snapshot.state === 'ended' && handle.endedReport === endedKey) return;
        if (value.snapshot.state === 'ended') handle.endedReport = endedKey;
        const report = observation(value.snapshot, ++handle.sequence);
        if (report) {
          handle.lastReport = now;
          handle.reportedTracks = trackKey;
          event(
            8,
            JSON.stringify({ type: 'observation', sessionId: value.snapshot.sessionId, observation: report }),
          );
        }
      }
    },
    element.parentElement ?? element,
    ambient,
    media,
    loadedRuntimeServices,
  );
  try {
    updateBrowserPlayerView(handle, json);
  } catch (error) {
    handle.engine.dispose();
    media.dispose();
    video.remove();
    throw error;
  }
  return handle;
}
export function updateBrowserPlayerView(handle: BrowserPlayerView, json: string) {
  const props = JSON.parse(json) as Record<string, string>;
  let changed: boolean;
  try {
    changed = handle.media.update(props.mediaAuth ?? '');
  } catch (error) {
    handle.engine.retireMediaAuthorization();
    throw error;
  }
  if (changed) {
    handle.engine.retireMediaAuthorization();
    handle.sessionJson = '';
    handle.planSession = '';
    handle.planRevision = -1;
  }
  handle.media.accept(props.nativeMedia ?? '');
  if (props.serverError !== handle.serverError) {
    handle.serverError = props.serverError ?? '';
    if (handle.serverError) handle.engine.rejectCommand(handle.serverError);
  }
  const input = props.plan || props.session || '';
  if (input && input !== handle.sessionJson) {
    let session: PlaybackSession;
    if (props.plan) {
      const plan = JSON.parse(input) as PlaybackPlan;
      const stale =
        plan.sessionId === handle.planSession &&
        (plan.revision <= handle.planRevision ||
          plan.sourceGeneration < handle.engine.controller.source ||
          plan.seekGeneration < handle.engine.controller.seek);
      if (stale) {
        applyCommand(handle, props);
        return;
      }
      session = sessionFromPlan(plan);
      handle.planRevision = plan.revision;
      handle.planSession = plan.sessionId;
    } else session = JSON.parse(input) as PlaybackSession;
    if (!session.id || !Array.isArray(session.sources)) throw new Error('Invalid playback session');
    if (handle.engine.snapshot().sessionId !== session.id) playbackMark('plan:received');
    handle.sessionJson = input;
    const current = handle.engine.snapshot();
    if (
      props.plan &&
      current.sessionId === session.id &&
      current.sourceId === session.selectedSourceId &&
      current.sourceGeneration === session.sourceGeneration &&
      current.seekGeneration === session.seekGeneration
    )
      handle.engine.updateSession(session);
    else void handle.engine.load(session);
  }
  applyCommand(handle, props);
}
function applyCommand(handle: BrowserPlayerView, props: Record<string, string>) {
  if (props.playerCommand) {
    let command = JSON.parse(props.playerCommand) as Command;
    const value = (
      command as unknown as {
        value?: string;
      }
    ).value;
    if (typeof value === 'string') {
      const decoded = decodeURIComponent(value);
      const base = { id: command.id, type: command.type };
      switch (command.type) {
        case 'lowDelay':
          command = { ...base, type: 'lowDelay', enabled: decoded === 'true' };
          break;
        case 'seekBy':
          command = { ...base, type: 'seekBy', seconds: Number(decoded) };
          break;
        case 'seek':
          command = { ...base, type: 'seek', seconds: Number(decoded) };
          break;
        case 'volume':
          command = { ...base, type: 'volume', value: Number(decoded) };
          break;
        case 'speed':
          command = { ...base, type: 'speed', value: Number(decoded) };
          break;
        case 'subtitleStyle':
          command = { ...base, type: 'subtitleStyle', value: decoded };
          break;
        case 'mute':
          command = { ...base, type: 'mute', muted: decoded === '' ? undefined : decoded === 'true' };
          break;
        case 'quality':
          command = { ...base, type: 'quality', renditionId: decoded || null };
          break;
        case 'audio':
          command = { ...base, type: 'audio', trackId: decoded };
          break;
        case 'subtitle':
          command = { ...base, type: 'subtitle', trackId: decoded || null };
          break;
        case 'switchPath':
          command = { ...base, type: 'switchPath', pathId: decoded };
          break;
      }
    }
    if (!Number.isSafeInteger(command.id)) throw new Error('Command requires integer id');
    if (command.id > handle.lastCommand) {
      handle.lastCommand = command.id;
      void handle.engine.command(command);
    }
  }
}
export function disposeBrowserPlayerView(handle: BrowserPlayerView) {
  handle.engine.dispose();
  handle.media.dispose();
  handle.video.remove();
}
