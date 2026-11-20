/** Keep filters usable when fixed tabs and sorting would squeeze their scroll strip. */
export function singleLibraryStrip(width: number, tv: boolean): boolean {
  return !tv && width < 1200;
}

/** Arrows describe real clipped content, not the number of tabs or reserved padding. */
export function tabOverflow(x: number, viewport: number, content: number): { before: boolean; after: boolean } {
  return { before: x > 2, after: content > viewport + 2 && x + viewport < content - 2 };
}
