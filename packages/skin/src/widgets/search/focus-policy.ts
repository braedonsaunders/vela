/** A skin can request focus through both its action and press.focus on the next frame.
 * Only a later deliberate request should reopen an already focused Android field's IME. */
export function shouldRefocusSearch(focused: boolean, previous: number, now: number): boolean {
  return focused && now - previous >= 500;
}
