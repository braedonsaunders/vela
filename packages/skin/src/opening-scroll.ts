/** Detail-like routes always begin at their top; ordinary routes retain their own scroll policy. */
export function opensAtTop(route: string): boolean {
  return route === 'title' || route === 'screen';
}

/** Keep native focus from pulling an opening detail page down during its entrance/focus settle. */
export function pinOpeningScroll(opened: number, now: number, viewerMoved: boolean, settleMs = 1400): boolean {
  return !viewerMoved && now - opened <= settleMs;
}
