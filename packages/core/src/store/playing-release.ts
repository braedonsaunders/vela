// The release actually playing (Ether W380): the plan carries playingVersionId and playingLabel,
// and a session snapshot or event may carry them at its top level instead. The chrome reads them
// from the plan, so whichever the server sent ends up there.
import type * as V from '../wire';

/** The plan with the playing release: its own fields where it has them, else those the snapshot
 * or event around it carries. Malformed values are dropped, never shown; absent stays absent. */
export function withPlaying<P extends V.PlaybackPlan>(plan: P, holder?: V.PlayingRelease): P {
  const id = validId(plan.playingVersionId) !== undefined ? plan.playingVersionId : validId(holder?.playingVersionId);
  const label = validLabel(plan.playingLabel) ?? validLabel(holder?.playingLabel);
  if (id === plan.playingVersionId && label === plan.playingLabel) return plan;
  const { playingVersionId: _id, playingLabel: _label, ...rest } = plan;
  return { ...rest, ...(id !== undefined ? { playingVersionId: id } : {}), ...(label !== undefined ? { playingLabel: label } : {}) } as P;
}

/** The release playing, by row id (null: not a row of the menu) and label; null when unknown. */
export function playingRelease(plan: V.PlaybackPlan | null | undefined): { versionId: string | null; label: string } | null {
  if (!plan) return null;
  const id = validId(plan.playingVersionId);
  const label = validLabel(plan.playingLabel) ?? '';
  if (id === undefined && !label) return null;
  return { versionId: id ?? null, label };
}

function validId(value: unknown): string | null | undefined {
  return value === null || (typeof value === 'string' && value !== '') ? value : undefined;
}

function validLabel(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
