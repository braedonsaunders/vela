/** Older reading labels may already end in a percentage. The book hero supplies its own. */
export function readingChapterLabel(label: string): string {
  return label.replace(/(?:^| · )\d+(?:[.,]\d+)?\s*%\s*$/, '');
}

/** The enlarged native cover needs just its broad color shapes behind the hero. */
export function readBackdropComponents(page: 'book' | 'series', platform: string, tv: boolean): [number, number] | undefined {
  return page === 'book' && (tv || platform === 'ios') ? [3, 4] : undefined;
}
