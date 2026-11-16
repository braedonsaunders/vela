// Product areas (search, live TV, sign-in…) extend the vocabulary from their own directories
// under widgets/. Each area exports one Area and is listed here with one line. An area also
// augments the Env and Ctx interfaces in its own file:
//   declare module '../../vocabulary' { interface Env { search?: SearchView } interface Ctx { hit?: Hit } }
import type { Accessor, Ctx, Env } from './vocabulary';

export interface Area {
  /** Binding keys the area adds, by name (`search.titleCount`). */
  vocabulary?: Record<string, Accessor>;
  /** The items of a collection the area owns (`search.titles`), or undefined for any other. */
  collection?(over: string, c: Ctx, e: Env, limit: number): Ctx[] | undefined;
}

export const AREAS: Area[] = [
];
