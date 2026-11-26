/** Older reading labels may already end in a percentage. The book hero supplies its own. */
export function readingChapterLabel(label: string): string {
  return label.replace(/(?:^| · )\d+(?:[.,]\d+)?\s*%\s*$/, '');
}
