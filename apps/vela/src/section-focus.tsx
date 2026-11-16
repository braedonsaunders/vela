import { createContext, useContext } from 'react';

export const SectionFocusContext = createContext<boolean | null>(null);

export function useSectionFocus(): boolean | null {
  return useContext(SectionFocusContext);
}
