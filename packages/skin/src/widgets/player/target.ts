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
