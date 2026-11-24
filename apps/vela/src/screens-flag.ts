// Development only, for parity work on the integration branch (docs/plugin-screens.md: Phase 1):
// plugin screens draw from their documents when EXPO_PUBLIC_VELA_SCREENS=1, or on the web after
// `?screens=1` (remembered for the tab, `?screens=0` forgets it). Removed before merge (hard cut).
import { Platform } from 'react-native';

const KEY = 'vela.screens';

function fromAddress(): boolean | undefined {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
  const value = new URLSearchParams(window.location.search).get('screens');
  try {
    if (value === '1') window.sessionStorage.setItem(KEY, '1');
    if (value === '0') window.sessionStorage.removeItem(KEY);
    return window.sessionStorage.getItem(KEY) === '1';
  } catch {
    return value === '1';
  }
}

/** Whether plugin screens draw from documents. */
export function screenDocuments(): boolean {
  return process.env.EXPO_PUBLIC_VELA_SCREENS === '1' || fromAddress() === true;
}
