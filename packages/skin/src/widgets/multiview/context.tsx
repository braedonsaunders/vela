// How React reaches multiview: the app provides the signed-in server's controller (null where the
// server has no live TV), so "Add to multiview" works from the guide, a channel, the player or a game.
import { createContext, useContext, type ReactNode } from 'react';
import type { MultiviewController } from './controller';

interface MultiviewContextValue {
  controller: MultiviewController;
  /** Adds a channel and shows the multiview screen; `replace` takes the current screen's place (full
   * watch, whose session must end rather than play on underneath). */
  open(channelId?: string, options?: { replace?: boolean }): void;
}

const MultiviewContext = createContext<MultiviewContextValue | null>(null);

export function MultiviewProvider({ value, children }: { value: MultiviewContextValue | null; children: ReactNode }) {
  return <MultiviewContext.Provider value={value}>{children}</MultiviewContext.Provider>;
}

/** The multiview controller and its opener, or null where the server has no live TV. */
export function useMultiview(): MultiviewContextValue | null {
  return useContext(MultiviewContext);
}
