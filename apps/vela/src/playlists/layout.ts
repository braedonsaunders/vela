/** The playlists page at the width between the screen's side insets: a phone puts the create
 * field and New on their own row under the heading, with a narrower side inset, and shows two
 * columns where three cards (160 px each, 20 px apart) do not fit. In two columns `card` caps a
 * card at one column's width, so a lone last card keeps the size of the rows above it; with three
 * columns it is null and the cards keep their 160-280 px bounds. A TV always keeps one row and
 * three columns, whatever width it reports. */
export function playlistsLayout(width: number, tv: boolean): { stacked: boolean; columns: number; gutter: number; card: number | null } {
  const gutter = !tv && width < 640 ? 20 : 30;
  if (tv || width - 2 * gutter >= 3 * 160 + 2 * 20) return { stacked: !tv && width < 600, columns: 3, gutter, card: null };
  return { stacked: width < 600, columns: 2, gutter, card: Math.min(280, Math.floor((width - 2 * gutter - 20) / 2)) };
}
