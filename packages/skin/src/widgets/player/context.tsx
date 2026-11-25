// What the player chrome reads from the watch route that hosts it: the session's plan and the
// view's latest snapshot, why a start failed, and the few things the chrome can ask for. The
// chrome never sees media credentials, URLs or the server: it sends view commands and asks the
// route to close or retry.
import type { StreamingSettings, TrickplayFrame } from '@vela/core';
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

/** A refused start the server allows retrying, while the next attempt is awaited. */
export interface StartRetrying {
  /** Seconds the client waits before asking again. */
  seconds: number;
  /** Why the last attempt was refused, in the server's words ("" when it gave none). */
  message: string;
}

/** What the route asked to play: a channel or a live library plays live before (or without) a plan. */
export interface ChromeTarget {
  kind: 'title' | 'extra' | 'channel' | 'library-live' | 'programme';
  id: string;
  /** A programme's channel (catch-up and Start over), and whether it plays from the start of one on air. */
  channelId?: string;
  from?: 'start';
}

export interface PlayerChromeState {
  /** The heading: the title, or "Season 1, Episode 2: Name". */
  title: string;
  /** What the route asked to play (absent for a host that only has a plan). */
  target?: ChromeTarget;
  plan: PlaybackPlan | null;
  snapshot: Snapshot | null;
  startFailure: StartFailure | null;
  /** A refused start being asked again on the server's terms (never an endless wait). */
  retrying?: StartRetrying | null;
  /** A failure the view reported through onError. */
  failure: Failure | null;
  /** The last command the engine or the server refused, in words ("" when none). */
  actionError: string;
  /** Only the quality command currently awaiting acknowledgement. */
  pendingQualityId?: string;
  pendingVersionId?: string;
  versionMessage: string;
  send(command: CommandInput): void;
  switchVersion(versionId: string): void;
  /** The quality menu opened: re-read the session's versions (the plan prop shows the result). */
  refreshVersions?(): void;
  close(): void;
  retry(): void;
  /** The scrub thumbnail (trickplay) for a position, once a session offers them and its sheet is here. */
  thumbnail?(seconds: number): TrickplayFrame | null;
  /** This device's streaming cap on each network and whether the network is metered now; a change
   * applies from the next start. */
  streaming?: { settings: StreamingSettings; metered: boolean; set(next: Partial<StreamingSettings>): void };
}

export const PlayerChromeContext = createContext<PlayerChromeState | null>(null);

/** The chrome's state, or null outside a watch route (the widget then draws nothing). */
export function usePlayerChrome(): PlayerChromeState | null {
  return useContext(PlayerChromeContext);
}
