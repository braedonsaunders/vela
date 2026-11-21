import type { Env } from '@vela/skin';

// Row pagers report whether a row is scrolled to either end. They are kept per route, so a row
// reporting on one route (Home's rows as they lay out) does not change every other route's
// environment and redraw retained sections whole.

export const NO_PAGERS: Env['pagers'] = {};

/** The scope a route's row pagers are kept under. */
export function pagerScope(route: string, entry: string): string {
  return `${route}:${entry}`;
}

/** The pagers with one row's ends set; the same value when nothing changed. */
export function withPager(all: Record<string, Env['pagers']>, scope: string, rowId: string, state: { atStart: boolean; atEnd: boolean }): Record<string, Env['pagers']> {
  const pagers = all[scope];
  const held = pagers?.[rowId];
  if (held?.atStart === state.atStart && held.atEnd === state.atEnd) return all;
  return { ...all, [scope]: { ...pagers, [rowId]: state } };
}
