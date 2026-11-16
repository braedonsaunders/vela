import type { StreamEvent } from '../../app.contract.d.ts';
import type { PlaybackPlan, SessionEvent, SessionSnapshot } from '../../wire/v0/types';
import type { ServerAdapter } from '../adapter';
import type { EventStream } from '../adapter/capabilities';

const cursors = new Map<string, string>();

/** The host owns the stream lifetime. Each connection starts from a fresh snapshot.
 * `present` validates a plan for the server it came from before the player receives it. */
export async function sessionEvents(
  api: ServerAdapter & EventStream,
  present: (plan: PlaybackPlan) => PlaybackPlan,
  sessionId: string,
): Promise<{ planJson: string; sessionId: string; preparing: boolean; errorCode: string; errorMessage: string; retryAllowed: boolean; retryAfterSeconds: number; retryLimit: number }> {
  let snapshot: SessionSnapshot = await api.sessionSnapshot(sessionId);
  let revision = snapshot.revision;
  return api.streamSession(sessionId, cursors.get(sessionId) ?? snapshot.cursor, async (event: StreamEvent) => {
      if (event.type === 'error') throw new Error(event.message || 'Session stream disconnected');
      if (typeof event.data !== 'string') throw new Error('Invalid session event');
      const value = JSON.parse(event.data) as SessionEvent;
      if (value.sessionId !== sessionId || !value.cursor || typeof value.revision !== 'number') throw new Error('Invalid session event');
      if (value.revision < revision) return { planJson: JSON.stringify(present(snapshot.plan)), sessionId, preparing: false, errorCode: '', errorMessage: '', retryAllowed: false, retryAfterSeconds: 0, retryLimit: 0 };
      switch (value.type) {
        case 'snapshot': snapshot = value.snapshot; break;
        case 'plan': snapshot = { ...snapshot, plan: value.plan, cursor: value.cursor, revision: value.revision }; break;
        case 'ended': snapshot = { ...snapshot, plan: { ...snapshot.plan, state: 'ended', revision: value.revision }, cursor: value.cursor, revision: value.revision }; break;
        case 'error': throw new Error(value.error.message);
        default: snapshot = await api.sessionSnapshot(sessionId); break;
      }
      revision = snapshot.revision;
      cursors.set(sessionId, snapshot.cursor);
      return { planJson: JSON.stringify(present(snapshot.plan)), sessionId, preparing: false, errorCode: '', errorMessage: '', retryAllowed: false, retryAfterSeconds: 0, retryLimit: 0 };
    });
}
