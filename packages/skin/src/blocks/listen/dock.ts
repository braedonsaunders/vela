// Where Now Playing lives today: the app's audio dock (apps/vela/src/media/audio.tsx) opens and
// closes it, owns the full-screen visualizer's history and focus, and decides whether a visualizer
// can open. A `nowPlaying` block drawn inside the dock takes those from here; drawn anywhere else
// (a document's own overlay), from its props and the document's state.
import { createContext, useContext } from 'react';
import type { VisualizerSwitch } from './visualizer';

export interface ListenDock {
  /** Close Now Playing. */
  close(): void;
  /** Open the full-screen visualizer; absent while none can open. */
  openVisualizer?(): void;
  /** The Sound tab's visualizer On/Off, while what plays could be visualized. */
  visualizer?: VisualizerSwitch;
  /** The full-screen visualizer covers Now Playing (it stays mounted, keeping its tab). */
  hidden: boolean;
  /** Now Playing has drawn (a TV: the dock gives it focus, as when it opened). */
  shown?(): void;
}

export const ListenDockContext = createContext<ListenDock | null>(null);

export function useListenDock(): ListenDock | null {
  return useContext(ListenDockContext);
}
