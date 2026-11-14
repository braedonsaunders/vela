import type { EngineEvent } from '../../player/model';

/** Only expose observations the engine can substantiate. */
export function liveStatus(event: EngineEvent) {
  if (event.type !== 'snapshot' || !event.snapshot.live) return null;
  const live = event.snapshot.live;
  return {
    sessionId: event.snapshot.sessionId ?? '',
    reconnecting: live.reconnecting,
    delivery: live.delivery,
    drift: live.driftSeconds === null ? -1 : Math.round(live.driftSeconds),
    canCatchUp: live.canCatchUp,
  };
}
