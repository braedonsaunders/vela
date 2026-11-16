import { number } from '../i18n';
import type { PlaybackPlan, SessionCommand } from '../wire';

/** The part of a player snapshot (`@vela/player-api`) live status reads. */
export interface LiveObservation {
  sessionId: string | null;
  live: {
    reconnecting: boolean;
    delivery: string;
    driftSeconds: number | null;
    canCatchUp: boolean;
  } | null;
}

/** Only expose observations the engine can substantiate. */
export function liveStatus(snapshot: LiveObservation) {
  if (!snapshot.live) return null;
  const live = snapshot.live;
  return {
    sessionId: snapshot.sessionId ?? '',
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
