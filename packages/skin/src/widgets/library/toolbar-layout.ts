/** Arrows describe real clipped content, not the number of tabs or reserved padding. */
export function tabOverflow(x: number, viewport: number, content: number): { before: boolean; after: boolean } {
  return { before: x > 2, after: content > viewport + 2 && x + viewport < content - 2 };
}
