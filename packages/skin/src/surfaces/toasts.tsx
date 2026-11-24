// The toast stack (docs/plugin-screens.md: Surfaces, toast): alerts pushed on the live stream
// (`event: alert`) while the app is in the foreground, each drawn by the toast surface its plugin
// contributes (the frame names it), at the top right over any page and over the player. At most
// three stand, oldest first; a newer alert about the same event replaces the older one. A toast
// leaves after its ttl (8 to 30 s), held while the pointer is on it or focus is inside it, sooner
// when dismissed. Toasts take no focus by themselves. On TV they take none at all for now (a
// floating toast in the focus order traps Android TV's D-pad; deliberate entry is to come): the
// play/pause key takes the newest toast's Watch (over a channel with a multiview, its Add).
//
// One host draws at a time: an open player draws its own (above the picture and its chrome, which
// a native full-screen presentation would otherwise cover) and the app's steps aside.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, Platform, Text, View } from 'react-native';
import Animated, { FadeInRight, FadeOutRight, LinearTransition } from 'react-native-reanimated';
import type { AlertFrame, SurfaceContribution } from '../../../protocol/screen';
import { useScreenAlerts, useVela, useVelaState } from '@vela/core/react';
import { useHost } from '../host';
import { pressed, useRemote } from '../widgets/player/remote';
import type { PlayerLook } from '../widgets/player/look';
import { toastBox, toastContext, toastRemaining, toastSeconds, toastStack, toastSurface } from './model';
import { SurfaceView, useSurfaceApp } from './view';

// Which host draws

let players = 0;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** A player's toaster stands while it is mounted; the app's steps aside. */
function usePlayerToaster(): void {
  useEffect(() => {
    players++;
    emit();
    return () => { players--; emit(); };
  }, []);
}

function useAppToasterStands(): boolean {
  return useSyncExternalStore(subscribe, () => players === 0, () => players === 0);
}

let toastKey: (() => boolean) | null = null;

/** The standing toaster's action for the remote's play/pause key, while it has one to offer. */
function claimToastKey(handler: (() => boolean) | null): () => void {
  toastKey = handler;
  return () => { if (toastKey === handler) toastKey = null; };
}

/** A play/pause press: a standing toast's Watch takes it (answers true), else it is the player's. */
export function takeToastKey(): boolean {
  return toastKey?.() ?? false;
}

/** Followed only in the foreground: a backgrounded app keeps no stream open for alerts. */
function useForeground(): boolean {
  const [foreground, setForeground] = useState(AppState.currentState !== 'background');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setForeground(state !== 'background'));
    return () => subscription.remove();
  }, []);
  return foreground;
}

interface Placement {
  look: PlayerLook;
  /** Distance from the top of the area the toasts are drawn in. */
  top: number;
  /** Distance from the right edge (the look's gutter by default). */
  right?: number;
  /** The channel playing under the toasts (its games need no Watch; over it, Add to multiview). */
  playingChannelId?: string;
}

/** The toasts over the player: they stand in for the app's while it is open. */
export function PlayerToasts(props: Placement) {
  usePlayerToaster();
  const foreground = useForeground();
  return foreground ? <Stack {...props} inPlayer /> : null;
}

/** The app's toasts, over every screen except an open player. The remote's play/pause key reaches
 * their Watch; nothing else listens to it outside the player. */
export function AppToasts(props: Placement) {
  const stands = useAppToasterStands();
  const foreground = useForeground();
  useRemote(event => {
    if (stands && event.eventType === 'playPause' && pressed(event)) takeToastKey();
  });
  return stands && foreground ? <Stack {...props} /> : null;
}

const NO_SURFACES: SurfaceContribution[] = [];
/** Room around a toast's box for its shadow. */
const SHADE = 24;
const primaryChannel = (value: unknown): string => {
  const watch = (value as { watch?: { primary?: { channelId?: unknown } } } | undefined)?.watch;
  return typeof watch?.primary?.channelId === 'string' ? watch.primary.channelId : '';
};

