// Values an environment rebuilds on every read, kept while they say the same (env.ts): a tracked
// node draws again when a value it read is a different one, so a list built afresh with the same
// entries redrew the shell's navigation for every flag and every turn of the hero.
import type { Env } from '@vela/skin/src/vocabulary';

type Destinations = Env['libraries'];

/** The same destinations in the same order (withScreens builds a plugin screen's entry afresh). */
export function sameDestinations(a: Destinations | undefined, b: Destinations | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((item, i) => item === b[i] || sameFields(item, b[i]));
}

/** Two flat records with the same fields, each the same value. */
export function sameFields<T extends object>(a: T | undefined, b: T | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => (a as Record<string, unknown>)[key] === (b as Record<string, unknown>)[key]);
}
