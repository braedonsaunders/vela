// Where the viewer left a page's scroll, by page key, so the same page drawn again (a shell changing
// form on a fold or a resize, or Back to a page) is put back where it was. Pure; kept for the app's run.

export interface ScrollMemory {
  keep(key: string, offset: number): void;
  /** Where to put the page back (0: its top). */
  resume(key: string): number;
}

/** At most this many pages are remembered (the oldest forgotten first). */
const PAGES = 50;

export function createScrollMemory(limit = PAGES): ScrollMemory {
  const offsets = new Map<string, number>();
  return {
    keep(key, offset) {
      offsets.delete(key);
      if (offset > 0) offsets.set(key, offset);
      while (offsets.size > limit) offsets.delete(offsets.keys().next().value!);
    },
    resume: key => offsets.get(key) ?? 0,
  };
}

/** The memory the experience host's pages share. */
export const pageScrollMemory = createScrollMemory();
