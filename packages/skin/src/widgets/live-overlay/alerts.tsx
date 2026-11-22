// Favourite-team alerts as toasts: a game starting, a close finish, a final, pushed on the live
// stream (`event: alert`) while the app is open. They slide in at the top right, stand two at a
// time (oldest first, the rest wait), and leave on their own after a while, sooner if dismissed;
// a hairline shows the time left and holds while the viewer is on the toast. A toast offers
// Watch when a channel carries the game (one that is not already playing): a press opens it, and
// on a TV remote so does play/pause while the toast stands. Toasts never take focus themselves;
// the remote's focus can move onto Watch like onto any other control.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, Text, View, type ViewStyle } from 'react-native';
import Animated, { FadeInRight, FadeOutRight, LinearTransition } from 'react-native-reanimated';
import { msg, type LiveAlert, type LiveEvent } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import { FocusPressable as Pressable } from '../../focus';
import { isFocusVisible } from '../../focus-visible';
import { useHost } from '../../host';
import { PlayerIcon, type PlayerIconName } from '../player/icons';
import { pressed, useRemote } from '../player/remote';
import type { PlayerLook } from '../player/look';
import { claimAlertKey, takeAlertKey, useAppToasterStands, useLiveOverlayActions, usePlayerToaster } from './context';
import { alertWatch, toastQueue, TOAST_MS, TV_TOAST_MS, watchLabel, type AlertWatch } from './model';

/** A television is read from across the room and answered with a remote: its toasts stand longer. */
const STAND_MS = Platform.isTV ? TV_TOAST_MS : TOAST_MS;

/** The app follows the viewer's alerts while it is in the foreground (one shared live stream). */
export function useAlertFollow(enabled = true): void {
  const vela = useVela();
  const [foreground, setForeground] = useState(AppState.currentState !== 'background');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setForeground(state !== 'background'));
    return () => subscription.remove();
  }, []);
  const on = enabled && foreground;
  useEffect(() => (on ? vela.liveEvents.follow({ alerts: true }) : undefined), [vela, on]);
}

interface Placement {
  look: PlayerLook;
  /** Distance from the top of the area the toasts are drawn in. */
  top: number;
  /** Distance from the right edge (the look's gutter by default). */
  right?: number;
  /** The channel playing under the toasts, whose games need no Watch. */
  playingChannelId?: string;
}

/** The toasts over the player: they stand in for the app's while it is open. Over a channel, a
 * toast also offers to add its game to the multiview (when the app has one), and the remote's
 * play/pause key does that rather than leave what is playing. */
export function PlayerAlertToasts(props: Placement) {
  usePlayerToaster();
  return <Toasts {...props} inPlayer />;
}

/** The app's toasts, over every screen except an open player (which draws its own). The remote's
 * play/pause key reaches their Watch; nothing else listens to it outside the player. */
export function AppAlertToasts(props: Placement) {
  const stands = useAppToasterStands();
  useRemote(event => {
    if (stands && event.eventType === 'playPause' && pressed(event)) takeAlertKey();
  });
  return stands ? <Toasts {...props} /> : null;
}

/** What one toast can do: where Watch goes, with the event it is about. */
interface ToastActions extends AlertWatch {
  event?: LiveEvent;
  /** Add the game to the multiview beside what is playing. */
  multiview: boolean;
}

