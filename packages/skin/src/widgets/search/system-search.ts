// Apple TV searches on the system's own search screen (the app's search route, hosting
// UISearchController with React results): the skin's fields there only open it.

/** Whether search happens on the system search screen rather than in the skin's field. */
export function systemSearch(os: string, tv: boolean | undefined): boolean {
  return os === 'ios' && !!tv;
}
