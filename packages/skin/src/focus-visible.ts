import { Platform } from 'react-native';

/** Pointer clicks keep DOM focus without borrowing the keyboard/remote focus treatment. */
export function isFocusVisible(target: unknown): boolean {
  if (Platform.OS !== 'web') return true;
  const element = target as { matches?(selector: string): boolean } | null;
  return element?.matches?.(':focus-visible') ?? true;
}
