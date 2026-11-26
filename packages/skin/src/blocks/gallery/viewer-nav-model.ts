export type PhotoDirection = -1 | 1;

export interface PhotoNeighbours<T> {
  previous?: T;
  next?: T;
  more: boolean;
}

/** The current photo stays at the centre of the opening grid's order. */
export function photoNeighbours<T extends { id: string }>(photos: readonly T[], current: string, more: boolean): PhotoNeighbours<T> {
  const index = photos.findIndex(photo => photo.id === current);
  if (index < 0) return { more: false };
  return { previous: photos[index - 1], next: photos[index + 1], more: more && index === photos.length - 1 };
}

interface TouchPoint { x: number; y: number }

/** Only deliberate horizontal swipes page the viewer. Vertical drags can scroll the facts. */
export function photoSwipe(start: TouchPoint, end: TouchPoint): PhotoDirection | undefined {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
  return dx < 0 ? 1 : -1;
}

/** Expo Router decodes parameters on web. Keep a screen key's own percent escapes intact. */
export function galleryOriginParam(pageKey: string): string {
  return pageKey.replace(/[%~]/g, character => character === '%' ? '~p' : '~~');
}

export function galleryOriginKey(param: string): string {
  return param.replace(/~[~p]/g, escape => escape === '~p' ? '%' : '~');
}
