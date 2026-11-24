// The page side of /live/stream: which topics one connection follows, the query it opens with,
// and the frames it reads (records, source, alert, heartbeat). Ether: topic repeated, one since
// (the lowest followed page rev; it replays every record and source above it), at most 4 topics.
import type { AlertFrame, RecordEntry, StreamSource } from '../wire';

export const MAX_TOPICS = 4;

export interface TopicInterest { topic: string; rev: number; shownAt: number }
export interface ScreenStreamQuery { topics: string[]; since: number; alerts: boolean }

/** The topics one connection follows: the most recently shown pages first, at most 4, each once. */
export function chooseTopics(interests: Iterable<TopicInterest>): TopicInterest[] {
  const byTopic = new Map<string, TopicInterest>();
  for (const interest of interests) {
    if (!interest.topic) continue;
    const known = byTopic.get(interest.topic);
    // The same topic on two pages: the later shown, with the lower rev (it must replay for both).
    if (!known) byTopic.set(interest.topic, interest);
    else byTopic.set(interest.topic, { topic: interest.topic, shownAt: Math.max(known.shownAt, interest.shownAt), rev: Math.min(known.rev, interest.rev) });
  }
  return [...byTopic.values()].sort((a, b) => b.shownAt - a.shownAt || (a.topic < b.topic ? -1 : 1)).slice(0, MAX_TOPICS);
}

/** The query for the chosen topics: since is the lowest of their revs (0 when none is known). */
export function streamQuery(topics: readonly TopicInterest[], alerts: boolean): ScreenStreamQuery {
  const revs = topics.map(topic => topic.rev).filter(rev => Number.isFinite(rev) && rev > 0);
  return { topics: topics.map(topic => topic.topic).sort(), since: revs.length ? Math.min(...revs) : 0, alerts };
}

/** Identity of a connection: the topics and alerts, never since (a moving rev reconnects nothing). */
export const connectionKey = (query: Pick<ScreenStreamQuery, 'topics' | 'alerts'>) => JSON.stringify([query.topics, query.alerts]);
export const emptyQuery = (query: Pick<ScreenStreamQuery, 'topics' | 'alerts'>) => !query.topics.length && !query.alerts;

/** The query string: `topic=A&topic=B&since=<lowest>&alerts=1`. No tz: each topic seals its own
 * (Ether refuses any other key with 400 invalid_request). */
export function streamSearch(query: ScreenStreamQuery): string {
  const params = new URLSearchParams();
  for (const topic of query.topics) params.append('topic', topic);
  if (query.topics.length && query.since > 0) params.set('since', String(query.since));
  if (query.alerts) params.set('alerts', '1');
  const text = params.toString();
  return text ? `?${text}` : '';
}

export type ScreenStreamMessage =
  | { kind: 'records'; records: Record<string, RecordEntry> }
  | { kind: 'source'; frame: StreamSource }
  | { kind: 'alert'; alert: AlertFrame }
  | { kind: 'heartbeat' }
  | { kind: 'ignored' };

const text = (value: unknown): value is string => typeof value === 'string';

/** One stream frame, validated. `update` (the old event frames) and anything unknown are ignored. */
export function readScreenMessage(name: string, data: string): ScreenStreamMessage {
  if (name === 'heartbeat') return { kind: 'heartbeat' };
  if (name !== 'records' && name !== 'source' && name !== 'alert') return { kind: 'ignored' };
  let value: unknown;
  try { value = JSON.parse(data); } catch { return { kind: 'ignored' }; }
  if (!value || typeof value !== 'object') return { kind: 'ignored' };
  const frame = value as Record<string, unknown>;
  if (name === 'records') {
    const records = frame.records;
    return records && typeof records === 'object' && !Array.isArray(records) ? { kind: 'records', records: records as Record<string, RecordEntry> } : { kind: 'ignored' };
  }
  if (name === 'source') {
    if (!text(frame.source) || !frame.source || typeof frame.rev !== 'number' || !Number.isFinite(frame.rev) || !('value' in frame)) return { kind: 'ignored' };
    // Exactly one owner: a screen page, or a surface.
    if (text(frame.surface) && frame.surface && frame.screen === undefined && frame.page === undefined)
      return { kind: 'source', frame: { surface: frame.surface, source: frame.source, rev: frame.rev, value: frame.value } };
    if (text(frame.screen) && frame.screen && text(frame.page) && frame.surface === undefined)
      return { kind: 'source', frame: { screen: frame.screen, page: frame.page, source: frame.source, rev: frame.rev, value: frame.value } };
    return { kind: 'ignored' };
  }
  const alert = frame as Partial<AlertFrame>;
  if (!text(alert.id) || !alert.id || !text(alert.kind) || !text(alert.title) || !text(alert.body) || !text(alert.at)) return { kind: 'ignored' };
  return { kind: 'alert', alert: {
    id: alert.id, kind: alert.kind, title: alert.title, body: alert.body, at: alert.at,
    ...(text(alert.ref) ? { ref: alert.ref } : {}), ...(text(alert.plugin) ? { plugin: alert.plugin } : {}), ...(text(alert.surface) ? { surface: alert.surface } : {}),
  } };
}
