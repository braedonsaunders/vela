/** Covered documents cannot consume Back or return focus over the visible screen. */
export function openScopeFlags(flags: string[], open: string[], active: boolean): string[] {
  return active ? flags.filter(flag => open.includes(flag)) : [];
}

/** Whether a button pressed on the web takes focus itself: only when focus is on the page's body.
 * Chromium focuses a link or button it clicks; Firefox and Safari on macOS do not, so the
 * keyboard's next PageDown or Space went to the body, which does not scroll. A press that finds
 * focus elsewhere (a field, its own button by keyboard) leaves it there. */
export function pressTakesFocus(active: unknown, body: unknown): boolean {
  return !active || active === body;
}

/** The drawn button to take focus from one that has left the page (`left`, and what it does):
 * one that does the same, when focus has fallen to the page's body. None when the button is drawn
 * again (a redraw binds it anew) or focus has gone somewhere else. */
export function successor<T>(left: { target: T; does: string }, buttons: ReadonlyMap<T, string>, active: unknown, body: unknown): T | undefined {
  if (buttons.has(left.target) || !pressTakesFocus(active, body)) return undefined;
  for (const [target, does] of buttons) if (does === left.does) return target;
  return undefined;
}
