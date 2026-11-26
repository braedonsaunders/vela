/** Older reading labels may already end in a percentage. The book hero supplies its own. */
export function readingChapterLabel(label: string): string {
  return label.replace(/(?:^| · )\d+(?:[.,]\d+)?\s*%\s*$/, '');
}

/** Enlarged book covers put their lettering behind the foreground cover on TV. */
export function readTitleBackdrop(page: 'book' | 'series', tv: boolean, poster = ''): string {
  return tv && page === 'book' ? '' : poster;
}
