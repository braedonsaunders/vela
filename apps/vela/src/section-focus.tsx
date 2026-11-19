import { createContext, useContext } from 'react';

export const SectionFocusContext = createContext<boolean | null>(null);

export function useSectionFocus(): boolean | null {
  return useContext(SectionFocusContext);
}

// The active retained page supplies its existing model/actions to compact shell tabs.
export const SectionShellHostContext = createContext<((host: import('@vela/skin').SkinHost, active: boolean) => void) | null>(null);
