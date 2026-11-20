/** Covered documents cannot consume Back or return focus over the visible screen. */
export function openScopeFlags(flags: string[], open: string[], active: boolean): string[] {
  return active ? flags.filter(flag => open.includes(flag)) : [];
}
