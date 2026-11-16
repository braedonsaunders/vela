// Live watch, for the player chrome: the live panel (the LIVE badge, channel up and down, honest
// delivery states and "Go live" when playback has fallen behind the edge) and the keys that flick
// channels. Latency is automatic; there is no viewer-facing latency toggle.
import { View } from 'react-native';
import { msg, number } from '@vela/core';
import type { Snapshot } from '@vela/player-api';
import type { LiveController } from './controller';
import { useLiveSurface } from './live';
import { useGuideLook, type GuideLook } from './look';
import { Glyph, Line, LiveBadge, Press } from './parts';

type LiveSnapshot = NonNullable<Snapshot['live']>;

interface ControlsProps {
  /** The player's live snapshot for the watched session (null until it reports one). */
  live: LiveSnapshot | null;
  /** Send the player its catchUp command. */
  onGoLive(): void;
  /** Flick to the previous (-1) or next (1) channel. */
  onZap(step: -1 | 1): void;
}

/** Whether the live panel must show while the rest of the chrome is hidden: a state the viewer should see. */
export function liveNeedsAttention(live: LiveSnapshot | null): boolean {
  if (!live) return false;
  return live.reconnecting || live.delivery === 'upstream-gap' || live.delivery === 'segment-delayed'
    || live.delivery === 'waiting-for-publication' || behind(live) > 0;
}

/** Whole seconds behind the live edge, when playback can catch up. */
function behind(live: LiveSnapshot): number {
  if (!live.canCatchUp || live.driftSeconds === null) return 0;
  return Math.max(0, Math.round(live.driftSeconds));
}

const DELIVERY: Partial<Record<LiveSnapshot['delivery'], string>> = {
  'upstream-gap': 'live.gap',
  'segment-delayed': 'live.delayed',
  'waiting-for-publication': 'live.publication',
};

export function LiveControls({ live, onGoLive, onZap }: ControlsProps) {
  const look = useGuideLook();
  const drift = live ? behind(live) : 0;
  const delivery = live ? DELIVERY[live.delivery] : undefined;
  return (
    <View style={{
      gap: 10, paddingVertical: 14, paddingHorizontal: 16, minWidth: 240, borderRadius: 18, borderWidth: 1,
      borderColor: look.edge, backgroundColor: look.glass, boxShadow: `0px 24px 70px ${look.shadow}`,
    }}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
        <LiveBadge look={look} />
        <View style={{ flex: 1 }} />
        <ZapButton look={look} label={msg('live.channelUp')} rotate="90deg" onPress={() => onZap(-1)} />
        <ZapButton look={look} label={msg('live.channelDown')} rotate="-90deg" onPress={() => onZap(1)} />
      </View>
      {live?.reconnecting ? <Status look={look} text={msg('live.reconnecting')} /> : null}
      {delivery ? <Status look={look} text={msg(delivery)} /> : null}
      {drift > 0 ? (
        <>
          <Status look={look} text={msg('live.behind', { seconds: number(drift) })} />
          <Press
            label={msg('live.catchUp')}
            onPress={onGoLive}
            style={({ hovered, focused, pressed }) => ({
              alignSelf: 'flex-start', height: 34, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 999,
              borderWidth: 1, borderColor: look.edge, backgroundColor: hovered ? look.controlHover : look.control,
              transform: [{ scale: pressed ? 0.97 : 1 }],
              boxShadow: focused ? `0px 0px 0px 2px ${look.accent}` : undefined,
            })}
          >
            <Line look={look} size={13} weight={600}>{msg('live.catchUp')}</Line>
          </Press>
        </>
      ) : null}
    </View>
  );
}

function Status({ look, text }: { look: GuideLook; text: string }) {
  return (
    <View accessibilityLiveRegion="polite">
      <Line look={look} size={13} color={look.inkSecondary} lines={2} tabular>{text}</Line>
    </View>
  );
}

function ZapButton({ look, label, rotate, onPress }: { look: GuideLook; label: string; rotate: string; onPress(): void }) {
  return (
    <Press
      label={label}
      onPress={onPress}
      style={({ hovered, focused, pressed }) => ({
        width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 999, borderWidth: 1,
        borderColor: look.edge, backgroundColor: hovered ? look.controlHover : look.control,
        transform: [{ scale: pressed ? 0.94 : 1 }],
        boxShadow: focused ? `0px 0px 0px 2px ${look.accent}` : undefined,
      })}
    >
      <View style={{ transform: [{ rotate }] }}><Glyph name="back" size={13} color={look.ink} /></View>
    </Press>
  );
}

const ZAP_KEYS: Record<string, -1 | 1> = {
  ArrowUp: -1, PageUp: -1, ChannelUp: -1,
  ArrowDown: 1, PageDown: 1, ChannelDown: 1,
};

/**
 * Live watch's keys: up and down (and the remote's channel keys) dial a channel, Enter tunes the
 * dialled one at once and Escape forgets it. Returns whether the key was taken. The watch screen
 * holds its surface open with useLiveWatch while it is focused.
 */
export function liveWatchKey(controller: LiveController, key: string, playingId: string, dialling: boolean): boolean {
  const step = ZAP_KEYS[key];
  if (step !== undefined) {
    controller.zapWatch(step, playingId);
    return true;
  }
  if (dialling && key === 'Enter') {
    controller.commitWatchZap();
    return true;
  }
  if (dialling && key === 'Escape') {
    controller.cancelWatchZap();
    return true;
  }
  return false;
}

/** Keeps live watch's surface open (clock, listings, flicking) while the watch screen is focused. */
export function useLiveWatch(focused: boolean): void {
  useLiveSurface('watch', focused);
}
