export type RowDirection = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

/** The card position to focus for a directional key, independent of DOM layout. */
export function rowFocusDestination(
  row: number,
  item: number,
  lengths: readonly number[],
  key: RowDirection,
): { row: number; item: number } | null {
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    const next = item + (key === 'ArrowRight' ? 1 : -1);
    return next >= 0 && next < (lengths[row] ?? 0) ? { row, item: next } : null;
  }
  const nextRow = row + (key === 'ArrowDown' ? 1 : -1);
  const length = lengths[nextRow] ?? 0;
  return length > 0 ? { row: nextRow, item: Math.min(item, length - 1) } : null;
}

/** Move among cards in web shelves. Native TV focus engines already provide spatial movement. */
export function moveWebRowFocus(target: HTMLElement, key: string): boolean {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return false;
  const currentRow = target.closest<HTMLElement>('[data-vela-row]');
  if (!currentRow) return false;
  const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-vela-row]')).filter(row =>
    !row.closest('[aria-hidden="true"]') && row.querySelector('[data-vela-row-item]'),
  );
  const row = rows.indexOf(currentRow);
  const items = rows.map(node => Array.from(node.querySelectorAll<HTMLElement>('[data-vela-row-item]')));
  const item = items[row]?.indexOf(target) ?? -1;
  if (row < 0 || item < 0) return false;
  const destination = rowFocusDestination(row, item, items.map(group => group.length), key as RowDirection);
  if (!destination) return false;
  const next = items[destination.row]?.[destination.item];
  if (!next) return false;
  next.focus({ preventScroll: true });
  next.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  return true;
}
