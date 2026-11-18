import type { Css } from './translate';
import { fontSizeOf, type Viewport } from './css';
import { inheritRows } from './inherit-rows';

/** Inherited sizes are already in native points; reparsing them as CSS px scales them twice. */
export function inheritText(parent: { rows: Css; fontSize: number }, inherited: Css, viewport: Viewport) {
  if (!Object.keys(inherited).length) return parent;
  const rows = inheritRows(parent.rows, inherited);
  const fontSize = fontSizeOf(rows['font-size'], parent.fontSize, { viewport, fontSize: parent.fontSize, axis: 'x' });
  return { rows: { ...rows, 'font-size': String(fontSize) }, fontSize };
}
