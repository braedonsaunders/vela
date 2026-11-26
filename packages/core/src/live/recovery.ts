import type { PlaybackTarget } from '../store/playback';
import type { PlaybackPlan } from '../wire';
import { LIVE_SLACK_SECONDS } from './timeshift';

export type LiveResume = { kind: 'programme'; seconds: number; startAt?: string } | { kind: 'timeshift'; at: number } | { kind: 'edge' };

/** Capture the viewer's position before the old session and its timeline go away. */
export function liveRestart(target: PlaybackTarget, plan: PlaybackPlan, position: number, atLive: boolean): {
  target: PlaybackTarget;
  resume?: LiveResume;
} | undefined {
  const archive = plan.catchUp;
  if (archive && target.kind === 'programme') {
    const { positionSeconds: _, ...programme } = target;
    const rangeSeconds = (Date.parse(archive.endAt ?? '') - Date.parse(archive.startAt)) / 1000;
    const durationSeconds = rangeSeconds > 0 ? rangeSeconds : plan.durationSeconds ?? 0;
    const restart = plan.live?.mode === 'startOver'
      ? { kind: 'programme' as const, id: archive.programmeId ?? programme.id, channelId: archive.channelId, from: 'start' as const }
      : Number.isFinite(durationSeconds) && durationSeconds > 0
        ? { kind: 'programme' as const, id: programme.id, channelId: archive.channelId, range: { startAt: archive.startAt, durationSeconds } }
        : programme;
    return { target: restart, resume: { kind: 'programme', seconds: position, startAt: archive.startAt } };
  }

  if (target.kind !== 'channel' && target.kind !== 'programme') return;
  const channelId = plan.channelId ?? (target.kind === 'channel' ? target.id : undefined);
  if (!channelId || !plan.live || (target.kind === 'channel' && !plan.live.timeshift)) return;
  const live = plan.live;
  const edge = live.liveEdgeSeconds;
  const edgeAt = Date.parse(live.edgeAt ?? '');
  const resume: LiveResume | undefined = !atLive && live.timeshift && edge !== undefined && Number.isFinite(edgeAt)
    ? { kind: 'timeshift', at: edgeAt + (position - edge) * 1000 } : { kind: 'edge' };
  return { target: { kind: 'channel', id: channelId }, resume };
}

/** Translate the saved point into the replacement session's coordinate system. */
export function liveRestartSeek(resume: Exclude<LiveResume, { kind: 'edge' }>, plan: PlaybackPlan): number | 'evicted' {
  if (resume.kind === 'programme') {
    const previousStart = Date.parse(resume.startAt ?? '');
    const replacementStart = Date.parse(plan.catchUp?.startAt ?? '');
    const offset = Number.isFinite(previousStart) && Number.isFinite(replacementStart)
      ? (previousStart - replacementStart) / 1000 : 0;
    const position = resume.seconds + offset;
    return Math.max(plan.live?.windowStartSeconds ?? 0,
      Math.min(position, plan.live?.liveEdgeSeconds ?? plan.durationSeconds ?? position));
  }
  const { live } = plan;
  const edgeAt = Date.parse(live?.edgeAt ?? '');
  const edge = live?.liveEdgeSeconds;
  const start = live?.windowStartSeconds;
  if (!live?.timeshift || edge === undefined || start === undefined || !Number.isFinite(edgeAt)) return 'evicted';
  const position = edge + (resume.at - edgeAt) / 1000;
  return position >= start && position <= edge ? position : 'evicted';
}

export function atLiveEdge(plan: PlaybackPlan, position: number): boolean {
  return position >= (plan.live?.liveEdgeSeconds ?? Infinity) - LIVE_SLACK_SECONDS * 2;
}
