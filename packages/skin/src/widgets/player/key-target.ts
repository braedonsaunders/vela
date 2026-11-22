// Which key presses belong to a focused control and which to the page's player shortcuts.
/** Whether a keydown's target is a control the viewer reached with the keyboard (focus-visible).
 * A control focused by a click is not: the browser keeps focus on a clicked button, but a Space
 * press there means the page's play and pause. */
export function keyboardControl(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; getAttribute?(name: string): string | null; matches?(selector: string): boolean } | null;
  if (!el) return false;
  const control = el.tagName === 'BUTTON' || el.getAttribute?.('role') === 'button';
  if (!control) return false;
  try { return el.matches?.(':focus-visible') ?? true; } catch { return true; }
}
