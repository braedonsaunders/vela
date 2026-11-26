// Live TV catch-up and timeshift (features.liveCatchUp, Ether v0.3.22 spec section C). Two of every
// three channels keep a three-day provider archive (VELA_MOCK_ARCHIVE_DAYS); their past programmes
// replay from it and the programme on air can start over. Every channel's live plan carries the
// rewind window (live.ts). VELA_MOCK_CATCHUP=0 turns all of it off; VELA_MOCK_CATCHUP_UNAVAILABLE
// lists channel ids whose provider refuses archive requests (catchup_unavailable).
import type * as V from '../packages/protocol/types';
import { archiveWindow, catchUpEnabled, liveWindow, sequenceAt, timeshiftMinutes } from './live';

const DAY = 86_400_000;
export const archiveDays = Math.max(1, Math.min(30, Number(process.env.VELA_MOCK_ARCHIVE_DAYS ?? 3) || 3));
const refusing = new Set((process.env.VELA_MOCK_CATCHUP_UNAVAILABLE ?? '').split(',').filter(Boolean));

export function catchUpFeature(): Partial<V.ServerCapabilities['features']> {
  if (!catchUpEnabled) return {};
  return { liveCatchUp: { available: true, maxDays: archiveDays, timeshift: timeshiftMinutes ? { available: true, maxMinutes: timeshiftMinutes } : { available: false } } };
}

/** Which channels keep an archive: two of every three in lineup order. */
export function withArchives(channels: V.Channel[]): void {
  if (!catchUpEnabled) return;
  channels.forEach((channel, i) => { if (i % 3 !== 2) channel.archiveDays = archiveDays; });
}

/** The A4 flags on a guide programme, from its channel's stored archive. */
export function flagProgramme(programme: V.Programme, channel: V.Channel | undefined, now = Date.now()): V.Programme {
  const days = channel?.archiveDays;
  if (!days) return programme;
  const start = Date.parse(programme.start), end = Date.parse(programme.end);
  if (start < now - days * DAY || start > now) return programme;
  return end <= now ? { ...programme, catchUp: true } : { ...programme, startOver: true };
}

type Fail = (cls: V.ProtocolError['class'], code: string, message: string, extra?: Partial<V.ProtocolError>, status?: number) => never;

/** A catch-up request's range on its channel: a programme (by its fixture id `<channel>:<start ms>`), or an explicit range. */
type ArchiveRequest = { programmeId?: string; startAt?: string; durationSeconds?: number };
export function archiveRange(request: ArchiveRequest, channel: V.Channel, find: (id: string) => V.Programme | undefined, fail: Fail, now = Date.now()) {
  if (!catchUpEnabled || !channel.archiveDays) fail('conflict', 'catchup_not_supported', 'This channel has no archive', {}, 409);
  let programme: V.Programme | undefined;
  let start: number, end: number;
  if (request.programmeId) {
    programme = find(request.programmeId);
    if (!programme || programme.channelId !== channel.id) fail('not-found', 'programme_not_found', 'Programme not found');
    start = Date.parse(programme.start); end = Date.parse(programme.end);
  } else {
    start = Date.parse(request.startAt ?? ''); end = start + (request.durationSeconds ?? NaN) * 1000;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) fail('request', 'invalid_range', 'startAt and a positive durationSeconds are required');
  }
  const earliest = now - channel.archiveDays! * DAY;
  if (start < earliest || start > now) fail('conflict', 'catchup_outside_archive', 'The range is outside the channel archive', { archiveDays: channel.archiveDays, earliestAt: new Date(earliest).toISOString() }, 409);
  if (refusing.has(channel.id)) fail('source', 'catchup_unavailable', 'The provider had no archive for this range', { retry: { allowed: true, afterSeconds: 30 } }, 502);
  return { programme, start, end, airing: end > now };
}

/** Turn a fresh live-channel plan into a catch-up (ended: on-demand) or Start over (airing: growing) plan. */
export function archivePlan(plan: V.PlaybackPlan, base: string, channel: V.Channel, range: ReturnType<typeof archiveRange>): void {
  // The segments covering the range: from the one carrying its start to the one carrying its last instant.
  const startSeq = sequenceAt(range.start), endSeq = range.airing ? null : sequenceAt(range.end - 1) + 1;
  const prefix = `${base}/live/archive/${startSeq}/${endSeq ?? 'open'}`;
  // A catch-up plan names its channel only in `catchUp`: the engines treat a channelId as live.
  delete plan.channelId;
  plan.title = range.programme?.name ?? channel.name;
  plan.catchUp = { channelId: channel.id, ...(range.programme ? { programmeId: range.programme.id } : {}), startAt: new Date(range.start).toISOString(), endAt: new Date(range.end).toISOString() };
  plan.paths = plan.paths.map(path => ({ ...path, sourceId: 'synthetic-archive', timelineId: `archive-${startSeq}`, url: `${prefix}/master.m3u8`,
    qualities: path.qualities.map(q => ({ ...q, url: `${prefix}/v${q.height}/index.m3u8` })) }) as V.PlaybackPath);
  plan.positionSeconds = 0;
  if (range.airing) {
    const window = archiveWindow(startSeq, null);
    plan.live = { mode: 'startOver', windowStartSeconds: 0, liveEdgeSeconds: window.edge, edgeAt: window.edgeAt, behindLiveSeconds: window.edge };
    plan.durationSeconds = undefined;
    archives.set(plan.sessionId, { startSeq, endSeq: null });
  } else {
    delete plan.live;
    plan.durationSeconds = (endSeq! - startSeq) * 4;
    archives.set(plan.sessionId, { startSeq, endSeq });
  }
}

