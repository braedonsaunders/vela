// How React reaches Live TV: the app provides one LiveController and the player view that draws
// the tile's picture; widgets read the controller's view and open their surface while on screen.
import type { VelaPlayerViewProps } from '@vela/player-api';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from 'react';
import { AccessibilityInfo, AppState, Platform } from 'react-native';
import type { LiveController, LiveView, Surface } from './controller';
import type { GuideRowDrawingProps } from './drawing';

interface LiveContextValue {
  controller: LiveController;
  /** Draws a session's picture; absent until the app has a player view, and then the tile stays off. */
  Player?: ComponentType<VelaPlayerViewProps>;
  GuideRow?: ComponentType<GuideRowDrawingProps>;
}

const LiveContext = createContext<LiveContextValue | null>(null);

/** Save-Data, where the platform reports it (the web's Network Information API). */
function saveData(): boolean {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

interface ProviderProps {
  /** The signed-in server's controller; null while signed out or where the server has no live TV. */
  controller: LiveController | null;
  Player?: ComponentType<VelaPlayerViewProps>;
  GuideRow?: ComponentType<GuideRowDrawingProps>;
  children: ReactNode;
}

/** Wraps the app (always, so the tree never remounts when a controller arrives). It follows the
 * foreground, reduced motion and Save-Data for the controller it is given. */
export function LiveProvider({ controller, Player, GuideRow, children }: ProviderProps) {
  useEffect(() => {
    controller?.setCanPreview(Player !== undefined);
  }, [controller, Player]);

  useEffect(() => {
    if (!controller) return;
    controller.setVisible(AppState.currentState !== 'background');
    const sub = AppState.addEventListener('change', state => controller.setVisible(state !== 'background'));
    return () => sub.remove();
  }, [controller]);

  useEffect(() => {
    if (!controller) return;
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

  const value = useMemo(() => (controller ? { controller, Player, GuideRow } : null), [controller, Player, GuideRow]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

/** The app's live controller and player, or null where the server has no live TV. */
export function useLiveContext(): LiveContextValue | null {
  return useContext(LiveContext);
}

const IDLE: LiveView = {
  load: 'idle',
  guide: null,
  day: 0,
  clock: '',
  zapping: '',
  tunedId: '',
  watchZap: '',
  tile: { state: 'off', channelId: '', muted: true, fullscreen: false, plan: null, command: null },
};
const none = () => () => {};

/** The live view, re-rendering on every change; idle where there is no controller. */
export function useLiveView(): LiveView {
  const live = useContext(LiveContext);
  return useSyncExternalStore(
    live?.controller.subscribe ?? none,
    live?.controller.view ?? (() => IDLE),
    live?.controller.view ?? (() => IDLE),
  );
}

/** Guide cache/clock changes cannot cause native player prop commits. */
export function useLiveTile(): LiveView['tile'] {
  const live = useContext(LiveContext);
  const read = useMemo(() => {
    let previous = IDLE.tile;
    return () => {
      const next = live?.controller.view().tile ?? IDLE.tile;
      if (next.state !== previous.state || next.channelId !== previous.channelId || next.muted !== previous.muted
        || next.fullscreen !== previous.fullscreen || next.plan !== previous.plan || next.command !== previous.command) previous = next;
      return previous;
    };
  }, [live?.controller]);
  return useSyncExternalStore(live?.controller.subscribe ?? none, read, read);
}

/** Keeps a surface open while `active` (the screen holding it is focused). */
export function useLiveSurface(surface: Surface, active: boolean): void {
  const controller = useContext(LiveContext)?.controller;
  useEffect(() => {
    if (!controller || !active) return;
    return controller.open(surface);
  }, [controller, surface, active]);
}
