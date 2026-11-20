import type { SkinHost } from '@vela/skin';

/** Covered routes keep their committed content until visible again. A server/viewer
 * or document change must still replace it, even while the route is covered. */
export function retainedHost(previous: SkinHost | null, next: SkinHost | null, active: boolean): SkinHost | null {
  return active || previous?.doc !== next?.doc || previous?.env.viewer !== next?.env.viewer ? next : previous;
}