const archives = new Map<string, { startSeq: number; endSeq: number | null }>();

/** Before a plan is published: the live window as it is now (Ether's refreshLiveWindow), and how far behind it the viewer is. */
export function refreshLive(plan: V.PlaybackPlan): void {
  if (!plan.live) return;
  const archive = archives.get(plan.sessionId);
  if (plan.live.mode === 'startOver' && archive) {
    const window = archiveWindow(archive.startSeq, archive.endSeq);
    Object.assign(plan.live, { liveEdgeSeconds: window.edge, edgeAt: window.edgeAt, behindLiveSeconds: Math.max(0, window.edge - plan.positionSeconds) });
    return;
  }
  if (!timeshiftMinutes) return;
  const window = liveWindow();
  Object.assign(plan.live, { anchor: window.anchor, windowStartSeconds: window.windowStartSeconds, liveEdgeSeconds: window.liveEdgeSeconds, edgeAt: window.edgeAt, timeshift: window.timeshift,
    behindLiveSeconds: Math.max(0, window.liveEdgeSeconds - plan.positionSeconds) });
}

/** A live or Start over session's command checks (spec B2, C5); throws the C6 refusals. */
export function checkTimeshiftCommand(plan: V.PlaybackPlan, command: V.SessionCommand, fail: Fail): void {
  if (command.kind === 'goLive' && !plan.live) fail('request', 'invalid_command', 'A catch-up session has no live edge');
  if (!plan.live || (command.kind !== 'seek' && command.kind !== 'resume')) return;
  refreshLive(plan);
  const start = plan.live.windowStartSeconds ?? 0, edge = plan.live.liveEdgeSeconds ?? 0;
  const bounds = { windowStartSeconds: start, liveEdgeSeconds: edge };
  if (plan.state === 'paused' && plan.positionSeconds < start)
    fail('conflict', 'timeshift_position_evicted', 'The paused position left the rewind window', bounds, 409);
  if (command.kind === 'seek' && (!Number.isFinite(command.positionSeconds) || command.positionSeconds < start || command.positionSeconds > edge))
    fail('conflict', 'timeshift_outside_window', 'The position is outside the rewind window', bounds, 409);
}

/** goLive: a live session moves to its edge; a Start over session becomes its channel's live session. */
export function goLive(plan: V.PlaybackPlan, base: string): void {
  if (plan.live?.mode === 'startOver' && plan.catchUp) {
    plan.channelId = plan.catchUp.channelId;
    delete plan.catchUp;
    archives.delete(plan.sessionId);
    plan.paths = plan.paths.map(path => ({ ...path, sourceId: 'synthetic-live', timelineId: 'synthetic-live', url: `${base}/live/master.m3u8`,
      qualities: path.qualities.map(q => ({ ...q, url: `${base}/live/v${q.height}/index.m3u8` })) }) as V.PlaybackPath);
    plan.live = { ...liveWindow(), mode: 'adaptive' };
    plan.sourceGeneration++;
  }
  refreshLive(plan);
  plan.positionSeconds = plan.live?.liveEdgeSeconds ?? plan.positionSeconds;
  plan.seekGeneration++;
  if (plan.live) plan.live.behindLiveSeconds = 0;
}

/** The Sports "Watch from start" programme of an event on a channel (C7): the programme it airs in. */
export function eventProgramme(channel: V.Channel | undefined, programmes: V.Programme[], eventStart: number, now = Date.now()): V.WatchTarget['programme'] {
  if (!channel?.archiveDays) return undefined;
  const programme = programmes.find(p => Date.parse(p.start) <= eventStart && eventStart < Date.parse(p.end));
  if (!programme) return undefined;
  const flagged = flagProgramme(programme, channel, now);
  if (!flagged.catchUp && !flagged.startOver) return undefined;
  return { id: programme.id, start: programme.start, end: programme.end, ...(flagged.catchUp ? { catchUp: true } : { startOver: true }) };
}

