// Live watch inside the chrome: a channel plays at the live edge, so the timeline gives way to
// the live panel (the LIVE badge, channel up and down, honest delivery states and Go live), the
// mini guide shows while a channel is being dialled, and up and down flick channels. The panel
// and flicking come from the live TV widgets (widgets/guide); this only places them.
import type { PlaybackPlan, Snapshot } from '@vela/player-api';
import { LiveControls, liveNeedsAttention, liveWatchKey, MiniGuide, useLiveContext, useLiveView } from '../guide';
import type { CommandInput } from './context';

export interface LiveWatch {
  /** The session plays a channel. */
  live: boolean;
  /** Something about delivery the viewer should see even while the chrome rests. */
  attention: boolean;
  /** A key for live watch (dialling, tuning, forgetting); answers whether it was taken. */
  key(key: string): boolean;
  zap(step: -1 | 1): void;
}

export function useLiveWatchChrome(plan: PlaybackPlan | null, snapshot: Snapshot | null): LiveWatch {
  const context = useLiveContext();
  const view = useLiveView();
  const channelId = plan?.channelId ?? '';
  const controller = context?.controller;
  return {
    live: !!channelId || !!plan?.live,
    attention: liveNeedsAttention(snapshot?.live ?? null),
    key: key => (controller && channelId ? liveWatchKey(controller, key, channelId, view.watchZap !== '') : false),
    zap: step => {
      if (controller && channelId) controller.zapWatch(step, channelId);
    },
  };
}

interface PanelProps {
  snapshot: Snapshot | null;
  watch: LiveWatch;
  send(command: CommandInput): void;
}

export function LivePanel({ snapshot, watch, send }: PanelProps) {
  return (
    <LiveControls live={snapshot?.live ?? null} onGoLive={() => send({ type: 'catchUp' })} onZap={watch.zap} />
  );
}

/** The dialled channel between its neighbours, while flicking. */
export function LiveDial({ plan, small, still }: { plan: PlaybackPlan | null; small: boolean; still: boolean }) {
  if (!plan?.channelId) return null;
  return <MiniGuide playingId={plan.channelId} small={small} still={still} />;
}
