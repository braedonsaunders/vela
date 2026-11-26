import type { LiveEventRef, PlaybackPlan, SessionEvent, SessionSnapshot } from '../wire';
import type { ServerAdapter } from '../adapter';
import type { EventStream } from '../adapter/capabilities';
import { withPlaying } from '../store/playing-release';
import { VelaError } from '../adapter/errors';

/**
 * One connection to a playback session's events. It starts from a fresh authoritative snapshot,
 * then follows the stream from that snapshot's cursor. Every plan goes to
 * `onPlan` after `present` validates it for the server it came from. Resolves when the server
 * closes the stream; an unknown or malformed event rejects, so a retry starts with a new snapshot.
 * The live event on air (a live channel showing a game) goes to `onLiveEvent`, from the snapshot
 * and from the stream's `liveEvent` events. `onActivity` hears the stream open and every chunk on it.
 */
export async function followSession(
  api: ServerAdapter & EventStream,
  present: (plan: PlaybackPlan) => PlaybackPlan,
  sessionId: string,
  onPlan: (plan: PlaybackPlan) => void,
  signal?: AbortSignal,
  onLiveEvent?: (liveEvent: LiveEventRef | null) => void,
  onActivity?: () => void,
): Promise<void> {
  let snapshot: SessionSnapshot = await api.sessionSnapshot(sessionId);
  let revision = snapshot.revision;
  signal?.throwIfAborted();
  onPlan(present(withPlaying(snapshot.plan, snapshot)));
  if (snapshot.liveEvent !== undefined) onLiveEvent?.(liveEventRef(snapshot.liveEvent));
  await api.streamSession(sessionId, snapshot.cursor, async event => {
    if (event.event === 'liveEvent') {
      onLiveEvent?.(liveEventRef((JSON.parse(event.data) as { liveEvent?: unknown }).liveEvent));
      return;
    }
    const value = JSON.parse(event.data) as SessionEvent;
    if (value.sessionId !== sessionId || !value.cursor || typeof value.revision !== 'number') {
      throw new Error('Invalid session event');
    }
    if (value.revision < revision) return;
    switch (value.type) {
      case 'snapshot':
        snapshot = { ...value.snapshot, plan: withPlaying(withPlaying(value.snapshot.plan, value.snapshot), value) };
        break;
      case 'plan':
        // The playing release may ride on the event rather than its plan (a failover's new release).
        snapshot = { ...snapshot, plan: withPlaying(value.plan, value), cursor: value.cursor, revision: value.revision };
        break;
      case 'ended': {
        const plan = { ...snapshot.plan, state: 'ended' as const, revision: value.revision };
        snapshot = { ...snapshot, plan, cursor: value.cursor, revision: value.revision };
        break;
      }
      case 'error':
        // The server's own answer, carried by the stream it answered (200) on.
        throw new VelaError(value.error, 200);
      default:
        snapshot = await api.sessionSnapshot(sessionId);
        break;
    }
    revision = snapshot.revision;
    onPlan(present(snapshot.plan));
  }, signal, onActivity);
}

/** A wire `liveEvent` value: an `{id, feed}` reference, or null for none (malformed reads as none). */
export function liveEventRef(value: unknown): LiveEventRef | null {
  const ref = value as LiveEventRef | null | undefined;
  return ref && typeof ref.id === 'string' && ref.id && typeof ref.feed === 'string' ? { id: ref.id, feed: ref.feed } : null;
}
