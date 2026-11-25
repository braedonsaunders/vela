/** Presses that remain useful to a pointer but must never slow keyboard, D-pad or remote travel. */
export function takesDirectionalFocus(action: string | undefined, arg: string | undefined): boolean {
  if (action === 'pickHero' || action === 'pagePrev' || action === 'pageNext') return false;
  if (action === 'toggle' && arg === 'hero-paused') return false;
  return true;
}

/** A row heading is pointer-only; the end card is the row's one See all focus destination. */
export function rowLinkTakesDirectionalFocus(end: boolean): boolean {
  return end;
}
