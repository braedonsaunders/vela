// Where TV focus goes when a live control leaves the chrome under it.

/** Back to live, once pressed, gives way to the LIVE mark (not a control) as the picture reaches the
 * edge: the focus it held must be handed on (to the play toggle), not left to the focus engine. A
 * Back to live that leaves for another reason (the viewer moved on, the window caught up by itself)
 * hands nothing on. */
export function backToLiveLeft(pressed: boolean, offered: boolean): boolean {
  return pressed && !offered;
}
