// What a Sports surface asks the app to do (the widget never navigates itself), and the live copy
// of an event: the latest the stream has pushed, else the one the screen or detail carried.
import { createContext, useContext } from 'react';
import type { LiveEvent, WatchTarget } from '@vela/core';
import { useVelaState } from '@vela/core/react';

export interface SportsActions {
  /** The game page for an event. */
  openEvent(event: LiveEvent): void;
  /** Watch where a target says: a Live TV channel tunes it. */
  watch(target: WatchTarget, event: LiveEvent): void;
  /** Present where the app plays programmes from a channel's archive: the target's programme from its
   * beginning (on air: Start over; ended: catch-up). */
  watchFromStart?(target: WatchTarget, kind: 'catchUp' | 'startOver', event: LiveEvent): void;
  /** Present when the multiview is available: add the target's channel as a tile. */
  addToMultiview?(target: WatchTarget, event: LiveEvent): void;
  /** Leave the game page (its close control and Back). */
  close?(): void;
  /** Where a link on the game page goes (opened outside the app). */
  openLink?(url: string): void;
}

export const SportsActionsContext = createContext<SportsActions | null>(null);

export function useSportsActions(): SportsActions | null {
  return useContext(SportsActionsContext);
}

/** The event as it is now. */
export function useLiveEvent<T extends LiveEvent | undefined>(event: T): T {
  const latest = useVelaState(state => (event ? state.liveEvents.events[event.id] : undefined));
  return (latest ?? event) as T;
}