function Toasts({ look, top, right, playingChannelId, inPlayer = false }: Placement & { inPlayer?: boolean }) {
  const vela = useVela();
  const { viewport } = useHost();
  const actions = useLiveOverlayActions();
  const alerts = useVelaState(state => state.liveEvents.alerts);
  const { shown, superseded } = useMemo(() => toastQueue(alerts), [alerts]);
  useEffect(() => {
    for (const alert of superseded) vela.liveEvents.dismissAlert(alert.id);
  }, [vela, superseded]);
  const events = useVelaState(state => state.liveEvents.events);
  const details = useVelaState(state => state.liveEvents.details);
  const offers = useMemo(() => new Map<string, ToastActions>(shown.map(alert => {
    const detail = details[alert.eventId]?.value;
    const event = detail ?? events[alert.eventId];
    const where = actions.watch && event ? alertWatch(detail?.watch ?? events[alert.eventId]?.watch, playingChannelId) : { onNow: false };
    return [alert.id, { ...where, ...(event ? { event } : {}), multiview: inPlayer && !!playingChannelId && !!actions.addToMultiview && !!where.target }];
  })), [shown, events, details, playingChannelId, actions, inPlayer]);
  // Where to watch is resolved per viewer with the event's detail: read once for an alert whose
  // event came without it.
  const asked = useRef(new Set<string>());
  useEffect(() => {
    for (const alert of shown) {
      const id = alert.eventId;
      if (asked.current.has(id) || details[id] || events[id]?.watch) continue;
      asked.current.add(id);
      void vela.liveEvents.loadDetail(id);
    }
  }, [vela, shown, details, events]);

  const act = (alert: LiveAlert, kind: 'watch' | 'multiview') => {
    const offer = offers.get(alert.id);
    if (!offer?.target || !offer.event) return;
    vela.liveEvents.dismissAlert(alert.id);
    if (kind === 'multiview') actions.addToMultiview?.(offer.target, offer.event);
    else actions.watch?.(offer.target, offer.event);
  };
  // The remote's play/pause key takes the newest toast's action while one offers it: over a
  // channel, into the multiview when there is one; anywhere else, Watch.
  const keyed = [...shown].reverse().find(alert => offers.get(alert.id)?.target);
  const keyedKind: 'watch' | 'multiview' = keyed && offers.get(keyed.id)?.multiview ? 'multiview' : 'watch';
  const latest = useRef({ keyed, keyedKind, act });
  latest.current = { keyed, keyedKind, act };
  useEffect(() => {
    if (!keyed) return;
    const release = claimAlertKey(() => {
      const { keyed: alert, keyedKind: kind, act: run } = latest.current;
      if (!alert) return false;
      run(alert, kind);
      return true;
    });
    // A player holding the system's media controls hears the button there: it comes back here.
    const native = actions.claimPlayPause?.(() => { takeAlertKey(); });
    return () => { native?.(); release(); };
  }, [keyed?.id, keyedKind, actions]);

  if (!shown.length) return null;
  const width = look.small ? viewport.width - look.gutter * 2 : look.size(360);
  return (
    <View pointerEvents="box-none" testID="live-alerts" style={{ position: 'absolute', top, right: right ?? look.gutter, width, gap: look.size(10) }}>
      {shown.map(alert => (
        <Animated.View key={alert.id}
          entering={look.still ? undefined : FadeInRight.duration(420)}
          exiting={look.still ? undefined : FadeOutRight.duration(240)}
          layout={look.still ? undefined : LinearTransition.duration(320)}>
          <Toast alert={alert} look={look} offer={offers.get(alert.id) ?? { onNow: false, multiview: false }}
            keyed={alert === keyed ? keyedKind : null}
            onAct={kind => act(alert, kind)} onDismiss={() => vela.liveEvents.dismissAlert(alert.id)} />
        </Animated.View>
      ))}
    </View>
  );
}

function kindColour(alert: LiveAlert, look: PlayerLook): string {
  return alert.kind === 'started' ? look.live : alert.kind === 'close' ? '#f5c451' : look.inkSecondary;
}

