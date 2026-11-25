// Which list Now Playing shows beside or below the transport: Up Next, a book's chapters, the
// lyrics, or Sound. Pure, so the rules are testable without a renderer.

export type NowPlayingList = 'queue' | 'chapters' | 'lyrics' | 'sound';

/** What the item playing offers besides Up Next and Sound. */
export interface NowPlayingLists { chapters: boolean; lyrics: boolean }

/** Whether `list` can be shown for the item playing. */
export function listOffered(list: NowPlayingList, offered: NowPlayingLists): boolean {
  return list === 'chapters' ? offered.chapters : list === 'lyrics' ? offered.lyrics : true;
}

/**
 * The list after the item changes: Sound stays open (the viewer is adjusting it); a book with
 * chapters shows them; the lyrics stay if the new item has them; else Up Next.
 */
export function listForItem(current: NowPlayingList, offered: NowPlayingLists): NowPlayingList {
  if (current === 'sound') return 'sound';
  if (offered.chapters) return 'chapters';
  return current === 'lyrics' && offered.lyrics ? 'lyrics' : 'queue';
}

/**
 * The header's Sound button: it opens Sound, and from Sound goes back to the list it was opened
 * over (Up Next if that list is gone, say the next song has no lyrics).
 */
export function toggleSound(current: NowPlayingList, before: NowPlayingList, offered: NowPlayingLists): NowPlayingList {
  if (current !== 'sound') return 'sound';
  return before !== 'sound' && listOffered(before, offered) ? before : offered.chapters ? 'chapters' : 'queue';
}
