// A title's version list as the session last described it. A server may answer Play before its
// release search finishes and fill the plan with placeholder ("cold") slots; it describes the
// real releases on a later session read. That read refreshes only this list, kept apart from the
// plan the engines receive, so a refreshed list never looks like a new plan to any player.
import type * as V from '../wire';

export interface SessionVersions {
  sessionId: string;
  /** The plan's source generation when the session was read: a newer plan's choice wins. */
  sourceGeneration: number;
  versions: V.VersionItem[];
  selectedVersionId?: string;
  rememberedChoice?: V.RememberedVersionChoice;
}

/** A placeholder slot: offered before the server knew what it is (no size, source, codec or audio). */
export function coldVersion(version: V.VersionItem): boolean {
  return !version.sizeBytes && !version.source && !version.videoCodec && !version.audio;
}

export function hasColdVersion(versions: readonly V.VersionItem[] | undefined): boolean {
  return !!versions?.some(coldVersion);
}

/** The version list a session read carries, or null when it carries none worth keeping. */
export function sessionVersionsOf(plan: V.PlaybackPlan): SessionVersions | null {
  const versions = plan.versions;
  if (!Array.isArray(versions) || !versions.length) return null;
  if (!versions.every(v => v && typeof v.id === 'string' && typeof v.label === 'string')) return null;
  return {
    sessionId: plan.sessionId,
    sourceGeneration: plan.sourceGeneration,
    versions,
    ...(plan.selectedVersionId !== undefined ? { selectedVersionId: plan.selectedVersionId } : {}),
    ...(plan.rememberedChoice !== undefined ? { rememberedChoice: plan.rememberedChoice } : {}),
  };
}

/**
 * The plan as the chrome shows it: the refreshed list for this session, unless the plan is newer
 * (a version switch answered since) and already describes real releases. The current choice comes
 * from whichever is newer. Only the version fields change; every other field is the plan's own.
 */
export function withSessionVersions<P extends V.PlaybackPlan>(plan: P, refreshed: SessionVersions | null | undefined): P {
  if (!refreshed || refreshed.sessionId !== plan.sessionId) return plan;
  const newerPlan = plan.sourceGeneration > refreshed.sourceGeneration;
  const planReal = !!plan.versions?.length && !hasColdVersion(plan.versions);
  const versions = newerPlan && planReal ? plan.versions! : refreshed.versions;
  const choice = newerPlan ? plan : refreshed;
  if (versions === plan.versions && choice === plan) return plan;
  const { selectedVersionId: _selected, rememberedChoice: _remembered, ...rest } = plan;
  return {
    ...rest,
    versions,
    ...(choice.selectedVersionId !== undefined ? { selectedVersionId: choice.selectedVersionId } : {}),
    ...(choice.rememberedChoice !== undefined ? { rememberedChoice: choice.rememberedChoice } : {}),
  } as P;
}