function Toast({ alert, look, offer, keyed, onAct, onDismiss }: {
  alert: LiveAlert; look: PlayerLook; offer: ToastActions;
  /** The remote's play/pause key does this toast's action. */
  keyed: 'watch' | 'multiview' | null;
  onAct(kind: 'watch' | 'multiview'): void; onDismiss(): void;
}) {
  const [held, setHeld] = useState(false);
  // The toast's time: it runs while nobody is on it and resumes where it stopped.
  const left = useRef(STAND_MS);
  useEffect(() => {
    if (held) return;
    const started = Date.now();
    const timer = setTimeout(onDismiss, left.current);
    return () => { clearTimeout(timer); left.current = Math.max(1200, left.current - (Date.now() - started)); };
  }, [held]);
  const colour = kindColour(alert, look);
  const tv = Platform.isTV;
  const target = offer.target;
  const radius = Math.min(look.radiusPanel, look.size(16));
  return (
    <View
      testID="live-alert"
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      // A pointer over the toast holds it; so does focus on its buttons.
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      style={{
        borderRadius: radius, backgroundColor: '#0b0f1a',
        shadowColor: '#000', shadowOpacity: 0.55, shadowRadius: look.size(22), shadowOffset: { width: 0, height: look.size(8) },
      }}
    >
      {/* Clipped inside, so the shadow outside stays drawn. */}
      <View style={{ borderRadius: radius, overflow: 'hidden', backgroundColor: '#0b0f1af0', borderWidth: 1, borderColor: '#ffffff1f' }}>
      <View style={{ flexDirection: 'row' }}>
        <View style={{ width: look.size(4), backgroundColor: colour }} />
        <View style={{ flex: 1, paddingVertical: look.size(12), paddingLeft: look.size(14), paddingRight: look.size(12), gap: look.size(4) }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: look.size(8) }}>
            <Text numberOfLines={1} style={[look.text(13, 800, colour), { flex: 1, letterSpacing: look.size(0.4) }]}>{alert.title}</Text>
            {!tv ? (
              <Pressable accessibilityRole="button" accessibilityLabel={msg('liveOverlay.dismiss')} onPress={onDismiss} testID="live-alert-dismiss"
                hitSlop={8} style={{ width: look.size(22), height: look.size(22), alignItems: 'center', justifyContent: 'center', borderRadius: look.size(11) }}>
                <Text style={look.text(14, 600, look.inkQuiet)}>✕</Text>
              </Pressable>
            ) : null}
          </View>
          {alert.body ? <Text numberOfLines={2} style={[look.text(14, 500, look.ink), { fontVariant: ['tabular-nums'] }]}>{alert.body}</Text> : null}
          {target ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: look.size(8), marginTop: look.size(6) }}>
              <ToastButton look={look} primary icon="play" label={`${msg('liveOverlay.watch')} · ${watchLabel(target)}`}
                accessibilityLabel={msg('liveOverlay.watchOn', { channel: watchLabel(target) })} testID="live-alert-watch"
                onPress={() => onAct('watch')} onFocus={setHeld} />
              {offer.multiview ? (
                <ToastButton look={look} icon="tiles" label={msg('liveOverlay.multiview')} accessibilityLabel={msg('liveOverlay.addToMultiview')}
                  testID="live-alert-multiview" onPress={() => onAct('multiview')} onFocus={setHeld} />
              ) : null}
            </View>
          ) : offer.onNow ? (
            <Text style={[look.text(12, 600, look.inkSecondary), { marginTop: look.size(2) }]}>{msg('liveOverlay.onNow')}</Text>
          ) : null}
          {target && tv && keyed ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: look.size(5), marginTop: look.size(2) }}>
              <Text style={look.text(11, 500, look.inkQuiet)}>{msg('liveOverlay.press')}</Text>
              <PlayerIcon name="play" size={look.size(11)} color={look.inkSecondary} />
              <PlayerIcon name="pause" size={look.size(11)} color={look.inkSecondary} />
              <Text style={look.text(11, 500, look.inkQuiet)}>{msg(keyed === 'multiview' ? 'liveOverlay.toAddToMultiview' : 'liveOverlay.toWatch')}</Text>
            </View>
          ) : null}
        </View>
      </View>
      <Countdown look={look} colour={colour} held={held} />
      </View>
    </View>
  );
}

/** The hairline along the toast's foot: the time it has left, holding while the toast is held. */
function Countdown({ look, colour, held }: { look: PlayerLook; colour: string; held: boolean }) {
  if (look.still) return null;
  return (
    <View style={{ height: look.size(2), backgroundColor: '#ffffff10' }}>
      <Animated.View style={{
        height: '100%', width: '100%', backgroundColor: colour, opacity: 0.7, transformOrigin: 'left',
        animationName: { from: { transform: [{ scaleX: 1 }] }, to: { transform: [{ scaleX: 0 }] } },
        animationDuration: STAND_MS, animationTimingFunction: 'linear', animationFillMode: 'both',
        animationPlayState: held ? 'paused' : 'running',
      } as ViewStyle} />
    </View>
  );
}

function ToastButton({ look, icon, label, accessibilityLabel, primary, testID, onPress, onFocus }: {
  look: PlayerLook; icon: PlayerIconName; label: string; accessibilityLabel: string; primary?: boolean; testID: string; onPress(): void; onFocus(focused: boolean): void;
}) {
  const [focus, setFocus] = useState(false);
  const [hover, setHover] = useState(false);
  const tv = Platform.isTV;
  const lit = focus || hover;
  const ink = lit ? look.inkInverse : primary ? look.onAccent : look.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      onFocus={event => { setFocus(isFocusVisible(event.currentTarget)); onFocus(true); }}
      onBlur={() => { setFocus(false); onFocus(false); }}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: look.size(7),
        paddingVertical: look.size(7), paddingHorizontal: look.size(13),
        borderRadius: Math.min(look.radiusControl, look.size(18)),
        backgroundColor: lit ? look.ink : primary ? look.accent : look.control,
        outlineColor: look.accent, outlineStyle: 'solid', outlineWidth: focus ? (tv ? look.size(3) : 2) : 0, outlineOffset: look.size(2),
        transform: [{ scale: focus && tv && !look.still ? 1.08 : 1 }],
      } as ViewStyle}
    >
      <PlayerIcon name={icon} size={look.size(13)} color={ink} />
      <Text numberOfLines={1} style={look.text(13, 700, ink)}>{label}</Text>
    </Pressable>
  );
}
