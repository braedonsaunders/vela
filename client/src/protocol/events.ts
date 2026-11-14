import type { StreamEvent } from '../../app.contract.d.ts';
import type { SessionEvent, SessionSnapshot, Tokens } from '../../wire/v0/types';
import type { ServerAdapter } from '../adapter';
import { mediaPlan } from './media';

const cursors = new Map<string, string>();

/** The host owns the stream lifetime. Each connection starts from a fresh snapshot. */
export async function sessionEvents(api: ServerAdapter, origin: string, tokens: () => Tokens | null, deviceId: string, sessionId: string): Promise<{ planJson: string; sessionId: string }> {
  let snapshot: SessionSnapshot = await api.snapshot(sessionId);
  const credentials = tokens();
  if (!credentials) throw new Error('Sign in required');
  let revision = snapshot.revision;
  return fetch(`${origin}/vela/v0/sessions/${encodeURIComponent(sessionId)}/events`, {
    headers: { Authorization: `Bearer ${credentials.accessToken}`, 'X-Vela-Device-Id': deviceId, 'Last-Event-ID': cursors.get(sessionId) ?? snapshot.cursor },
    exactStream(event: StreamEvent) {
      if (event.type === 'error') throw new Error(event.message || 'Session stream disconnected');
      if (typeof event.data !== 'string') throw new Error('Invalid session event');
      const value = JSON.parse(event.data) as SessionEvent;
      if (value.sessionId !== sessionId || !value.cursor || typeof value.revision !== 'number') throw new Error('Invalid session event');
      if (value.revision < revision) return { planJson: JSON.stringify(mediaPlan(snapshot.plan, origin)), sessionId };
      switch (value.type) {
        case 'snapshot': snapshot = value.snapshot; break;
        case 'plan': snapshot = { ...snapshot, plan: value.plan, cursor: value.cursor, revision: value.revision }; break;
        case 'ended': snapshot = { ...snapshot, cursor: value.cursor, revision: value.revision }; break;
        case 'error': throw new Error(value.error.message);
        default: throw new Error('Unknown session event; refresh snapshot');
      }
      revision = value.revision;
      cursors.set(sessionId, value.cursor);
      return { planJson: JSON.stringify(mediaPlan(snapshot.plan, origin)), sessionId };
    },
  });
}
