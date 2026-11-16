import { number } from '../../foundation/i18n';
import type { EngineEvent } from '../../player/model';
import type { PlaybackPlan, SessionCommand } from '../../wire/v0/types';

/** Only expose observations the engine can substantiate. */
export function liveStatus(event: EngineEvent) {
  if (event.type !== 'snapshot' || !event.snapshot.live) return null;
  const live = event.snapshot.live;
  return {
    sessionId: event.snapshot.sessionId ?? '',
    reconnecting: live.reconnecting,
    delivery: live.delivery,
    drift: live.driftSeconds === null ? -1 : Math.round(live.driftSeconds),
    driftLabel: live.driftSeconds === null ? '' : number(Math.round(live.driftSeconds)),
    canCatchUp: live.canCatchUp,
  };
}

/** Release the session a plan belongs to, at that plan's generations. An already-ended session needs nothing more. */
export async function stopPlan(api: { command(id: string, r: SessionCommand): Promise<PlaybackPlan> }, planJson: string) {
  const plan = JSON.parse(planJson) as PlaybackPlan;
  try {
    await api.command(plan.sessionId, { kind: 'stop', sourceGeneration: plan.sourceGeneration, seekGeneration: plan.seekGeneration,
      idempotencyKey: `stop-${plan.sessionId}-${plan.sourceGeneration}-${plan.seekGeneration}` });
  } catch { /* Ended, expired or already stopped: the server holds nothing for it. */ }
  return { planJson: '', sessionId: plan.sessionId, error: '' };
}
