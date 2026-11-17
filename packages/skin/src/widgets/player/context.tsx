// What the player chrome reads from the watch route that hosts it: the session's plan and the
// view's latest snapshot, why a start failed, and the few things the chrome can ask for. The
// chrome never sees media credentials, URLs or the server: it sends view commands and asks the
// route to close or retry.
import type { ImageSource } from 'expo-image';
import { createContext, useContext } from 'react';
import type { Command, Failure, PlaybackPlan, Snapshot } from '@vela/player-api';

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
/** A view command before the route numbers it. */
export type CommandInput = WithoutId<Command>;

/** Why playback could not start: all streams in use (capacity), a refusal, or no server. */
export interface StartFailure {
  capacity: boolean;
  message: string;
}

export interface PlayerChromeState {
  /** The heading: the title, or "Season 1, Episode 2: Name". */
  title: string;
  plan: PlaybackPlan | null;
  snapshot: Snapshot | null;
  startFailure: StartFailure | null;
  /** A failure the view reported through onError. */
  failure: Failure | null;
  /** The last command the engine or the server refused, in words ("" when none). */
  actionError: string;
  /** Only the quality command currently awaiting acknowledgement. */
  pendingQualityId?: string;
  send(command: CommandInput): void;
  close(): void;
  retry(): void;
  /** A scrub thumbnail for a position (trickplay), once a session offers them. */
  thumbnail?(seconds: number): ImageSource | null;
}

export const PlayerChromeContext = createContext<PlayerChromeState | null>(null);

/** The chrome's state, or null outside a watch route (the widget then draws nothing). */
export function usePlayerChrome(): PlayerChromeState | null {
  return useContext(PlayerChromeContext);
}
