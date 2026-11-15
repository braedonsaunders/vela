import type { StreamEvent } from '../../app.contract.d.ts';
import type { SessionEvent, SessionSnapshot } from '../../wire/v0/types';
import type { EtherAdapter } from '../adapter/ether';
import { mediaPlan } from './media';

const cursors = new Map<string, string>();

/** The host owns the stream lifetime. Each connection starts from a fresh snapshot. */
export async function sessionEvents(api: EtherAdapter, origin: string, sessionId: string): Promise<{ planJson: string; sessionId: string; errorCode: string; errorMessage: string; retryAllowed: boolean; retryAfterSeconds: number; retryLimit: number }> {
  let snapshot: SessionSnapshot = await api.snapshot(sessionId);
  let revision = snapshot.revision;
  return api.streamSession(sessionId, cursors.get(sessionId) ?? snapshot.cursor, async (event: StreamEvent) => {
      if (event.type === 'error') throw new Error(event.message || 'Session stream disconnected');
      if (typeof event.data !== 'string') throw new Error('Invalid session event');
      const value = JSON.parse(event.data) as SessionEvent;
      if (value.sessionId !== sessionId || !value.cursor || typeof value.revision !== 'number') throw new Error('Invalid session event');
      if (value.revision < revision) return { planJson: JSON.stringify(mediaPlan(snapshot.plan, origin)), sessionId, errorCode: '', errorMessage: '', retryAllowed: false, retryAfterSeconds: 0, retryLimit: 0 };
      switch (value.type) {
        case 'snapshot': snapshot = value.snapshot; break;
        case 'plan': snapshot = { ...snapshot, plan: value.plan, cursor: value.cursor, revision: value.revision }; break;
        case 'ended': snapshot = { ...snapshot, plan: { ...snapshot.plan, state: 'ended', revision: value.revision }, cursor: value.cursor, revision: value.revision }; break;
        case 'error': throw new Error(value.error.message);
        default: snapshot = await api.snapshot(sessionId); break;
      }
      revision = snapshot.revision;
      cursors.set(sessionId, snapshot.cursor);
      return { planJson: JSON.stringify(mediaPlan(snapshot.plan, origin)), sessionId, errorCode: '', errorMessage: '', retryAllowed: false, retryAfterSeconds: 0, retryLimit: 0 };
    });
}
