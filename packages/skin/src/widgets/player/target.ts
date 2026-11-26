// What the route asked to play decides whether the chrome is live, as much as the plan does:
// a channel or a live library is live from the first frame, before a plan arrives and when
// none ever does (a refused start).
import type { PlaybackPlan } from '@vela/player-api';
import type { ChromeTarget } from './context';

export function isLiveTarget(target: ChromeTarget | undefined): boolean {
  return target?.kind === 'channel' || target?.kind === 'library-live';
}

/** Whether the chrome is live, and the channel it zaps from. */
export function liveWatchOf(plan: PlaybackPlan | null, target: ChromeTarget | undefined): { live: boolean; channelId: string } {
  const channelId = plan?.channelId || (target?.kind === 'channel' ? target.id : '');
  return { live: !!channelId || !!plan?.live || target?.kind === 'library-live', channelId };
}

/**
 * A programme from the channel's archive: Start over (the programme on air from its beginning, still
 * growing) or a catch-up (one that has ended), and the channel Back to live returns to.
 */
export function catchUpWatchOf(plan: PlaybackPlan | null, target: ChromeTarget | undefined): { kind: 'startOver' | 'catchUp'; channelId: string } | null {
  const channelId = plan?.catchUp?.channelId || (!plan && (target?.kind === 'programme' ? target.channelId ?? '' : ''));
  if (!channelId) return null;
  const startOver = plan ? plan.live?.mode === 'startOver' : target?.kind === 'programme' && target.from === 'start';
  return { kind: startOver ? 'startOver' : 'catchUp', channelId };
}
