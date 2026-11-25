import { canAttemptOriginal } from '../original-support';
import { pathUnplayable, refusedReason, type PageAbility, type Unplayable } from '../path-playability';
import type { HostContext } from './state';
import { supportsSource } from './quality';

export function pageAbility(context: HostContext): PageAbility {
  return {
    secure: typeof isSecureContext === 'boolean' ? isSecureContext : true,
    originalRoute: canAttemptOriginal(),
    canPlay: (mime) => !!context.surface.video.canPlayType(mime),
  };
}

/** The session's paths this page cannot play, with why, for the quality menu (Snapshot.unplayablePaths). */
export function unplayablePaths(context: HostContext): { id: string; reason: Unplayable }[] {
  const session = context.session.current;
  if (!session) return [];
  const page = pageAbility(context);
  const out: { id: string; reason: Unplayable }[] = [];
  for (const source of session.sources) {
    if (source.edition !== session.edition || supportsSource(context, source)) continue;
    out.push({ id: source.id, reason: refusedReason(source, page) });
  }
  for (const source of session.onDemandSources ?? []) {
    const reason = pathUnplayable(source, page);
    if (reason) out.push({ id: source.id, reason });
  }
  return out;
}
