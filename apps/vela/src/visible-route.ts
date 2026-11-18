import type { RouteName } from '@vela/skin';

/** Expo's usePathname substitutes decoded route parameters. A retained detail screen
 * under another detail or watch route must not participate in Android's focus search. */
export function documentIsVisible(route: RouteName, entry: string, pathname: string): boolean {
  if (route === 'title') return pathname === `/title/${entry}`;
  if (route === 'person') return pathname === '/person';
  return true;
}
