// A search field's placeholder reads as the document's secondary text, not as typed text: regular
// weight, a step smaller than the field's own text, in the field's muted placeholder ink. Native
// text inputs draw their placeholder in the input's own font, so the field takes these rows while
// it is empty and its typed rows once there is text.
import type { Css } from '../../translate';

/** The smallest placeholder size: Vela's secondary text never draws smaller. */
const SECONDARY_MIN = 14;
/** The secondary step under body text (Cinematic: 15px secondary under a 17px field). */
const SECONDARY_STEP = 0.88;

/** The placeholder's size for a field whose text is `typed` px: never larger than the typed text. */
export function placeholderSize(typed: number): number {
  return Math.min(typed, Math.max(SECONDARY_MIN, Math.round(typed * SECONDARY_STEP)));
}

/** The field's text rows as its placeholder draws them, and that text's size in points: `typed`
 * is the field's drawn size in points, and a document px draws as `scale` points (more on a TV). */
export function placeholderRows(rows: Css, typed: number, scale: number): { rows: Css; fontSize: number } {
  const size = placeholderSize(typed / scale);
  return { rows: { ...rows, 'font-size': `${size}px`, 'font-weight': '400' }, fontSize: size * scale };
}
