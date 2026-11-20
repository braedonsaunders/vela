let pendingTitle = '';

/** Remember that the next matching title route was opened from inside Vela. */
export function noteTitleNavigation(id: string): void {
  pendingTitle = id;
}

/** Direct/deep links must not trust Expo's synthetic history. */
export function isTitleNavigation(id: string): boolean {
  return !!id && pendingTitle === id;
}

export function clearTitleNavigation(id: string): void {
  if (pendingTitle === id) pendingTitle = '';
}