function Stack({ look, top, right, playingChannelId, inPlayer = false }: Placement & { inPlayer?: boolean }) {
  const vela = useVela();
  const host = useHost();
  const app = useSurfaceApp();
  const alerts = useScreenAlerts();
  const surfaces = useVelaState(state => state.home.value?.surfaces ?? NO_SURFACES);
  const { shown, superseded } = useMemo(() => toastStack(alerts), [alerts]);
  useEffect(() => { for (const alert of superseded) vela.screens.dismissAlert(alert.id); }, [vela, superseded]);

  // The remote's play/pause key: the newest toast whose game a channel carries (not the one playing).
  const keyed = [...shown].reverse().find(alert => {
    const channel = alert.ref ? primaryChannel(vela.screens.records.get(alert.ref)?.value) : '';
    return !!channel && channel !== playingChannelId;
  });
  const latest = useRef({ keyed, app, playingChannelId, inPlayer });
  latest.current = { keyed, app, playingChannelId, inPlayer };
  useEffect(() => {
    if (!keyed) return;
    const release = claimToastKey(() => {
      const { keyed: alert, app: actions, playingChannelId: playing, inPlayer: over } = latest.current;
      const channel = alert?.ref ? primaryChannel(vela.screens.records.get(alert.ref)?.value) : '';
      if (!alert || !channel || !actions) return false;
      vela.screens.dismissAlert(alert.id);
      if (over && playing && actions.actions.multiview) actions.actions.multiview(channel);
      else actions.actions.watch?.({ event: alert.ref ?? '', channel });
      return true;
    });
    // A player holding the system's media controls hears the button there: it comes back here.
    const native = app?.claimPlayPause?.(() => { takeToastKey(); });
    return () => { native?.(); release(); };
  }, [keyed?.id, app, vela]);

  if (!shown.length) return null;
  const box = toastBox(look.size, look.small, host.viewport.width, look.gutter);
  return (
    <View pointerEvents="box-none" testID="live-alerts" style={{ position: 'absolute', top, right: right ?? look.gutter, width: box.width, gap: look.size(10) }}>
      {shown.map(alert => (
        <Animated.View key={alert.id}
          entering={look.still ? undefined : FadeInRight.duration(420)}
          exiting={look.still ? undefined : FadeOutRight.duration(240)}
          layout={look.still ? undefined : LinearTransition.duration(320)}>
          <Toast alert={alert} surface={toastSurface(alert, surfaces)} look={look} maxHeight={box.maxHeight} playingChannelId={playingChannelId}
            onDismiss={() => vela.screens.dismissAlert(alert.id)} />
        </Animated.View>
      ))}
    </View>
  );
}

function Toast({ alert, surface, look, maxHeight, playingChannelId, onDismiss }: {
  alert: AlertFrame; surface: SurfaceContribution | undefined; look: PlayerLook; maxHeight: number; playingChannelId?: string; onDismiss(): void;
}) {
  const host = useHost();
  const [pointer, setPointer] = useState(false);
  const [focus, setFocus] = useState(false);
  const held = pointer || focus;
  // Its time runs while nobody is on it, and resumes where it stopped.
  const total = toastSeconds(surface?.ttl) * 1000;
  const left = useRef(total);
  useEffect(() => {
    if (held) return;
    const started = Date.now();
    const timer = setTimeout(onDismiss, left.current);
    return () => { clearTimeout(timer); left.current = toastRemaining(left.current, Date.now() - started); };
  }, [held]);
  const context = useMemo(() => toastContext(alert, playingChannelId), [alert, playingChannelId]);
  return (
    <View
      accessibilityLiveRegion="polite"
      onPointerEnter={() => setPointer(true)}
      onPointerLeave={() => setPointer(false)}
      // Focus inside the toast (its Watch, its Dismiss) holds it.
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      // Clipped to its box, with room beside it for its shadow.
      style={{ margin: -SHADE, padding: SHADE, maxHeight: maxHeight + SHADE * 2, overflow: 'hidden' }}
    >
      {surface ? <SurfaceView surface={surface} context={context} host={host} overPicture dismiss={onDismiss} unfocusable={Platform.isTV} /> : <Plain alert={alert} look={look} />}
    </View>
  );
}

/** An alert whose plugin contributes no toast: its title and body. */
function Plain({ alert, look }: { alert: AlertFrame; look: PlayerLook }) {
  return (
    <View testID="live-alert" accessibilityRole="alert" style={{ borderRadius: Math.min(look.radiusPanel, look.size(16)), backgroundColor: look.popover,
      borderWidth: 1, borderColor: look.glassEdge, paddingVertical: look.size(12), paddingHorizontal: look.size(14), gap: look.size(4) }}>
      <Text numberOfLines={1} style={look.text(13, 800, look.ink)}>{alert.title}</Text>
      {alert.body ? <Text numberOfLines={2} style={look.text(14, 500, look.inkSecondary)}>{alert.body}</Text> : null}
    </View>
  );
}
