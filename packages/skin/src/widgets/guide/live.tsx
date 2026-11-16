// How React reaches Live TV: the app provides one LiveController and the player view that draws
// the tile's picture; widgets read the controller's view and open their surface while on screen.
import type { VelaPlayerViewProps } from '@vela/player-api';
import { createContext, useContext, useEffect, useSyncExternalStore, type ComponentType, type ReactNode } from 'react';
import { AccessibilityInfo, AppState, Platform } from 'react-native';
import type { LiveController, LiveView, Surface } from './controller';

interface LiveContextValue {
  controller: LiveController;
  /** Draws a session's picture; absent until the app has a player view, and then the tile stays off. */
  Player?: ComponentType<VelaPlayerViewProps>;
}

const LiveContext = createContext<LiveContextValue | null>(null);

/** Save-Data, where the platform reports it (the web's Network Information API). */
function saveData(): boolean {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

/** Wraps the app while a server with live TV is signed in. It follows foreground and reduced motion. */
export function LiveProvider({ controller, Player, children }: LiveContextValue & { children: ReactNode }) {
  useEffect(() => {
    controller.setCanPreview(Player !== undefined);
  }, [controller, Player]);

  useEffect(() => {
    controller.setVisible(AppState.currentState !== 'background');
    const sub = AppState.addEventListener('change', state => controller.setVisible(state !== 'background'));
    return () => sub.remove();
  }, [controller]);

  useEffect(() => {
    let still = false;
    const apply = () => controller.setQuiet(still || saveData());
    AccessibilityInfo.isReduceMotionEnabled().then(on => {
      still = on;
      apply();
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', on => {
      still = on;
      apply();
    });
    apply();
    return () => sub.remove();
  }, [controller]);

  return <LiveContext.Provider value={{ controller, Player }}>{children}</LiveContext.Provider>;
}

/** The app's live controller and player, or null where the server has no live TV. */
export function useLiveContext(): LiveContextValue | null {
  return useContext(LiveContext);
}

const IDLE: LiveView = {
  load: 'idle', guide: null, day: 0, clock: '', zapping: '', tunedId: '', watchZap: '',
  tile: { state: 'off', channelId: '', muted: true, plan: null, command: null },
};
const none = () => () => {};

/** The live view, re-rendering on every change; idle where there is no controller. */
export function useLiveView(): LiveView {
  const live = useContext(LiveContext);
  return useSyncExternalStore(live?.controller.subscribe ?? none, live?.controller.view ?? (() => IDLE), live?.controller.view ?? (() => IDLE));
}

/** Keeps a surface open while `active` (the screen holding it is focused). */
export function useLiveSurface(surface: Surface, active: boolean): void {
  const live = useContext(LiveContext);
  useEffect(() => {
    if (!live || !active) return;
    return live.controller.open(surface);
  }, [live, surface, active]);
}
