// Which of the music home's own shelves and tiles give way to the page's rows. Ether's
// Recommendations page may carry its own play contexts (purpose recentContexts: Jump back in) and
// liked music (purpose liked); when it does, Vela's own Recently played / Jump back in shelves and
// its Liked Songs tile are not drawn beside them. Pure, so it is tested without a renderer.
import type { Row } from '@vela/core';

export interface MusicHomeRows {
  /** The page has its own play-contexts row: Vela's own recent shelves are not drawn. */
  ownRecent: boolean;
  /** The page has its own liked row: Vela's Liked Songs tile is not drawn. */
  ownLiked: boolean;
  /** An older server's plugin Jump back in row's items (only when the page has no recentContexts row). */
  jump: Row['items'];
  /** The rows drawn as shelves, in page order. */
  shelves: Row[];
}

export function musicHomeRows(rows: readonly Row[], recentAvailable: boolean): MusicHomeRows {
  const ownRecent = rows.some(row => row.purpose === 'recentContexts');
  const ownLiked = rows.some(row => row.purpose === 'liked');
  // Before Recommendations, a plugin named these rows by id; kept only while the page has no purpose for them.
  const legacyJump = (row: Row) => !ownRecent && row.id.endsWith(':jump-back-in');
  const legacyRecent = (row: Row) => !ownRecent && recentAvailable && row.id.endsWith(':recently-played');
  return {
    ownRecent,
    ownLiked,
    jump: rows.find(legacyJump)?.items ?? [],
    // A plugin surface's row is drawn by its host on Home and library pages, not here.
    shelves: rows.filter(row => !row.surface && row.items.length > 0 && !legacyJump(row) && !legacyRecent(row)),
  };
}
