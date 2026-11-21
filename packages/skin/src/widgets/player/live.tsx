// Live watch inside the chrome: a channel plays at the live edge, so the timeline gives way to
// a status line (reconnecting, a delayed segment, a real lag behind live), and the control row
// takes channel up and down beside the play toggle and the LIVE mark (Go live once playback has
// fallen behind) with the same buttons as every other control. The mini guide shows while a
// channel is being dialled, and the remote's channel keys flick channels. The delivery rule and
// the flicking come from the live TV widgets (widgets/guide); this only places them.
import { Text, View } from 'react-native';
import { msg } from '@vela/core';
import type { PlaybackPlan, Snapshot } from '@vela/player-api';
import { liveBehind, liveNotices, liveWatchKey, MiniGuide, useLiveContext, useLiveView } from '../guide';
import { ChromeButton } from './button';
import type { ChromeTarget, CommandInput } from './context';
import { liveWatchOf } from './target';
import type { PlayerLook } from './look';

export interface LiveWatch {
  /** The session plays a channel. */
  live: boolean;
  /** The channel being watched ('' for a live library or a film). */
  channelId: string;
  /** Channel up and down can dial from here (a live controller and a channel). */
  canZap: boolean;
  /** What the viewer should be told about delivery (empty while the channel plays normally). */
  notices: string[];
  /** Whole seconds behind live when playback can catch up, else 0. */
  behind: number;
  /** A key for live watch (dialling, tuning, forgetting); answers whether it was taken. */
  key(key: string): boolean;
  zap(step: -1 | 1): void;
}

export function useLiveWatchChrome(plan: PlaybackPlan | null, snapshot: Snapshot | null, target?: ChromeTarget): LiveWatch {
  const context = useLiveContext();
  const view = useLiveView();
  const { live: isLive, channelId } = liveWatchOf(plan, target);
  const controller = context?.controller;
  const live = snapshot?.live ?? null;
  return {
    live: isLive,
    channelId,
    canZap: !!controller && !!channelId,
    notices: liveNotices(live),
    behind: liveBehind(live),
    key: key => (controller && channelId ? liveWatchKey(controller, key, channelId, view.watchZap !== '') : false),
    zap: step => {
      if (controller && channelId) controller.zapWatch(step, channelId);
    },
  };
}

/** Channel up and down, as two of the bar's own buttons. */
export function LiveZap({ look, watch, disabled }: { look: PlayerLook; watch: LiveWatch; disabled: boolean }) {
  return (
    <>
      <ChromeButton
        look={look}
        icon="channelUp"
        label={msg('live.channelUp')}
        disabled={disabled}
        testID="player-channel-up"
        onPress={() => watch.zap(-1)}
      />
      <ChromeButton
        look={look}
        icon="channelDown"
        label={msg('live.channelDown')}
        disabled={disabled}
        testID="player-channel-down"
        onPress={() => watch.zap(1)}
      />
    </>
  );
}

/** LIVE at the edge; a Go live button (the same control as the others) once playback is behind. */
export function LiveMark({ look, watch, send }: { look: PlayerLook; watch: LiveWatch; send(command: CommandInput): void }) {
  if (watch.behind > 0) {
    return (
      <ChromeButton
        look={look}
        icon="live"
        text={msg('live.catchUp')}
        label={msg('live.catchUp')}
        testID="player-go-live"
        onPress={() => send({ type: 'catchUp' })}
      />
    );
  }
  return (
    <View
      testID="player-live-mark"
      accessibilityRole="text"
      accessibilityLabel={msg('live.liveBadge')}
      style={{ flexDirection: 'row', alignItems: 'center', gap: look.size(7), paddingHorizontal: look.size(10) }}
    >
      <View style={{ width: look.size(8), height: look.size(8), borderRadius: look.size(4), backgroundColor: look.live }} />
      <Text style={[look.text(12, 700, look.ink), { letterSpacing: look.size(1.2) }]}>{msg('live.liveBadge')}</Text>
    </View>
  );
}

/** The bar's status line on a channel, where the timeline's clock sits on a film. */
export function LiveStatusLine({ look, watch }: { look: PlayerLook; watch: LiveWatch }) {
  if (!watch.notices.length) return null;
  return (
    <View accessibilityLiveRegion="polite" testID="player-live-status">
      <Text numberOfLines={1} style={[look.text(13, 500, look.inkSecondary), { fontVariant: ['tabular-nums'] }]}>
        {watch.notices.join(' · ')}
      </Text>
    </View>
  );
}

/**
 * While the chrome rests, a channel in trouble keeps one small line in the corner (never the
 * whole overlay): out of the focus tree and the pointer's way, gone once delivery recovers.
 */
export function LiveNotice({ look, watch }: { look: PlayerLook; watch: LiveWatch }) {
  if (!watch.live || !watch.notices.length) return null;
  return (
    <View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      testID="player-live-notice"
      style={{
        position: 'absolute',
        left: look.gutter,
        bottom: look.small ? 18 : look.size(30),
        maxWidth: '70%',
        flexDirection: 'row',
        alignItems: 'center',
        gap: look.size(8),
        paddingVertical: look.size(6),
        paddingHorizontal: look.size(12),
        borderRadius: look.radiusControl,
        backgroundColor: look.scrim,
      }}
    >
      <View style={{ width: look.size(8), height: look.size(8), borderRadius: look.size(4), backgroundColor: look.live }} />
      <Text numberOfLines={1} style={[look.text(13, 500, look.inkSecondary), { flexShrink: 1, fontVariant: ['tabular-nums'] }]}>
        {watch.notices[0]}
      </Text>
    </View>
  );
}

/** The dialled channel between its neighbours, while flicking. */
export function LiveDial({ channelId, small, still }: { channelId: string; small: boolean; still: boolean }) {
  if (!channelId) return null;
  return <MiniGuide playingId={channelId} small={small} still={still} />;
}
